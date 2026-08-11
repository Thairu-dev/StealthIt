"""
Drag-to-select screen region.

A full-screen translucent overlay that dims everything except the selection.
This did not exist in the original, which only ever captured the whole primary
screen -- so asking about one error message meant sending the entire desktop,
costing tokens and diluting the model's attention across irrelevant pixels.
"""
from __future__ import annotations

from PySide6.QtCore import QPoint, QRect, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPen
from PySide6.QtWidgets import QApplication, QWidget

from ..native.screen import virtual_desktop_rect
from .theme import PALETTE


class RegionSelector(QWidget):
    """
    Modal region picker.

    Emits `selected(x, y, w, h)` in virtual-desktop coordinates, or
    `cancelled` on Escape / right-click.
    """

    selected = Signal(int, int, int, int)
    cancelled = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.setWindowFlags(
            Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setCursor(Qt.CrossCursor)

        vx, vy, vw, vh = virtual_desktop_rect()
        self._origin = QPoint(vx, vy)
        self.setGeometry(vx, vy, vw, vh)

        self._start: QPoint | None = None
        self._end: QPoint | None = None

    def keyPressEvent(self, event) -> None:
        if event.key() == Qt.Key_Escape:
            self.cancelled.emit()
            self.close()

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.RightButton:
            self.cancelled.emit()
            self.close()
            return
        self._start = event.position().toPoint()
        self._end = self._start
        self.update()

    def mouseMoveEvent(self, event) -> None:
        if self._start is not None:
            self._end = event.position().toPoint()
            self.update()

    def mouseReleaseEvent(self, event) -> None:
        if self._start is None:
            return
        self._end = event.position().toPoint()
        rect = QRect(self._start, self._end).normalized()
        self.close()
        # A stray click should not fire a capture of a few pixels.
        if rect.width() < 12 or rect.height() < 12:
            self.cancelled.emit()
            return
        self.selected.emit(rect.x() + self._origin.x(),
                           rect.y() + self._origin.y(),
                           rect.width(), rect.height())

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        full = self.rect()

        if self._start is None or self._end is None:
            painter.fillRect(full, QColor(0, 0, 0, 110))
            self._draw_hint(painter, full)
            return

        sel = QRect(self._start, self._end).normalized()

        # Dim everything outside the selection with four bands, leaving the
        # selected region at full brightness so the user sees exactly what
        # will be sent.
        shade = QColor(0, 0, 0, 130)
        painter.fillRect(QRect(full.left(), full.top(),
                               full.width(), sel.top()), shade)
        painter.fillRect(QRect(full.left(), sel.bottom() + 1,
                               full.width(), full.bottom() - sel.bottom()),
                         shade)
        painter.fillRect(QRect(full.left(), sel.top(),
                               sel.left(), sel.height()), shade)
        painter.fillRect(QRect(sel.right() + 1, sel.top(),
                               full.right() - sel.right(), sel.height()), shade)

        pen = QPen(QColor(PALETTE.accent), 1.5)
        painter.setPen(pen)
        painter.drawRect(sel)

        # Corner ticks, which make the edges readable against busy content.
        painter.setPen(QPen(QColor(PALETTE.accent), 3))
        arm = min(18, sel.width() // 3, sel.height() // 3)
        for cx, cy, dx, dy in (
            (sel.left(), sel.top(), 1, 1),
            (sel.right(), sel.top(), -1, 1),
            (sel.left(), sel.bottom(), 1, -1),
            (sel.right(), sel.bottom(), -1, -1),
        ):
            painter.drawLine(cx, cy, cx + arm * dx, cy)
            painter.drawLine(cx, cy, cx, cy + arm * dy)

        self._draw_size_badge(painter, sel)

    def _draw_size_badge(self, painter: QPainter, sel: QRect) -> None:
        text = f"{sel.width()} x {sel.height()}"
        font = QFont()
        font.setPointSize(9)
        font.setWeight(QFont.DemiBold)
        painter.setFont(font)
        metrics = painter.fontMetrics()
        w = metrics.horizontalAdvance(text) + 14
        h = metrics.height() + 8
        # Prefer above the selection; flip below when there is no room.
        y = sel.top() - h - 6
        if y < 0:
            y = sel.bottom() + 6
        badge = QRect(sel.left(), y, w, h)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor(18, 20, 28, 235))
        painter.drawRoundedRect(badge, 5, 5)
        painter.setPen(QColor(PALETTE.text))
        painter.drawText(badge, Qt.AlignCenter, text)

    def _draw_hint(self, painter: QPainter, full: QRect) -> None:
        font = QFont()
        font.setPointSize(12)
        painter.setFont(font)
        painter.setPen(QColor(PALETTE.text))
        painter.drawText(
            full, Qt.AlignCenter,
            "Drag to select a region\nEsc or right-click to cancel")
