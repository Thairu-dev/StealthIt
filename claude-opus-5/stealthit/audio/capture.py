"""
Dual-source audio capture: microphone + system loopback.

This is the capability that makes a meeting assistant useful and that the
original app lacked entirely. It recorded only the microphone via sounddevice,
which means during an interview or a call it could hear the user but not the
person asking the questions -- the half that actually matters.

WASAPI loopback captures whatever the speakers are playing, so the other
participant's voice is available even though it never touches a microphone.
Both sources run concurrently and are tagged, giving a speaker-attributed
transcript ([you] vs [them]) rather than an undifferentiated blob.
"""
from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass
from typing import Callable

import numpy as np

try:
    import pyaudiowpatch as pyaudio
    LOOPBACK_AVAILABLE = True
except ImportError:  # pragma: no cover
    try:
        import pyaudio  # type: ignore
    except ImportError:
        pyaudio = None  # type: ignore
    LOOPBACK_AVAILABLE = False

TARGET_RATE = 16000  # what Whisper wants
CHUNK_FRAMES = 1024


@dataclass
class Utterance:
    """
    A speech segment.

    `partial=True` marks an interim result: speech is still in progress and
    this is a snapshot of what has been said so far. Partials are what make
    the transcript appear live rather than in silence-delimited bursts; each
    is superseded by the next, and finally by the `partial=False` version.
    """
    speaker: str            # "you" | "them"
    audio: np.ndarray       # float32 mono @ 16 kHz
    started: float
    duration: float
    partial: bool = False
    seq: int = 0            # identifies the utterance a partial belongs to


def _resample(audio: np.ndarray, src_rate: int,
              dst_rate: int = TARGET_RATE) -> np.ndarray:
    """
    Linear resample to 16 kHz.

    Loopback devices commonly run at 44.1 or 48 kHz; feeding those to Whisper
    unresampled makes it transcribe gibberish at the wrong speed. Linear
    interpolation is crude but entirely adequate for speech recognition, and
    avoids a scipy dependency.
    """
    if src_rate == dst_rate or audio.size == 0:
        return audio
    duration = audio.shape[0] / src_rate
    dst_len = int(duration * dst_rate)
    if dst_len <= 0:
        return np.zeros(0, dtype=np.float32)
    src_idx = np.linspace(0, audio.shape[0] - 1, dst_len)
    return np.interp(src_idx, np.arange(audio.shape[0]),
                     audio).astype(np.float32)


def _to_mono(audio: np.ndarray, channels: int) -> np.ndarray:
    if channels <= 1:
        return audio
    return audio.reshape(-1, channels).mean(axis=1)


class VoiceGate:
    """
    Energy-based voice activity detection with hangover, emitting both interim
    and final segments.

    The original cut audio into fixed 4-second chunks regardless of content,
    which sliced words in half and sent silence to the API. Segmenting on
    speech boundaries instead means each final transcription contains one
    complete utterance -- better accuracy, and far fewer wasted calls.

    Hangover (holding "speaking" briefly after energy drops) prevents a
    natural pause mid-sentence from splitting one thought into two.

    Interim results: waiting for silence means nothing appears on screen while
    someone is mid-sentence, which during a call reads as the app being
    broken. So every `partial_interval` seconds of ongoing speech we also emit
    a snapshot of the audio so far, transcribed and shown as provisional text
    that is replaced when the utterance closes.
    """

    def __init__(self, threshold: float = 0.008,
                 min_seconds: float = 0.7, max_seconds: float = 12.0,
                 hangover_seconds: float = 0.6,
                 partial_interval: float = 1.1,
                 rate: int = TARGET_RATE) -> None:
        self.threshold = threshold
        self.min_samples = int(min_seconds * rate)
        self.max_samples = int(max_seconds * rate)
        self.hangover_samples = int(hangover_seconds * rate)
        self.partial_samples = int(partial_interval * rate)
        self.rate = rate
        self._buffer: list[np.ndarray] = []
        self._samples = 0
        self._silence = 0
        self._speaking = False
        self._started = 0.0
        self._last_partial_at = 0
        self.seq = 0

    def feed(self, block: np.ndarray) -> tuple[np.ndarray | None, bool]:
        """
        Push audio.

        Returns (audio, is_partial). `audio` is None when there is nothing to
        emit yet. A partial is a snapshot of in-progress speech; a non-partial
        is a completed utterance.
        """
        rms = float(np.sqrt(np.mean(block ** 2))) if block.size else 0.0
        voiced = rms > self.threshold

        if voiced:
            if not self._speaking:
                self._speaking = True
                self._started = time.time()
                self.seq += 1
                self._last_partial_at = 0
            self._silence = 0
            self._buffer.append(block)
            self._samples += block.shape[0]
        elif self._speaking:
            # Keep trailing silence: cutting it off clips word endings.
            self._buffer.append(block)
            self._samples += block.shape[0]
            self._silence += block.shape[0]

        if not self._speaking:
            return None, False

        closed = (self._silence >= self.hangover_samples
                  or self._samples >= self.max_samples)

        if not closed:
            # Emit an interim snapshot while speech continues.
            grown = self._samples - self._last_partial_at
            if (grown >= self.partial_samples
                    and self._samples >= self.min_samples):
                self._last_partial_at = self._samples
                return np.concatenate(self._buffer), True
            return None, False

        audio = (np.concatenate(self._buffer) if self._buffer
                 else np.zeros(0, dtype=np.float32))
        self.reset()
        # Discard blips: a door closing is not an utterance.
        if audio.shape[0] < self.min_samples:
            return None, False
        return audio, False

    def flush(self) -> np.ndarray | None:
        if not self._buffer or self._samples < self.min_samples:
            self.reset()
            return None
        audio = np.concatenate(self._buffer)
        self.reset()
        return audio

    def reset(self) -> None:
        self._buffer.clear()
        self._samples = 0
        self._silence = 0
        self._speaking = False
        self._last_partial_at = 0

    @property
    def speaking(self) -> bool:
        return self._speaking


class _SourceThread(threading.Thread):
    """One capture thread per audio source."""

    def __init__(self, speaker: str, device_index: int, rate: int,
                 channels: int, out_queue: "queue.Queue[Utterance]",
                 gate: VoiceGate, loopback: bool,
                 level_cb: Callable[[str, float], None] | None = None) -> None:
        super().__init__(daemon=True, name=f"audio-{speaker}")
        self.speaker = speaker
        self.device_index = device_index
        self.rate = rate
        self.channels = channels
        self.out_queue = out_queue
        self.gate = gate
        self.loopback = loopback
        self.level_cb = level_cb
        self._stop = threading.Event()
        self.error: str = ""

    def run(self) -> None:
        pa = pyaudio.PyAudio()
        stream = None
        try:
            stream = pa.open(
                format=pyaudio.paFloat32, channels=self.channels,
                rate=self.rate, input=True,
                input_device_index=self.device_index,
                frames_per_buffer=CHUNK_FRAMES)
            while not self._stop.is_set():
                try:
                    raw = stream.read(CHUNK_FRAMES,
                                      exception_on_overflow=False)
                except Exception:
                    # A transient overflow must not kill a capture that is
                    # meant to run for the length of a meeting.
                    continue
                block = np.frombuffer(raw, dtype=np.float32)
                block = _to_mono(block, self.channels)
                block = _resample(block, self.rate)

                if self.level_cb is not None and block.size:
                    self.level_cb(self.speaker,
                                  float(np.sqrt(np.mean(block ** 2))))

                utt, is_partial = self.gate.feed(block)
                if utt is not None:
                    self.out_queue.put(Utterance(
                        self.speaker, utt, time.time(),
                        utt.shape[0] / TARGET_RATE,
                        partial=is_partial, seq=self.gate.seq))

            tail = self.gate.flush()
            if tail is not None:
                self.out_queue.put(Utterance(
                    self.speaker, tail, time.time(),
                    tail.shape[0] / TARGET_RATE, seq=self.gate.seq))
        except Exception as exc:
            self.error = str(exc)
        finally:
            if stream is not None:
                try:
                    stream.stop_stream()
                    stream.close()
                except Exception:
                    pass
            pa.terminate()

    def stop(self) -> None:
        self._stop.set()


class AudioCapture:
    """
    Manages both capture sources and emits speech-bounded utterances.

    Consumers pull from `utterances`; the transcription worker turns them into
    text. Sources are independent, so a missing microphone does not stop
    system audio and vice versa.
    """

    def __init__(self, threshold: float = 0.008,
                 min_seconds: float = 0.7, max_seconds: float = 12.0,
                 partial_interval: float = 1.1,
                 level_cb: Callable[[str, float], None] | None = None) -> None:
        self.utterances: "queue.Queue[Utterance]" = queue.Queue()
        self.threshold = threshold
        self.min_seconds = min_seconds
        self.max_seconds = max_seconds
        self.partial_interval = partial_interval
        self.level_cb = level_cb
        self._threads: list[_SourceThread] = []
        self.errors: list[str] = []

    @staticmethod
    def available() -> bool:
        return pyaudio is not None

    @staticmethod
    def describe_devices() -> dict[str, str]:
        """Names of the devices we would use, for the settings UI."""
        out = {"microphone": "unavailable", "system_audio": "unavailable"}
        if pyaudio is None:
            return out
        pa = pyaudio.PyAudio()
        try:
            try:
                mic = pa.get_default_input_device_info()
                out["microphone"] = str(mic["name"])
            except Exception:
                pass
            if LOOPBACK_AVAILABLE:
                try:
                    lb = pa.get_default_wasapi_loopback()
                    out["system_audio"] = str(lb["name"])
                except Exception:
                    out["system_audio"] = "no loopback device found"
            else:
                out["system_audio"] = "requires PyAudioWPatch"
        finally:
            pa.terminate()
        return out

    def start(self, microphone: bool = True, system_audio: bool = True) -> None:
        if pyaudio is None:
            self.errors.append(
                "PyAudioWPatch is not installed; audio capture is unavailable.")
            return
        self.stop()
        self.errors.clear()
        pa = pyaudio.PyAudio()
        try:
            if microphone:
                try:
                    info = pa.get_default_input_device_info()
                    self._spawn("you", info, loopback=False)
                except Exception as exc:
                    self.errors.append(f"No microphone available ({exc}).")

            if system_audio:
                if not LOOPBACK_AVAILABLE:
                    self.errors.append(
                        "System audio needs PyAudioWPatch "
                        "(pip install PyAudioWPatch).")
                else:
                    try:
                        info = pa.get_default_wasapi_loopback()
                        self._spawn("them", info, loopback=True)
                    except Exception as exc:
                        self.errors.append(
                            f"No system-audio loopback device ({exc}).")
        finally:
            pa.terminate()

    def _spawn(self, speaker: str, info: dict, loopback: bool) -> None:
        gate = VoiceGate(self.threshold, self.min_seconds, self.max_seconds,
                         partial_interval=self.partial_interval)
        thread = _SourceThread(
            speaker=speaker,
            device_index=int(info["index"]),
            rate=int(info["defaultSampleRate"]),
            channels=min(2, int(info["maxInputChannels"])),
            out_queue=self.utterances, gate=gate, loopback=loopback,
            level_cb=self.level_cb)
        thread.start()
        self._threads.append(thread)

    def stop(self) -> None:
        for t in self._threads:
            t.stop()
        for t in self._threads:
            t.join(timeout=2.0)
            if t.error:
                self.errors.append(f"{t.speaker}: {t.error}")
        self._threads.clear()

    @property
    def running(self) -> bool:
        return any(t.is_alive() for t in self._threads)

    @property
    def active_sources(self) -> list[str]:
        return [t.speaker for t in self._threads if t.is_alive()]
