"""
Shared HTTP helper.

Deliberately built on urllib rather than requests so the packaged exe stays
lean and dependency-light. Handles the one thing SSE parsing consistently gets
wrong: a JSON object split across TCP reads.

Note on timeouts: the original called socket.setdefaulttimeout(30) from inside
a worker thread, which mutates a process-global and silently changed the
timeout of every other socket in the app, including the audio uploads. Here
timeouts are per-request arguments.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterator


class HttpError(RuntimeError):
    """
    An HTTP failure with its status and the provider's own message intact.

    The status and body are what make a 401 ("bad key") distinguishable from a
    404 ("wrong URL") from a 403 ("key has no access to this model"). Callers
    that catch a bare `Exception` and return an empty list throw all of that
    away; carrying it here means every layer upstream can say something real.
    """

    def __init__(self, status: int, reason: str = "", body: str = "") -> None:
        super().__init__(f"HTTP {status}: {reason or ''}"
                         + (f" {body[:200]}" if body else ""))
        self.status = status
        self.reason = reason
        self.body = body


def _raise_http_error(e: urllib.error.HTTPError) -> None:
    """
    Turn an HTTPError into an HttpError carrying the status and the
    provider's own message.

    Providers put the useful text in the response body, not the status line;
    reading it turns "HTTP Error 400: Bad Request" into something actionable.
    """
    body = ""
    raw = ""
    try:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                err = parsed.get("error", parsed)
                if isinstance(err, dict):
                    body = str(err.get("message")
                               or err.get("type") or "")
                else:
                    body = str(err)
            else:
                body = raw[:300]
        except json.JSONDecodeError:
            body = raw[:300]
    except Exception:
        pass
    raise HttpError(e.code, e.reason or "", body or raw[:300]) from None


def post_json(url: str, payload: dict[str, Any],
              headers: dict[str, str] | None = None,
              timeout: float = 60.0) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        _raise_http_error(e)


def get_json(url: str, headers: dict[str, str] | None = None,
             timeout: float = 15.0) -> dict[str, Any]:
    req = urllib.request.Request(url, method="GET")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        _raise_http_error(e)


def stream_sse(url: str, payload: dict[str, Any],
               headers: dict[str, str] | None = None,
               timeout: float = 120.0) -> Iterator[dict[str, Any]]:
    """
    POST and yield parsed `data:` events from a Server-Sent Events stream.

    Reads line-wise off the socket so tokens surface as they arrive. A `data:`
    payload that is not valid JSON is skipped rather than killing the stream --
    providers occasionally emit keep-alive comments and non-JSON sentinels.
    """
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "text/event-stream")
    for k, v in (headers or {}).items():
        req.add_header(k, v)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw in resp:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line or line.startswith(":"):
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    yield json.loads(data)
                except json.JSONDecodeError:
                    continue
    except urllib.error.HTTPError as e:
        _raise_http_error(e)


def stream_ndjson(url: str, payload: dict[str, Any],
                  headers: dict[str, str] | None = None,
                  timeout: float = 300.0) -> Iterator[dict[str, Any]]:
    """
    Newline-delimited JSON, which is what Ollama emits.

    The timeout is generous because a cold Ollama model load can take a minute
    before the first token appears.
    """
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw in resp:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except urllib.error.HTTPError as e:
        _raise_http_error(e)


def _http_error(e: urllib.error.HTTPError) -> Exception:
    """Kept for callers that want the exception rather than a raise."""
    try:
        _raise_http_error(e)
    except HttpError as built:
        return built
    return RuntimeError(f"HTTP {e.code}")
