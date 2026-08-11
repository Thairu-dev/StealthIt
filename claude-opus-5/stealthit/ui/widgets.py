"""
Custom-painted widgets.

Everything visually distinctive is drawn with QPainter rather than approximated
in QSS. That is what makes the difference between "a Qt app with a dark
stylesheet" and something that looks designed.
"""
from __future__ import annotations

import math
import time

from PySide6.QtCore import (Property, QEasingCurve, QPointF, QPropertyAnimation,
                            QRectF, QSize, Qt, QTimer, Signal)
from PySide6.QtGui import (QBrush, QColor, QFont, QFontMetrics, QLinearGradient,
                           QPainter, QPainterPath, QPen)
from PySide6.QtWidgets import (QApplication, QFrame, QHBoxLayout, QLabel,
                               QPushButton, QSizePolicy, QTextBrowser,
                               QTextEdit, QVBoxLayout, QWidget)

from . import icons, markdown_view
from .theme import MOTION, PALETTE, SPACE, TYPE


class ThinkingIndicator(QWidget):
    """
    Three dots with a travelling luminance wave.

    Replaces the original's three static dots whose opacity was stepped in a
    timer -- this reads as a continuous wave rather than a blink, which better
    communicates "working" than "stuck".
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedSize(46, 18)
        self._phase = 0.0
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)

    def start(self) -> None:
        self.show()
        if not self._timer.isActive():
            self._timer.start(16)  # ~60fps

    def stop(self) -> None:
        self._timer.stop()
        self.hide()

    def _tick(self) -> None:
        self._phase = (self._phase + 0.055) % (2 * math.pi)
        self.update()

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setPen(Qt.NoPen)
        base = QColor(PALETTE.accent)
        for i in range(3):
            wave = math.sin(self._phase - i * 0.75)
            alpha = int(90 + 130 * (wave * 0.5 + 0.5))
            radius = 2.6 + 1.3 * (wave * 0.5 + 0.5)
            colour = QColor(base)
            colour.setAlpha(alpha)
            painter.setBrush(QBrush(colour))
            painter.drawEllipse(QPointF(9 + i * 13, 9), radius, radius)


class LevelMeter(QWidget):
    """
    Live audio level, one bar row per source.

    Colour-coded to match the transcript (blue = you, green = them) so it is
    immediately obvious which side is being picked up -- important when the
    loopback device is misconfigured and only one channel is live.
    """

    BARS = 22

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedHeight(20)
        self.setMinimumWidth(90)
        self._levels = {"you": [0.0] * self.BARS, "them": [0.0] * self.BARS}
        self._current = {"you": 0.0, "them": 0.0}
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._shift)

    def start(self) -> None:
        self.show()
        if not self._timer.isActive():
            self._timer.start(55)

    def stop(self) -> None:
        self._timer.stop()
        for key in self._levels:
            self._levels[key] = [0.0] * self.BARS
            self._current[key] = 0.0
        self.hide()

    def set_level(self, speaker: str, rms: float) -> None:
        if speaker in self._current:
            # Log-ish scaling: linear RMS makes normal speech look near-silent.
            self._current[speaker] = min(1.0, math.sqrt(rms * 12))

    def _shift(self) -> None:
        for key, series in self._levels.items():
            series.pop(0)
            series.append(self._current[key])
            self._current[key] *= 0.55  # decay if no new audio arrives
        self.update()

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setPen(Qt.NoPen)
        w, h = self.width(), self.height()
        bar_w = max(1.5, (w - self.BARS * 1.5) / self.BARS)
        mid = h / 2
        for speaker, colour_hex in (("them", PALETTE.speaker_them),
                                    ("you", PALETTE.speaker_you)):
            colour = QColor(colour_hex)
            series = self._levels[speaker]
            for i, level in enumerate(series):
                if level <= 0.01:
                    continue
                bar_h = max(1.5, level * (h - 4))
                x = i * (bar_w + 1.5)
                colour.setAlpha(int(70 + 150 * level))
                painter.setBrush(QBrush(colour))
                painter.drawRoundedRect(
                    QRectF(x, mid - bar_h / 2, bar_w, bar_h), 1, 1)


class StatusDot(QWidget):
    """A pulsing state dot: idle, listening, thinking, error."""

    COLOURS = {
        "idle": PALETTE.text_faint,
        "listening": PALETTE.speaker_them,
        "thinking": PALETTE.accent,
        "error": PALETTE.danger,
        "stealth": PALETTE.success,
    }

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFixedSize(10, 10)
        self._state = "idle"
        self._pulse = 0.0
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)

    def set_state(self, state: str) -> None:
        self._state = state
        if state in ("listening", "thinking"):
            if not self._timer.isActive():
                self._timer.start(33)
        else:
            self._timer.stop()
            self._pulse = 0.0
        self.update()

    def _tick(self) -> None:
        self._pulse = (self._pulse + 0.09) % (2 * math.pi)
        self.update()

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setPen(Qt.NoPen)
        colour = QColor(self.COLOURS.get(self._state, PALETTE.text_faint))
        if self._timer.isActive():
            glow = QColor(colour)
            glow.setAlpha(int(50 + 50 * (math.sin(self._pulse) * 0.5 + 0.5)))
            painter.setBrush(QBrush(glow))
            r = 5 + 1.6 * (math.sin(self._pulse) * 0.5 + 0.5)
            painter.drawEllipse(QPointF(5, 5), r, r)
        painter.setBrush(QBrush(colour))
        painter.drawEllipse(QPointF(5, 5), 3, 3)


class AutoGrowTextEdit(QTextEdit):
    """
    Prompt box that grows with content, up to a cap.

    Enter sends; Shift+Enter inserts a newline -- the convention every chat
    app uses and the original had backwards for multi-line input.

    `focus_requested` fires on click. The overlay carries WS_EX_NOACTIVATE so
    it never steals focus from the app being shared, but that flag also blocks
    keyboard input entirely -- so clicking here has to ask the window to drop
    it, or typed characters go to whatever window is actually focused.
    """

    submitted = Signal()
    escaped = Signal()
    focus_requested = Signal()
    focus_released = Signal()

    def __init__(self, placeholder: str = "", parent: QWidget | None = None):
        super().__init__(parent)
        self.setPlaceholderText(placeholder)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setAcceptRichText(False)  # pasted HTML must not style the prompt
        self._min_h = 40
        self._max_h = 132
        self.setFixedHeight(self._min_h)
        self.textChanged.connect(self._resize_to_fit)

    def mousePressEvent(self, event) -> None:
        # Ask for keyboard focus before handling the click, so the caret lands
        # in a box that can actually receive what the user types next.
        self.focus_requested.emit()
        super().mousePressEvent(event)

    def focusInEvent(self, event) -> None:
        self.focus_requested.emit()
        super().focusInEvent(event)

    def focusOutEvent(self, event) -> None:
        super().focusOutEvent(event)
        # Restore the passive, never-steal-focus behaviour once done typing.
        self.focus_released.emit()

    def resizeEvent(self, event) -> None:
        # Wrapping changes with width, so the required height does too.
        super().resizeEvent(event)
        self._resize_to_fit()

    def _resize_to_fit(self) -> None:
        doc = self.document()
        # QTextDocument.size() reports 0x0 until textWidth is set, so without
        # this the box silently never grows for multi-line input.
        doc.setTextWidth(max(1, self.viewport().width()))
        doc_h = doc.size().height()
        target = int(min(self._max_h, max(self._min_h, doc_h + 14)))
        if target != self.height():
            self.setFixedHeight(target)
        self.setVerticalScrollBarPolicy(
            Qt.ScrollBarAsNeeded if doc_h + 20 > self._max_h
            else Qt.ScrollBarAlwaysOff)

    def keyPressEvent(self, event) -> None:
        key, mods = event.key(), event.modifiers()
        if key in (Qt.Key_Return, Qt.Key_Enter):
            if mods & Qt.ShiftModifier:
                super().keyPressEvent(event)
                return
            if not (mods & Qt.ControlModifier):
                self.submitted.emit()
                return
        if key == Qt.Key_Escape:
            self.escaped.emit()
            return
        super().keyPressEvent(event)


class CodeBlockBar(QWidget):
    """Language label plus a copy button, shown above each code block."""

    def __init__(self, language: str, code: str,
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.code = code
        layout = QHBoxLayout(self)
        layout.setContentsMargins(2, 0, 2, 2)
        layout.setSpacing(SPACE.sm)

        label = QLabel(language or "code")
        label.setStyleSheet(
            f"color:{PALETTE.text_faint};font-family:{TYPE.mono};"
            f"font-size:{TYPE.size_xs}px;background:transparent;")
        layout.addWidget(label)
        layout.addStretch()

        self.button = QPushButton("  Copy")
        self.button.setIcon(icons.icon("copy", 12, PALETTE.text_faint))
        self.button.setIconSize(QSize(12, 12))
        self.button.setCursor(Qt.PointingHandCursor)
        self.button.setStyleSheet(
            f"QPushButton{{color:{PALETTE.text_faint};background:transparent;"
            f"border:none;font-size:{TYPE.size_xs}px;padding:2px 6px;}}"
            f"QPushButton:hover{{color:{PALETTE.text};}}")
        self.button.clicked.connect(self._copy)
        layout.addWidget(self.button)

    def _copy(self) -> None:
        QApplication.clipboard().setText(self.code)
        self.button.setText("  Copied")
        self.button.setIcon(icons.icon("copy", 12, PALETTE.success))
        QTimer.singleShot(1400, self._reset_label)

    def _reset_label(self) -> None:
        self.button.setText("  Copy")
        self.button.setIcon(icons.icon("copy", 12, PALETTE.text_faint))


class MessageBubble(QFrame):
    """
    One message. Assistant messages render markdown with highlighted code and
    a copy affordance per block; user messages are plain and right-aligned.
    """
    edit_requested = Signal(str)

    def __init__(self, text: str, is_user: bool,
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.is_user = is_user
        self._raw = text
        self.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Maximum)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(2)

        self.body = QTextBrowser()
        self.body.setOpenExternalLinks(True)
        self.body.setFrameShape(QFrame.NoFrame)
        self.body.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.body.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.body.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Fixed)
        self.body.document().setDocumentMargin(0)

        if is_user:
            self.body.setStyleSheet(
                f"QTextBrowser{{background:{PALETTE.bubble_user};"
                f"border:1px solid {PALETTE.bubble_user_border};"
                f"border-radius:{SPACE.radius_md}px;padding:9px 13px;"
                f"color:{PALETTE.text};}}")
        else:
            self.body.setStyleSheet(
                f"QTextBrowser{{background:transparent;border:none;"
                f"padding:2px 0;color:{PALETTE.text};}}")

        outer.addWidget(self.body)
        
        self.actions_layout = QHBoxLayout()
        self.actions_layout.setContentsMargins(0, 0, 0, 0)
        self.actions_layout.setSpacing(SPACE.sm)

        if is_user:
            self.actions_layout.addStretch()

            self.btn_edit = QPushButton("  Edit")
            self.btn_edit.setIcon(icons.icon("edit", 12, PALETTE.text_faint))
            self.btn_edit.setIconSize(QSize(12, 12))
            self.btn_edit.setCursor(Qt.PointingHandCursor)
            self.btn_edit.setStyleSheet(
                f"QPushButton{{color:{PALETTE.text_faint};background:transparent;"
                f"border:none;font-size:{TYPE.size_xs}px;padding:2px 6px;}}"
                f"QPushButton:hover{{color:{PALETTE.text};}}")
            self.btn_edit.clicked.connect(self._request_edit)
            self.actions_layout.addWidget(self.btn_edit)

        self.btn_copy = QPushButton("  Copy")
        self.btn_copy.setIcon(icons.icon("copy", 12, PALETTE.text_faint))
        self.btn_copy.setIconSize(QSize(12, 12))
        self.btn_copy.setCursor(Qt.PointingHandCursor)
        self.btn_copy.setStyleSheet(
            f"QPushButton{{color:{PALETTE.text_faint};background:transparent;"
            f"border:none;font-size:{TYPE.size_xs}px;padding:2px 6px;}}"
            f"QPushButton:hover{{color:{PALETTE.text};}}")
        self.btn_copy.clicked.connect(self._copy_text)
        self.actions_layout.addWidget(self.btn_copy)
        
        if not is_user:
            self.actions_layout.addStretch()

        outer.addLayout(self.actions_layout)

        self._code_bars: list[CodeBlockBar] = []
        self._outer = outer
        self.set_text(text)

    def set_text(self, text: str, streaming: bool = False) -> None:
        self._raw = text
        if self.is_user:
            self.body.setPlainText(text)
        else:
            self.body.setHtml(markdown_view.render(text, streaming=streaming))
        self._fit()
        if not streaming and not self.is_user:
            self._rebuild_code_bars(text)

    def append_text(self, delta: str) -> None:
        """Streaming append. Re-renders so partial code blocks stay styled."""
        self.set_text(self._raw + delta, streaming=True)

    def finalise(self) -> None:
        self.set_text(self._raw, streaming=False)

    def _copy_text(self) -> None:
        QApplication.clipboard().setText(self._raw)
        self.btn_copy.setText("  Copied")
        self.btn_copy.setIcon(icons.icon("copy", 12, PALETTE.success))
        QTimer.singleShot(1400, self._reset_copy_label)

    def _reset_copy_label(self) -> None:
        self.btn_copy.setText("  Copy")
        self.btn_copy.setIcon(icons.icon("copy", 12, PALETTE.text_faint))

    def _request_edit(self) -> None:
        self.edit_requested.emit(self._raw)

    def _rebuild_code_bars(self, text: str) -> None:
        for bar in self._code_bars:
            bar.setParent(None)
            bar.deleteLater()
        self._code_bars.clear()
        blocks = markdown_view.extract_code_blocks(text)
        # One consolidated copy row per block, placed under the message. Qt's
        # rich text cannot host live widgets inline, so anchoring them here is
        # the honest way to offer per-block copy.
        for language, code in blocks:
            if not code.strip():
                continue
            bar = CodeBlockBar(language, code, self)
            self._outer.addWidget(bar)
            self._code_bars.append(bar)

    def _fit(self) -> None:
        """Size the browser to its document so the bubble has no inner scroll."""
        doc = self.body.document()
        width = max(120, self.width() or 480)
        doc.setTextWidth(width - 26)
        self.body.setFixedHeight(int(doc.size().height()) + 20)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._fit()

    @property
    def raw_text(self) -> str:
        return self._raw


class TranscriptLine(QWidget):
    """
    One speaker-attributed transcript entry.

    `partial=True` renders provisional text -- speech still in progress --
    dimmed and italic, so it is visibly distinct from committed transcript and
    nobody mistakes a half-heard fragment for the final wording.
    """

    def __init__(self, speaker: str, text: str, partial: bool = False,
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.speaker = speaker
        self.partial = partial
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 3, 0, 3)
        layout.setSpacing(SPACE.sm)

        colour = (PALETTE.speaker_you if speaker == "you"
                  else PALETTE.speaker_them)
        tag = QLabel("You" if speaker == "you" else "Them")
        tag.setFixedWidth(38)
        tag.setAlignment(Qt.AlignRight | Qt.AlignTop)
        tag.setStyleSheet(
            f"color:{colour};font-size:{TYPE.size_xs}px;font-weight:700;"
            f"background:transparent;"
            + ("opacity:0.6;" if partial else ""))
        layout.addWidget(tag)

        self.label = QLabel(text)
        self.label.setWordWrap(True)
        self.label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.label.setStyleSheet(
            f"color:{PALETTE.text_faint if partial else PALETTE.text_muted};"
            f"font-size:{TYPE.size_sm}px;background:transparent;"
            + ("font-style:italic;" if partial else ""))
        layout.addWidget(self.label, 1)

    def set_text(self, text: str) -> None:
        self.label.setText(text)

    def append(self, text: str) -> None:
        self.label.setText(f"{self.label.text()} {text}".strip())


class Toast(QFrame):
    """
    Transient status message.

    The original reported provider failures as chat bubbles, which polluted
    the conversation history with error text that then got sent back to the
    model as context. Errors belong out-of-band.
    """

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("Toast")
        self.hide()
        layout = QHBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(SPACE.sm)

        self.icon = StatusDot()
        layout.addWidget(self.icon)

        self.label = QLabel()
        self.label.setWordWrap(True)
        layout.addWidget(self.label, 1)

        self.action = QPushButton()
        self.action.hide()
        self.action.setCursor(Qt.PointingHandCursor)
        layout.addWidget(self.action)

        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.hide)
        self._action_connected = False

    def show_message(self, text: str, kind: str = "idle",
                     timeout: int = 5000, action_text: str = "",
                     action_cb=None) -> None:
        self.label.setText(text)
        self.icon.set_state(kind)
        colour = {"error": PALETTE.danger, "listening": PALETTE.success}.get(
            kind, PALETTE.text_muted)
        self.setStyleSheet(
            f"#Toast{{background:{PALETTE.surface_raised};"
            f"border:1px solid {PALETTE.border_strong};"
            f"border-radius:{SPACE.radius_md}px;}}")
        self.label.setStyleSheet(
            f"color:{colour};font-size:{TYPE.size_sm}px;background:transparent;")

        # Track the connection rather than calling disconnect() blindly --
        # disconnecting a signal with no connections emits a RuntimeWarning
        # that Qt does not raise, so try/except cannot suppress it.
        if self._action_connected:
            self.action.clicked.disconnect()
            self._action_connected = False
        if action_text and action_cb:
            self.action.setText(action_text)
            self.action.setStyleSheet(
                f"QPushButton{{color:{PALETTE.accent};background:transparent;"
                f"border:none;font-size:{TYPE.size_sm}px;font-weight:600;}}"
                f"QPushButton:hover{{color:{PALETTE.accent_hover};}}")
            self.action.clicked.connect(action_cb)
            self._action_connected = True
            self.action.show()
        else:
            self.action.hide()

        self.show()
        self._timer.stop()
        if timeout > 0:
            self._timer.start(timeout)
