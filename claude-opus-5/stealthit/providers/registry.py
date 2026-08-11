"""Provider registry -- constructs providers from settings + secret store."""
from __future__ import annotations

from ..core.config import Settings
from ..core.secrets import SecretStore
from .anthropic_p import AnthropicProvider
from .base import Provider, ProviderError
from .gemini import GeminiProvider
from .ollama import OllamaProvider
from .openai_compat import CustomOpenAIProvider, OpenAIProvider, OpenRouterProvider

PROVIDER_CLASSES: dict[str, type[Provider]] = {
    "gemini": GeminiProvider,
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
    "openrouter": OpenRouterProvider,
    "ollama": OllamaProvider,
}

PROVIDER_LABELS: dict[str, str] = {
    "gemini": "Google Gemini",
    "anthropic": "Anthropic",
    "openai": "OpenAI",
    "openrouter": "OpenRouter",
    "ollama": "Ollama (local)",
}

# Shown in settings so the choice is informed rather than a guess.
PROVIDER_BLURBS: dict[str, str] = {
    "gemini": "Fast, strong vision, generous free tier.",
    "anthropic": "Best reasoning and code quality.",
    "openai": "Reliable all-rounder with solid vision.",
    "openrouter": "One key, hundreds of models across every major lab.",
    "ollama": "Runs entirely on your machine. No key, no network, no logging.",
}


def build_provider(name: str, settings: Settings,
                   secrets: SecretStore) -> Provider:
    cfg = settings.provider(name)

    # Built-in providers are in PROVIDER_CLASSES; custom user-created ones
    # are OpenAI-compatible endpoints configured at runtime.
    if cfg.is_custom:
        provider = CustomOpenAIProvider(
            provider_name=name,
            provider_label=cfg.label or name,
            api_key=secrets.get(name),
            base_url=cfg.base_url,
            custom_headers=dict(cfg.custom_headers))
        provider.capabilities = dict(cfg.capabilities)
        return provider

    cls = PROVIDER_CLASSES.get(name)
    if cls is None:
        raise ProviderError(
            f"Unknown provider '{name}'.",
            hint="Pick a provider in Settings.", recoverable=False)
    provider = cls(api_key=secrets.get(name), host=cfg.host,
                   base_url=cfg.base_url,
                   custom_headers=dict(cfg.custom_headers))
    # Hand over what we learned from the catalogue, so the vision pre-flight
    # check trusts the provider's own metadata over a name heuristic.
    provider.capabilities = dict(cfg.capabilities)
    return provider


def available_providers(settings: Settings,
                        secrets: SecretStore) -> list[tuple[str, bool, str]]:
    """
    (name, ready, reason) for each provider, so the UI can grey out and
    explain the ones that are not usable yet instead of failing at send time.
    """
    out: list[tuple[str, bool, str]] = []
    for name, cls in PROVIDER_CLASSES.items():
        if name == "ollama":
            provider = build_provider(name, settings, secrets)
            running = provider.is_running()  # type: ignore[attr-defined]
            out.append((name, running,
                        "" if running else "Ollama is not running"))
        elif cls.needs_api_key and not secrets.has(name):
            out.append((name, False, "No API key set"))
        else:
            out.append((name, True, ""))

    # Custom user-created providers.
    for name in settings.custom_providers:
        cfg = settings.provider(name)
        if not cfg.is_custom:
            continue
        has_key = secrets.has(name)
        has_url = bool(cfg.base_url)
        if not has_url:
            out.append((name, False, "No base URL set"))
        elif not has_key:
            out.append((name, False, "No API key set"))
        else:
            out.append((name, True, ""))
    return out

