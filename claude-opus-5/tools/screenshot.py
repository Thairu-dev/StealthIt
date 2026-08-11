"""
Render the overlay to a PNG using the real Windows platform plugin, so the
result shows actual fonts and compositing rather than offscreen tofu.

Run:  python -m tools.screenshot
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PySide6.QtCore import QPoint, Qt, QTimer  # noqa: E402
from PySide6.QtGui import QColor, QImage, QPainter  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from stealthit.core.config import ConfigManager  # noqa: E402
from stealthit.core.secrets import SecretStore  # noqa: E402
from stealthit.native.win32 import user32  # noqa: E402,F401
from stealthit.ui.overlay import Overlay  # noqa: E402

DEMO_ANSWER = """Reverse it iteratively, tracking the previous node:

```python
def reverse(head: Node | None) -> Node | None:
    prev = None
    while head:
        head.next, prev, head = prev, head, head.next
    return prev
```

Each step rewrites one `next` pointer, so it is **O(n)** time and `O(1)` space.

- The tuple assignment avoids needing a temp variable
- Returning `prev` matters: `head` is `None` once the loop ends
"""


def main() -> int:
    # DPI awareness is left to Qt (PER_MONITOR_AWARE_V2). Setting it ourselves
    # first wins the race with a weaker context and makes Qt log a warning.
    app = QApplication.instance() or QApplication(sys.argv)
    # The overlay is a Qt.Tool window, which Qt does not count as a top-level
    # window. With the default quitOnLastWindowClosed, exec() therefore sees
    # zero windows and returns immediately -- before the capture timer fires,
    # leaving the script exiting 0 having written nothing.
    app.setQuitOnLastWindowClosed(False)

    tmp = tempfile.TemporaryDirectory()
    config = ConfigManager(Path(tmp.name))
    secrets = SecretStore(Path(tmp.name) / "credentials.json")
    config.settings.appearance.animations = False

    overlay = Overlay(config, secrets)
    overlay.show()
    overlay.expand()

    overlay._add_bubble("How do I reverse a linked list in Python?", True)
    bubble = overlay._add_bubble("", False)
    bubble.set_text(DEMO_ANSWER)

    # Go through the real signal handler so the capture exercises the same
    # code path the app does, including a live partial at the tail.
    overlay._on_transcript(
        "them", "So walk me through how you would reverse a linked list.")
    overlay._on_transcript("you", "Sure, I would do it iteratively.")
    overlay._on_transcript("them", "And what about the space", partial=True)
    overlay.transcript_pane.show()
    overlay.level_meter.show()
    overlay.level_meter.set_level("them", 0.55)
    overlay.level_meter.set_level("you", 0.25)
    overlay.status_dot.set_state("listening")
    overlay.set_listening_appearance(True)
    overlay.resize(880, 580)

    out_dir = Path(__file__).resolve().parent.parent / "docs"
    out_dir.mkdir(parents=True, exist_ok=True)

    def grab(widget, path: Path) -> None:
        app.processEvents()
        image = QImage(widget.size(), QImage.Format_ARGB32_Premultiplied)
        image.fill(QColor(58, 62, 74))
        painter = QPainter(image)
        widget.render(painter, QPoint(0, 0))
        painter.end()
        image.save(str(path))
        print(f"wrote {path.name}  ({path.stat().st_size / 1024:.0f} KB, "
              f"{image.width()}x{image.height()})")

    def capture() -> None:
        try:
            grab(overlay, out_dir / "overlay.png")

            # Collapsed state, to verify the bar leaves no empty slab behind.
            overlay.toast.hide()
            overlay.collapse()
            app.processEvents()
            grab(overlay, out_dir / "overlay-collapsed.png")
        except Exception as exc:
            print(f"capture failed: {type(exc).__name__}: {exc}",
                  file=sys.stderr)
        finally:
            # Always quit, or a failure here leaves the process hanging in
            # app.exec() with no window the user can close.
            overlay.hotkeys.unregister_all()
            app.quit()

    # Let Qt lay out and paint once before grabbing.
    QTimer.singleShot(320, capture)
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
