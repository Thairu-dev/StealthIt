"""
Live self-test on the real Windows platform.

The offscreen platform plugin cannot register global hotkeys or apply window
composition, so the headless suite cannot prove those work. This launches the
genuine overlay on the real desktop, asserts the runtime invariants, then
exits. It is the closest thing to "run it and see" that can be checked
automatically.

Run:  python -m tools.doctor
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PySide6.QtCore import QTimer  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from stealthit.core.config import ConfigManager  # noqa: E402
from stealthit.core.secrets import SecretStore  # noqa: E402
from stealthit.native import DEFAULT_KEYMAP  # noqa: E402
from stealthit.ui.overlay import Overlay  # noqa: E402

results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"  [{' OK ' if ok else 'FAIL'}] {name}"
          + (f" -- {detail}" if detail else ""))


def main() -> int:
    app = QApplication.instance() or QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)

    tmp = tempfile.TemporaryDirectory()
    config = ConfigManager(Path(tmp.name))
    secrets = SecretStore(Path(tmp.name) / "credentials.json")
    config.settings.appearance.animations = False

    overlay = Overlay(config, secrets)
    overlay.show()

    def verify() -> None:
        try:
            app.processEvents()

            # 1. Global hotkeys -- the thing offscreen could not test.
            bindings = overlay.hotkeys.bindings
            registered = [b for b in bindings if b.registered]
            expected = len(DEFAULT_KEYMAP)
            failed = [b for b in bindings if not b.registered]
            detail = f"{len(registered)}/{expected} live"
            if len(registered) < expected:
                # Name the culprits. A bare count hides the usual cause: a
                # previous StealthIt still running and holding the chords,
                # which looks like a code failure but is not one.
                taken = ", ".join(f"{b.chord} ({b.error})"
                                  for b in failed[:4]) or "unknown"
                missing = expected - len(bindings)
                detail += (f"; unavailable: {taken}"
                           + (f"; {missing} never attempted -- another "
                              f"StealthIt is probably still running"
                              if missing > 0 else ""))
            record("Global hotkeys registered", len(registered) >= expected,
                   detail)

            # 2. Stealth, verified by reading the affinity back from the OS.
            report = overlay._stealth_report
            record("Hidden from screen capture", report.hidden_from_capture,
                   report.detail or "WDA_EXCLUDEFROMCAPTURE confirmed")
            record("Absent from taskbar and Alt-Tab",
                   report.excluded_from_taskbar, report.detail)
            record("Never steals focus", report.never_takes_focus,
                   "WS_EX_NOACTIVATE set")
            record("Stealth survives a hide/show cycle",
                   (overlay.hide(), overlay.show(), app.processEvents(),
                    overlay.stealth.verify_capture_exclusion())[-1],
                   "re-asserted in showEvent")

            # 3. The window is real and composited.
            hwnd = int(overlay.winId())
            record("Native window handle", hwnd > 0, f"HWND {hwnd}")

            # 4. Audio devices resolve on this machine.
            from stealthit.audio import AudioCapture
            devices = AudioCapture.describe_devices()
            record("System audio loopback device",
                   "unavailable" not in devices["system_audio"]
                   and "requires" not in devices["system_audio"],
                   devices["system_audio"][:56])
            record("Microphone device",
                   devices["microphone"] != "unavailable",
                   devices["microphone"][:56])

            # 5. Screen capture on the live desktop.
            from stealthit.native.screen import enumerate_monitors, grab_monitor
            monitors = enumerate_monitors()
            image = grab_monitor()
            record("Screen capture", image.size[0] > 0,
                   f"{len(monitors)} display(s), grabbed "
                   f"{image.size[0]}x{image.size[1]}")

            # 6. Typing. This is the one the offscreen suite cannot test:
            # it needs a real HWND, because WS_EX_NOACTIVATE is what decides
            # whether keystrokes reach the prompt or leak to the terminal.
            from stealthit.native.win32 import (GWL_EXSTYLE, WS_EX_NOACTIVATE,
                                                user32)
            hwnd = int(overlay.winId())

            def flag_set() -> bool:
                return bool(user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                            & WS_EX_NOACTIVATE)

            overlay._end_typing()
            app.processEvents()
            passive = flag_set()

            overlay._begin_typing()
            app.processEvents()
            typing_ok = not flag_set()

            # Re-asserting stealth (showEvent, settings changes) must not
            # clobber typing mode mid-sentence.
            overlay.stealth.apply(stealth=True, acrylic=True,
                                  no_activate=not overlay._typing)
            app.processEvents()
            survives = not flag_set()

            overlay._end_typing()
            app.processEvents()
            restored = flag_set()

            record("Passive overlay refuses focus", passive,
                   "WS_EX_NOACTIVATE set when idle")
            record("Typing mode accepts keyboard input", typing_ok,
                   "flag dropped so keystrokes reach the prompt")
            record("Stealth re-assert preserves typing", survives)
            record("Passive behaviour restored after typing", restored)

            overlay.input.setPlainText("hello")
            record("Typed text lands in the prompt box",
                   overlay.input.toPlainText() == "hello",
                   f"box holds {overlay.input.toPlainText()!r}")
            overlay.input.clear()
        except Exception as exc:
            import traceback
            traceback.print_exc()
            record("doctor run", False, f"{type(exc).__name__}: {exc}")
        finally:
            overlay.hotkeys.unregister_all()
            overlay.transcriber.stop()
            app.quit()

    QTimer.singleShot(400, verify)
    app.exec()

    print("\n" + "=" * 70)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"{passed}/{len(results)} runtime checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
