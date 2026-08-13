"""
Vector icon set.

Drawn with QPainterPath on a 24x24 grid rather than shipped as PNGs or pulled
from an icon font. Three reasons:

  * Crisp at any DPI and any size, with no bitmap scaling.
  * Recolourable at draw time, so icons follow the theme and hover states
    instead of needing a variant file per colour.
  * No dependency. The original pulled in qtawesome (~2 MB of icon fonts) and
    rasterised a PNG to disk on every single startup just to reference a
    chevron from a stylesheet.

Stroke-based and geometrically consistent: 2px strokes, round caps and joins,
matching the Lucide/Feather visual language that reads as current.
"""
from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import (QColor, QIcon, QPainter, QPainterPath, QPen,
                           QPixmap)

VIEWBOX = 24.0


def _mic(p: QPainterPath) -> None:
    p.addRoundedRect(QRectF(9, 2, 6, 11), 3, 3)
    p.moveTo(5, 10)
    p.arcTo(QRectF(5, 4.5, 14, 14), 180, 180)
    p.moveTo(12, 19)
    p.lineTo(12, 22)
    p.moveTo(8, 22)
    p.lineTo(16, 22)


def _mic_off(p: QPainterPath) -> None:
    _mic(p)
    p.moveTo(3, 3)
    p.lineTo(21, 21)


def _monitor(p: QPainterPath) -> None:
    p.addRoundedRect(QRectF(2, 3, 20, 14), 2, 2)
    p.moveTo(8, 21)
    p.lineTo(16, 21)
    p.moveTo(12, 17)
    p.lineTo(12, 21)


def _crop(p: QPainterPath) -> None:
    p.moveTo(6, 2)
    p.lineTo(6, 18)
    p.lineTo(22, 18)
    p.moveTo(2, 6)
    p.lineTo(18, 6)
    p.lineTo(18, 22)


def _sparkle(p: QPainterPath) -> None:
    # Four-point star: the established "AI" glyph.
    p.moveTo(12, 3)
    p.cubicTo(12.6, 8.4, 15.6, 11.4, 21, 12)
    p.cubicTo(15.6, 12.6, 12.6, 15.6, 12, 21)
    p.cubicTo(11.4, 15.6, 8.4, 12.6, 3, 12)
    p.cubicTo(8.4, 11.4, 11.4, 8.4, 12, 3)
    p.closeSubpath()


def _command(p: QPainterPath) -> None:
    p.addRect(QRectF(9, 9, 6, 6))
    for cx, cy in ((6, 6), (18, 6), (6, 18), (18, 18)):
        p.addEllipse(QPointF(cx, cy), 3, 3)
    p.moveTo(9, 6)
    p.lineTo(15, 6)
    p.moveTo(9, 18)
    p.lineTo(15, 18)
    p.moveTo(6, 9)
    p.lineTo(6, 15)
    p.moveTo(18, 9)
    p.lineTo(18, 15)


def _settings(p: QPainterPath) -> None:
    # Sliders: clearer at 16px than a cogwheel, whose teeth turn to mush.
    for y, knob in ((6, 15), (12, 9), (18, 16)):
        p.moveTo(3, y)
        p.lineTo(21, y)
        p.addEllipse(QPointF(knob, y), 2.4, 2.4)


def _chevron_down(p: QPainterPath) -> None:
    p.moveTo(6, 9)
    p.lineTo(12, 15)
    p.lineTo(18, 9)


def _chevron_up(p: QPainterPath) -> None:
    p.moveTo(6, 15)
    p.lineTo(12, 9)
    p.lineTo(18, 15)


def _close(p: QPainterPath) -> None:
    p.moveTo(6, 6)
    p.lineTo(18, 18)
    p.moveTo(18, 6)
    p.lineTo(6, 18)


def _send(p: QPainterPath) -> None:
    p.moveTo(3, 12)
    p.lineTo(21, 3)
    p.lineTo(14, 21)
    p.lineTo(11, 13)
    p.closeSubpath()


def _stop(p: QPainterPath) -> None:
    p.addRoundedRect(QRectF(6, 6, 12, 12), 2, 2)


def _plus(p: QPainterPath) -> None:
    p.moveTo(12, 5)
    p.lineTo(12, 19)
    p.moveTo(5, 12)
    p.lineTo(19, 12)


def _copy(p: QPainterPath) -> None:
    p.addRoundedRect(QRectF(9, 9, 12, 12), 2, 2)
    p.moveTo(5, 15)
    p.lineTo(4, 15)
    p.arcTo(QRectF(3, 3, 4, 4), 270, -90)
    p.lineTo(3, 5)
    p.arcTo(QRectF(3, 3, 4, 4), 180, -90)
    p.lineTo(15, 3)
    p.arcTo(QRectF(13, 3, 4, 4), 90, -90)
    p.lineTo(17, 5)


def _edit(p: QPainterPath) -> None:
    # A simple pencil pointing bottom-left
    p.moveTo(17, 3)
    p.lineTo(21, 7)
    p.lineTo(7, 21)
    p.lineTo(3, 21)
    p.lineTo(3, 17)
    p.lineTo(17, 3)
    p.closeSubpath()


def _eye(p: QPainterPath) -> None:
    """Stealth disabled: the app is visible to screen sharing."""
    p.moveTo(2, 12)
    p.cubicTo(5, 6, 9, 4, 12, 4)
    p.cubicTo(15, 4, 19, 6, 22, 12)
    p.cubicTo(19, 18, 15, 20, 12, 20)
    p.cubicTo(9, 20, 5, 18, 2, 12)
    p.addEllipse(QPointF(12, 12), 3.2, 3.2)


def _eye_off(p: QPainterPath) -> None:
    """Stealth: the app is watching, nothing is watching the app."""
    p.moveTo(2, 12)
    p.cubicTo(5, 6, 9, 4, 12, 4)
    p.cubicTo(15, 4, 19, 6, 22, 12)
    p.cubicTo(20.5, 15, 18.5, 17, 16.5, 18.4)
    p.moveTo(9.5, 19.4)
    p.cubicTo(6.6, 18.4, 4, 15.8, 2, 12)
    p.addEllipse(QPointF(12, 12), 3.2, 3.2)
    p.moveTo(3, 3)
    p.lineTo(21, 21)


def _layers(p: QPainterPath) -> None:
    """Model / provider picker."""
    p.moveTo(12, 2)
    p.lineTo(22, 7)
    p.lineTo(12, 12)
    p.lineTo(2, 7)
    p.closeSubpath()
    p.moveTo(2, 12)
    p.lineTo(12, 17)
    p.lineTo(22, 12)
    p.moveTo(2, 17)
    p.lineTo(12, 22)
    p.lineTo(22, 17)


def _message(p: QPainterPath) -> None:
    p.addRoundedRect(QRectF(3, 4, 18, 14), 3, 3)
    p.moveTo(8, 18)
    p.lineTo(8, 22)
    p.lineTo(13, 18)


def _waveform(p: QPainterPath) -> None:
    for x, half in ((4, 3), (8, 7), (12, 10), (16, 6), (20, 3)):
        p.moveTo(x, 12 - half)
        p.lineTo(x, 12 + half)


def _list(p: QPainterPath) -> None:
    for y in (6, 12, 18):
        p.moveTo(9, y)
        p.lineTo(21, y)
        p.addEllipse(QPointF(4.5, y), 1.5, 1.5)


def _pin(p: QPainterPath) -> None:
    """Click-through toggle."""
    p.moveTo(12, 17)
    p.lineTo(12, 22)
    p.moveTo(7, 4)
    p.lineTo(17, 4)
    p.moveTo(9, 4)
    p.lineTo(8.5, 12)
    p.lineTo(6, 14)
    p.lineTo(6, 17)
    p.lineTo(18, 17)
    p.lineTo(18, 14)
    p.lineTo(15.5, 12)
    p.lineTo(15, 4)


_BUILDERS = {
    "mic": _mic,
    "mic-off": _mic_off,
    "monitor": _monitor,
    "crop": _crop,
    "sparkle": _sparkle,
    "command": _command,
    "settings": _settings,
    "chevron-down": _chevron_down,
    "chevron-up": _chevron_up,
    "close": _close,
    "send": _send,
    "stop": _stop,
    "plus": _plus,
    "copy": _copy,
    "edit": _edit,
    "eye": _eye,
    "eye-off": _eye_off,
    "layers": _layers,
    "message": _message,
    "waveform": _waveform,
    "list": _list,
    "pin": _pin,
}

# Icons whose shape reads better filled than stroked.
_FILLED = {"sparkle", "send", "stop"}

_cache: dict[tuple[str, int, str], QPixmap] = {}


def pixmap(name: str, size: int = 18, colour: str = "#EDEFF5",
           ratio: float = 1.0) -> QPixmap:
    """Render an icon. Cached per (name, size, colour)."""
    key = (name, int(size * ratio), colour)
    cached = _cache.get(key)
    if cached is not None:
        return cached

    builder = _BUILDERS.get(name)
    if builder is None:
        raise KeyError(f"unknown icon {name!r}; have {sorted(_BUILDERS)}")

    px = max(1, int(size * ratio))
    pm = QPixmap(px, px)
    pm.setDevicePixelRatio(ratio)
    pm.fill(Qt.transparent)

    painter = QPainter(pm)
    painter.setRenderHint(QPainter.Antialiasing)
    scale = px / VIEWBOX
    painter.scale(scale, scale)

    path = QPainterPath()
    builder(path)

    qcolour = QColor(colour)
    if name in _FILLED:
        painter.setPen(Qt.NoPen)
        painter.setBrush(qcolour)
        painter.drawPath(path)
    else:
        pen = QPen(qcolour, 2.0)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)
        painter.drawPath(path)
    painter.end()

    _cache[key] = pm
    return pm


def icon(name: str, size: int = 18, colour: str = "#EDEFF5") -> QIcon:
    """QIcon for use on buttons."""
    return QIcon(pixmap(name, size, colour))


def available() -> list[str]:
    return sorted(_BUILDERS)
