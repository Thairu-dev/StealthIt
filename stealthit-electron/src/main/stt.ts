import type { TranscribeChunkRequest, TranscribeChunkResult } from '@shared/types';
import type { LocalStore } from './storage';

const WHISPER_HALLUCINATION_EXACT = new Set([
  'thank you',
  'thank you.',
  'thanks',
  'thanks.',
  'thanks for watching',
  'thanks for watching.',
  'thank you for watching',
  'thank you for watching.',
  'please subscribe',
  'subscribe',
  'you',
  'you.',
  'bye',
  'bye.',
  'goodbye',
  'goodbye.',
  'hmm',
  'uh',
  'um',
  'mbc 뉴스',
  'subtitles by the amara.org community',
]);

export function filterWhisperHallucination(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return '';
  // Reject SRT/VTT timestamp hallucinations (e.g. "00:00:00.000 --> 00:00:03.000 I'm not sure.")
  if (/\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(cleaned)) return '';
  // Reject explicit [SILENCE] sentinel returned by Gemini audio prompt
  if (/^\[?\s*silence\s*\]?\.?$/i.test(cleaned)) return '';
  // Drop bracketed/parenthesized non-speech tags like [Music], (Silence), ♪
  const withoutTags = cleaned
    .replace(/\[[^\]]*\]|\([^)]*\)|♪+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutTags || /^[\p{P}\p{S}\s]+$/u.test(withoutTags)) return '';
  const normalized = withoutTags.toLowerCase().replace(/[!?,.\s]+$/g, '').trim();
  if (WHISPER_HALLUCINATION_EXACT.has(normalized) || WHISPER_HALLUCINATION_EXACT.has(withoutTags.toLowerCase())) {
    return '';
  }
  return withoutTags;
}

export interface WhisperVerboseSegment {
  text?: string;
  no_speech_prob?: number;
  avg_logprob?: number;
}

export function extractReliableWhisperText(data: {
  text?: string;
  segments?: WhisperVerboseSegment[];
}): string {
  if (Array.isArray(data.segments) && data.segments.length > 0) {
    const kept = data.segments
      .filter((seg) => {
        const noSpeech = seg.no_speech_prob ?? 0;
        const logprob = seg.avg_logprob ?? 0;
        return noSpeech <= 0.6 && logprob >= -1.05;
      })
      .map((seg) => (seg.text ?? '').trim())
      .filter(Boolean)
      .join(' ');
    return filterWhisperHallucination(kept);
  }
  return filterWhisperHallucination(data.text ?? '');
}

export async function transcribeAudioChunk(
  store: LocalStore,
  req: TranscribeChunkRequest
): Promise<TranscribeChunkResult> {
  const settings = store.getSettings();
  const stt = settings.stt;

  const wavBuffer = Buffer.from(req.wavBase64, 'base64');
  if (wavBuffer.byteLength < 1000) {
    return { text: '', speaker: req.speaker };
  }

  let endpoint = '';
  let apiKey: string | null = null;
  let model = stt.model;

  if (stt.provider === 'openai-whisper') {
    endpoint = 'https://api.openai.com/v1/audio/transcriptions';
    apiKey = store.getSecret('openai');
    model = model || 'whisper-1';
    if (!apiKey) {
      return {
        text: '',
        speaker: req.speaker,
        error: 'OpenAI API key missing for Whisper transcription.',
      };
    }
  } else if (stt.provider === 'groq-whisper') {
    endpoint = 'https://api.groq.com/openai/v1/audio/transcriptions';
    apiKey = store.getSecret('groq');
    model = model || 'whisper-large-v3-turbo';
    if (!apiKey) {
      return {
        text: '',
        speaker: req.speaker,
        error: 'Groq API key missing for Groq Whisper transcription.',
      };
    }
  } else if (stt.provider === 'gemini-audio') {
    const geminiKey = store.getSecret('gemini');
    if (!geminiKey) {
      return {
        text: '',
        speaker: req.speaker,
        error: 'Google Gemini API key missing. Add it in Dashboard -> API Keys or Audio & Voice.',
      };
    }
    const baseUrl = (
      settings.providers.gemini.baseUrl || 'https://generativelanguage.googleapis.com'
    ).replace(/\/+$/, '');
    const geminiModel = model || 'gemini-2.5-flash';
    const langHint =
      stt.language && stt.language !== 'auto'
        ? ` The speaker is likely speaking "${stt.language}".`
        : '';
    try {
      const res = await fetch(
        `${baseUrl}/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/wav',
                      data: req.wavBase64,
                    },
                  },
                  {
                    text: `Transcribe only clear spoken human speech in this audio verbatim.${langHint} Return ONLY the exact spoken words with normal punctuation. Never include timestamps, SRT/VTT timecodes, or guesses. If the audio is silent, muffled, or only background noise, return ONLY: [SILENCE]`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
            },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        return {
          text: '',
          speaker: req.speaker,
          error: `Gemini Audio error (${res.status}): ${errText.slice(0, 160)}`,
        };
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const rawText = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join(' ');
      return {
        text: filterWhisperHallucination(rawText),
        speaker: req.speaker,
      };
    } catch (err) {
      return {
        text: '',
        speaker: req.speaker,
        error: err instanceof Error ? err.message : 'Gemini audio transcription failed',
      };
    }
  } else if (stt.provider === 'local-whisper') {
    endpoint = stt.localUrl || 'http://localhost:8000/v1/audio/transcriptions';
    model = model || 'Systran/faster-whisper-small';
  } else {
    // Deepgram uses direct WebSocket streaming in renderer; fallback REST if invoked
    const dgKey = store.getSecret('deepgram');
    if (!dgKey) {
      return {
        text: '',
        speaker: req.speaker,
        error: 'Deepgram API key missing.',
      };
    }
    try {
      const res = await fetch(
        `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(stt.model || 'nova-3')}&language=${encodeURIComponent(stt.language || 'en')}&smart_format=true`,
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${dgKey}`,
            'Content-Type': 'audio/wav',
          },
          body: wavBuffer,
          signal: AbortSignal.timeout(12000),
        }
      );
      if (!res.ok) {
        return {
          text: '',
          speaker: req.speaker,
          error: `Deepgram HTTP ${res.status}`,
        };
      }
      const data = (await res.json()) as {
        results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
      };
      const text =
        data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? '';
      return { text, speaker: req.speaker };
    } catch (err) {
      return {
        text: '',
        speaker: req.speaker,
        error: err instanceof Error ? err.message : 'Deepgram request failed',
      };
    }
  }

  try {
    const formData = new FormData();
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'chunk.wav');
    formData.append('model', model);
    formData.append('temperature', '0');
    if (stt.provider === 'groq-whisper' || stt.provider === 'openai-whisper') {
      formData.append('response_format', 'verbose_json');
    }
    if (stt.language && stt.language !== 'auto') {
      formData.append('language', stt.language);
    }

    const headers: Record<string, string> = {};
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return {
        text: '',
        speaker: req.speaker,
        error: `STT error (${res.status}): ${errText.slice(0, 160)}`,
      };
    }

    const data = (await res.json()) as {
      text?: string;
      segments?: WhisperVerboseSegment[];
    };
    return {
      text: extractReliableWhisperText(data),
      speaker: req.speaker,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Transcription request failed';
    const friendly =
      stt.provider === 'local-whisper' && /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(raw)
        ? `No local Whisper server is running at ${endpoint}. Start an OpenAI-compatible Whisper server (e.g. faster-whisper-server, whisper.cpp server, or "npm run whisper:local" from source) — or switch to Groq Whisper (free tier), OpenAI, or Gemini Audio in Dashboard -> Audio & Voice.`
        : raw;
    return {
      text: '',
      speaker: req.speaker,
      error: friendly,
    };
  }
}
