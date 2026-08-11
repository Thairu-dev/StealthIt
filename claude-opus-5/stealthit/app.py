"""
Application entry point.

Responsibilities kept deliberately narrow: platform preflight, single-instance
enforcement, config/secret bootstrap, then hand off to the overlay.
"""
from __future__ import annotations

import ctypes
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QMessageBox

from .core.config import ConfigManager
from .core.secrets import SecretStore
from .native.win32 import kernel32

MUTEX_NAME = "StealthIt.SingleInstance.v2"
ERROR_ALREADY_EXISTS = 183


def _acquire_single_instance() -> bool:
    """
    One instance only, enforced with a named mutex.

    Two instances would fight over the same global hotkeys: the second
    RegisterHotKey call fails, so the first process keeps the keys and the
    second becomes an unreachable window with no way to show itself.
    The handle is intentionally leaked -- Windows releases it on exit.
    """
    kernel32.CreateMutexW(None, True, MUTEX_NAME)
    return ctypes.get_last_error() != ERROR_ALREADY_EXISTS


def _preflight() -> list[str]:
    """Non-fatal warnings shown once at startup."""
    warnings: list[str] = []
    build = sys.getwindowsversion().build if hasattr(
        sys, "getwindowsversion") else 0
    if build and build < 19041:
        warnings.append(
            f"Windows build {build} does not support hiding a window from "
            "screen capture (needs 19041 or newer). Stealth will be inactive.")
    try:
        import pyaudiowpatch  # noqa: F401
    except ImportError:
        warnings.append(
            "PyAudioWPatch is not installed, so system audio cannot be "
            "captured. Run: pip install PyAudioWPatch")
    try:
        import whisper  # noqa: F401
    except ImportError:
        warnings.append(
            "openai-whisper is not installed, so live transcription is "
            "unavailable. Run: pip install openai-whisper")
    return warnings


def main() -> int:
    if sys.platform != "win32":
        print("StealthIt targets Windows: it relies on Win32 APIs "
              "(SetWindowDisplayAffinity, WASAPI loopback) with no "
              "cross-platform equivalent.", file=sys.stderr)
        return 1

    if not _acquire_single_instance():
        print("StealthIt is already running. Press Ctrl+\\ to show it.",
              file=sys.stderr)
        return 0

    # Note: DPI awareness is deliberately left to Qt, which sets
    # PER_MONITOR_AWARE_V2. Calling SetProcessDpiAwareness ourselves first
    # wins the race with a weaker V1 context and makes Qt log an
    # "Access is denied" warning it cannot recover from.
    QApplication.setAttribute(Qt.AA_DontCreateNativeWidgetSiblings, True)
    app = QApplication(sys.argv)
    app.setApplicationName("StealthIt")
    app.setApplicationVersion("2.0.0")
    # The overlay is a Qt.Tool window with no taskbar presence, so closing a
    # dialog must not be treated as the app exiting.
    app.setQuitOnLastWindowClosed(False)

    config = ConfigManager()
    secrets = SecretStore(config.dir / "credentials.json")

    # Adopt keys from the original app's plaintext .env, once.
    migrated: list[str] = []
    for candidate in (Path.cwd() / ".env", Path.cwd().parent / ".env"):
        if candidate.exists():
            migrated = secrets.import_legacy_env(candidate)
            if migrated:
                break

    from .ui.overlay import Overlay
    overlay = Overlay(config, secrets)
    if not config.settings.behaviour.launch_hidden:
        overlay.show()

    notices = _preflight()
    if migrated:
        notices.insert(0, (
            f"Imported {len(migrated)} API key(s) from the old .env into "
            "encrypted storage. You can now delete that .env file."))
    if config.migrated_from:
        notices.insert(0, f"Settings migrated from {config.migrated_from}.")
    if notices:
        overlay.toast.show_message(notices[0], timeout=10000)
        for extra in notices[1:]:
            print(f"note: {extra}", file=sys.stderr)

    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
