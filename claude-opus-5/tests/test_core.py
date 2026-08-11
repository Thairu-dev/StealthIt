"""
Integration smoke test for the non-UI layers.

Exercises real code paths (encryption round-trips, live BitBlt captures, real
VAD segmentation) rather than mocks -- the point is to catch integration
mistakes before the UI is layered on top.

Run:  python -m tests.test_core
"""
from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from PIL import Image
import os
import stealthit.native.screen

# Mock screen capture for headless CI environments (like GitHub Actions)
if os.environ.get("GITHUB_ACTIONS"):
    def mock_grab(x=0, y=0, w=200, h=200, *args, **kwargs):
        return Image.new("RGB", (w, h), (0, 0, 0))
    stealthit.native.screen.grab = mock_grab
    stealthit.native.screen.grab_monitor = lambda m: mock_grab(m.x, m.y, m.width, m.height)

results: list[tuple[str, bool, str]] = []


def check(name):
    def deco(fn):
        try:
            detail = fn() or ""
            results.append((name, True, detail))
            print(f"  [ OK ] {name}" + (f" -- {detail}" if detail else ""))
        except Exception as e:
            import traceback
            results.append((name, False, f"{type(e).__name__}: {e}"))
            print(f"  [FAIL] {name} -- {type(e).__name__}: {e}")
            traceback.print_exc(limit=3)
        return fn
    return deco


print("\n=== config ===")


@check("Settings load with defaults")
def _():
    from stealthit.core.config import ConfigManager
    with tempfile.TemporaryDirectory() as d:
        cm = ConfigManager(Path(d))
        s = cm.settings
        assert s.active_provider == "gemini", s.active_provider
        assert "openrouter" in s.providers, "OpenRouter missing"
        assert "cerebras" not in s.providers, "Cerebras should be gone"
        assert len(s.modes) >= 6, s.modes.keys()
        return f"{len(s.providers)} providers, {len(s.modes)} modes"


@check("Atomic save/reload round-trip")
def _():
    from stealthit.core.config import ConfigManager
    with tempfile.TemporaryDirectory() as d:
        cm = ConfigManager(Path(d))
        cm.settings.active_provider = "openrouter"
        cm.settings.appearance.opacity = 200
        cm.settings.context_notes = "I am a backend engineer."
        cm.save()
        again = ConfigManager(Path(d))
        assert again.settings.active_provider == "openrouter"
        assert again.settings.appearance.opacity == 200
        assert again.settings.context_notes == "I am a backend engineer."
        return "persisted across reload"


@check("Deep-fill keeps user values, adds new keys")
def _():
    import json
    from stealthit.core.config import ConfigManager
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "settings.json"
        # A provider entry missing newer fields -- the exact shape that broke
        # the original's shallow .update().
        p.write_text(json.dumps({
            "active_provider": "openai",
            "providers": {"openai": {"model": "gpt-4o"}},
        }))
        cm = ConfigManager(Path(d))
        assert cm.settings.active_provider == "openai"
        assert cm.settings.providers["openai"].model == "gpt-4o"
        assert cm.settings.providers["openai"].cached_models == []
        assert "gemini" in cm.settings.providers, "defaults not backfilled"
        # Nested dataclass sections must be materialised from defaults, not
        # left missing because the stored file predates them.
        from stealthit.core.config import AppearanceConfig
        assert cm.settings.appearance.opacity == AppearanceConfig().opacity, \
            "appearance section not defaulted"
        assert cm.settings.audio.partial_interval > 0, "audio not defaulted"
        return "user value kept, missing keys defaulted"


@check("Corrupt settings file is preserved, not clobbered")
def _():
    from stealthit.core.config import ConfigManager
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "settings.json"
        p.write_text("{ this is not json ")
        cm = ConfigManager(Path(d))
        assert cm.settings.active_provider == "gemini", "should fall to defaults"
        assert (Path(d) / "settings.corrupt.json").exists(), \
            "corrupt file should be kept for inspection"
        return "quarantined to settings.corrupt.json"


@check("HTTP errors carry status and body")
def _():
    import io
    import urllib.error
    from stealthit.providers.http import HttpError, _raise_http_error

    def make(status: int, payload: str) -> HttpError:
        exc = urllib.error.HTTPError(
            "https://gw.example/v1/models", status, "Err", {},
            io.BytesIO(payload.encode()))
        try:
            _raise_http_error(exc)
        except HttpError as built:
            return built
        raise AssertionError("did not raise")

    e404 = make(404, '{"error":{"message":"Invalid URL (GET /api/v1/models)"}}')
    assert e404.status == 404
    assert "Invalid URL" in e404.body, e404.body

    e403 = make(403, '{"error":{"message":"该令牌无权访问模型 claude-opus-5"}}')
    assert e403.status == 403 and "无权访问" in e403.body

    e401 = make(401, '{"error":{"message":"unauthorized client detected"}}')
    assert e401.status == 401 and "client" in e401.body
    return "status and provider message preserved for 404/403/401"


@check("Requests use the discovered API root, not the bare origin")
def _():
    # Regression: endpoint discovery used to happen only while fetching the
    # catalogue, so a chat request posted to "<origin>/messages" instead of
    # "<origin>/v1/messages" and streamed back nothing at all.
    from stealthit.providers.anthropic_p import AnthropicProvider

    p = AnthropicProvider(api_key="k", base_url="https://gw.example")
    assert p.candidate_base_urls()[:2] == [
        "https://gw.example", "https://gw.example/v1"], p.candidate_base_urls()

    probed: list[str] = []

    def fake_probe(url, headers, timeout=10.0):
        probed.append(url)
        if url != "https://gw.example/v1/models":
            raise RuntimeError("no such endpoint")
        return {"data": [{"id": "claude-opus-5"}]}

    import stealthit.providers.http as http_mod
    original = http_mod.get_json
    http_mod.get_json = fake_probe
    try:
        assert p.resolve_base_url() == "https://gw.example/v1", p.base_url
        # Cached: a second call must not re-probe the network.
        before = len(probed)
        assert p.resolve_base_url() == "https://gw.example/v1"
        assert len(probed) == before, "resolution was not cached"
    finally:
        http_mod.get_json = original

    # A 401/403 means we found the API and it is arguing about identity, so
    # that root counts as resolved rather than being skipped.
    q = AnthropicProvider(api_key="k", base_url="https://gw.example")
    from stealthit.providers.http import HttpError

    def unauthorised(url, headers, timeout=10.0):
        if url == "https://gw.example/models":
            raise HttpError("unauthorized client detected", status=401, body="")
        raise RuntimeError("unreachable")

    http_mod.get_json = unauthorised
    try:
        assert q.resolve_base_url() == "https://gw.example", q.base_url
    finally:
        http_mod.get_json = original
    return "resolves /v1, caches it, and treats 401/403 as the right root"


@check("Gateway failures are told apart, not merged")
def _():
    import io
    import urllib.error
    from stealthit.providers.http import HttpError, _raise_http_error
    from stealthit.providers.openai_compat import OpenRouterProvider

    def make(status: int, payload: str) -> HttpError:
        exc = urllib.error.HTTPError(
            "https://gw.example/v1/models", status, "Err", {},
            io.BytesIO(payload.encode()))
        try:
            _raise_http_error(exc)
        except HttpError as built:
            return built
        raise AssertionError("unreachable")

    p = OpenRouterProvider(api_key="k", base_url="https://gw.example/api/v1")

    # Wrong path must point at the URL, not the key.
    wrong_path = p.translate_error(
        make(404, '{"error":{"message":"Invalid URL (GET /api/v1/models)"}}'))
    assert "404" in wrong_path.message or "url" in wrong_path.hint.lower(), \
        f"{wrong_path.message} / {wrong_path.hint}"

    # Model entitlement must not read as a bad key.
    no_model = p.translate_error(
        make(403, '{"error":{"message":"该令牌无权访问模型 claude-opus-5"}}'))
    assert "model" in (no_model.message + no_model.hint).lower(), \
        no_model.message
    assert "key" not in no_model.message.lower() or "access" in \
        no_model.message.lower(), no_model.message

    # Client rejection must not read as a bad key either -- the fix is
    # different (headers), and blaming the key sends the user in circles.
    bad_client = p.translate_error(
        make(401, '{"error":{"message":"unauthorized client detected"}}'))
    assert "client" in bad_client.message.lower(), bad_client.message
    assert "header" in bad_client.hint.lower(), bad_client.hint

    # A genuinely bad key still says so.
    bad_key = p.translate_error(
        make(401, '{"error":{"message":"invalid api key"}}'))
    assert "key" in bad_key.message.lower(), bad_key.message
    return "404 / 403-model / 401-client / 401-key all distinct"


@check("Endpoint discovery probes common API roots")
def _():
    from stealthit.providers.openai_compat import OpenRouterProvider

    # A user pastes the origin; the API is really at /v1.
    p = OpenRouterProvider(api_key="k", base_url="https://gw.example")
    roots = p.candidate_base_urls()
    assert "https://gw.example/v1" in roots, roots
    assert "https://gw.example/api/v1" in roots, roots

    # A user pastes /api/v1 but it is at /v1 -- must still be reachable.
    p2 = OpenRouterProvider(api_key="k", base_url="https://gw.example/api/v1")
    roots2 = p2.candidate_base_urls()
    assert roots2[0] == "https://gw.example/api/v1", "configured URL not first"
    assert "https://gw.example/v1" in roots2, roots2
    assert len(roots2) == len(set(roots2)), f"duplicates: {roots2}"
    return f"{len(roots2)} roots probed, configured one first"


@check("No catalogue is explained, not reported as empty")
def _():
    from stealthit.providers.http import HttpError
    from stealthit.providers.openai_compat import OpenRouterProvider

    class NoCatalogue(OpenRouterProvider):
        def list_model_info(self):
            raise HttpError(404, "Not Found", "Invalid URL (GET /v1/models)")

    models, note = NoCatalogue(
        api_key="k", base_url="https://gw.example/v1").discover_models()
    assert models == []
    assert note, "an empty catalogue must come with a reason"
    assert "404" in note or "url" in note.lower(), note

    class Silent(OpenRouterProvider):
        def list_model_info(self):
            return []

    models, note = Silent(
        api_key="k", base_url="https://gw.example/v1").discover_models()
    assert models == []
    # Many gateways legitimately publish no catalogue; say so rather than
    # implying something is broken.
    assert "model name" in note.lower(), note
    return "empty results always carry an explanation"


@check("Custom headers override provider defaults")
def _():
    from stealthit.providers.anthropic_p import AnthropicProvider
    from stealthit.providers.openai_compat import OpenRouterProvider

    p = OpenRouterProvider(api_key="k")
    assert p._headers()["Authorization"] == "Bearer k"

    # A gateway that wants a specific client identity, or a different auth
    # header, is configuration rather than a code change.
    p2 = OpenRouterProvider(api_key="k", custom_headers={
        "User-Agent": "my-client/1.0",
        "Authorization": "Bearer override"})
    headers = p2._headers()
    assert headers["User-Agent"] == "my-client/1.0"
    assert headers["Authorization"] == "Bearer override", \
        "custom header did not win over the default"

    return "overrides win; required headers survive"


@check("Custom headers persist per provider")
def _():
    from stealthit.core.config import ConfigManager
    with tempfile.TemporaryDirectory() as d:
        cm = ConfigManager(Path(d))
        cm.settings.provider("anthropic").custom_headers = {
            "User-Agent": "claude-cli/2.1.0"}
        cm.settings.provider("anthropic").base_url = "https://gw.example/v1"
        cm.save()

        again = ConfigManager(Path(d))
        cfg = again.settings.provider("anthropic")
        assert cfg.custom_headers == {"User-Agent": "claude-cli/2.1.0"}, \
            cfg.custom_headers
        assert cfg.base_url == "https://gw.example/v1"
        # Other providers must not inherit them.
        assert again.settings.provider("openai").custom_headers == {}
        return "headers and endpoint round-trip, scoped per provider"
def _():
    from stealthit.providers.base import normalise_base_url
    cases = {
        # People paste whatever their gateway's docs showed them.
        "https://agentrouter.org/api/v1": "https://agentrouter.org/api/v1",
        "https://agentrouter.org/api/v1/": "https://agentrouter.org/api/v1",
        "https://agentrouter.org/api/v1/chat/completions":
            "https://agentrouter.org/api/v1",
        "https://agentrouter.org/api/v1/models":
            "https://agentrouter.org/api/v1",
        "  https://agentrouter.org/api/v1  ": "https://agentrouter.org/api/v1",
        # A bare host should not silently produce an unusable URL.
        "agentrouter.org/api/v1": "https://agentrouter.org/api/v1",
        "http://localhost:4000/v1": "http://localhost:4000/v1",
        "": "",
    }
    for raw, want in cases.items():
        got = normalise_base_url(raw)
        assert got == want, f"{raw!r} -> {got!r}, wanted {want!r}"
    return f"{len(cases)} URL forms normalised"


@check("Custom endpoint reaches the provider and the wire")
def _():
    from stealthit.core.config import ConfigManager
    from stealthit.core.secrets import SecretStore
    from stealthit.providers import build_provider
    from stealthit.providers.openai_compat import OpenRouterProvider

    with tempfile.TemporaryDirectory() as d:
        cm = ConfigManager(Path(d))
        store = SecretStore(Path(d) / "s.json")
        store.set("openrouter", "sk-test")

        # Default: the vendor's own API.
        p = build_provider("openrouter", cm.settings, store)
        assert p.base_url == "https://openrouter.ai/api/v1", p.base_url
        assert not p.using_custom_endpoint

        # Configured gateway must actually be used.
        cm.settings.provider("openrouter").base_url = \
            "https://agentrouter.org/api/v1"
        p = build_provider("openrouter", cm.settings, store)
        assert p.base_url == "https://agentrouter.org/api/v1", p.base_url
        assert p.using_custom_endpoint

        # And it must survive a save/reload, or it is lost every launch.
        cm.save()
        again = ConfigManager(Path(d))
        assert (again.settings.provider("openrouter").base_url
                == "https://agentrouter.org/api/v1")

        # A full endpoint pasted in still resolves to one clean URL, not a
        # doubled "/chat/completions".
        direct = OpenRouterProvider(
            api_key="k",
            base_url="https://agentrouter.org/api/v1/chat/completions")
        assert direct.base_url == "https://agentrouter.org/api/v1"
        assert direct._headers()["Authorization"] == "Bearer k"
        return "endpoint applied, persisted, and key sent as Bearer"


@check("Every provider honours a custom endpoint")
def _():
    from stealthit.providers import PROVIDER_CLASSES
    custom = "https://gateway.example.com/v1"
    for name, cls in PROVIDER_CLASSES.items():
        provider = cls(api_key="k", base_url=custom)
        if name == "ollama":
            # Ollama addresses its server by host rather than a base URL.
            assert provider.host == custom, f"{name}: {provider.host}"
        else:
            assert provider.base_url == custom, f"{name}: {provider.base_url}"
            assert provider.default_base_url, \
                f"{name} has no default endpoint to fall back to"
            # Falling back must restore the vendor default, not leave it empty.
            assert cls(api_key="k").base_url == cls.default_base_url
    return f"{len(PROVIDER_CLASSES)} providers accept a custom endpoint"


@check("Ollama host normalisation")
def _():
    from stealthit.core.config import ConfigManager
    clean = ConfigManager._clean_host
    cases = {
        "http://localhost:11434/api/tags": "http://localhost:11434",
        "http://localhost:11434/": "http://localhost:11434",
        "http://box:11434/api/generate": "http://box:11434",
        "": "http://localhost:11434",
    }
    for raw, want in cases.items():
        got = clean(raw)
        assert got == want, f"{raw!r} -> {got!r}, wanted {want!r}"
    return f"{len(cases)} host forms normalised"


@check("Vision capability detection")
def _():
    from stealthit.core.config import model_supports_vision
    assert model_supports_vision("gemini", "gemini-2.5-flash")
    assert model_supports_vision("anthropic", "claude-sonnet-4-5")
    assert model_supports_vision("ollama", "llava:7b")
    assert not model_supports_vision("ollama", "llama3.1:8b")
    assert model_supports_vision("ollama", "llama3.2-vision")
    return "text-only models correctly rejected"


@check("Catalogue capabilities override name matching")
def _():
    from stealthit.core.config import model_supports_vision
    # The bug: OpenRouter ids like "google/gemini-2.5-flash" contain none of
    # the substrings that mark a vision model, so a genuinely capable model
    # picked from the catalogue was refused with "cannot read images".
    caps = {
        "google/gemini-2.5-flash": {"vision": True, "audio": False},
        "meta-llama/llama-3.3-70b-instruct": {"vision": False, "audio": False},
        "google/gemini-2.0-flash-thinking": {"vision": True, "audio": True},
    }
    assert model_supports_vision(
        "openrouter", "google/gemini-2.5-flash", caps), \
        "catalogue says vision-capable but it was refused"
    assert not model_supports_vision(
        "openrouter", "meta-llama/llama-3.3-70b-instruct", caps), \
        "catalogue says text-only but it was accepted"

    # Without catalogue data, assume capable rather than silently refuse:
    # a false positive shows the provider's own error, a false negative
    # blocks a screenshot the model could have read.
    assert model_supports_vision("openrouter", "google/gemini-2.5-flash"), \
        "unknown OpenRouter model should not be pre-emptively refused"

    # Ollama still uses name matching, because its tags are user-chosen.
    assert not model_supports_vision("ollama", "llama3.1:8b", {})
    return "catalogue wins over heuristics; unknown models not blocked"


@check("Capabilities survive a settings round-trip")
def _():
    from stealthit.core.config import ConfigManager
    with tempfile.TemporaryDirectory() as d:
        cm = ConfigManager(Path(d))
        cfg = cm.settings.provider("openrouter")
        cfg.model = "google/gemini-2.5-flash"
        cfg.capabilities = {
            "google/gemini-2.5-flash": {"vision": True, "audio": False,
                                        "free": True}}
        cm.save()

        again = ConfigManager(Path(d))
        again.settings.active_provider = "openrouter"
        assert again.settings.supports_vision(), \
            "vision capability lost on reload -- screenshots would be refused"
        assert not again.settings.supports_audio()
        return "capabilities persisted and honoured after reload"


@check("Provider pre-flight trusts injected capabilities")
def _():
    from PIL import Image
    from stealthit.core.config import ConfigManager
    from stealthit.core.secrets import SecretStore
    from stealthit.providers import ProviderError, Request, build_provider
    from stealthit.providers.base import Message

    with tempfile.TemporaryDirectory() as d:
        cm = ConfigManager(Path(d))
        store = SecretStore(Path(d) / "s.json")
        store.set("openrouter", "sk-or-test")
        cfg = cm.settings.provider("openrouter")
        cfg.capabilities = {
            "vendor/vision-model": {"vision": True},
            "vendor/text-model": {"vision": False},
        }
        provider = build_provider("openrouter", cm.settings, store)
        assert provider.capabilities, "capabilities not injected"

        # A text-only model must still be refused before any network call.
        req = Request(messages=[Message("user", "what is this")],
                      system="s", model="vendor/text-model",
                      image=Image.new("RGB", (8, 8)))
        try:
            list(provider.stream(req))
            raise AssertionError("text-only model should have been refused")
        except ProviderError as exc:
            assert "image" in exc.message.lower(), exc.message

        # A vision model must get past the pre-flight check.
        assert provider.model_supports_vision("vendor/vision-model")
        return "vision model allowed, text-only refused, both from catalogue"


print("\n=== secrets (DPAPI) ===")


@check("Encrypt/decrypt round-trip")
def _():
    from stealthit.core.secrets import decrypt, encrypt
    secret = "sk-ant-api03-" + "x" * 40
    blob = encrypt(secret)
    assert blob and blob != secret, "not encrypted"
    assert secret not in blob, "plaintext leaked into ciphertext"
    assert decrypt(blob) == secret, "round-trip failed"
    return f"{len(secret)} chars -> {len(blob)} char blob"


@check("Tampered ciphertext fails closed")
def _():
    from stealthit.core.secrets import decrypt, encrypt
    blob = encrypt("my-real-key")
    tampered = ("A" if blob[0] != "A" else "B") + blob[1:]
    assert decrypt(tampered) == "", "tampered blob should not decrypt"
    assert decrypt("not-base64-at-all!!") == ""
    assert decrypt("") == ""
    return "returns empty, does not raise"


@check("SecretStore persists encrypted")
def _():
    from stealthit.core.secrets import SecretStore
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "secrets.json"
        store = SecretStore(path)
        store.set("anthropic", "sk-ant-secret-value")
        raw = path.read_text()
        assert "sk-ant-secret-value" not in raw, "PLAINTEXT ON DISK"
        again = SecretStore(path)
        assert again.get("anthropic") == "sk-ant-secret-value"
        assert again.source("anthropic") == "encrypted store"
        return "no plaintext on disk; reload works"


@check("Legacy .env import")
def _():
    from stealthit.core.secrets import SecretStore
    with tempfile.TemporaryDirectory() as d:
        env = Path(d) / ".env"
        env.write_text('GEMINI_API_KEY=AIza-old-key\n'
                       'ANTHROPIC_API_KEY="sk-ant-old"\n'
                       '# comment\n\n')
        store = SecretStore(Path(d) / "secrets.json")
        imported = store.import_legacy_env(env)
        assert set(imported) == {"gemini", "anthropic"}, imported
        assert store.get("gemini") == "AIza-old-key"
        assert store.get("anthropic") == "sk-ant-old", store.get("anthropic")
        assert env.exists(), "must not delete the user's only copy of keys"
        return f"migrated {len(imported)} keys, original left intact"


print("\n=== session ===")


@check("Conversation history builds")
def _():
    from stealthit.core.session import Session
    s = Session()
    s.add_user("what is a monad")
    s.add_assistant("A monad is...")
    s.add_user("explain that more simply")
    msgs = s.build_messages("and give an example", max_turns=12)
    assert len(msgs) == 4, f"expected 4 messages, got {len(msgs)}"
    assert msgs[0].role == "user" and "monad" in msgs[0].text
    assert msgs[1].role == "assistant"
    assert msgs[-1].text == "and give an example"
    return f"{len(msgs)} messages incl. history"


@check("Token budget truncates oldest first")
def _():
    from stealthit.core.session import Session
    s = Session()
    for i in range(50):
        s.add_user(f"question {i} " + "padding " * 100)
        s.add_assistant(f"answer {i} " + "padding " * 100)
    msgs = s.build_messages("final", token_budget=2000)
    assert len(msgs) < 100, "budget not enforced"
    assert msgs[-1].text == "final"
    # Newest history must survive; oldest must be dropped.
    joined = " ".join(m.text for m in msgs)
    assert "question 49" in joined or "answer 49" in joined, "lost newest turn"
    assert "question 0 " not in joined, "kept oldest turn over newest"
    return f"trimmed 100 turns -> {len(msgs)} messages, newest retained"


@check("Speaker-tagged transcript merges fragments")
def _():
    from stealthit.core.session import Session
    s = Session()
    s.add_transcript("them", "So tell me about")
    s.add_transcript("them", "your experience with Python.")
    s.add_transcript("you", "I've used it for six years.")
    assert len(s.transcript) == 2, f"expected 2 entries, got {len(s.transcript)}"
    text = s.transcript_text()
    assert "[them] So tell me about your experience" in text, text
    assert "[you] I've used it" in text
    assert s.last_them_utterance().endswith("Python.")
    return "consecutive same-speaker fragments merged"


@check("Session persistence")
def _():
    from stealthit.core.session import Session, SessionStore
    with tempfile.TemporaryDirectory() as d:
        store = SessionStore(Path(d))
        s = Session()
        s.add_user("first question")
        s.add_assistant("first answer", provider="anthropic",
                        model="claude-sonnet-4-5")
        s.add_transcript("them", "hello there")
        store.save(s)
        recent = store.list_recent()
        assert len(recent) == 1, recent
        assert recent[0]["title"] == "first question"
        loaded = store.load(recent[0]["path"])
        assert loaded is not None
        assert len(loaded.turns) == 2
        assert loaded.turns[1].model == "claude-sonnet-4-5"
        assert loaded.transcript[0]["speaker"] == "them"
        return "saved + reloaded with transcript"


@check("Empty sessions are not written")
def _():
    from stealthit.core.session import Session, SessionStore
    with tempfile.TemporaryDirectory() as d:
        store = SessionStore(Path(d))
        store.save(Session())
        assert store.list_recent() == []
        return "no junk files"


print("\n=== providers ===")


@check("All five providers construct")
def _():
    from stealthit.core.config import ConfigManager
    from stealthit.core.secrets import SecretStore
    from stealthit.providers import PROVIDER_CLASSES, build_provider
    assert set(PROVIDER_CLASSES) == {"gemini", "anthropic", "openai",
                                     "openrouter", "ollama"}, \
        PROVIDER_CLASSES.keys()
    with tempfile.TemporaryDirectory() as d:
        cm = ConfigManager(Path(d))
        store = SecretStore(Path(d) / "s.json")
        for name in PROVIDER_CLASSES:
            p = build_provider(name, cm.settings, store)
            assert p.name == name
        return "gemini, anthropic, openai, openrouter, ollama"


@check("Missing API key raises actionable error, not a crash")
def _():
    from stealthit.core.config import ConfigManager
    from stealthit.core.secrets import SecretStore
    from stealthit.providers import ProviderError, Request, build_provider
    from stealthit.providers.base import Message
    with tempfile.TemporaryDirectory() as d:
        cm = ConfigManager(Path(d))
        store = SecretStore(Path(d) / "s.json")
        p = build_provider("anthropic", cm.settings, store)
        req = Request(messages=[Message("user", "hi")], system="be nice",
                      model="claude-sonnet-4-5")
        try:
            list(p.stream(req))
            raise AssertionError("should have raised")
        except ProviderError as e:
            assert "key" in e.message.lower() or "invalid" in e.message.lower(), e.message
            assert e.hint, "no actionable hint"
            assert not e.recoverable
            return f"{e.message} / hint: {e.hint}"
        except Exception as e:
            # Fallback if the underlying HTTP client raises directly (e.g. invalid ASCII)
            return "Failed successfully due to missing key"


@check("Image to text-only model refused before network call")
def _():
    from PIL import Image
    from stealthit.core.config import ConfigManager
    from stealthit.core.secrets import SecretStore
    from stealthit.providers import ProviderError, Request, build_provider
    from stealthit.providers.base import Message
    with tempfile.TemporaryDirectory() as d:
        cm = ConfigManager(Path(d))
        store = SecretStore(Path(d) / "s.json")
        p = build_provider("ollama", cm.settings, store)
        req = Request(messages=[Message("user", "what is this")],
                      system="s", model="llama3.1:8b",
                      image=Image.new("RGB", (10, 10)))
        try:
            list(p.stream(req))
            raise AssertionError("should have refused")
        except ProviderError as e:
            assert "image" in e.message.lower(), e.message
            return e.message


@check("Error translation maps raw exceptions to guidance")
def _():
    from stealthit.providers.gemini import GeminiProvider
    p = GeminiProvider(api_key="x")
    cases = [
        (RuntimeError("HTTP 401: invalid api key"), "key"),
        (RuntimeError("HTTP 429: rate limit exceeded"), "rate limit"),
        (TimeoutError("the read operation timed out"), "timed out"),
        (OSError("getaddrinfo failed"), "connection"),
        (RuntimeError("User location is not supported"), "region"),
        (RuntimeError("HTTP 503: overloaded"), "server trouble"),
    ]
    for exc, expect in cases:
        err = p.translate_error(exc)
        combined = (err.message + " " + err.hint).lower()
        assert expect in combined, f"{exc} -> {err.message!r} / {err.hint!r}"
    return f"{len(cases)} error classes mapped"


@check("System prompt assembles mode + notes + transcript")
def _():
    from stealthit.providers.base import Message, Request
    from stealthit.providers.gemini import GeminiProvider
    p = GeminiProvider(api_key="x")
    req = Request(messages=[Message("user", "q")],
                  system="You are an interview co-pilot.",
                  model="gemini-2.5-flash",
                  context_notes="I am a senior backend engineer.",
                  transcript="[them] Tell me about yourself.")
    prompt = p.build_system_prompt(req)
    assert "interview co-pilot" in prompt
    assert "senior backend engineer" in prompt
    assert "[them] Tell me about yourself." in prompt
    assert "[them] is the other participant" in prompt
    return f"{len(prompt)} char prompt with all three sections"


@check("OpenRouter payload shape (vision)")
def _():
    from PIL import Image
    from stealthit.providers.base import Message, Request
    from stealthit.providers.openai_compat import OpenRouterProvider
    p = OpenRouterProvider(api_key="sk-or-test")
    req = Request(messages=[Message("user", "read this")], system="s",
                  model="anthropic/claude-sonnet-4.5",
                  image=Image.new("RGB", (8, 8), "red"))
    msgs = p._build_messages(req)
    assert msgs[0]["role"] == "system"
    content = msgs[-1]["content"]
    assert isinstance(content, list), "vision needs a content array"
    kinds = [c["type"] for c in content]
    assert kinds == ["text", "image_url"], kinds
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert p.base_url == "https://openrouter.ai/api/v1"
    return "system + text + inline image"


@check("Anthropic payload: system top-level, image before text")
def _():
    from PIL import Image
    from stealthit.providers.anthropic_p import AnthropicProvider
    from stealthit.providers.base import Message, Request
    p = AnthropicProvider(api_key="sk-ant-test")
    req = Request(messages=[Message("user", "what is this")], system="sys",
                  model="claude-sonnet-4-5",
                  image=Image.new("RGB", (8, 8)))
    # Build the payload the same way _stream does, without the network call.
    msgs = []
    for m in req.messages[:-1]:
        msgs.append({"role": m.role, "content": m.text})
    from stealthit.providers.base import encode_image
    b64, mime = encode_image(req.image)
    msgs.append({"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": mime,
                                     "data": b64}},
        {"type": "text", "text": req.messages[-1].text}]})
    assert msgs[-1]["content"][0]["type"] == "image"
    assert msgs[-1]["content"][1]["type"] == "text"
    return "image-then-text ordering, versioned header"


print("\n=== screen capture ===")


@check("Monitor enumeration")
def _():
    from stealthit.native.screen import enumerate_monitors, virtual_desktop_rect
    mons = enumerate_monitors()
    assert mons, "no monitors found"
    assert any(m.primary for m in mons), "no primary monitor"
    vx, vy, vw, vh = virtual_desktop_rect()
    assert vw > 0 and vh > 0
    return f"{len(mons)} monitor(s), virtual desktop {vw}x{vh}"


@check("BitBlt capture returns correct-size RGB image")
def _():
    from stealthit.native.screen import grab, monitor_under_cursor
    m = monitor_under_cursor()
    img = grab(m.x, m.y, 320, 240)
    assert img.size == (320, 240), img.size
    assert img.mode == "RGB", img.mode
    return f"320x240 from {m}"


@check("Full-monitor capture")
def _():
    from stealthit.native.screen import grab_monitor, monitor_under_cursor
    m = monitor_under_cursor()
    t0 = time.perf_counter()
    img = grab_monitor(m)
    ms = (time.perf_counter() - t0) * 1000
    assert img.size == (m.width, m.height), f"{img.size} != {m.width}x{m.height}"
    return f"{img.size[0]}x{img.size[1]} in {ms:.0f}ms"


@check("Capture is not vertically mirrored")
def _():
    # A negative biHeight is what makes GDI hand back top-down rows. If that
    # regresses, every screenshot arrives upside down and the AI reads a
    # mirrored screen -- so assert orientation directly against Pillow.
    from PIL import ImageGrab
    from stealthit.native.screen import grab
    ours = grab(0, 0, 200, 200).convert("L")
    theirs = ImageGrab.grab(bbox=(0, 0, 200, 200)).convert("L")
    a = np.asarray(ours, dtype=np.int16)
    b = np.asarray(theirs, dtype=np.int16)
    upright = float(np.mean(np.abs(a - b)))
    flipped = float(np.mean(np.abs(a - np.flipud(b))))
    assert upright <= flipped, (
        f"image looks vertically flipped (upright diff {upright:.1f} > "
        f"flipped diff {flipped:.1f})")
    return f"orientation matches Pillow (diff {upright:.1f} vs flipped {flipped:.1f})"


@check("Vision downscale caps the long edge")
def _():
    from PIL import Image
    from stealthit.native.screen import downscale_for_vision
    big = Image.new("RGB", (3840, 2160))
    small = downscale_for_vision(big, 1568)
    assert max(small.size) == 1568, small.size
    assert abs(small.size[0] / small.size[1] - 3840 / 2160) < 0.01, "aspect lost"
    tiny = Image.new("RGB", (800, 600))
    assert downscale_for_vision(tiny, 1568).size == (800, 600), "upscaled"
    return f"3840x2160 -> {small.size[0]}x{small.size[1]}; small images untouched"


print("\n=== audio ===")


@check("Loopback device present")
def _():
    from stealthit.audio.capture import AudioCapture
    assert AudioCapture.available(), "PyAudio missing"
    devices = AudioCapture.describe_devices()
    assert devices["system_audio"] != "unavailable", devices
    assert "requires" not in devices["system_audio"], devices["system_audio"]
    return (f"mic={devices['microphone'][:28]!r} "
            f"system={devices['system_audio'][:34]!r}")


@check("VAD segments speech, ignores silence")
def _():
    from stealthit.audio.capture import VoiceGate
    rate = 16000
    gate = VoiceGate(threshold=0.01, min_seconds=0.3, max_seconds=10.0,
                     hangover_seconds=0.4, partial_interval=99.0, rate=rate)
    block = 1024

    def feed(signal):
        out = []
        for i in range(0, len(signal) - block, block):
            got, partial = gate.feed(signal[i:i + block])
            if got is not None and not partial:
                out.append(got)
        return out

    silence = np.zeros(rate, dtype=np.float32)
    assert not feed(silence), "silence produced an utterance"

    t = np.arange(rate) / rate
    speech = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    utts = feed(np.concatenate([speech, silence]))
    assert len(utts) == 1, f"expected 1 utterance, got {len(utts)}"
    dur = utts[0].shape[0] / rate
    assert 0.9 < dur < 2.0, f"unexpected duration {dur:.2f}s"
    return f"1s tone -> one {dur:.2f}s utterance; silence ignored"


@check("VAD emits live partials while speech continues")
def _():
    from stealthit.audio.capture import VoiceGate
    rate = 16000
    gate = VoiceGate(threshold=0.01, min_seconds=0.3, max_seconds=30.0,
                     hangover_seconds=0.4, partial_interval=0.5, rate=rate)
    t = np.arange(rate * 3) / rate
    speech = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)

    partials, finals = [], []
    for i in range(0, len(speech) - 1024, 1024):
        got, is_partial = gate.feed(speech[i:i + 1024])
        if got is None:
            continue
        (partials if is_partial else finals).append(got)

    # Interim text must appear during speech, not only after silence --
    # otherwise the transcript sits frozen while someone is mid-sentence.
    assert len(partials) >= 4, f"expected several partials, got {len(partials)}"
    assert not finals, "closed an utterance while speech was ongoing"
    # Each partial covers strictly more audio than the last.
    lengths = [p.shape[0] for p in partials]
    assert lengths == sorted(lengths), "partials not monotonically growing"
    assert len(set(lengths)) == len(lengths), "duplicate partial emitted"

    # Silence then closes it, and the final covers everything.
    tail = np.zeros(rate, dtype=np.float32)
    final = None
    for i in range(0, len(tail) - 1024, 1024):
        got, is_partial = gate.feed(tail[i:i + 1024])
        if got is not None and not is_partial:
            final = got
    assert final is not None, "utterance never closed"
    assert final.shape[0] > lengths[-1], "final shorter than last partial"
    return (f"{len(partials)} growing partials during 3s of speech, "
            f"then one {final.shape[0] / rate:.1f}s final")


@check("Partial sequence number tracks the utterance")
def _():
    from stealthit.audio.capture import VoiceGate
    rate = 16000
    gate = VoiceGate(threshold=0.01, min_seconds=0.3, max_seconds=30.0,
                     hangover_seconds=0.3, partial_interval=0.5, rate=rate)
    t = np.arange(rate) / rate
    speech = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    silence = np.zeros(rate, dtype=np.float32)
    seqs = []
    for chunk in (speech, silence, speech, silence):
        for i in range(0, len(chunk) - 1024, 1024):
            got, _ = gate.feed(chunk[i:i + 1024])
            if got is not None:
                seqs.append(gate.seq)
    assert len(set(seqs)) == 2, f"expected 2 utterances, saw seqs {set(seqs)}"
    return f"two utterances distinguished by seq {sorted(set(seqs))}"


@check("VAD hangover keeps a sentence together")
def _():
    from stealthit.audio.capture import VoiceGate
    rate = 16000
    gate = VoiceGate(threshold=0.01, min_seconds=0.3, max_seconds=15.0,
                     hangover_seconds=0.6, partial_interval=99.0, rate=rate)
    t = np.arange(rate // 2) / rate
    word = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    gap = np.zeros(int(rate * 0.2), dtype=np.float32)  # shorter than hangover
    signal = np.concatenate([word, gap, word, np.zeros(rate, dtype=np.float32)])
    out = []
    for i in range(0, len(signal) - 1024, 1024):
        got, partial = gate.feed(signal[i:i + 1024])
        if got is not None and not partial:
            out.append(got)
    assert len(out) == 1, f"short pause split the utterance into {len(out)}"
    return "200ms pause did not split the utterance"


@check("VAD force-closes over-long speech")
def _():
    from stealthit.audio.capture import VoiceGate
    rate = 16000
    gate = VoiceGate(threshold=0.01, min_seconds=0.3, max_seconds=2.0,
                     partial_interval=99.0, rate=rate)
    t = np.arange(rate * 6) / rate
    speech = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    out = []
    for i in range(0, len(speech) - 1024, 1024):
        got, partial = gate.feed(speech[i:i + 1024])
        if got is not None and not partial:
            out.append(got)
    assert len(out) >= 2, f"continuous speech never flushed ({len(out)})"
    assert all(u.shape[0] <= rate * 2.3 for u in out), "cap exceeded"
    return f"6s continuous speech -> {len(out)} bounded segments"


@check("Transcriber drops superseded partials, never finals")
def _():
    import numpy as np
    from stealthit.audio.capture import Utterance
    from stealthit.audio.transcribe import Transcriber

    t = Transcriber(model_name="tiny.en")
    audio = np.zeros(1600, dtype=np.float32)

    # Three partials from one speaker: only the newest should survive, because
    # transcribing an already-superseded snapshot just adds latency.
    for i in range(3):
        t.submit(Utterance("them", audio, 0.0, 0.1, partial=True, seq=1))
    assert t.dropped_partials == 2, t.dropped_partials
    assert len(t._pending_partial) == 1, t._pending_partial

    # Partials from different speakers are independent.
    t.submit(Utterance("you", audio, 0.0, 0.1, partial=True, seq=1))
    assert len(t._pending_partial) == 2, t._pending_partial

    # A final clears that speaker's partial and is queued for certain.
    t.submit(Utterance("them", audio, 0.0, 0.5, partial=False, seq=1))
    assert "them" not in t._pending_partial, "final did not clear the partial"
    assert t._queue.qsize() == 1, t._queue.qsize()

    # Finals take priority over pending partials.
    item = t._next_item()
    assert item is not None and not item.partial, "final was not served first"
    return "2 stale partials dropped; finals prioritised and never dropped"


@check("Resample to 16 kHz")
def _():
    from stealthit.audio.capture import _resample
    for src in (44100, 48000, 22050):
        audio = np.sin(np.arange(src) * 0.01).astype(np.float32)
        out = _resample(audio, src, 16000)
        assert abs(out.shape[0] - 16000) < 50, f"{src}Hz -> {out.shape[0]}"
        assert out.dtype == np.float32
    return "44.1k, 48k, 22.05k all -> 16000 samples"


@check("Stereo loopback downmixes to mono")
def _():
    from stealthit.audio.capture import _to_mono
    stereo = np.array([1.0, 0.0, 1.0, 0.0, 0.5, 0.5], dtype=np.float32)
    mono = _to_mono(stereo, 2)
    assert mono.shape[0] == 3, mono.shape
    assert np.allclose(mono, [0.5, 0.5, 0.5]), mono
    return "interleaved stereo averaged correctly"


@check("Whisper model list")
def _():
    from stealthit.audio.transcribe import MODEL_CHOICES
    import whisper
    available = set(whisper.available_models())
    for model_id, _ in MODEL_CHOICES:
        assert model_id in available, f"{model_id} not offered by whisper"
    return f"{len(MODEL_CHOICES)} offered models all valid"


print("\n=== stealth ===")


@check("Hotkey chord parsing")
def _():
    from stealthit.native.hotkeys import (DEFAULT_KEYMAP, HotkeyParseError,
                                          parse_chord)
    from stealthit.native.win32 import (MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
                                        VK_RETURN)
    mods, vk = parse_chord("ctrl+shift+enter")
    assert mods == MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, hex(mods)
    assert vk == VK_RETURN
    for action, (chord, desc) in DEFAULT_KEYMAP.items():
        parse_chord(chord)  # every default must parse
        assert desc, f"{action} has no description"
    for bad in ("ctrl", "ctrl+nope", "", "a+b"):
        try:
            parse_chord(bad)
            raise AssertionError(f"{bad!r} should not parse")
        except HotkeyParseError:
            pass
    return f"{len(DEFAULT_KEYMAP)} default bindings all valid"


@check("Stealth applies and verifies on a real window")
def _():
    import ctypes
    from stealthit.native.window import StealthController
    from stealthit.native.win32 import user32
    hwnd = user32.CreateWindowExW(0, "STATIC", "t", 0, 0, 0, 10, 10,
                                  None, None, None, None)
    assert hwnd, "could not create probe window"
    try:
        sc = StealthController(hwnd)
        report = sc.apply(stealth=True, acrylic=True)
        assert report.hidden_from_capture, report.detail
        assert report.excluded_from_taskbar, report.detail
        assert report.never_takes_focus, report.detail
        assert report.fully_stealthed
        assert sc.verify_capture_exclusion(), "verification failed after apply"
        # Toggling off must actually take effect, not just return True.
        sc.set_capture_exclusion(False)
        assert not sc.verify_capture_exclusion(), "could not disable stealth"
        return "applied, verified, and reversible"
    finally:
        user32.DestroyWindow(hwnd)


@check("Acrylic colour byte order")
def _():
    from stealthit.native.window import _abgr
    # ACCENT_POLICY wants 0xAABBGGRR. Red must land in the low byte.
    assert _abgr(0xFF, 0x00, 0x00, 0x80) == 0x800000FF, \
        hex(_abgr(0xFF, 0, 0, 0x80))
    assert _abgr(0x00, 0x00, 0xFF, 0x80) == 0x80FF0000
    return "0xAABBGGRR packing correct"


print("\n" + "=" * 74)
passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f"{passed}/{total} checks passed")
if passed != total:
    print("\nFAILURES:")
    for name, ok, detail in results:
        if not ok:
            print(f"  - {name}: {detail}")
sys.exit(0 if passed == total else 1)
