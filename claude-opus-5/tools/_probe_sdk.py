"""
Does the OFFICIAL Anthropic SDK reach agentrouter natively?

Earlier probing showed the gateway rejects unrecognised clients: a raw urllib
request (User-Agent "Python-urllib/3.13") gets 401 "unauthorized client
detected". That is not a claim about the key -- the same key works from Claude
Code.

The officially supported way to point the SDK at a gateway is the `base_url`
parameter (or ANTHROPIC_BASE_URL). The SDK sends its own genuine client
identity headers, so if the gateway allowlists real Anthropic clients this
needs no header spoofing at all.

Run:  python -m tools._probe_sdk
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import anthropic

key = os.environ.get("ANTHROPIC_API_KEY", "")
base = os.environ.get("ANTHROPIC_BASE_URL", "https://agentrouter.org")
print(f"anthropic SDK {anthropic.__version__}")
print(f"base_url={base}  key={key[:8]}...{key[-4:]}\n")


def attempt(label: str, **client_kwargs) -> bool:
    try:
        client = anthropic.Anthropic(**client_kwargs)
        msg = client.messages.create(
            model="claude-opus-5",
            max_tokens=32,
            messages=[{"role": "user", "content": "Reply with exactly: OK"}],
        )
        text = "".join(b.text for b in msg.content if b.type == "text")
        print(f"  [ OK ] {label}")
        print(f"         reply={text.strip()!r}  model={msg.model!r}")
        print(f"         usage in={msg.usage.input_tokens} out={msg.usage.output_tokens}")
        return True
    except Exception as exc:
        detail = str(exc).replace("\n", " ")[:150]
        print(f"  [FAIL] {label}\n         {type(exc).__name__}: {detail}")
        return False


print("1. base_url + api_key  (sends x-api-key)")
ok_key = attempt("api_key", base_url=base, api_key=key)

print("\n2. base_url + auth_token  (sends Authorization: Bearer)")
ok_tok = attempt("auth_token", base_url=base, auth_token=key)

print("\n3. What identity headers does the SDK actually send?")
client = anthropic.Anthropic(base_url=base, api_key=key)
req = client._build_request(
    anthropic._models.FinalRequestOptions.construct(
        method="post", url="/v1/messages",
        json_data={"model": "claude-opus-5", "max_tokens": 8,
                   "messages": [{"role": "user", "content": "hi"}]},
    )
)
for name, value in sorted(req.headers.items()):
    low = name.lower()
    if low in ("x-api-key", "authorization"):
        value = value[:10] + "...(redacted)"
    if low.startswith(("user-agent", "x-stainless", "anthropic", "x-api", "authorization")):
        print(f"         {name}: {value}")

print("\n" + "-" * 62)
if ok_key or ok_tok:
    print("The official SDK reaches this gateway natively via base_url.\n"
          "No header spoofing required -- the SDK's own client identity is\n"
          "genuine and evidently recognised.")
else:
    print("The SDK's native identity is not accepted either.")
