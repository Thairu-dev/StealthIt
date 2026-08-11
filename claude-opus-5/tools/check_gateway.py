"""
End-to-end check of the versatile gateway path against agentrouter.org.

Uses only the app's own provider layer -- no bespoke request building -- so
what this prints is exactly what the app would tell the user. Reads the key
from the environment; nothing is written anywhere.

    python -m tools._check_gateway
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from stealthit.providers.anthropic_p import AnthropicProvider
from stealthit.providers.base import Message, Request
from stealthit.providers.openai_compat import OpenRouterProvider

key = os.environ.get("ANTHROPIC_API_KEY", "")
base = os.environ.get("ANTHROPIC_BASE_URL", "https://agentrouter.org")
if not key:
    print("ANTHROPIC_API_KEY not set; nothing to check.")
    raise SystemExit(0)

print(f"base={base}  key={key[:8]}...{key[-4:]}\n")
print("1. Endpoint discovery -- which roots would be probed?")
p = AnthropicProvider(api_key=key, base_url=base)
for root in p.candidate_base_urls():
    print(f"     {root}")

print("\n2. Catalogue, with no custom headers")
models, note = AnthropicProvider(
    api_key=key, base_url=base).discover_models()
print(f"     models: {len(models)}")
print(f"     note  : {note}")

print("\n3. Catalogue, declaring a client identity")
models2, note2 = AnthropicProvider(
    api_key=key, base_url=base,
    custom_headers={"User-Agent": "claude-cli/2.1.0 (external, cli)"}
).discover_models()
print(f"     models: {len(models2)}")
print(f"     note  : {note2}")

print("\n4. An actual chat turn (the thing that matters)")
provider = AnthropicProvider(
    api_key=key, base_url=base,
    custom_headers={"User-Agent": "claude-cli/2.1.0 (external, cli)"})
req = Request(messages=[Message("user", "Reply with exactly: OK")],
              system="Be terse.", model="claude-opus-5", max_tokens=16)
try:
    text = "".join(c.text for c in provider.stream(req))
    print(f"     reply: {text.strip()!r}")
except Exception as exc:
    from stealthit.providers.base import ProviderError
    if isinstance(exc, ProviderError):
        print(f"     {exc.message}\n     hint: {exc.hint}")
    else:
        print(f"     {type(exc).__name__}: {exc}")

print("\n5. Same key via the OpenAI-compatible dialect (should fail cleanly)")
alt = OpenRouterProvider(api_key=key, base_url=base)
_, alt_note = alt.discover_models()
print(f"     note  : {alt_note}")
