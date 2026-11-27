"""
Lightweight, zero-extra-dependency local Whisper HTTP server for StealthIt.
Uses Python stdlib + already-installed `faster-whisper`.

Run:
    npm run whisper:local
    # or: python scripts/local-whisper-server.py
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from faster_whisper import WhisperModel
except ImportError:
    print(
        "ERROR: faster-whisper is not installed.\n"
        "Install it once with: pip install faster-whisper",
        file=sys.stderr,
    )
    sys.exit(1)

HOST = os.environ.get("WHISPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("WHISPER_PORT", "8000"))
MODEL_NAME = os.environ.get("WHISPER_MODEL", "base.en")

print(f"[StealthIt Local Whisper] Loading model '{MODEL_NAME}' (first run downloads weights)...")
model = WhisperModel(MODEL_NAME, device="auto", compute_type="int8")
print(f"[StealthIt Local Whisper] Ready at http://{HOST}:{PORT}/v1/audio/transcriptions")


def parse_multipart(content_type: str, body: bytes) -> dict[str, bytes]:
    """Minimal multipart/form-data parser using stdlib only (Python 3.13 compatible)."""
    match = re.search(r'boundary=(?:"([^"]+)"|([^;\s]+))', content_type)
    if not match:
        return {}
    boundary = (match.group(1) or match.group(2)).encode("utf-8")
    delimiter = b"--" + boundary
    parts: dict[str, bytes] = {}

    for raw_part in body.split(delimiter)[1:]:
        if raw_part.startswith(b"--"):
            break
        raw_part = raw_part.lstrip(b"\r\n")
        sep_idx = raw_part.find(b"\r\n\r\n")
        if sep_idx == -1:
            continue
        header_block = raw_part[:sep_idx].decode("utf-8", errors="ignore")
        payload = raw_part[sep_idx + 4 :]
        if payload.endswith(b"\r\n"):
            payload = payload[:-2]

        name_match = re.search(r'name="([^"]+)"', header_block)
        if name_match:
            parts[name_match.group(1)] = payload

    return parts


class WhisperHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        # Keep console output concise
        sys.stdout.write(f"[Whisper] {fmt % args}\n")
        sys.stdout.flush()

    def _send_json(self, code: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path in ("/", "/health"):
            self._send_json(200, {"ok": True, "model": MODEL_NAME})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if not self.path.startswith("/v1/audio/transcriptions"):
            self._send_json(404, {"error": "Use POST /v1/audio/transcriptions"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            content_type = self.headers.get("Content-Type", "")
            parts = parse_multipart(content_type, body)
            audio_bytes = parts.get("file")

            if not audio_bytes:
                self._send_json(400, {"error": "Missing multipart 'file' field"})
                return

            lang_bytes = parts.get("language")
            language = lang_bytes.decode("utf-8", errors="ignore").strip() if lang_bytes else None
            if not language or language == "auto":
                language = None

            # faster-whisper accepts file-like BytesIO or temp file path
            try:
                segments, _ = model.transcribe(
                    io.BytesIO(audio_bytes),
                    language=language,
                    vad_filter=True,
                    beam_size=1,
                )
                text = " ".join(seg.text.strip() for seg in segments).strip()
            except Exception:
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    tmp.write(audio_bytes)
                    tmp_path = tmp.name
                try:
                    segments, _ = model.transcribe(
                        tmp_path,
                        language=language,
                        vad_filter=True,
                        beam_size=1,
                    )
                    text = " ".join(seg.text.strip() for seg in segments).strip()
                finally:
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass

            self._send_json(200, {"text": text})
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), WhisperHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[StealthIt Local Whisper] Stopped.")
        server.server_close()
