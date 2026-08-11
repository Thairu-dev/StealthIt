"""
Google Gemini provider.

Uses the REST streamGenerateContent endpoint directly rather than the
google-generativeai SDK. The SDK pulls in grpc and protobuf (~40 MB packaged),
reconfigures global state on every call via genai.configure(), and its
streaming iterator does not cooperate with cancellation -- all of which matter
for an overlay that must stay small and abortable.
"""
from __future__ import annotations

from typing import Iterator

from .base import Chunk, Provider, Request, encode_image
from .http import get_json, stream_sse


class GeminiProvider(Provider):
    name = "gemini"
    label = "Google Gemini"
    default_base_url = "https://generativelanguage.googleapis.com/v1beta"

    def _stream(self, req: Request) -> Iterator[Chunk]:
        contents: list[dict] = []
        for m in req.messages[:-1]:
            # Gemini names the assistant role "model".
            role = "model" if m.role == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": m.text}]})

        last = req.messages[-1]
        parts: list[dict] = [{"text": last.text}]
        if req.image is not None:
            b64, mime = encode_image(req.image)
            parts.append({"inline_data": {"mime_type": mime, "data": b64}})
        contents.append({"role": "user", "parts": parts})

        payload = {
            "contents": contents,
            "systemInstruction": {
                "parts": [{"text": self.build_system_prompt(req)}]},
            "generationConfig": {
                "maxOutputTokens": req.max_tokens,
                "temperature": req.temperature,
            },
        }

        url = (f"{self.base_url}/models/{req.model}:streamGenerateContent"
               f"?alt=sse&key={self.api_key}")
        usage: dict[str, int] = {}
        saw_text = False

        for event in stream_sse(url, payload):
            if "usageMetadata" in event:
                u = event["usageMetadata"]
                usage = {"input": u.get("promptTokenCount", 0),
                         "output": u.get("candidatesTokenCount", 0)}
            for cand in event.get("candidates") or []:
                for part in (cand.get("content") or {}).get("parts") or []:
                    if part.get("text"):
                        saw_text = True
                        yield Chunk(text=part["text"])
                reason = cand.get("finishReason")
                if reason in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"):
                    raise RuntimeError(
                        f"Gemini blocked the response (safety: {reason})")

            fb = event.get("promptFeedback") or {}
            if fb.get("blockReason"):
                raise RuntimeError(
                    f"Gemini blocked the prompt ({fb['blockReason']})")

        if not saw_text:
            # An empty stream with no error usually means the safety filter
            # dropped everything; say so rather than showing a blank bubble.
            raise RuntimeError(
                "Gemini returned an empty response. This usually means a "
                "safety filter suppressed it.")
        yield Chunk(done=True, usage=usage)

    def list_models(self) -> list[str]:
        if not self.api_key:
            return []
        data = get_json(f"{self.base_url}/models?key={self.api_key}",
                        self._apply_custom_headers({}))
        out = []
        for m in data.get("models", []):
            name = m.get("name", "").replace("models/", "")
            if "generateContent" in (m.get("supportedGenerationMethods") or []):
                out.append(name)
        return sorted(out)
