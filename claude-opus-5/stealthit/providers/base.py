"""
Provider abstraction.

The original had five near-identical chat_* methods, each ~70 lines, each
rebuilding prompt assembly, image encoding and error handling by copy-paste --
and each returning one blocking string, so responses landed as a single dump
after several seconds of nothing.

Here every provider implements one method:

    stream(request) -> Iterator[Chunk]

Prompt assembly, history, vision handling and error normalisation live in the
base class, so a new provider is roughly 30 lines and cannot forget them.
"""
from __future__ import annotations

import base64
import io
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterator, Literal

from PIL import Image

Role = Literal["user", "assistant", "system"]


class ProviderError(Exception):
    """
    A provider failure already phrased for a human.

    `hint` carries the actionable next step, which the UI renders as an
    affordance (a button to open settings, to pull a model, and so on).
    """

    def __init__(self, message: str, hint: str = "",
                 recoverable: bool = True) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.recoverable = recoverable


@dataclass
class Message:
    role: Role
    text: str
    image: Image.Image | None = None

    def to_wire_text(self) -> str:
        return self.text


@dataclass
class Request:
    """Everything a provider needs for one turn."""
    messages: list[Message]
    system: str
    model: str
    image: Image.Image | None = None
    max_tokens: int = 2048
    temperature: float = 0.6
    context_notes: str = ""
    transcript: str = ""


@dataclass
class Chunk:
    """One streamed delta. `done` marks the terminal chunk."""
    text: str = ""
    done: bool = False
    usage: dict[str, int] = field(default_factory=dict)


def encode_image(img: Image.Image, fmt: str = "PNG") -> tuple[str, str]:
    """PIL image -> (base64, mime). PNG keeps UI text crisp; JPEG would blur it."""
    buf = io.BytesIO()
    if fmt == "JPEG" and img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    img.save(buf, format=fmt)
    mime = "image/png" if fmt == "PNG" else "image/jpeg"
    return base64.b64encode(buf.getvalue()).decode("ascii"), mime


@dataclass
class ModelInfo:
    """
    A model as advertised by a provider.

    Richer than a bare id so the picker can show what actually matters when
    choosing: whether it can read screenshots, what it costs, and how much
    context it has. `free` is tracked explicitly because a zero-cost model is
    the one a new user should be steered to first -- it lets them try the app
    before committing a payment method.
    """
    id: str
    label: str = ""
    vision: bool = False
    audio: bool = False   # accepts audio input directly (can transcribe)
    free: bool = False
    context: int = 0
    prompt_cost: float = 0.0      # USD per million input tokens
    completion_cost: float = 0.0  # USD per million output tokens
    description: str = ""

    @property
    def display(self) -> str:
        return self.label or self.id

    def price_summary(self) -> str:
        if self.free:
            return "Free"
        if not (self.prompt_cost or self.completion_cost):
            return ""
        return (f"${self.prompt_cost:g} in / "
                f"${self.completion_cost:g} out per 1M")

    def context_summary(self) -> str:
        if not self.context:
            return ""
        if self.context >= 1000:
            return f"{self.context // 1000}K context"
        return f"{self.context} context"

    def matches(self, query: str) -> bool:
        if not query:
            return True
        haystack = f"{self.id} {self.label} {self.description}".lower()
        # Every whitespace-separated term must appear, so "claude vision"
        # narrows rather than widening the way a plain substring would.
        return all(term in haystack for term in query.lower().split())


def normalise_base_url(url: str) -> str:
    """
    Clean a user-entered base URL.

    People paste whatever their gateway's docs showed them, which is often a
    full endpoint rather than a base. Stripping the trailing path here means
    every call site can simply append its own, instead of each one having to
    defend against a double "/chat/completions".
    """
    url = (url or "").strip().rstrip("/")
    if not url:
        return ""
    if "://" not in url:
        # Bare host: assume HTTPS rather than silently building an invalid URL.
        url = f"https://{url}"
    for suffix in ("/chat/completions", "/completions", "/messages",
                   "/models", "/responses"):
        if url.endswith(suffix):
            url = url[: -len(suffix)]
    return url.rstrip("/")


class Provider(ABC):
    """Base class. Subclasses implement `_stream` only."""

    name: str = "provider"
    label: str = "Provider"
    needs_api_key: bool = True
    supports_streaming: bool = True
    # The vendor's own endpoint. Subclasses set this; a user-supplied base URL
    # overrides it per instance without touching the class.
    default_base_url: str = ""

    def __init__(self, api_key: str = "", host: str = "",
                 base_url: str = "",
                 custom_headers: dict[str, str] | None = None) -> None:
        self.api_key = api_key
        self.host = host
        # Custom gateways (self-hosted proxies, corporate egress points,
        # aggregators) speak the same dialect on a different origin, so the
        # endpoint has to be data rather than a constant baked into the class.
        self.base_url = normalise_base_url(base_url) or self.default_base_url
        # Per-provider header overrides. Some gateways refuse requests whose
        # client identity they do not recognise, and a few want the key under
        # a non-standard header name. Making this configurable keeps such
        # cases out of the provider code.
        self.custom_headers: dict[str, str] = dict(custom_headers or {})
        # Capabilities from the provider's own catalogue, injected by the
        # registry. Authoritative, so a model picked from the catalogue is not
        # then misjudged by name matching.
        self.capabilities: dict[str, dict] = {}

    @property
    def using_custom_endpoint(self) -> bool:
        return bool(self.base_url and self.base_url != self.default_base_url)

    def _apply_custom_headers(self, headers: dict[str, str]) -> dict[str, str]:
        """
        Merge user-configured headers over the provider's own.

        Last write wins, so a configured User-Agent or Authorization replaces
        the default rather than being appended alongside it.
        """
        return {**headers, **self.custom_headers}

    # ---------------------------------------------------------- discovery
    # Path segments a gateway might mount its API under. Probed in order the
    # first time a catalogue is needed, because "no models returned" is
    # otherwise indistinguishable from "wrong path".
    API_ROOT_CANDIDATES: tuple[str, ...] = ("", "/v1", "/api/v1")

    def candidate_base_urls(self) -> list[str]:
        """
        Base URLs worth trying, most likely first.

        A user pastes "https://gateway.example.com" but the API lives at
        "/v1"; or they paste the full "/api/v1" and it is really at "/v1".
        Rather than making them guess, try the small set of conventions.
        """
        base = (self.base_url or self.default_base_url).rstrip("/")
        if not base:
            return []
        seen: list[str] = [base]
        # Strip a known root so alternatives can be built from the bare origin.
        stem = base
        for suffix in ("/api/v1", "/v1", "/api"):
            if stem.endswith(suffix):
                stem = stem[: -len(suffix)]
                break
        for candidate in self.API_ROOT_CANDIDATES:
            url = (stem + candidate).rstrip("/")
            if url and url not in seen:
                seen.append(url)
        return seen

    def resolve_base_url(self) -> str:
        """
        Settle on the API root, probing the conventions once and caching it.

        Discovery has to be available to `stream()`, not just the catalogue
        fetch: a chat request sent to the unresolved origin lands on
        "/messages" instead of "/v1/messages" and comes back empty. Doing it
        here means both paths agree on the endpoint.
        """
        from .http import HttpError, get_json

        if getattr(self, "_resolved_base_url", ""):
            return self._resolved_base_url

        candidates = self.candidate_base_urls()
        if len(candidates) <= 1:
            self._resolved_base_url = self.base_url
            return self.base_url

        for candidate in candidates:
            try:
                get_json(f"{candidate}/models", self._probe_headers(),
                         timeout=10.0)
            except HttpError as exc:
                # 401/403 mean we reached the API and it is arguing about who
                # we are, not about where it lives -- so this root is right.
                if exc.status in (401, 403):
                    self._resolved_base_url = candidate
                    return candidate
                continue
            except Exception:
                continue
            else:
                self._resolved_base_url = candidate
                return candidate

        # Nothing answered. If the user configured a bare origin (no path)
        # we append the provider's default path (e.g. /v1). If they configured
        # an explicit path, we respect it so the eventual error names their URL
        # rather than one we invented.
        import urllib.parse
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.path in ("", "/"):
            default_path = urllib.parse.urlparse(self.default_base_url).path
            if default_path and default_path != "/":
                fallback = self.base_url.rstrip("/") + default_path
                self._resolved_base_url = fallback
                return fallback

        self._resolved_base_url = self.base_url
        return self.base_url

    def _probe_headers(self) -> dict[str, str]:
        """Headers for a discovery probe. Subclasses reuse their auth."""
        try:
            return self._headers()  # type: ignore[attr-defined]
        except AttributeError:
            return self._apply_custom_headers({})

    # ------------------------------------------------------------- prompting
    def build_system_prompt(self, req: Request) -> str:
        """
        Assemble the system prompt from mode + persistent notes + live
        transcript. Centralised so every provider gets identical context --
        in the original, the transcript was only ever appended for Gemini.
        """
        parts = [req.system]
        if req.context_notes.strip():
            parts.append(
                "Persistent context the user has provided about themselves or "
                f"their situation:\n{req.context_notes.strip()}")
        if req.transcript.strip():
            parts.append(
                "Live transcript of the conversation happening right now. "
                "[them] is the other participant(s); [you] is the user you are "
                f"assisting:\n{req.transcript.strip()}")
        if req.image is not None:
            parts.append(
                "The user has attached a screenshot of their screen. Ground "
                "your answer in what is actually visible in it.")
        return "\n\n".join(p for p in parts if p.strip())

    # ---------------------------------------------------------------- public
    def stream(self, req: Request) -> Iterator[Chunk]:
        """
        Stream a response, translating provider-specific failures into
        ProviderError with an actionable hint.
        """
        if self.needs_api_key and not self.api_key:
            raise ProviderError(
                f"No {self.label} API key configured.",
                hint=f"Add your {self.label} key in Settings -> Providers.",
                recoverable=False)
        if req.image is not None and not self.model_supports_vision(req.model):
            raise ProviderError(
                f"{req.model} cannot read images.",
                hint="Switch to a vision-capable model to analyse screenshots.",
                recoverable=False)
        try:
            yield from self._stream(req)
        except ProviderError:
            raise
        except Exception as exc:
            raise self.translate_error(exc) from exc

    def model_supports_vision(self, model: str) -> bool:
        from ..core.config import model_supports_vision
        return model_supports_vision(self.name, model, self.capabilities)

    def translate_error(self, exc: Exception) -> ProviderError:
        """
        Map raw exceptions to human guidance.

        The original surfaced bare str(e) -- so a 401 read as a wall of JSON
        and the user had no idea their key was wrong.
        """
        from .http import HttpError

        text = str(exc)
        low = text.lower()

        # Status-aware branches first: an HttpError knows things that string
        # matching can only guess at.
        if isinstance(exc, HttpError):
            body = exc.body or ""
            blow = body.lower()
            if exc.status == 404:
                return ProviderError(
                    f"{self.label} returned 404 for {self.base_url}.",
                    hint="The base URL looks wrong. Check the API path "
                         "(often /v1) in Settings -> Providers.",
                    recoverable=False)
            if exc.status == 403:
                # Gateways commonly mean "your key exists but is not entitled
                # to this model" here -- a different fix from a bad key.
                if any(s in blow for s in ("model", "无权访问", "令牌", "access")):
                    return ProviderError(
                        f"This key has no access to that model on "
                        f"{self.label}.",
                        hint="Pick a model your key is entitled to, or check "
                             "your plan with the gateway operator.",
                        recoverable=False)
                return ProviderError(
                    f"{self.label} refused the request (403).",
                    hint=body[:160] or "Check your key's permissions.",
                    recoverable=False)
            if exc.status == 401:
                # "unauthorized client" is about who is asking, not the key.
                if "client" in blow:
                    return ProviderError(
                        f"{self.label} rejected this app as an unrecognised "
                        f"client.",
                        hint="This gateway only accepts specific clients. See "
                             "Custom headers in Settings -> Providers.",
                        recoverable=False)
                return ProviderError(
                    f"{self.label} rejected the API key.",
                    hint="Check the key in Settings -> Providers.",
                    recoverable=False)

        if any(s in low for s in ("401", "unauthorized", "invalid api key",
                                 "invalid_api_key", "authentication")):
            return ProviderError(
                f"{self.label} rejected the API key.",
                hint="Check the key in Settings -> Providers.",
                recoverable=False)
        if any(s in low for s in ("429", "rate limit", "quota",
                                 "resource_exhausted")):
            return ProviderError(
                f"{self.label} rate limit reached.",
                hint="Wait a moment, or switch to another provider.")
        if any(s in low for s in ("timed out", "timeout", "deadline")):
            return ProviderError(
                "The request timed out.",
                hint="Check your connection, or try a smaller/faster model.")
        if any(s in low for s in ("connection", "unreachable", "refused",
                                 "getaddrinfo", "dns", "ssl")):
            return ProviderError(
                f"Could not reach {self.label}.",
                hint="Check your internet connection.")
        if "user location is not supported" in low:
            return ProviderError(
                f"{self.label} is not available in your region.",
                hint="Use a different provider, or a VPN.",
                recoverable=False)
        if any(s in low for s in ("safety", "blocked", "content_filter",
                                 "content policy")):
            return ProviderError(
                "The provider's safety filter blocked this response.",
                hint="Rephrase the request, or try another provider.")
        if any(s in low for s in ("model not found", "does not exist",
                                 "404", "no such model")):
            return ProviderError(
                f"{self.label} does not recognise that model.",
                hint="Pick a different model from the model menu.",
                recoverable=False)
        if "500" in low or "502" in low or "503" in low or "overloaded" in low:
            return ProviderError(
                f"{self.label} is having server trouble.",
                hint="Retry in a moment, or switch provider.")
        # Keep the raw text as a last resort -- better a long message than a
        # silent failure.
        return ProviderError(text[:400] or "Unknown provider error.")

    @abstractmethod
    def _stream(self, req: Request) -> Iterator[Chunk]:
        ...

    def list_models(self) -> list[str]:
        """Live model list where the provider exposes one; [] otherwise."""
        return []

    def discover_models(self) -> tuple[list[ModelInfo], str]:
        """
        Fetch the catalogue, returning (models, note).

        `note` explains an empty result instead of leaving the UI to say "no
        models returned" for every possible cause. Many gateways expose no
        catalogue at all -- that is a normal configuration, not a failure, and
        the user simply types the model name instead.
        """
        from .http import HttpError

        try:
            models = self.list_model_info()
        except HttpError as exc:
            err = self.translate_error(exc)
            return [], f"{err.message} {err.hint}".strip()
        except Exception as exc:
            err = self.translate_error(exc)
            return [], f"{err.message} {err.hint}".strip()

        if models:
            return models, ""
        return [], (
            f"{self.label} did not return a model list. Many gateways do not "
            f"publish one -- type the model name directly instead.")

    def list_model_info(self) -> list[ModelInfo]:
        """
        Rich model metadata. Defaults to wrapping list_models() so providers
        that expose nothing extra still work in the picker.
        """
        from ..core.config import KNOWN_MODELS, model_supports_vision
        known = {m["id"]: m for m in KNOWN_MODELS.get(self.name, [])}
        out: list[ModelInfo] = []
        for model_id in self.list_models():
            entry = known.get(model_id, {})
            out.append(ModelInfo(
                id=model_id,
                label=entry.get("label", ""),
                vision=entry.get("vision",
                                 model_supports_vision(self.name, model_id))))
        return out
