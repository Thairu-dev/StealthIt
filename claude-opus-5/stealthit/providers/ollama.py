"""Ollama provider -- local models, no API key, full offline operation."""
from __future__ import annotations

from typing import Iterator

from .base import Chunk, Provider, ProviderError, Request, encode_image
from .http import get_json, stream_ndjson


class OllamaProvider(Provider):
    name = "ollama"
    label = "Ollama"
    needs_api_key = False

    def __init__(self, api_key: str = "",
                 host: str = "http://localhost:11434",
                 base_url: str = "",
                 custom_headers: dict[str, str] | None = None) -> None:
        super().__init__(api_key, host, base_url, custom_headers)
        # Ollama addresses its server by `host` rather than a versioned base
        # URL, so a base_url entered here is treated as the host -- pointing
        # at a remote Ollama works either way round.
        self.host = (base_url or host or "http://localhost:11434").rstrip("/")
        # Host is normalised at config load, so no suffix-stripping here.

    def _stream(self, req: Request) -> Iterator[Chunk]:
        messages: list[dict] = [
            {"role": "system", "content": self.build_system_prompt(req)}]
        for m in req.messages[:-1]:
            messages.append({"role": m.role, "content": m.text})

        last = req.messages[-1]
        entry: dict = {"role": "user", "content": last.text}
        if req.image is not None:
            b64, _ = encode_image(req.image)
            entry["images"] = [b64]
        messages.append(entry)

        payload = {
            "model": req.model,
            "messages": messages,
            "stream": True,
            "options": {"temperature": req.temperature,
                        "num_predict": req.max_tokens},
        }

        usage: dict[str, int] = {}
        try:
            for event in stream_ndjson(f"{self.host}/api/chat", payload):
                if event.get("error"):
                    raise RuntimeError(event["error"])
                msg = event.get("message") or {}
                if msg.get("content"):
                    yield Chunk(text=msg["content"])
                if event.get("done"):
                    usage = {"input": event.get("prompt_eval_count", 0),
                             "output": event.get("eval_count", 0)}
        except ProviderError:
            raise
        except Exception as exc:
            low = str(exc).lower()
            if any(s in low for s in ("refused", "unreachable", "connection",
                                     "getaddrinfo", "actively refused")):
                raise ProviderError(
                    "Ollama is not reachable.",
                    hint=f"Start Ollama, or check the host ({self.host}) in "
                         f"Settings.", recoverable=False) from exc
            if "not found" in low and "model" in low:
                raise ProviderError(
                    f"Ollama has no model called '{req.model}'.",
                    hint=f"Run `ollama pull {req.model}` in a terminal.",
                    recoverable=False) from exc
            raise
        yield Chunk(done=True, usage=usage)

    def list_models(self) -> list[str]:
        try:
            data = get_json(f"{self.host}/api/tags", timeout=5.0)
        except Exception:
            return []
        return sorted(m["name"] for m in data.get("models", []) if "name" in m)

    def is_running(self) -> bool:
        try:
            get_json(f"{self.host}/api/tags", timeout=2.0)
            return True
        except Exception:
            return False
