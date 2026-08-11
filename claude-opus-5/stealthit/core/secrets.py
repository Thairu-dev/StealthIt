"""
Credential storage via DPAPI.

The original app kept API keys in a plaintext .env next to config.json, read
them through os.environ, and wrote them back with dotenv.set_key. That file is
gitignored, which protects against committing it but not against anything else
-- any process running as the user, any backup, any screen share of the folder,
and any log that dumps the environment can read the keys.

CryptProtectData encrypts against the current Windows user account. The
ciphertext is useless on another machine or under another user, and never
appears in the process environment. No master password to manage, no keyring
dependency.
"""
from __future__ import annotations

import base64
import ctypes
import json
import os
from pathlib import Path

from ..native.win32 import (
    CRYPTPROTECT_UI_FORBIDDEN, DATA_BLOB, crypt32, kernel32, last_error,
)

# Bound to the ciphertext; a mismatch here makes decryption fail, which stops
# a blob from another app being swapped in.
_ENTROPY = "StealthIt.v2.credentials"


def _blob(data: bytes) -> DATA_BLOB:
    buf = ctypes.create_string_buffer(data, len(data))
    return DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _blob_bytes(blob: DATA_BLOB) -> bytes:
    return ctypes.string_at(blob.pbData, blob.cbData)


def encrypt(plaintext: str) -> str:
    """Encrypt to a base64 string safe to store in JSON."""
    if not plaintext:
        return ""
    src = _blob(plaintext.encode("utf-8"))
    entropy = _blob(_ENTROPY.encode("utf-8"))
    out = DATA_BLOB()
    ok = crypt32.CryptProtectData(
        ctypes.byref(src), "StealthIt", ctypes.byref(entropy),
        None, None, CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out))
    if not ok:
        raise OSError(f"CryptProtectData failed: {last_error()}")
    try:
        return base64.b64encode(_blob_bytes(out)).decode("ascii")
    finally:
        kernel32.LocalFree(out.pbData)


def decrypt(ciphertext: str) -> str:
    """
    Decrypt, returning "" on any failure.

    Failure is expected and not exceptional: the store may have been copied
    from another machine or written by a different Windows user, in which case
    the right behaviour is an empty key and a settings prompt, not a crash on
    startup.
    """
    if not ciphertext:
        return ""
    try:
        raw = base64.b64decode(ciphertext)
    except Exception:
        return ""
    src = _blob(raw)
    entropy = _blob(_ENTROPY.encode("utf-8"))
    out = DATA_BLOB()
    ok = crypt32.CryptUnprotectData(
        ctypes.byref(src), None, ctypes.byref(entropy),
        None, None, CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out))
    if not ok:
        return ""
    try:
        return _blob_bytes(out).decode("utf-8", errors="replace")
    finally:
        kernel32.LocalFree(out.pbData)


class SecretStore:
    """
    Encrypted key/value store for API keys.

    Values live encrypted at rest and are decrypted on read. Environment
    variables are still honoured as a fallback so CI and power users can
    inject keys without touching the store -- but we never write there.
    """

    ENV_FALLBACK = {
        "gemini": "GEMINI_API_KEY",
        "openai": "OPENAI_API_KEY",
        "anthropic": "ANTHROPIC_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
    }

    def __init__(self, path: Path) -> None:
        self.path = path
        self._data: dict[str, str] = {}
        self.load()

    def load(self) -> None:
        if not self.path.exists():
            self._data = {}
            return
        try:
            self._data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            self._data = {}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Write-then-replace so an interrupted save cannot truncate the store
        # and lose every key the user has entered.
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
        tmp.replace(self.path)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def get(self, name: str) -> str:
        stored = self._data.get(name)
        if stored:
            value = decrypt(stored)
            if value:
                return value
        env_name = self.ENV_FALLBACK.get(name)
        if env_name:
            return os.environ.get(env_name, "")
        return ""

    def set(self, name: str, value: str) -> None:
        if value:
            self._data[name] = encrypt(value)
        else:
            self._data.pop(name, None)
        self.save()

    def has(self, name: str) -> bool:
        return bool(self.get(name))

    def source(self, name: str) -> str:
        """Where a key came from -- shown in settings so it is never a mystery."""
        if self._data.get(name) and decrypt(self._data[name]):
            return "encrypted store"
        env_name = self.ENV_FALLBACK.get(name)
        if env_name and os.environ.get(env_name):
            return f"environment ({env_name})"
        return "not set"

    def import_legacy_env(self, env_path: Path) -> list[str]:
        """
        One-time migration of the old plaintext .env into the encrypted store.

        We deliberately do not delete the original file -- silently destroying
        the user's only copy of their keys would be a poor trade for tidiness.
        The UI tells them it is now safe to remove.
        """
        if not env_path.exists():
            return []
        imported = []
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                value = value.strip().strip('"').strip("'")
                if not value:
                    continue
                for provider, env_name in self.ENV_FALLBACK.items():
                    if key.strip() == env_name and not self._data.get(provider):
                        self.set(provider, value)
                        imported.append(provider)
        except Exception:
            return imported
        return imported
