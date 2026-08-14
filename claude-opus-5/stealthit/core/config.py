"""
Typed configuration with versioned migration.

Problems with the original config handling this replaces:

  * `config` was a module-level dict mutated from three places, including a
    background worker thread, with no lock.
  * load_config() did `config["providers"].update(loaded["providers"])`, a
    shallow merge -- so a stored provider entry missing a newly-added key
    would overwrite the default and leave the key absent, producing
    KeyErrors at call sites rather than at load.
  * save_config() wrote in place, so a crash mid-write left invalid JSON and
    the app started with defaults, silently losing all settings.
  * API keys and the vision prompt shared one file with cached model lists.

Here: a dataclass tree, a deep merge that only fills gaps, atomic writes, and
an explicit schema version so future changes migrate instead of guessing.
"""
from __future__ import annotations

import json
import os
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 2


def config_dir() -> Path:
    """
    %LOCALAPPDATA%\\StealthIt -- not the install directory.

    The original wrote config.json next to main.py, which breaks the moment
    the app lives in Program Files, and made the packaged exe non-portable.
    """
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    return Path(base) / "StealthIt"


# --------------------------------------------------------------------------
# Prompt modes
# --------------------------------------------------------------------------

BUILTIN_MODES: dict[str, str] = {
    "General": (
        "You are a sharp, concise assistant embedded in a desktop overlay. "
        "Answer directly, lead with the answer, and keep formatting light. "
        "The user is often mid-task, so brevity is a feature."
    ),
    "Interview": (
        "You are helping the user through a live technical interview. You will "
        "receive a running transcript where [them] is the interviewer and [you] "
        "is the user.\n\n"
        "When the interviewer asks a question, immediately give: a one-line "
        "direct answer, then 2-4 bullets of supporting detail the user can say "
        "out loud. For coding questions, give working code with a one-line "
        "complexity note. Never pad. The user is reading you while speaking, so "
        "every wasted word costs them."
    ),
    "Meeting": (
        "You are a meeting co-pilot. You receive a live transcript where [them] "
        "is other participants and [you] is the user.\n\n"
        "Surface: decisions made, action items with owners, open questions, and "
        "any figure or date worth remembering. When a question is directed at "
        "the user, draft a crisp answer they can deliver. Be terse."
    ),
    "Sales": (
        "You are a live sales co-pilot. From the transcript, identify the "
        "prospect's stated pain, budget signals, and objections.\n\n"
        "When you hear an objection, immediately supply a short, non-pushy "
        "response the user can say verbatim. Flag buying signals and suggest "
        "the next question to ask. Never invent product capabilities."
    ),
    "Coding": (
        "You are an expert engineer looking at the user's screen. Diagnose "
        "before prescribing: state the actual cause, then give the minimal "
        "correct fix as code. Match the conventions visible in the code. If the "
        "screenshot is ambiguous, say precisely what you cannot see rather than "
        "guessing."
    ),
    "Study": (
        "You are a study aid. Explain the material on screen simply and "
        "accurately, working from first principles. If the screen shows a "
        "question, work through the reasoning and then state the answer, so the "
        "user learns the method rather than just the result."
    ),
}

VISION_PROMPT = (
    "You are looking at a screenshot of the user's screen. Read it carefully, "
    "including small text, code, error messages, and UI state.\n\n"
    "Answer the user's question using what is visible. Quote exact error text "
    "and identifiers when they matter. If the answer is not fully determined by "
    "the screenshot, say what is missing, then give the most useful answer you "
    "can from general knowledge -- clearly separating the two."
)


# --------------------------------------------------------------------------
# Provider catalogue
# --------------------------------------------------------------------------

@dataclass
class ProviderConfig:
    model: str = ""
    host: str = ""  # Ollama only
    # Custom gateway endpoint. Empty means "use the vendor's own API".
    # Blank in the UI, filled in for gateways and aggregators like
    # agentrouter.org, self-hosted proxies, corporate egress points.
    base_url: str = ""
    # Per-provider HTTP header overrides. Kept as a plain dict of name ->
    # value because some gateways insist on a specific client identity or
    # a non-standard auth header.
    custom_headers: dict[str, str] = field(default_factory=dict)
    cached_models: list[str] = field(default_factory=list)
    # Capabilities learned from the provider's own catalogue, keyed by model
    # id: {"vision": bool, "audio": bool, "free": bool}. Authoritative, and
    # the reason a freshly-picked model is not misjudged by name matching.
    capabilities: dict[str, dict] = field(default_factory=dict)
    enabled: bool = True
    # True for user-created OpenAI-compatible providers, False for built-ins.
    is_custom: bool = False
    # Display name for custom providers. Built-in providers use
    # PROVIDER_LABELS in the registry; custom ones carry their own.
    label: str = ""


# Curated defaults. Vision capability is tracked per model because sending an
# image to a text-only model is a silent-failure class the original hit: it
# warned for Ollama but sent the image anyway, and for Cerebras it dropped the
# image with no warning at all.
KNOWN_MODELS: dict[str, list[dict[str, Any]]] = {
    "gemini": [
        {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash", "vision": True},
        {"id": "gemini-2.5-pro", "label": "Gemini 2.5 Pro", "vision": True},
        {"id": "gemini-2.0-flash", "label": "Gemini 2.0 Flash", "vision": True},
    ],
    "anthropic": [
        {"id": "claude-3-7-sonnet-latest", "label": "Claude 3.7 Sonnet", "vision": True},
        {"id": "claude-3-5-sonnet-latest", "label": "Claude 3.5 Sonnet", "vision": True},
        {"id": "claude-3-5-haiku-latest", "label": "Claude 3.5 Haiku", "vision": True},
        {"id": "claude-3-opus-latest", "label": "Claude 3 Opus", "vision": True},
    ],
    "openai": [
        {"id": "gpt-4o", "label": "GPT-4o", "vision": True},
        {"id": "gpt-4o-mini", "label": "GPT-4o mini", "vision": True},
        {"id": "gpt-4.1", "label": "GPT-4.1", "vision": True},
    ],
    "openrouter": [
        {"id": "anthropic/claude-sonnet-4.5",
         "label": "Claude Sonnet 4.5", "vision": True},
        {"id": "google/gemini-2.5-flash",
         "label": "Gemini 2.5 Flash", "vision": True},
        {"id": "openai/gpt-4o", "label": "GPT-4o", "vision": True},
        {"id": "meta-llama/llama-3.3-70b-instruct",
         "label": "Llama 3.3 70B", "vision": False},
        {"id": "qwen/qwen-2.5-coder-32b-instruct",
         "label": "Qwen 2.5 Coder 32B", "vision": False},
    ],
    "ollama": [
        {"id": "llava:7b", "label": "LLaVA 7B (vision)", "vision": True},
        {"id": "llama3.2-vision", "label": "Llama 3.2 Vision", "vision": True},
        {"id": "llama3.1:8b", "label": "Llama 3.1 8B", "vision": False},
        {"id": "qwen2.5-coder:latest", "label": "Qwen 2.5 Coder", "vision": False},
    ],
}

# Substring markers for locally-served models, whose names are user-chosen and
# so cannot be matched against a fixed list.
VISION_MODEL_MARKERS = ("llava", "vision", "moondream", "minicpm-v",
                        "bakllava", "gemma3", "qwen2-vl", "qwen2.5-vl",
                        "pixtral", "internvl")


def model_supports_vision(provider: str, model: str,
                          capabilities: dict[str, dict] | None = None) -> bool:
    """
    Can this model read an image?

    Order matters. Capabilities fetched from the provider's own catalogue win,
    because they are authoritative. Only then do we fall back to the curated
    list and finally to name matching.

    Name matching alone was wrong for OpenRouter: its ids look like
    "google/gemini-2.5-flash" or "openai/gpt-4o", none of which contain the
    substrings that mark a vision model, so genuinely vision-capable models
    were refused with "cannot read images" the moment they were picked from
    the catalogue.
    """
    if capabilities:
        entry = capabilities.get(model)
        if entry is not None and "vision" in entry:
            return bool(entry["vision"])

    for entry in KNOWN_MODELS.get(provider, []):
        if entry["id"] == model:
            return bool(entry["vision"])

    low = model.lower()
    if provider == "ollama":
        # Ollama tags are user-chosen, so a name heuristic is all there is.
        return any(m in low for m in VISION_MODEL_MARKERS)
    if provider == "openrouter":
        # Without catalogue data, assume capable rather than refuse. A false
        # positive surfaces the provider's own error message; a false negative
        # silently blocks a screenshot the model could have read.
        return True
    # Unknown cloud model or custom provider: assume vision, for the same
    # reason -- a false positive surfaces the provider's own error message.
    return True


# --------------------------------------------------------------------------
# Settings tree
# --------------------------------------------------------------------------

@dataclass
class AppearanceConfig:
    tint: list[int] = field(default_factory=lambda: [14, 16, 22])
    opacity: int = 132  # acrylic tint alpha, 0-255; lower shows more desktop
    accent: str = "#D5D9E4"  # neutral by default; set any hex to tint the UI
    font_size: int = 13
    compact_width: int = 620
    expanded_height: int = 560
    acrylic: bool = True
    animations: bool = True


@dataclass
class AudioConfig:
    capture_system_audio: bool = True   # hear the other side of the call
    capture_microphone: bool = True     # hear the user
    whisper_model: str = "base.en"
    device_index: int | None = None
    silence_threshold: float = 0.008
    min_utterance_seconds: float = 0.7
    max_utterance_seconds: float = 12.0
    # How often to emit provisional text while someone is still speaking.
    # Lower feels more live but spends more CPU on Whisper passes that will
    # be superseded moments later.
    partial_interval: float = 1.1
    live_partials: bool = True


@dataclass
class BehaviourConfig:
    stealth: bool = True
    launch_hidden: bool = False
    auto_suggest: bool = True       # answer proactively during a call
    auto_suggest_cooldown: float = 6.0
    history_turns: int = 12         # conversation turns sent as context
    stream: bool = True
    save_sessions: bool = True
    click_through: bool = False


@dataclass
class Settings:
    version: int = SCHEMA_VERSION
    active_provider: str = "gemini"
    active_mode: str = "General"
    providers: dict[str, ProviderConfig] = field(default_factory=dict)
    modes: dict[str, str] = field(default_factory=lambda: dict(BUILTIN_MODES))
    vision_prompt: str = VISION_PROMPT
    keymap: dict[str, str] = field(default_factory=dict)
    appearance: AppearanceConfig = field(default_factory=AppearanceConfig)
    audio: AudioConfig = field(default_factory=AudioConfig)
    behaviour: BehaviourConfig = field(default_factory=BehaviourConfig)
    context_notes: str = ""  # persistent user context, sent with every request
    # Ordered list of user-created custom provider names. Each name is a key
    # into `providers` whose ProviderConfig has `is_custom=True`.
    custom_providers: list[str] = field(default_factory=list)

    def provider(self, name: str | None = None) -> ProviderConfig:
        name = name or self.active_provider
        if name not in self.providers:
            self.providers[name] = ProviderConfig(
                model=(KNOWN_MODELS.get(name) or [{"id": ""}])[0]["id"])
        return self.providers[name]

    def active_model(self) -> str:
        return self.provider().model

    def system_prompt(self) -> str:
        return self.modes.get(self.active_mode, BUILTIN_MODES["General"])

    def supports_vision(self) -> bool:
        cfg = self.provider()
        return model_supports_vision(self.active_provider, cfg.model,
                                     cfg.capabilities)

    def supports_audio(self) -> bool:
        """Whether the active model accepts audio directly."""
        cfg = self.provider()
        entry = cfg.capabilities.get(cfg.model) or {}
        return bool(entry.get("audio", False))


def _default_providers() -> dict[str, ProviderConfig]:
    return {
        "gemini": ProviderConfig(model="gemini-2.5-flash"),
        "anthropic": ProviderConfig(model="claude-sonnet-4-5"),
        "openai": ProviderConfig(model="gpt-4o-mini"),
        "openrouter": ProviderConfig(model="anthropic/claude-sonnet-4.5"),
        "ollama": ProviderConfig(model="llava:7b",
                                 host="http://localhost:11434"),
    }


def _deep_fill(target: dict, defaults: dict) -> dict:
    """
    Recursively add missing keys from defaults without overwriting anything
    the user has set. This is the fix for the shallow .update() bug: a stored
    provider entry lacking a new field now gains the default instead of
    leaving the field undefined.
    """
    for key, value in defaults.items():
        if key not in target:
            target[key] = value
        elif isinstance(value, dict) and isinstance(target.get(key), dict):
            _deep_fill(target[key], value)
    return target


class ConfigManager:
    """Thread-safe load/save around a Settings tree."""

    def __init__(self, directory: Path | None = None) -> None:
        self.dir = directory or config_dir()
        self.path = self.dir / "settings.json"
        self._lock = threading.RLock()
        self.settings = Settings(providers=_default_providers())
        self.migrated_from: str = ""
        self.load()

    # ----------------------------------------------------------------- load
    def load(self) -> None:
        with self._lock:
            if not self.path.exists():
                self._try_migrate_v1()
                return
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                # Keep the unreadable file for inspection rather than
                # overwriting the user's only copy of their settings.
                try:
                    self.path.replace(self.path.with_suffix(".corrupt.json"))
                except OSError:
                    pass
                return
            self.settings = self._from_dict(raw)

    def _from_dict(self, raw: dict[str, Any]) -> Settings:
        defaults = asdict(Settings(providers=_default_providers()))
        raw = _deep_fill(dict(raw), defaults)

        providers: dict[str, ProviderConfig] = {}
        custom_names: list[str] = list(raw.get("custom_providers") or [])
        for name, cfg in (raw.get("providers") or {}).items():
            if not isinstance(cfg, dict):
                continue
            is_custom = bool(cfg.get("is_custom", False))
            providers[name] = ProviderConfig(
                model=cfg.get("model", ""),
                host=self._clean_host(cfg.get("host", "")),
                base_url=cfg.get("base_url", ""),
                custom_headers=dict(cfg.get("custom_headers") or {}),
                cached_models=list(cfg.get("cached_models") or []),
                capabilities=dict(cfg.get("capabilities") or {}),
                enabled=bool(cfg.get("enabled", True)),
                is_custom=is_custom,
                label=cfg.get("label", ""))
        for name, cfg in _default_providers().items():
            providers.setdefault(name, cfg)
        # Ensure consistency: every name in custom_providers has a config entry
        # and every is_custom entry is in the list.
        for name in list(custom_names):
            if name not in providers:
                custom_names.remove(name)
        for name, cfg in providers.items():
            if cfg.is_custom and name not in custom_names:
                custom_names.append(name)

        modes = {k: v for k, v in (raw.get("modes") or {}).items()
                 if isinstance(v, str) and v.strip()}
        for name, prompt in BUILTIN_MODES.items():
            modes.setdefault(name, prompt)

        active = raw.get("active_provider", "gemini")
        if active not in providers:
            active = "gemini"

        return Settings(
            version=SCHEMA_VERSION,
            active_provider=active,
            active_mode=(raw.get("active_mode")
                         if raw.get("active_mode") in modes else "General"),
            providers=providers,
            modes=modes,
            vision_prompt=raw.get("vision_prompt") or VISION_PROMPT,
            keymap=dict(raw.get("keymap") or {}),
            appearance=AppearanceConfig(**_subset(raw.get("appearance"),
                                                  AppearanceConfig)),
            audio=AudioConfig(**_subset(raw.get("audio"), AudioConfig)),
            behaviour=BehaviourConfig(**_subset(raw.get("behaviour"),
                                                BehaviourConfig)),
            context_notes=raw.get("context_notes", ""),
            custom_providers=custom_names)

    @staticmethod
    def _clean_host(host: str) -> str:
        """
        Normalise an Ollama host once, at load.

        The shipped config.json had "http://localhost:11434/api/tags" stored as
        the host, so every request path had to defensively strip API suffixes.
        Fixing it here means call sites can just append their endpoint.
        """
        host = (host or "").strip().rstrip("/")
        for suffix in ("/api/tags", "/api/generate", "/api/chat", "/api"):
            if host.endswith(suffix):
                host = host[: -len(suffix)]
        return host or "http://localhost:11434"

    # -------------------------------------------------------------- migrate
    def _try_migrate_v1(self) -> None:
        """
        Adopt settings from the original app if it is sitting alongside us,
        so upgrading does not mean re-entering everything.
        """
        for candidate in (Path.cwd() / "config.json",
                          Path.cwd().parent / "config.json"):
            if not candidate.exists():
                continue
            try:
                raw = json.loads(candidate.read_text(encoding="utf-8"))
            except Exception:
                continue
            self.settings = self._from_dict(raw)
            # Cerebras is replaced by OpenRouter, which reaches the same
            # models (and many more) through a single key.
            if self.settings.active_provider == "cerebras":
                self.settings.active_provider = "openrouter"
            self.settings.providers.pop("cerebras", None)
            # Drop junk modes from the old file (it shipped a "test" mode
            # whose prompt was literal keyboard mashing).
            self.settings.modes = {
                k: v for k, v in self.settings.modes.items()
                if k in BUILTIN_MODES or len(v.strip()) > 20}
            self.migrated_from = str(candidate)
            self.save()
            return

    # ----------------------------------------------------------------- save
    def save(self) -> None:
        with self._lock:
            self.dir.mkdir(parents=True, exist_ok=True)
            payload = asdict(self.settings)
            payload["version"] = SCHEMA_VERSION
            tmp = self.path.with_suffix(".tmp")
            # Atomic replace: a crash mid-write can no longer leave truncated
            # JSON that resets the user to defaults on next launch.
            tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            tmp.replace(self.path)


def _subset(raw: Any, cls: type) -> dict[str, Any]:
    """Keep only keys the dataclass declares, so stale files cannot TypeError."""
    if not isinstance(raw, dict):
        return {}
    valid = {f for f in cls.__dataclass_fields__}
    return {k: v for k, v in raw.items() if k in valid}
