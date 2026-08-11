"""
Local speech-to-text via Whisper.

The original uploaded every 4-second audio chunk to the Gemini API for
transcription. That has three problems for this use case: it requires a key
and a network round-trip for something a laptop can do offline, it sends the
audio of private meetings to a third party, and it made transcription
impossible when using a local Ollama model -- an app that otherwise runs fully
offline still phoned home to hear you.

openai-whisper runs locally. The model loads lazily on first use so startup
stays fast, and transcription happens on a worker thread so the UI never
blocks.
"""
from __future__ import annotations

import queue
import threading
from typing import Callable

import numpy as np

from .capture import Utterance

# Trade-offs shown in the settings UI so the choice is informed.
MODEL_CHOICES = [
    ("tiny.en", "Tiny (English) - fastest, ~75 MB, lowest accuracy"),
    ("base.en", "Base (English) - good balance, ~150 MB"),
    ("small.en", "Small (English) - more accurate, ~500 MB"),
    ("medium.en", "Medium (English) - high accuracy, ~1.5 GB"),
    ("large-v3", "Large v3 - best accuracy, multilingual, ~3 GB"),
]

# Whisper hallucinates stock phrases on silence or noise. These are the
# common ones; dropping them stops the transcript filling with subtitle
# boilerplate during quiet stretches.
_HALLUCINATIONS = {
    "you", "thank you.", "thanks for watching!", "thank you.",
    "subscribe to my channel", "thanks for watching.",
    "please subscribe to my channel", "bye.", "bye bye.",
    "subtitles by the amara.org community", ".", "!", "?",
    "you're welcome.", "thank you for watching.", "[music]", "[silence]",
    "(upbeat music)", "the end.",
}

# Distinct from None, which _next_item uses to mean "nothing available yet".
_SENTINEL = object()


class Transcriber:
    """
    Background Whisper worker.

    Utterances go in, `on_text(speaker, text, partial)` fires on completion.
    Model loading is deferred and reported so the UI can show progress rather
    than appearing frozen for the seconds it takes.

    Partial handling: interim snapshots arrive faster than they can be
    transcribed, so a naive queue falls further behind live speech with every
    one. Instead only the newest partial per speaker is kept -- an interim
    result that has already been superseded has no value, so it is dropped
    rather than transcribed. Final utterances are never dropped.
    """

    def __init__(self, model_name: str = "base.en",
                 on_text: Callable[[str, str, bool], None] | None = None,
                 on_status: Callable[[str], None] | None = None) -> None:
        self.model_name = model_name
        self.on_text = on_text
        self.on_status = on_status
        self._model = None
        self._queue: "queue.Queue[Utterance | None]" = queue.Queue()
        # Newest pending partial per speaker; older ones are discarded.
        self._pending_partial: dict[str, Utterance] = {}
        self._partial_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._load_lock = threading.Lock()
        self.error: str = ""
        self.dropped_partials = 0

    # ------------------------------------------------------------------ model
    def _status(self, message: str) -> None:
        if self.on_status:
            self.on_status(message)

    def ensure_model(self) -> bool:
        """Load the model, downloading on first use. Safe to call repeatedly."""
        if self._model is not None:
            return True
        with self._load_lock:
            if self._model is not None:
                return True
            try:
                import whisper
            except ImportError:
                self.error = ("openai-whisper is not installed "
                              "(pip install openai-whisper).")
                self._status(self.error)
                return False
            try:
                self._status(f"Loading Whisper '{self.model_name}'...")
                self._model = whisper.load_model(self.model_name)
                self._status("")
                return True
            except Exception as exc:
                self.error = f"Could not load Whisper model: {exc}"
                self._status(self.error)
                return False

    # ----------------------------------------------------------------- worker
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="transcriber")
        self._thread.start()

    def _run(self) -> None:
        if not self.ensure_model():
            return
        while not self._stop.is_set():
            item = self._next_item()
            if item is None:
                continue
            if item is _SENTINEL:
                break
            try:
                text = self._transcribe(item.audio)
            except Exception as exc:
                self.error = str(exc)
                continue
            if text and self.on_text:
                self.on_text(item.speaker, text, item.partial)

    def _next_item(self):
        """
        Prefer a final utterance; otherwise take the newest partial.

        Finals carry the authoritative text and must never be skipped, so they
        take priority over interim snapshots even when partials are queued.
        """
        try:
            item = self._queue.get(timeout=0.25)
            return item if item is not None else _SENTINEL
        except queue.Empty:
            pass
        with self._partial_lock:
            if self._pending_partial:
                speaker = next(iter(self._pending_partial))
                return self._pending_partial.pop(speaker)
        return None

    def _transcribe(self, audio: np.ndarray) -> str:
        if self._model is None or audio.size == 0:
            return ""
        # Whisper wants float32 in [-1, 1]; clipping guards against loopback
        # sources that occasionally deliver hot samples.
        audio = np.clip(audio.astype(np.float32), -1.0, 1.0)
        result = self._model.transcribe(
            audio,
            fp16=False,            # CPU path; fp16 warns and falls back anyway
            language="en" if self.model_name.endswith(".en") else None,
            condition_on_previous_text=False,  # stops repetition loops
            temperature=0.0,       # deterministic, no sampling drift
        )
        text = (result.get("text") or "").strip()
        if text.lower().strip() in _HALLUCINATIONS:
            return ""
        return text

    def submit(self, utterance: Utterance) -> None:
        """
        Queue an utterance.

        Partials replace any earlier un-transcribed partial from the same
        speaker instead of queueing behind it, so the interim text shown always
        reflects the most recent audio rather than lagging further behind the
        longer someone talks.
        """
        if utterance.partial:
            with self._partial_lock:
                if utterance.speaker in self._pending_partial:
                    self.dropped_partials += 1
                self._pending_partial[utterance.speaker] = utterance
        else:
            # A final supersedes any outstanding partial for that speaker.
            with self._partial_lock:
                self._pending_partial.pop(utterance.speaker, None)
            self._queue.put(utterance)

    def stop(self) -> None:
        self._stop.set()
        self._queue.put(None)
        if self._thread:
            self._thread.join(timeout=3.0)

    @property
    def ready(self) -> bool:
        return self._model is not None

    @property
    def backlog(self) -> int:
        return self._queue.qsize() + len(self._pending_partial)
