import type { SpeakerRole, STTConfig, TranscriptSegment } from '@shared/types';
import { getBridge } from './bridge';
import {
  bytesToBase64,
  computeRms,
  concatFloat32Arrays,
  downsampleTo16k,
  encodeWavBuffer,
  floatToInt16Pcm,
  isEchoDuplicate,
} from '@shared/wavEncoder';

export interface AudioEngineCallbacks {
  onTranscript: (segment: TranscriptSegment) => void;
  onAudioLevel: (level: number) => void;
  onStatus: (status: string) => void;
  onError: (message: string) => void;
}

interface ChannelPipeline {
  speaker: SpeakerRole;
  stream: MediaStream;
  audioCtx: AudioContext;
  processor: ScriptProcessorNode;
  ws?: WebSocket;
  keepAliveTimer?: number;
  cleanup: () => void;
}

export class DualAudioEngine {
  private channels: ChannelPipeline[] = [];
  private running = false;
  private levelThem = 0;
  private levelYou = 0;
  private rawRmsThem = 0;
  private lastSystemAudioMs = 0;
  private recentSystemTranscripts: Array<{ text: string; timestamp: number }> = [];

  public isRunning(): boolean {
    return this.running;
  }

  public async start(config: STTConfig, callbacks: AudioEngineCallbacks): Promise<void> {
    if (this.running) return;
    this.running = true;

    const bridge = getBridge();
    const useDeepgramWs = config.provider === 'deepgram';
    let deepgramToken: string | null = null;

    if (useDeepgramWs) {
      deepgramToken = await bridge.getDeepgramToken();
      if (!deepgramToken) {
        this.running = false;
        callbacks.onError(
          'Deepgram API key not configured. Add it in Dashboard -> Audio & STT, or switch to OpenAI/Groq/Local Whisper.'
        );
        return;
      }
    }

    const startedSources: string[] = [];

    if (config.captureSystemAudio) {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
        });
        // Immediately release unused video track to keep GPU/CPU overhead near zero
        for (const vt of displayStream.getVideoTracks()) {
          vt.stop();
        }
        const audioTracks = displayStream.getAudioTracks();
        if (audioTracks.length > 0) {
          const audioOnly = new MediaStream(audioTracks);
          const pipeline = this.createChannelPipeline(
            'them',
            audioOnly,
            config,
            deepgramToken,
            callbacks
          );
          this.channels.push(pipeline);
          startedSources.push('System');
        } else {
          callbacks.onError('System audio loopback track was unavailable on this display.');
        }
      } catch (err) {
        callbacks.onError(
          `System audio capture failed: ${err instanceof Error ? err.message : 'Permission denied'}`
        );
      }
    }

    if (config.captureMicrophone) {
      try {
        const audioConstraint: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(config.micDeviceId && config.micDeviceId !== 'default'
            ? { deviceId: { exact: config.micDeviceId } }
            : {}),
        };
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: false,
        });
        const pipeline = this.createChannelPipeline(
          'you',
          micStream,
          config,
          deepgramToken,
          callbacks
        );
        this.channels.push(pipeline);
        startedSources.push('Mic');
      } catch (err) {
        callbacks.onError(
          `Microphone capture failed: ${err instanceof Error ? err.message : 'Check mic permissions'}`
        );
      }
    }

    if (this.channels.length === 0) {
      this.running = false;
      callbacks.onError('No audio channels could be started. Check Audio settings.');
      return;
    }

    callbacks.onStatus(`Listening (${startedSources.join(' + ')})`);
  }

  public stop(): void {
    this.running = false;
    for (const ch of this.channels) {
      try {
        ch.cleanup();
      } catch {
        // Ignore teardown errors
      }
    }
    this.channels = [];
    this.levelThem = 0;
    this.levelYou = 0;
    this.rawRmsThem = 0;
    this.lastSystemAudioMs = 0;
    this.recentSystemTranscripts = [];
  }

  private createChannelPipeline(
    speaker: SpeakerRole,
    stream: MediaStream,
    config: STTConfig,
    deepgramToken: string | null,
    callbacks: AudioEngineCallbacks
  ): ChannelPipeline {
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    // Silent sink node so ScriptProcessorNode ticks without echoing audio to speakers
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    let ws: WebSocket | undefined;
    let keepAliveTimer: number | undefined;
    const interimId = `interim-${speaker}-${Date.now()}`;

    if (config.provider === 'deepgram' && deepgramToken) {
      const params = new URLSearchParams({
        model: config.model || 'nova-3',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        interim_results: 'true',
        smart_format: 'true',
        punctuate: 'true',
        endpointing: '350',
      });
      if (config.language && config.language !== 'auto') {
        params.set('language', config.language);
      }

      const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, [
        'token',
        deepgramToken,
      ]);
      ws = socket;

      socket.onmessage = (evt) => {
        try {
          const data = JSON.parse(String(evt.data)) as {
            is_final?: boolean;
            channel?: { alternatives?: Array<{ transcript?: string }> };
          };
          const transcript = data.channel?.alternatives?.[0]?.transcript?.trim();
          if (!transcript) return;
          const isFinal = Boolean(data.is_final);
          callbacks.onTranscript({
            id: isFinal ? `${speaker}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : interimId,
            speaker,
            text: transcript,
            timestamp: Date.now(),
            isFinal,
          });
        } catch {
          // Ignore non-JSON frames
        }
      };

      socket.onerror = () => {
        callbacks.onError(`Deepgram live stream error on ${speaker.toUpperCase()} channel.`);
      };

      keepAliveTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 8000);

      processor.onaudioprocess = (event) => {
        if (!this.running) return;
        const input = event.inputBuffer.getChannelData(0);
        const rms = computeRms(input);
        this.reportLevel(speaker, rms, callbacks);

        if (socket.readyState === WebSocket.OPEN) {
          const downsampled = downsampleTo16k(input, audioCtx.sampleRate, 16000);
          const pcm16 = floatToInt16Pcm(downsampled);
          socket.send(pcm16.buffer);
        }
      };
    } else {
      // VAD-chunked pipeline for OpenAI Whisper / Groq Whisper / Local Whisper Server
      const preSpeechQueue: Float32Array[] = [];
      const maxPreSpeechFrames = 3; // ~255ms lookback
      let speechFrames: Float32Array[] = [];
      let trailingSilenceFrames = 0;
      let activeSpeechFrames = 0;
      let peakRms = 0;
      let noiseFloor = speaker === 'you' ? 0.005 : 0.004;
      let inSpeech = false;
      let silenceStartMs = 0;
      let speechStartMs = 0;
      const maxUtteranceMs = 15000;
      const minActiveFrames = 3; // ~255ms of actual voice

      const flushUtterance = (frames: Float32Array[]): void => {
        if (frames.length === 0) return;
        const merged = concatFloat32Arrays(frames);
        const downsampled = downsampleTo16k(merged, audioCtx.sampleRate, 16000);
        const pcm16 = floatToInt16Pcm(downsampled);
        const wavBytes = encodeWavBuffer(pcm16, 16000);
        const wavBase64 = bytesToBase64(wavBytes);

        void getBridge()
          .transcribeChunk({ wavBase64, speaker })
          .then((result) => {
            if (result.error) {
              callbacks.onError(result.error);
              return;
            }
            const text = result.text.trim();
            if (!text) return;

            const nowMs = Date.now();
            // Prune system transcript echo window (> 8s old)
            this.recentSystemTranscripts = this.recentSystemTranscripts.filter(
              (entry) => nowMs - entry.timestamp < 8000
            );

            if (speaker === 'them') {
              this.recentSystemTranscripts.push({ text, timestamp: nowMs });
            } else if (
              isEchoDuplicate(
                text,
                this.recentSystemTranscripts.map((e) => e.text)
              )
            ) {
              // Drop mic pickup that merely echoes recent speaker audio
              return;
            }

            callbacks.onTranscript({
              id: `${speaker}-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
              speaker,
              text,
              timestamp: nowMs,
              isFinal: true,
            });
          })
          .catch((err: unknown) => {
            callbacks.onError(
              err instanceof Error ? err.message : 'Audio chunk transcription failed.'
            );
          });
      };

      processor.onaudioprocess = (event) => {
        if (!this.running) return;
        const input = new Float32Array(event.inputBuffer.getChannelData(0));
        const rms = computeRms(input);
        this.reportLevel(speaker, rms, callbacks);

        const now = Date.now();
        if (speaker === 'them') {
          this.rawRmsThem = rms;
          if (rms >= 0.008) {
            this.lastSystemAudioMs = now;
          }
        }

        // Adaptive noise floor (tracks steady fan/room hum without drifting up during speech)
        const baseThreshold =
          speaker === 'you'
            ? Math.max(config.vadThreshold * 0.75, 0.014, noiseFloor * 2.2)
            : Math.max(config.vadThreshold * 0.6, 0.012, noiseFloor * 2.2);

        // Speaker-bleed gate using raw system RMS (paired with cross-channel text echo dedup)
        const systemRecentlyActive = now - this.lastSystemAudioMs < 1200;
        let isVoice = false;
        if (speaker === 'you') {
          if (systemRecentlyActive) {
            isVoice = rms >= Math.max(baseThreshold * 1.6, 0.048, this.rawRmsThem * 1.15);
          } else {
            isVoice = rms >= baseThreshold;
          }
        } else {
          isVoice = rms >= baseThreshold;
        }

        if (!isVoice) {
          // Slowly adapt noise floor downward/upward during quiet frames
          noiseFloor = noiseFloor * 0.96 + Math.min(rms, 0.04) * 0.04;
        }

        if (isVoice) {
          if (!inSpeech) {
            inSpeech = true;
            speechStartMs = now;
            activeSpeechFrames = 1;
            peakRms = rms;
            trailingSilenceFrames = 0;
            speechFrames = [...preSpeechQueue, input];
          } else {
            activeSpeechFrames++;
            if (rms > peakRms) peakRms = rms;
            trailingSilenceFrames = 0;
            speechFrames.push(input);
          }
          silenceStartMs = 0;

          if (now - speechStartMs >= maxUtteranceMs) {
            const toSend = speechFrames;
            const hadEnoughSpeech = activeSpeechFrames >= minActiveFrames;
            speechFrames = [];
            activeSpeechFrames = 0;
            peakRms = 0;
            trailingSilenceFrames = 0;
            speechStartMs = now;
            if (hadEnoughSpeech) {
              flushUtterance(toSend);
            }
          }
        } else if (inSpeech) {
          // Keep at most 2 trailing silence frames (~170ms) so Whisper doesn't get 1s+ of dead air
          if (trailingSilenceFrames < 2) {
            speechFrames.push(input);
            trailingSilenceFrames++;
          }
          if (silenceStartMs === 0) {
            silenceStartMs = now;
          } else if (now - silenceStartMs >= config.vadSilenceMs) {
            const toSend = speechFrames;
            const hadEnoughSpeech =
              activeSpeechFrames >= minActiveFrames && peakRms >= baseThreshold * 1.15;
            inSpeech = false;
            speechFrames = [];
            activeSpeechFrames = 0;
            peakRms = 0;
            trailingSilenceFrames = 0;
            silenceStartMs = 0;
            if (hadEnoughSpeech) {
              flushUtterance(toSend);
            }
          }
        } else {
          preSpeechQueue.push(input);
          if (preSpeechQueue.length > maxPreSpeechFrames) {
            preSpeechQueue.shift();
          }
        }
      };
    }

    const cleanup = (): void => {
      if (keepAliveTimer !== undefined) {
        window.clearInterval(keepAliveTimer);
      }
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.send(JSON.stringify({ type: 'CloseStream' }));
        } catch {
          // ignore
        }
        ws.close();
      }
      processor.disconnect();
      source.disconnect();
      silentGain.disconnect();
      for (const t of stream.getTracks()) {
        t.stop();
      }
      void audioCtx.close();
    };

    return { speaker, stream, audioCtx, processor, ws, keepAliveTimer, cleanup };
  }

  private reportLevel(speaker: SpeakerRole, rms: number, callbacks: AudioEngineCallbacks): void {
    const normalized = Math.min(1, rms * 9);
    if (speaker === 'them') {
      this.levelThem = normalized;
    } else {
      this.levelYou = normalized;
    }
    callbacks.onAudioLevel(Math.max(this.levelThem, this.levelYou));
  }
}
