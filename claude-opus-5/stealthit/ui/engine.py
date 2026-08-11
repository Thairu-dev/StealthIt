"""
Threading bridge between streaming providers and the Qt event loop.

The original ran one QThread with a queue and emitted a single `response_ready`
signal carrying the whole answer, so nothing appeared until the request
finished. It also had no cancellation: once a request was in flight you waited,
even if you had already got what you needed or picked the wrong model.

Here each request is its own thread emitting `delta` signals as tokens arrive,
and `cancel()` stops the stream promptly. Provider objects are constructed per
request so a settings change mid-conversation takes effect immediately rather
than being captured once at startup.
"""
from __future__ import annotations

import threading
import time

from PIL import Image
from PySide6.QtCore import QObject, QThread, Signal

from ..core.config import Settings
from ..core.secrets import SecretStore
from ..core.session import Session
from ..providers import ProviderError, Request, build_provider
from ..providers.base import Provider


class StreamWorker(QThread):
    """Runs one streaming request."""

    started_stream = Signal()
    delta = Signal(str)
    finished_stream = Signal(str, dict)      # full text, usage
    failed = Signal(str, str, bool)          # message, hint, recoverable

    def __init__(self, provider: Provider, request: Request,
                 parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.provider = provider
        self.request = request
        self._cancel = threading.Event()
        self._text: list[str] = []

    def cancel(self) -> None:
        self._cancel.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def run(self) -> None:
        usage: dict[str, int] = {}
        try:
            self.started_stream.emit()
            for chunk in self.provider.stream(self.request):
                if self._cancel.is_set():
                    break
                if chunk.text:
                    self._text.append(chunk.text)
                    self.delta.emit(chunk.text)
                if chunk.done:
                    usage = chunk.usage
        except ProviderError as exc:
            # A cancelled stream can surface as a socket error; that is not a
            # failure the user needs to see.
            if not self._cancel.is_set():
                self.failed.emit(exc.message, exc.hint, exc.recoverable)
            return
        except Exception as exc:  # pragma: no cover - defensive
            if not self._cancel.is_set():
                self.failed.emit(str(exc)[:300], "", True)
            return

        text = "".join(self._text)
        if self._cancel.is_set():
            # Keep what was already streamed -- a partial answer is often
            # still useful, and silently discarding it is worse than keeping it.
            self.finished_stream.emit(text, usage)
        else:
            self.finished_stream.emit(text, usage)


class AIEngine(QObject):
    """
    Owns the current in-flight request.

    One request at a time by design: an overlay answering two questions
    concurrently into one pane is confusing, and starting a new request should
    cancel the old one rather than interleave.
    """

    started = Signal()
    delta = Signal(str)
    completed = Signal(str, dict)
    failed = Signal(str, str, bool)
    state_changed = Signal(str)  # idle | thinking

    def __init__(self, settings: Settings, secrets: SecretStore,
                 parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.settings = settings
        self.secrets = secrets
        self._worker: StreamWorker | None = None
        self._last_auto_suggest = 0.0

    @property
    def busy(self) -> bool:
        """
        Whether a request is in flight.

        The worker is deleted by Qt via deleteLater once it finishes, which
        leaves this Python wrapper pointing at a destroyed C++ object. Touching
        it then raises RuntimeError -- so a completed request would break the
        *next* one. Treat a dead wrapper as "not busy" and drop the reference.
        """
        if self._worker is None:
            return False
        try:
            return self._worker.isRunning()
        except RuntimeError:
            self._worker = None
            return False

    def cancel(self) -> None:
        if self._worker is None:
            return
        try:
            self._worker.cancel()
        except RuntimeError:
            self._worker = None
            return
        self.state_changed.emit("idle")

    def _release_worker(self) -> None:
        """Drop our reference as the worker finishes, before Qt destroys it."""
        self._worker = None

    def ask(self, session: Session, prompt: str,
            image: Image.Image | None = None,
            include_transcript: bool = True,
            system_override: str = "") -> None:
        """Send a turn. Cancels any request already running."""
        if self.busy:
            self.cancel()
            # Give the socket a moment to unwind so the old worker's teardown
            # does not race the new one's signals.
            if self._worker is not None:
                try:
                    self._worker.wait(300)
                except RuntimeError:
                    self._worker = None

        settings = self.settings
        provider_name = settings.active_provider

        try:
            provider = build_provider(provider_name, settings, self.secrets)
        except ProviderError as exc:
            self.failed.emit(exc.message, exc.hint, exc.recoverable)
            return

        model = settings.provider(provider_name).model
        system = system_override or settings.system_prompt()
        if image is not None:
            system = f"{system}\n\n{settings.vision_prompt}"

        messages = session.build_messages(
            prompt, max_turns=settings.behaviour.history_turns)

        request = Request(
            messages=messages,
            system=system,
            model=model,
            image=image,
            context_notes=settings.context_notes,
            transcript=(session.transcript_text() if include_transcript
                        else ""))

        worker = StreamWorker(provider, request, self)
        worker.started_stream.connect(lambda: self.state_changed.emit("thinking"))
        worker.started_stream.connect(self.started.emit)
        worker.delta.connect(self.delta.emit)
        worker.finished_stream.connect(self._on_finished)
        worker.failed.connect(self._on_failed)
        # Drop our reference as it finishes, before Qt destroys the C++ side.
        worker.finished.connect(self._release_worker)
        worker.finished.connect(worker.deleteLater)
        self._worker = worker
        worker.start()

    def _on_finished(self, text: str, usage: dict) -> None:
        self.state_changed.emit("idle")
        self.completed.emit(text, usage)

    def _on_failed(self, message: str, hint: str, recoverable: bool) -> None:
        self.state_changed.emit("idle")
        self.failed.emit(message, hint, recoverable)

    # ------------------------------------------------------------ suggestions
    def should_auto_suggest(self, cooldown: float) -> bool:
        """
        Rate-limit proactive answers.

        Without a cooldown, every transcribed sentence during a meeting would
        fire a request -- expensive, and the panel would thrash between
        half-finished answers.
        """
        if self.busy:
            return False
        if time.time() - self._last_auto_suggest < cooldown:
            return False
        return True

    def mark_auto_suggest(self) -> None:
        self._last_auto_suggest = time.time()


def looks_like_question(text: str) -> bool:
    """
    Heuristic for "the other person just asked something".

    Used to decide when to answer proactively during a call. Deliberately
    conservative: a false positive spends tokens and pushes an unwanted answer
    into the panel, so it only fires on reasonably clear signals.
    """
    stripped = text.strip()
    if len(stripped) < 12:
        return False
    if stripped.endswith("?"):
        return True
    low = stripped.lower()
    openers = (
        "what", "why", "how", "when", "where", "who", "which", "can you",
        "could you", "would you", "tell me", "explain", "describe", "walk me",
        "do you", "did you", "have you", "are you", "is there", "give me",
        "talk me through", "let's say", "suppose", "imagine",
    )
    if low.startswith(openers):
        return True
    prompts = ("tell me about", "walk me through", "how would you",
               "what would you", "your thoughts on", "any experience with")
    return any(p in low for p in prompts)
