"""
Anthropic (Claude) provider — built on the official SDK.

Uses the `anthropic` package rather than hand-rolled HTTP. That is not just
tidiness: the SDK sends a genuine client identity (`User-Agent:
Anthropic/Python x.y.z` plus `x-stainless-*` headers), and gateways that
allowlist real Anthropic clients accept it on that basis. A raw urllib request
identifying as `Python-urllib/3.13` is rejected by some gateways as an
unrecognised client — which looks like an auth failure but is not one.

Pointing at a gateway is the SDK's own supported mechanism: pass `base_url`
(or set ANTHROPIC_BASE_URL). No header spoofing is required or wanted.
"""
from __future__ import annotations

from typing import Iterator

from .base import Chunk, Provider, ProviderError, Request, encode_image


class AnthropicProvider(Provider):
    name = "anthropic"
    label = "Anthropic"
    # The SDK appends the version path itself, so this is the bare origin --
    # unlike the OpenAI-compatible providers, which address /v1 directly.
    default_base_url = "https://api.anthropic.com"

    def _client(self):
        """
        Build an SDK client for this request.

        Constructed per call so a settings change (key, endpoint, headers)
        applies immediately rather than being captured once at startup.
        """
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover - dependency missing
            raise ProviderError(
                "The 'anthropic' package is not installed.",
                hint="Run: pip install anthropic",
                recoverable=False) from exc

        kwargs: dict = {"api_key": self.api_key, "max_retries": 2}
        kwargs["base_url"] = self.base_url
        if self.custom_headers:
            # Escape hatch for gateways needing an extra header. Not required
            # for a stock gateway -- the SDK's own identity is sufficient.
            kwargs["default_headers"] = dict(self.custom_headers)
        return anthropic.Anthropic(**kwargs)

    def list_models(self) -> list[str]:
        """
        Live model catalogue.

        Many Anthropic-compatible gateways do not implement /v1/models; the
        404 propagates so discover_models can say so plainly instead of
        returning a bare empty list.
        """
        models = self._client().models.list(limit=1000)
        return sorted(m.id for m in models)

    def _build_messages(self, req: Request) -> list[dict]:
        messages: list[dict] = [
            {"role": m.role, "content": m.text} for m in req.messages[:-1]]

        last = req.messages[-1]
        if req.image is not None:
            b64, mime = encode_image(req.image)
            # Image block before text: the model attends to the image first
            # and the question second.
            messages.append({"role": "user", "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": mime, "data": b64}},
                {"type": "text", "text": last.text},
            ]})
        else:
            messages.append({"role": "user", "content": last.text})
        return messages

    def _stream(self, req: Request) -> Iterator[Chunk]:
        client = self._client()
        usage: dict[str, int] = {}

        # `system` is a top-level parameter in this dialect, not a message
        # role -- passing it as a message is a common and silent mistake.
        with client.messages.stream(
            model=req.model,
            system=self.build_system_prompt(req),
            messages=self._build_messages(req),
            max_tokens=req.max_tokens,
        ) as stream:
            for text in stream.text_stream:
                if text:
                    yield Chunk(text=text)
            final = stream.get_final_message()

        if final.usage is not None:
            usage = {"input": final.usage.input_tokens,
                     "output": final.usage.output_tokens}
        yield Chunk(done=True, usage=usage)

    def translate_error(self, exc: Exception) -> ProviderError:
        """Map the SDK's typed exceptions before falling back to text matching."""
        import json
        import re

        try:
            import anthropic
        except ImportError:
            return super().translate_error(exc)

        def _extract_msg(val) -> str:
            if isinstance(val, dict):
                inner = val.get("error")
                if inner and inner != val:
                    res = _extract_msg(inner)
                    if res:
                        return res
                return _extract_msg(val.get("message") or "")
            if isinstance(val, str):
                s = val.strip()
                if (s.startswith("{") and s.endswith("}")) or (s.startswith("[") and s.endswith("]")):
                    import ast
                    try:
                        parsed = ast.literal_eval(s)
                        if isinstance(parsed, (dict, list)):
                            res = _extract_msg(parsed)
                            if res:
                                return res
                    except Exception:
                        pass
                    try:
                        import json
                        parsed = json.loads(s)
                        if isinstance(parsed, (dict, list)):
                            res = _extract_msg(parsed)
                            if res:
                                return res
                    except Exception:
                        pass
                return s
            return str(val)

        # Extract nested error message from response or exception string if present
        msg = ""
        if hasattr(exc, "response") and exc.response is not None:
            try:
                data = exc.response.json()
                msg = _extract_msg(data)
            except Exception:
                pass

        if not msg:
            msg = _extract_msg(str(exc))

        if msg:
            if any(s in msg for s in ("无权访问", "not entitled", "permission", "not allowed", "unauthorized")):
                return ProviderError(
                    f"Access denied: {msg}",
                    hint=f"Your API key is not entitled to this model on {self.base_url}. Choose a model supported by your key (e.g. from Settings -> Providers).",
                    recoverable=False)
            if any(s in msg.lower() for s in ("model not found", "does not exist", "no such model")):
                return ProviderError(
                    f"{self.label} error: {msg}",
                    hint="Check the model name or pick an available model from Settings -> Providers -> Browse models.",
                    recoverable=False)
            return ProviderError(
                f"{self.label} error: {msg}",
                hint=f"Check model and permissions on {self.base_url}.",
                recoverable=False)

        if isinstance(exc, anthropic.AuthenticationError) or (isinstance(exc, TypeError) and "authentication method" in str(exc).lower()):
            return ProviderError(
                f"{self.label} rejected the API key.",
                hint="Check the key in Settings -> Providers.",
                recoverable=False)
        if isinstance(exc, anthropic.PermissionDeniedError):
            return ProviderError(
                f"This key is not allowed to use that model on {self.label}.",
                hint="Pick a model your key is entitled to, or check your "
                     "plan with the gateway operator.",
                recoverable=False)
        if isinstance(exc, anthropic.NotFoundError):
            return ProviderError(
                f"{self.label} does not recognise that model or endpoint.",
                hint=f"Check the model name, and the base URL "
                     f"({self.base_url}) in Settings -> Providers.",
                recoverable=False)
        if isinstance(exc, anthropic.RateLimitError):
            return ProviderError(
                f"{self.label} rate limit reached.",
                hint="Wait a moment, or switch to another provider.")
        if isinstance(exc, anthropic.APIConnectionError):
            return ProviderError(
                f"Could not reach {self.label} at {self.base_url}.",
                hint="Check your connection and the base URL.")
        return super().translate_error(exc)
