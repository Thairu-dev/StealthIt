"""
Conversation session.

The original app had no history at all: every request rebuilt a one-shot
f"{system}\n\nUser: {text}" string, so "explain that more" had nothing to
refer to. This is the single largest functional gap after streaming -- it made
the product a series of unrelated completions rather than a conversation.

Sessions here keep turns, cap what is sent by a token budget, retain the
transcript alongside, and persist to disk so a meeting can be reviewed later.
"""
from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from ..providers.base import Message


def estimate_tokens(text: str) -> int:
    """
    ~4 chars per token. Deliberately approximate: exact counting would mean a
    tokenizer per provider, and this is only used to decide how much history
    to include, where being roughly right is enough.
    """
    return max(1, len(text) // 4)


@dataclass
class Turn:
    role: str
    text: str
    timestamp: float = field(default_factory=time.time)
    had_image: bool = False
    provider: str = ""
    model: str = ""
    usage: dict[str, int] = field(default_factory=dict)


@dataclass
class Session:
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    title: str = ""
    started: float = field(default_factory=time.time)
    turns: list[Turn] = field(default_factory=list)
    transcript: list[dict] = field(default_factory=list)
    mode: str = "General"

    # ------------------------------------------------------------------ turns
    def add_user(self, text: str, had_image: bool = False) -> Turn:
        turn = Turn("user", text, had_image=had_image)
        self.turns.append(turn)
        if not self.title:
            # First user message becomes the session title, trimmed to
            # something that fits a list row.
            self.title = (text[:60] + "...") if len(text) > 60 else text
        return turn

    def add_assistant(self, text: str, provider: str = "", model: str = "",
                      usage: dict[str, int] | None = None) -> Turn:
        turn = Turn("assistant", text, provider=provider, model=model,
                    usage=usage or {})
        self.turns.append(turn)
        return turn

    def clear(self) -> None:
        self.turns.clear()
        self.transcript.clear()
        self.title = ""
        self.id = uuid.uuid4().hex[:12]
        self.started = time.time()

    # ------------------------------------------------------------- transcript
    def add_transcript(self, speaker: str, text: str) -> None:
        """speaker is 'you' (microphone) or 'them' (system audio)."""
        text = text.strip()
        if not text:
            return
        # Merge consecutive fragments from the same speaker so the transcript
        # reads as sentences rather than 4-second slices.
        if self.transcript and self.transcript[-1]["speaker"] == speaker:
            last = self.transcript[-1]
            if time.time() - last["timestamp"] < 12.0:
                last["text"] = f"{last['text']} {text}".strip()
                last["timestamp"] = time.time()
                return
        self.transcript.append(
            {"speaker": speaker, "text": text, "timestamp": time.time()})

    def transcript_text(self, last_seconds: float = 180.0,
                        max_chars: int = 4000) -> str:
        """Recent transcript, newest-biased, for injection into the prompt."""
        cutoff = time.time() - last_seconds
        lines = [f"[{e['speaker']}] {e['text']}"
                 for e in self.transcript if e["timestamp"] >= cutoff]
        out = "\n".join(lines)
        if len(out) > max_chars:
            out = "..." + out[-max_chars:]
        return out

    def last_them_utterance(self) -> str:
        for entry in reversed(self.transcript):
            if entry["speaker"] == "them":
                return entry["text"]
        return ""

    def last_question(self, within_seconds: float = 300.0) -> str:
        """
        The most recent thing the other side asked.

        Scans backwards for a question rather than just taking the last
        utterance, because the newest line is often an aside ("mm hmm", "right")
        after the actual question. Falls back to the latest utterance so the
        answer hotkey always has something to work with.
        """
        from ..ui.engine import looks_like_question

        cutoff = time.time() - within_seconds
        recent = [e for e in self.transcript
                  if e["speaker"] == "them" and e["timestamp"] >= cutoff]
        for entry in reversed(recent):
            if looks_like_question(entry["text"]):
                return entry["text"]
        return recent[-1]["text"] if recent else ""

    # ---------------------------------------------------------------- context
    def build_messages(self, max_turns: int = 12,
                       token_budget: int = 6000) -> list[Message]:
        """
        History window for the next request.

        Walks backwards so the most recent turns are always included, and
        stops at whichever limit hits first. Without a budget, a long meeting
        eventually sends a context that costs more than the answer.
        """
        selected: list[Turn] = []
        used = 0
        for turn in reversed(self.turns[-max_turns * 2:]):
            cost = estimate_tokens(turn.text)
            if used + cost > token_budget and selected:
                break
            selected.append(turn)
            used += cost
        selected.reverse()

        return [Message(role=t.role, text=t.text) for t in selected]

    # ------------------------------------------------------------ persistence
    def to_dict(self) -> dict:
        return {
            "id": self.id, "title": self.title, "started": self.started,
            "mode": self.mode,
            "turns": [{"role": t.role, "text": t.text,
                       "timestamp": t.timestamp, "provider": t.provider,
                       "model": t.model, "usage": t.usage}
                      for t in self.turns],
            "transcript": self.transcript,
        }

    @classmethod
    def from_dict(cls, raw: dict) -> "Session":
        s = cls(id=raw.get("id", uuid.uuid4().hex[:12]),
                title=raw.get("title", ""),
                started=raw.get("started", time.time()),
                mode=raw.get("mode", "General"))
        for t in raw.get("turns", []):
            s.turns.append(Turn(
                role=t.get("role", "user"), text=t.get("text", ""),
                timestamp=t.get("timestamp", 0.0),
                provider=t.get("provider", ""), model=t.get("model", ""),
                usage=t.get("usage", {})))
        s.transcript = raw.get("transcript", [])
        return s


class SessionStore:
    """Session persistence, newest first."""

    def __init__(self, directory: Path) -> None:
        self.dir = directory
        self.dir.mkdir(parents=True, exist_ok=True)

    def save(self, session: Session) -> None:
        # An empty session is not worth a file on disk.
        if not session.turns and not session.transcript:
            return
        path = self.dir / f"{int(session.started)}_{session.id}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(session.to_dict(), indent=2),
                       encoding="utf-8")
        tmp.replace(path)

    def list_recent(self, limit: int = 40) -> list[dict]:
        out = []
        for path in sorted(self.dir.glob("*.json"), reverse=True)[:limit]:
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                out.append({"id": raw.get("id"), "title": raw.get("title", ""),
                            "started": raw.get("started", 0),
                            "turns": len(raw.get("turns", [])),
                            "path": str(path)})
            except Exception:
                continue
        return out

    def load(self, path: str | Path) -> Session | None:
        try:
            return Session.from_dict(
                json.loads(Path(path).read_text(encoding="utf-8")))
        except Exception:
            return None
