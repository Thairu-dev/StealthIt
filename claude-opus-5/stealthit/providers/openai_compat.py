"""
OpenAI-compatible providers: OpenAI and OpenRouter.

OpenRouter replaces Cerebras from the original. It speaks the same
/chat/completions dialect, so both share one implementation -- and it is a
strict upgrade: one key reaches hundreds of models across every major lab,
including the Cerebras-hosted Llama endpoints the original was using.
"""
from __future__ import annotations

from typing import Iterator

from .base import Chunk, ModelInfo, Provider, Request, encode_image
from .http import get_json, stream_sse


class OpenAICompatProvider(Provider):
    """
    Shared /chat/completions implementation.

    This dialect is the de-facto standard, so a custom base URL here reaches
    most gateways and aggregators (agentrouter.org, LiteLLM, vLLM, Together,
    Groq, a corporate proxy) without any provider-specific code.
    """

    default_base_url = "https://api.openai.com/v1"
    extra_headers: dict[str, str] = {}

    def _headers(self) -> dict[str, str]:
        return self._apply_custom_headers(
            {"Authorization": f"Bearer {self.api_key}", **self.extra_headers})

    def _build_messages(self, req: Request) -> list[dict]:
        msgs: list[dict] = [
            {"role": "system", "content": self.build_system_prompt(req)}]
        for m in req.messages[:-1]:
            msgs.append({"role": m.role, "content": m.text})

        last = req.messages[-1]
        if req.image is not None:
            b64, mime = encode_image(req.image)
            msgs.append({"role": "user", "content": [
                {"type": "text", "text": last.text},
                {"type": "image_url",
                 "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ]})
        else:
            msgs.append({"role": "user", "content": last.text})
        return msgs

    def _stream(self, req: Request) -> Iterator[Chunk]:
        payload = {
            "model": req.model,
            "messages": self._build_messages(req),
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
            "stream": True,
            # Ask for usage on the final chunk so the UI can show token counts.
            "stream_options": {"include_usage": True},
        }
        usage: dict[str, int] = {}
        base = self.resolve_base_url()
        for event in stream_sse(f"{base}/chat/completions", payload,
                                self._headers()):
            if event.get("usage"):
                u = event["usage"]
                usage = {"input": u.get("prompt_tokens", 0),
                         "output": u.get("completion_tokens", 0)}
            for choice in event.get("choices") or []:
                delta = (choice.get("delta") or {}).get("content")
                if delta:
                    yield Chunk(text=delta)
        yield Chunk(done=True, usage=usage)


class OpenAIProvider(OpenAICompatProvider):
    name = "openai"
    label = "OpenAI"
    default_base_url = "https://api.openai.com/v1"

    def list_models(self) -> list[str]:
        # Errors propagate: discover_models needs the status to tell a wrong
        # path from a bad key, and swallowing them here is what produced the
        # uninformative "no models returned".
        data = get_json(f"{self.resolve_base_url()}/models", self._headers())
        ids = [m["id"] for m in data.get("data", []) if "id" in m]
        # The full list is hundreds of embeddings/audio/moderation models;
        # keep the chat-capable ones so the picker stays usable. A custom
        # gateway serves whatever names it likes, so no filtering there --
        # it would hide the very models the user pointed us at.
        if self.using_custom_endpoint:
            return sorted(ids)
        return sorted(i for i in ids
                      if i.startswith(("gpt-", "o1", "o3", "o4", "chatgpt")))


class OpenRouterProvider(OpenAICompatProvider):
    """
    OpenRouter. Replaces Cerebras.

    The HTTP-Referer/X-Title headers are OpenRouter's attribution convention;
    they are optional but keep the app identifiable in the user's dashboard.
    """
    name = "openrouter"
    label = "OpenRouter"
    default_base_url = "https://openrouter.ai/api/v1"
    extra_headers = {
        "HTTP-Referer": "https://github.com/Thairu-dev/StealthIt",
        "X-Title": "StealthIt",
    }

    def list_models(self) -> list[str]:
        # OpenRouter's own catalogue needs no auth, so the picker works
        # before a key is entered. A custom gateway usually does require
        # one, so send it when we have it.
        headers = self._headers() if self.api_key else None
        data = get_json(f"{self.resolve_base_url()}/models", headers)
        return sorted(m["id"] for m in data.get("data", []) if "id" in m)

    def list_model_info(self) -> list[ModelInfo]:
        """
        Full catalogue with pricing, context and vision support.

        OpenRouter reports prices as USD per token in strings like
        "0.0000025". Free models report exactly "0", which is what makes it
        possible to surface a no-cost starting point for someone who has not
        added billing yet.
        """
        headers = self._headers() if self.api_key else None
        data = get_json(f"{self.resolve_base_url()}/models", headers,
                        timeout=20.0)

        out: list[ModelInfo] = []
        for entry in data.get("data", []):
            model_id = entry.get("id")
            if not model_id:
                continue
            pricing = entry.get("pricing") or {}

            def _per_million(key: str) -> float:
                try:
                    return float(pricing.get(key) or 0.0) * 1_000_000
                except (TypeError, ValueError):
                    return 0.0

            prompt_cost = _per_million("prompt")
            completion_cost = _per_million("completion")
            modalities = ((entry.get("architecture") or {})
                          .get("input_modalities") or [])
            out.append(ModelInfo(
                id=model_id,
                label=entry.get("name", "") or model_id,
                vision="image" in modalities,
                audio="audio" in modalities,
                # ":free" variants are the explicitly free tier; a zero price
                # also covers models that are temporarily free.
                free=(prompt_cost == 0.0 and completion_cost == 0.0),
                context=int(entry.get("context_length") or 0),
                prompt_cost=prompt_cost,
                completion_cost=completion_cost,
                description=(entry.get("description") or "")[:180]))
        # Free first, then cheapest, so the zero-cost options are impossible
        # to miss at the top of the list.
        out.sort(key=lambda m: (not m.free, m.prompt_cost, m.id))
        return out


class CustomOpenAIProvider(OpenAICompatProvider):
    """
    User-created OpenAI-compatible provider.

    Instantiated dynamically from ProviderConfig rather than from a hardcoded
    class in the registry. The base URL comes from the user's settings, and
    list_models() returns everything the gateway advertises without filtering.
    """
    needs_api_key = True

    def __init__(self, *, provider_name: str = "custom",
                 provider_label: str = "Custom", **kwargs) -> None:
        super().__init__(**kwargs)
        self.name = provider_name
        self.label = provider_label

    def list_models(self) -> list[str]:
        data = get_json(f"{self.resolve_base_url()}/models", self._headers())
        return sorted(m["id"] for m in data.get("data", []) if "id" in m)

