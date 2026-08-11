"""
The overlay window.

Layout is a floating command bar over an expandable panel. The panel holds
Answer and Transcript views side by side rather than in tabs, because during a
live call you need both at once -- the original's tabbed Chat/Transcription
split meant reading the question and the answer were mutually exclusive.
"""
from __future__ import annotations

import ctypes
import time
from ctypes import wintypes

from PIL import Image
from PySide6.QtCore import (QEasingCurve, QPoint, QPropertyAnimation, QSize,
                            Qt, QTimer, Signal)
from PySide6.QtGui import QColor, QCursor, QGuiApplication, QPalette
from PySide6.QtWidgets import (QApplication, QFrame, QHBoxLayout, QLabel,
                               QMainWindow, QMenu, QPushButton, QScrollArea,
                               QSizePolicy, QSplitter, QVBoxLayout, QWidget)

from ..audio import AudioCapture, Transcriber
from ..core.config import KNOWN_MODELS, ConfigManager, model_supports_vision
from ..core.secrets import SecretStore
from ..core.session import Session, SessionStore
from ..native import DEFAULT_KEYMAP, HotkeyManager, StealthController
from ..native.screen import (downscale_for_vision, grab, grab_active_window,
                             grab_monitor)
from ..native.win32 import WM_HOTKEY
from ..providers import PROVIDER_LABELS
from . import icons, markdown_view
from .chips import ChipComboBox
from .engine import AIEngine, looks_like_question
from .region_select import RegionSelector
from .theme import MOTION, PALETTE, SPACE, TYPE, stylesheet
from .widgets import (AutoGrowTextEdit, LevelMeter, MessageBubble, StatusDot,
                      ThinkingIndicator, Toast, TranscriptLine)

COMPACT_HEIGHT = 62


def _make_transparent(scroll: QScrollArea) -> None:
    """
    Stop a QScrollArea painting an opaque background over the acrylic.

    A QScrollArea's viewport is a separate QWidget that fills itself from the
    window palette, and a `QScrollArea { background: transparent }` rule does
    not reach it. Without this the answer pane renders as a light slab in the
    middle of a dark panel.
    """
    scroll.setFrameShape(QFrame.NoFrame)
    scroll.viewport().setAutoFillBackground(False)
    scroll.setAttribute(Qt.WA_TranslucentBackground, True)


class Overlay(QMainWindow):
    """Frameless, stealthed, always-on-top assistant overlay."""

    transcript_arrived = Signal(str, str, bool)
    status_arrived = Signal(str)

    def __init__(self, config: ConfigManager, secrets: SecretStore) -> None:
        super().__init__()
        self.config = config
        self.settings = config.settings
        self.secrets = secrets
        self.session = Session(mode=self.settings.active_mode)
        self.sessions = SessionStore(config.dir / "sessions")

        self.expanded = False
        self.listening = False
        self._drag_origin: QPoint | None = None
        self._stream_bubble: MessageBubble | None = None
        self._pending_image: Image.Image | None = None
        self._last_transcript_index: int = -1
        self._last_transcript_widget: TranscriptLine | None = None
        self._partial_widgets: dict[str, TranscriptLine] = {}
        self._typing = False
        self._anim: QPropertyAnimation | None = None

        self._build_window()
        self._build_ui()
        # Style AFTER the widget tree exists. Setting the stylesheet inside
        # _build_window() meant every child was created afterwards and so was
        # never polished against it -- the panels came up painted from the
        # default light palette, and only re-styling (which the appearance
        # settings happened to do) cleared it. That is the launch flash.
        self._apply_stylesheet()

        self.engine = AIEngine(self.settings, self.secrets, self)
        self.engine.started.connect(self._on_stream_started)
        self.engine.delta.connect(self._on_delta)
        self.engine.completed.connect(self._on_completed)
        self.engine.failed.connect(self._on_failed)
        self.engine.state_changed.connect(self._on_engine_state)

        self.audio = AudioCapture(
            threshold=self.settings.audio.silence_threshold,
            min_seconds=self.settings.audio.min_utterance_seconds,
            max_seconds=self.settings.audio.max_utterance_seconds,
            partial_interval=self.settings.audio.partial_interval,
            level_cb=self._on_audio_level)
        self.transcriber = Transcriber(
            model_name=self.settings.audio.whisper_model,
            on_text=lambda s, t, p: self.transcript_arrived.emit(s, t, p),
            on_status=lambda m: self.status_arrived.emit(m))
        # Worker threads must not touch widgets directly; these signals hop
        # the result back onto the GUI thread.
        self.transcript_arrived.connect(self._on_transcript)
        self.status_arrived.connect(self._on_status)

        self._utterance_pump = QTimer(self)
        self._utterance_pump.timeout.connect(self._drain_utterances)

        self._apply_stealth()
        self._register_hotkeys()
        self._refresh_chips()

    # ------------------------------------------------------------ window setup
    def _build_window(self) -> None:
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint
                            | Qt.Tool)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_AlwaysShowToolTips, True)
        # Never take focus from whatever the user is actually working in.
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        # Do not let Qt fill the window from the system palette before our
        # own painting runs. Without this the first frame is drawn in the
        # default light colour, which reads as a white flash on launch.
        self.setAttribute(Qt.WA_NoSystemBackground, True)
        self.setAutoFillBackground(False)

        palette = self.palette()
        palette.setColor(QPalette.Window, QColor(0, 0, 0, 0))
        palette.setColor(QPalette.Base, QColor(0, 0, 0, 0))
        self.setPalette(palette)

        width = self.settings.appearance.compact_width
        self.resize(width, COMPACT_HEIGHT)

        screen = QGuiApplication.primaryScreen().availableGeometry()
        self.move(screen.center().x() - width // 2, screen.top() + 48)

    def _apply_stylesheet(self) -> None:
        """
        (Re)style the whole tree and force a repolish.

        unpolish/polish is what makes an already-created widget pick up new
        rules. Without it, children built after the stylesheet was set keep
        their default palette, which is where the pale background came from.
        """
        self.setStyleSheet(stylesheet(self.settings.appearance.accent,
                                      self.settings.appearance.font_size,
                                      self.settings.appearance.acrylic,
                                      self.settings.appearance.opacity))
        style = self.style()
        for widget in self.findChildren(QWidget):
            style.unpolish(widget)
            style.polish(widget)
        style.unpolish(self)
        style.polish(self)
        self.update()

    def _preview_appearance(self, acrylic: bool, opacity: int) -> None:
        """Live-preview appearance without committing it to settings."""
        self.setStyleSheet(stylesheet(self.settings.appearance.accent,
                                      self.settings.appearance.font_size,
                                      acrylic, opacity))
        self.update()

    def _apply_stealth(self) -> None:
        self.stealth = StealthController(int(self.winId()))
        report = self.stealth.apply(
            stealth=self.settings.behaviour.stealth,
            acrylic=self.settings.appearance.acrylic,
            tint=tuple(self.settings.appearance.tint),
            opacity=self.settings.appearance.opacity)
        self._stealth_report = report
        self.status_dot.set_state("stealth" if report.fully_stealthed
                                  else "error")
        self.status_dot.setToolTip(
            "Hidden from screen capture and recording"
            if report.fully_stealthed
            else f"Stealth incomplete: {report.detail}")
        if not report.fully_stealthed and self.settings.behaviour.stealth:
            self.toast.show_message(
                f"Stealth is not fully active. {report.detail}",
                kind="error", timeout=9000)

    def showEvent(self, event) -> None:
        super().showEvent(event)
        if not hasattr(self, "stealth"):
            return

        # Re-assert the backdrop on every show, unconditionally -- but only
        # when stealth is off.  DWM accent policies (acrylic, transparent
        # gradient) create a compositor-owned layer that the OS renders as a
        # solid black rectangle when the window is excluded from capture.
        # With stealth on, the dark translucent look comes from CSS rgba()
        # backgrounds on a WA_TranslucentBackground window instead.
        if not self.settings.behaviour.stealth:
            self.stealth.apply_backdrop(
                self.settings.appearance.acrylic,
                tuple(self.settings.appearance.tint),
                self.settings.appearance.opacity)

        # Qt can also recreate the native handle, which silently drops the
        # display affinity -- the window would become visible to capture with
        # no error anywhere. This is the guard the original lacked.
        if not self.stealth.verify_capture_exclusion() and \
                self.settings.behaviour.stealth:
            self.stealth.apply(
                stealth=True,
                acrylic=self.settings.appearance.acrylic,
                tint=tuple(self.settings.appearance.tint),
                opacity=self.settings.appearance.opacity,
                no_activate=not self._typing)

        # One more pass after the compositor has actually presented a frame.
        # On a cold start the first apply can land before DWM is ready for
        # this window, and the flash returns.
        QTimer.singleShot(0, self._reassert_backdrop)

    def _reassert_backdrop(self) -> None:
        if not hasattr(self, "stealth"):
            return
        # Skip DWM backdrop when stealth is active (same reason as showEvent).
        if self.settings.behaviour.stealth:
            return
        self.stealth.apply_backdrop(
            self.settings.appearance.acrylic,
            tuple(self.settings.appearance.tint),
            self.settings.appearance.opacity)

    # ----------------------------------------------------------------- ui tree
    def _build_ui(self) -> None:
        root = QWidget()
        root.setObjectName("Root")
        self.setCentralWidget(root)
        outer = QVBoxLayout(root)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(SPACE.sm)

        outer.addWidget(self._build_command_bar())

        self.toast = Toast(self)
        outer.addWidget(self.toast)

        self.panel = QFrame()
        self.panel.setObjectName("Panel")
        self.panel.hide()
        panel_layout = QVBoxLayout(self.panel)
        panel_layout.setContentsMargins(0, 0, 0, 0)
        panel_layout.setSpacing(0)

        self.split = QSplitter(Qt.Horizontal)
        self.split.setHandleWidth(1)
        self.split.setStyleSheet(
            f"QSplitter::handle{{background:{PALETTE.border};}}")
        self.split.addWidget(self._build_answer_pane())
        self.split.addWidget(self._build_transcript_pane())
        self.split.setSizes([440, 220])
        self.transcript_pane.hide()  # only shown while listening
        panel_layout.addWidget(self.split, 1)

        panel_layout.addWidget(self._build_input_area())
        outer.addWidget(self.panel, 1)

    def _build_command_bar(self) -> QWidget:
        """
        Top toolbar: main actions only, as icons.

        Model and mode selection deliberately live down by the composer
        instead, which is where every current AI chat UI puts them -- next to
        the thing you are about to send, not in the window chrome.
        """
        bar = QFrame()
        bar.setObjectName("CommandBar")
        bar.setFixedHeight(COMPACT_HEIGHT)
        layout = QHBoxLayout(bar)
        layout.setContentsMargins(SPACE.md, 0, SPACE.sm, 0)
        layout.setSpacing(SPACE.xs)

        self.status_dot = StatusDot()
        self.status_dot.setToolTip("Stealth status")
        layout.addWidget(self.status_dot)
        layout.addSpacing(SPACE.sm)

        self.btn_listen = self._icon_button(
            "mic", "Listen to this call  (Ctrl+Shift+L)")
        self.btn_listen.clicked.connect(self.toggle_listening)
        layout.addWidget(self.btn_listen)

        self.level_meter = LevelMeter()
        self.level_meter.hide()
        layout.addWidget(self.level_meter)

        self.btn_capture = self._icon_button(
            "monitor", "Capture the screen and answer  (Ctrl+Enter)\n"
                       "Type a question first to ask about it specifically")
        self.btn_capture.clicked.connect(lambda: self.capture_and_ask("screen"))
        layout.addWidget(self.btn_capture)

        self.btn_region = self._icon_button(
            "crop", "Select a region and answer  (Ctrl+Shift+Enter)")
        self.btn_region.clicked.connect(self.capture_region)
        layout.addWidget(self.btn_region)

        self.btn_palette = self._icon_button(
            "command", "Command palette  (Ctrl+Shift+P)")
        self.btn_palette.clicked.connect(self._show_command_palette)
        layout.addWidget(self.btn_palette)

        self.btn_answer = self._icon_button(
            "sparkle", "Answer the last question you were asked  "
                       "(Ctrl+Shift+A)")
        self.btn_answer.clicked.connect(self.answer_last_question)
        layout.addWidget(self.btn_answer)

        layout.addStretch()

        self.thinking = ThinkingIndicator()
        self.thinking.hide()
        layout.addWidget(self.thinking)

        self.btn_history = self._icon_button(
            "list", "Past conversations  (Ctrl+Shift+H)")
        self.btn_history.clicked.connect(self.open_history)
        layout.addWidget(self.btn_history)

        self.btn_new = self._icon_button(
            "plus", "New conversation  (Ctrl+Shift+K)")
        self.btn_new.clicked.connect(self.new_session)
        layout.addWidget(self.btn_new)

        self.btn_settings = self._icon_button(
            "settings", "Settings  (Ctrl+Shift+,)")
        self.btn_settings.clicked.connect(self.open_settings)
        layout.addWidget(self.btn_settings)

        self.btn_expand = self._icon_button(
            "chevron-down", "Expand  (Ctrl+Shift+T)")
        self.btn_expand.clicked.connect(self.toggle_expanded)
        layout.addWidget(self.btn_expand)

        self.btn_close = self._icon_button("close", "Quit  (Ctrl+Shift+Q)")
        self.btn_close.setObjectName("Danger")
        self.btn_close.clicked.connect(self.quit_app)
        layout.addWidget(self.btn_close)

        self.command_bar = bar
        return bar

    def _icon_button(self, icon_name: str, tooltip: str,
                     size: int = 34) -> QPushButton:
        btn = QPushButton()
        btn.setIcon(icons.icon(icon_name, 18, PALETTE.text_muted))
        btn.setIconSize(QSize(18, 18))
        btn.setFixedSize(size, size)
        btn.setToolTip(tooltip)
        btn.setCursor(Qt.PointingHandCursor)
        btn.setFocusPolicy(Qt.NoFocus)  # keep focus in the prompt box
        btn._icon_name = icon_name      # so the icon can be recoloured later
        return btn

    def _set_button_icon(self, btn: QPushButton, name: str,
                         colour: str = "") -> None:
        btn._icon_name = name
        btn.setIcon(icons.icon(name, 18, colour or PALETTE.text_muted))

    def _build_answer_pane(self) -> QWidget:
        wrap = QWidget()
        layout = QVBoxLayout(wrap)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self.answer_scroll = QScrollArea()
        self.answer_scroll.setWidgetResizable(True)
        self.answer_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        _make_transparent(self.answer_scroll)

        self.answer_body = QWidget()
        self.answer_body.setObjectName("ScrollBody")
        self.answer_layout = QVBoxLayout(self.answer_body)
        self.answer_layout.setContentsMargins(SPACE.lg, SPACE.md,
                                              SPACE.lg, SPACE.md)
        self.answer_layout.setSpacing(SPACE.md)
        self.answer_layout.addStretch()

        self.empty_hint = QLabel(
            "Ask anything, capture your screen, or start listening to a call.\n"
            "Everything here is hidden from screen sharing and recording.")
        self.empty_hint.setAlignment(Qt.AlignCenter)
        self.empty_hint.setWordWrap(True)
        self.empty_hint.setStyleSheet(
            f"color:{PALETTE.text_faint};font-size:{TYPE.size_sm}px;"
            f"background:transparent;padding:22px;")
        self.answer_layout.insertWidget(0, self.empty_hint)

        self.answer_scroll.setWidget(self.answer_body)
        layout.addWidget(self.answer_scroll)
        return wrap

    def _build_transcript_pane(self) -> QWidget:
        wrap = QWidget()
        self.transcript_pane = wrap
        layout = QVBoxLayout(wrap)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        header = QWidget()
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(SPACE.md, SPACE.sm, SPACE.sm, SPACE.xs)
        title = QLabel("LIVE TRANSCRIPT")
        title.setObjectName("SectionLabel")
        header_layout.addWidget(title)
        header_layout.addStretch()
        self.btn_summarise = QPushButton("Summarise")
        self.btn_summarise.setObjectName("Chip")
        self.btn_summarise.setCursor(Qt.PointingHandCursor)
        self.btn_summarise.setToolTip(
            "Summarise the call so far with decisions and action items")
        self.btn_summarise.clicked.connect(self.summarise_call)
        header_layout.addWidget(self.btn_summarise)
        layout.addWidget(header)

        self.transcript_scroll = QScrollArea()
        self.transcript_scroll.setWidgetResizable(True)
        self.transcript_scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarAlwaysOff)
        _make_transparent(self.transcript_scroll)
        self.transcript_body = QWidget()
        self.transcript_body.setObjectName("ScrollBody")
        self.transcript_layout = QVBoxLayout(self.transcript_body)
        self.transcript_layout.setContentsMargins(SPACE.md, 0, SPACE.sm,
                                                  SPACE.md)
        self.transcript_layout.setSpacing(0)
        self.transcript_layout.addStretch()
        self.transcript_scroll.setWidget(self.transcript_body)
        layout.addWidget(self.transcript_scroll)
        return wrap

    def _build_input_area(self) -> QWidget:
        wrap = QFrame()
        wrap.setObjectName("InputWrap")
        layout = QVBoxLayout(wrap)
        layout.setContentsMargins(SPACE.md, SPACE.md, SPACE.md, SPACE.md)
        layout.setSpacing(SPACE.sm)

        self.input = AutoGrowTextEdit(
            "Ask anything...  (Enter to send, Shift+Enter for a new line)")
        self.input.submitted.connect(self.submit_prompt)
        self.input.escaped.connect(self.collapse)
        self.input.focus_requested.connect(self._begin_typing)
        self.input.focus_released.connect(self._end_typing)
        layout.addWidget(self.input)

        row = QHBoxLayout()
        row.setSpacing(SPACE.sm)

        # Model and mode live here, under the prompt, the way ChatGPT, Claude
        # and Copilot place them -- attached to the message you are composing.
        # Real dropdowns rather than QMenus: a QMenu that outgrows the screen
        # scrolls on hover, so reaching for a model silently moves the list
        # under the pointer and you select the wrong one.
        self.btn_model = ChipComboBox("layers")
        self.btn_model.setToolTip("Provider and model")
        self.btn_model.activated.connect(self._model_chosen)
        row.addWidget(self.btn_model)

        self.btn_mode = ChipComboBox("sparkle")
        self.btn_mode.setToolTip("Assistant mode")
        self.btn_mode.activated.connect(self._mode_chosen)
        row.addWidget(self.btn_mode)

        self.attachment_chip = QPushButton()
        self.attachment_chip.setObjectName("Chip")
        self.attachment_chip.setIcon(
            icons.icon("close", 12, PALETTE.text_muted))
        self.attachment_chip.setIconSize(QSize(12, 12))
        self.attachment_chip.setCursor(Qt.PointingHandCursor)
        self.attachment_chip.setToolTip("Remove the attached screenshot")
        self.attachment_chip.clicked.connect(self._clear_attachment)
        self.attachment_chip.hide()
        row.addWidget(self.attachment_chip)

        row.addStretch()

        self.btn_stop = QPushButton()
        self.btn_stop.setObjectName("Chip")
        self.btn_stop.setIcon(icons.icon("stop", 13, PALETTE.danger))
        self.btn_stop.setIconSize(QSize(13, 13))
        self.btn_stop.setCursor(Qt.PointingHandCursor)
        self.btn_stop.setToolTip("Stop generating")
        self.btn_stop.clicked.connect(self.engine_cancel)
        self.btn_stop.hide()
        row.addWidget(self.btn_stop)

        self.btn_send = QPushButton()
        self.btn_send.setObjectName("Send")
        self.btn_send.setIcon(icons.icon("send", 16, PALETTE.text))
        self.btn_send.setIconSize(QSize(16, 16))
        self.btn_send.setFixedSize(34, 30)
        self.btn_send.setCursor(Qt.PointingHandCursor)
        self.btn_send.setToolTip("Send  (Enter)")
        self.btn_send.clicked.connect(self.submit_prompt)
        row.addWidget(self.btn_send)

        layout.addLayout(row)
        return wrap

    # ---------------------------------------------------------------- hotkeys
    def _register_hotkeys(self) -> None:
        self.hotkeys = HotkeyManager(int(self.winId()))
        actions = {
            "toggle_visibility": self.toggle_visibility,
            "capture_analyse": lambda: self.capture_and_ask("screen"),
            "region_capture": self.capture_region,
            "toggle_listen": self.toggle_listening,
            "answer_last": self.answer_last_question,
            "answer_selection": self.answer_from_context,
            "ask": self.focus_prompt,
            "command_palette": self._show_command_palette,
            "toggle_expand": self.toggle_expanded,
            "history": self.open_history,
            "settings": self.open_settings,
            "clear_session": self.new_session,
            "click_through": self.toggle_click_through,
            "move_up": lambda: self.nudge(0, -28),
            "move_down": lambda: self.nudge(0, 28),
            "move_left": lambda: self.nudge(-28, 0),
            "move_right": lambda: self.nudge(28, 0),
            "quit": self.quit_app,
        }
        failures = []
        for action, callback in actions.items():
            chord = self.settings.keymap.get(
                action, DEFAULT_KEYMAP[action][0])
            binding = self.hotkeys.register(
                action, chord, callback, DEFAULT_KEYMAP[action][1])
            if not binding.registered:
                failures.append(f"{chord} ({binding.error})")
        if failures:
            # Report conflicts rather than leaving dead keys, which is what
            # the original did when another app already owned a chord.
            self.toast.show_message(
                f"{len(failures)} hotkey(s) unavailable: {failures[0]}",
                kind="error", timeout=8000)

    def nativeEvent(self, event_type, message):
        if event_type == b"windows_generic_MSG":
            msg = ctypes.cast(int(message),
                              ctypes.POINTER(wintypes.MSG)).contents
            if msg.message == WM_HOTKEY:
                if self.hotkeys.dispatch(msg.wParam):
                    return True, 0
        return super().nativeEvent(event_type, message)

    # ------------------------------------------------------------ interactions
    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.LeftButton:
            self._drag_origin = (event.globalPosition().toPoint()
                                 - self.frameGeometry().topLeft())

    def mouseMoveEvent(self, event) -> None:
        if self._drag_origin is not None and event.buttons() & Qt.LeftButton:
            self.move(event.globalPosition().toPoint() - self._drag_origin)

    def mouseReleaseEvent(self, _event) -> None:
        self._drag_origin = None

    def nudge(self, dx: int, dy: int) -> None:
        self.move(self.x() + dx, self.y() + dy)

    def toggle_visibility(self) -> None:
        if self.isVisible():
            self.hide()
        else:
            self.show()

    def toggle_click_through(self) -> None:
        enabled = not self.settings.behaviour.click_through
        self.settings.behaviour.click_through = enabled
        self.stealth.set_click_through(enabled)
        self.config.save()
        self.toast.show_message(
            "Click-through on -- the overlay ignores the mouse. "
            "Press Ctrl+Shift+X to turn it off."
            if enabled else "Click-through off.",
            timeout=4000)

    def focus_prompt(self) -> None:
        self.show()
        self.expand()
        # We carry WS_EX_NOACTIVATE, so the window will not activate on its
        # own; this is the one place we deliberately take focus, because the
        # user explicitly asked to type.
        self._begin_typing()
        self.activateWindow()
        self.raise_()
        self.input.setFocus()

    def _begin_typing(self) -> None:
        """
        Drop WS_EX_NOACTIVATE so keystrokes reach the prompt.

        Without this, clicking into the box leaves focus wherever it was and
        every character goes to that window instead -- which, when StealthIt
        is launched from a terminal, means the shell silently collects the
        prompt and runs it as a command.
        """
        if not hasattr(self, "stealth"):
            return
        if self._typing:
            return
        self._typing = True
        self.stealth.allow_typing(True)
        self.activateWindow()
        self.raise_()

    def _end_typing(self) -> None:
        """Restore the passive overlay behaviour once typing is done."""
        if not hasattr(self, "stealth") or not self._typing:
            return
        self._typing = False
        self.stealth.allow_typing(False)

    # ------------------------------------------------------------- expansion
    def toggle_expanded(self) -> None:
        self.collapse() if self.expanded else self.expand()

    def expand(self) -> None:
        if self.expanded:
            return
        self.expanded = True
        self.panel.show()
        self._set_button_icon(self.btn_expand, "chevron-up")
        self.btn_expand.setToolTip("Collapse  (Ctrl+Shift+T)")
        self._animate_height(self.settings.appearance.expanded_height)

    def collapse(self) -> None:
        if not self.expanded:
            return
        self.expanded = False
        self._set_button_icon(self.btn_expand, "chevron-down")
        self.btn_expand.setToolTip("Expand  (Ctrl+Shift+T)")
        # Hide the panel *before* animating. Leaving it visible during the
        # shrink meant the window kept the panel's minimum height, so the
        # collapsed overlay showed a dark slab under the toolbar instead of
        # actually collapsing.
        self.panel.hide()
        self._animate_height(self._collapsed_height())

    def _collapsed_height(self) -> int:
        """
        Height of the bar alone, plus the toast only when one is showing.

        Computed rather than hardcoded so a visible toast is not clipped, and
        so nothing reserves space when there is nothing to show.
        """
        height = COMPACT_HEIGHT
        if self.toast.isVisible():
            height += self.toast.sizeHint().height() + SPACE.sm
        return height

    def _animate_height(self, target: int, on_done=None) -> None:
        if not self.settings.appearance.animations:
            self.setFixedHeight(target)
            self.resize(self.width(), target)
            if on_done:
                on_done()
            return
        anim = QPropertyAnimation(self, b"size", self)
        anim.setDuration(MOTION.normal)
        anim.setStartValue(self.size())
        anim.setEndValue(QSize(self.width(), target))
        # OutQuint decelerates hard at the end, which reads as responsive.
        # The original used 300ms OutCubic, which feels sluggish by comparison.
        anim.setEasingCurve(QEasingCurve.OutQuint)
        # A frameless window keeps its old minimum size during the tween and
        # would otherwise stop short of the target, leaving a stub of panel.
        self.setMinimumHeight(0)
        self.setMaximumHeight(16777215)
        if on_done:
            anim.finished.connect(on_done)
        anim.start(QPropertyAnimation.DeleteWhenStopped)
        self._anim = anim

    # ------------------------------------------------------------------ chips
    def _refresh_chips(self) -> None:
        self._populate_mode_chip()
        self._populate_model_chip()

    def _populate_mode_chip(self) -> None:
        combo = self.btn_mode
        was = combo.blockSignals(True)
        combo.clear()
        for name in self.settings.modes:
            combo.add_choice(name, ("mode", name))
        combo.addItem("Edit modes...", ("settings", None))
        combo.select_value(("mode", self.settings.active_mode))
        combo.blockSignals(was)

    def _populate_model_chip(self) -> None:
        """
        Build the model dropdown: recently-used and curated models per
        provider, plus an entry into the searchable catalogue.

        Deliberately a shortlist. Pouring several hundred OpenRouter models
        into a dropdown recreates exactly the scrolling problem this replaces;
        "Browse all models..." is the right home for the long tail.
        """
        combo = self.btn_model
        was = combo.blockSignals(True)
        combo.clear()

        active_provider = self.settings.active_provider
        active_model = self.settings.provider(active_provider).model
        seen: set[tuple[str, str]] = set()

        for provider in KNOWN_MODELS:
            cfg = self.settings.provider(provider)
            ready = (provider == "ollama" or self.secrets.has(provider))

            entries: list[tuple[str, str, bool]] = []
            for entry in KNOWN_MODELS.get(provider, []):
                entries.append((entry["id"], entry["label"], entry["vision"]))
            # Anything picked from the catalogue, so a chosen model stays one
            # click away instead of only living in Settings.
            for model_id in cfg.cached_models[:8]:
                if model_id not in {e[0] for e in entries}:
                    entries.append((
                        model_id, model_id.split("/")[-1],
                        model_supports_vision(provider, model_id,
                                              cfg.capabilities)))
            if cfg.model and cfg.model not in {e[0] for e in entries}:
                entries.insert(0, (
                    cfg.model, cfg.model.split("/")[-1],
                    model_supports_vision(provider, cfg.model,
                                          cfg.capabilities)))
            if not entries:
                continue

            combo.add_header(
                PROVIDER_LABELS.get(provider, provider)
                + ("" if ready else "  (no API key)"))
            for model_id, label, vision in entries[:10]:
                if (provider, model_id) in seen:
                    continue
                seen.add((provider, model_id))
                combo.add_choice(
                    label + ("" if vision else "  · text only"),
                    ("model", provider, model_id),
                    tooltip=f"{model_id}\n"
                            + ("Can read screenshots" if vision
                               else "Cannot read screenshots"),
                    enabled=ready, indent=True)

        # Custom user-created providers.
        for provider in self.settings.custom_providers:
            cfg = self.settings.provider(provider)
            if not cfg.is_custom:
                continue
            ready = bool(cfg.base_url and self.secrets.has(provider))
            display_label = cfg.label or provider

            entries = []
            if cfg.model:
                entries.append((
                    cfg.model, cfg.model.split("/")[-1],
                    model_supports_vision(provider, cfg.model,
                                          cfg.capabilities)))
            for model_id in cfg.cached_models[:8]:
                if model_id not in {e[0] for e in entries}:
                    entries.append((
                        model_id, model_id.split("/")[-1],
                        model_supports_vision(provider, model_id,
                                              cfg.capabilities)))
            if not entries:
                continue

            combo.add_header(
                display_label + ("" if ready else "  (not configured)"))
            for model_id, label, vision in entries[:10]:
                if (provider, model_id) in seen:
                    continue
                seen.add((provider, model_id))
                combo.add_choice(
                    label + ("" if vision else "  · text only"),
                    ("model", provider, model_id),
                    tooltip=f"{model_id}\n"
                            + ("Can read screenshots" if vision
                               else "Cannot read screenshots"),
                    enabled=ready, indent=True)

        combo.addItem("Browse all models...", ("browse", None))
        combo.addItem("Settings...", ("settings", None))

        if not combo.select_value(("model", active_provider, active_model)):
            combo.set_display(active_model.split("/")[-1] or "No model")
        combo.blockSignals(was)

        label = active_model.split("/")[-1]
        active_cfg = self.settings.provider(active_provider)
        provider_display = (active_cfg.label or active_provider) \
            if active_cfg.is_custom \
            else PROVIDER_LABELS.get(active_provider, active_provider)
        combo.setToolTip(
            f"{provider_display} - "
            f"{active_model}\n"
            f"{'Can read screenshots' if self.settings.supports_vision() else 'Text only'}")

    def _model_chosen(self, index: int) -> None:
        # PySide6 round-trips item data through QVariant, which turns a Python
        # tuple into a list. Checking for `tuple` alone silently discarded
        # every selection.
        data = self.btn_model.itemData(index)
        if not isinstance(data, (list, tuple)) or not data:
            return
        kind = data[0]
        if kind == "model":
            _, provider, model_id = data
            self._set_model(provider, model_id)
        elif kind in ("browse", "settings"):
            self.open_settings()
        self._refresh_chips()

    def _mode_chosen(self, index: int) -> None:
        data = self.btn_mode.itemData(index)
        if not isinstance(data, (list, tuple)) or not data:
            return
        if data[0] == "mode":
            self._set_mode(data[1])
        else:
            self.open_settings()
        self._refresh_chips()

    def _set_mode(self, name: str) -> None:
        self.settings.active_mode = name
        self.session.mode = name
        self.config.save()
        self.toast.show_message(f"Mode: {name}", timeout=2200)

    def _show_mode_menu(self) -> None:
        """Kept for the command palette; opens the dropdown."""
        self.btn_mode.showPopup()

    def _show_model_menu(self) -> None:
        self.btn_model.showPopup()

    def _set_model(self, provider: str, model: str) -> None:
        self.settings.active_provider = provider
        self.settings.provider(provider).model = model
        self.config.save()

    # --------------------------------------------------------------- capture
    def capture_and_ask(self, source: str = "screen",
                        analyse: bool = True) -> None:
        """
        Capture the screen and, by default, analyse it straight away.

        `analyse=False` only attaches, for when you want to add a screenshot
        to something you are still composing. Attaching without sending was
        the old behaviour of this method and it read as the button doing
        nothing: the tooltip promised analysis, but you got a chip and a
        blinking cursor.

        Anything already typed becomes the question, so "what is this error?"
        then Ctrl+Enter asks exactly that about the screen.
        """
        try:
            if source == "window":
                image = grab_active_window()
            else:
                image = grab_monitor()
        except Exception as exc:
            self.toast.show_message(f"Screen capture failed: {exc}",
                                    kind="error")
            return
        self._attach(image, focus=not analyse)
        if analyse:
            self.submit_prompt()

    def capture_region(self, analyse: bool = True) -> None:
        was_visible = self.isVisible()
        self.hide()  # never let the picker overlay capture our own chrome

        def _selected(x: int, y: int, w: int, h: int) -> None:
            if was_visible:
                self.show()
            try:
                self._attach(grab(x, y, w, h), focus=not analyse)
            except Exception as exc:
                self.toast.show_message(f"Region capture failed: {exc}",
                                        kind="error")
                return
            if analyse:
                self.submit_prompt()

        def _cancelled() -> None:
            if was_visible:
                self.show()

        self._selector = RegionSelector()
        self._selector.selected.connect(_selected)
        self._selector.cancelled.connect(_cancelled)
        self._selector.showFullScreen()

    def _attach(self, image: Image.Image, focus: bool = True) -> None:
        self._pending_image = downscale_for_vision(image)
        w, h = self._pending_image.size
        self.attachment_chip.setText(f"Screenshot {w}x{h}")
        self.attachment_chip.show()
        if not self.settings.supports_vision():
            self.toast.show_message(
                f"{self.settings.active_model()} cannot read images.",
                kind="error", timeout=7000,
                action_text="Change model", action_cb=self._show_model_menu)
        if focus:
            self.focus_prompt()
        else:
            self.show()
            self.expand()

    def _clear_attachment(self) -> None:
        self._pending_image = None
        self.attachment_chip.hide()

    # ------------------------------------------------------------------ chat
    def submit_prompt(self) -> None:
        text = self.input.toPlainText().strip()
        image = self._pending_image
        if not text and image is None:
            return
        if not text:
            # Sent when a screenshot is captured with nothing typed. Phrased
            # to get a useful answer about whatever is on screen rather than a
            # description of it.
            text = ("What's on my screen? If there's a question, error or "
                    "task visible, answer or solve it directly. Be concise.")

        self.expand()
        self.input.clear()
        self._clear_attachment()
        self._add_bubble(text, is_user=True)
        self.session.add_user(text, had_image=image is not None)
        self.engine.ask(self.session, text, image=image)

    def engine_cancel(self) -> None:
        self.engine.cancel()
        self.btn_stop.hide()

    def _add_bubble(self, text: str, is_user: bool) -> MessageBubble:
        self.empty_hint.hide()
        bubble = MessageBubble(text, is_user)
        self.answer_layout.insertWidget(self.answer_layout.count() - 1, bubble)
        QTimer.singleShot(16, self._scroll_answers_to_bottom)
        return bubble

    def _scroll_answers_to_bottom(self) -> None:
        bar = self.answer_scroll.verticalScrollBar()
        bar.setValue(bar.maximum())

    def _on_stream_started(self) -> None:
        self._stream_bubble = self._add_bubble("", is_user=False)
        self.btn_stop.show()
        self.btn_send.setEnabled(False)

    def _on_delta(self, text: str) -> None:
        if self._stream_bubble is not None:
            self._stream_bubble.append_text(text)
            self._scroll_answers_to_bottom()

    def _on_completed(self, text: str, usage: dict) -> None:
        if self._stream_bubble is not None:
            self._stream_bubble.finalise()
            self._stream_bubble = None
        self.btn_stop.hide()
        self.btn_send.setEnabled(True)
        if text.strip():
            self.session.add_assistant(
                text, provider=self.settings.active_provider,
                model=self.settings.active_model(), usage=usage)
            if self.settings.behaviour.save_sessions:
                self.sessions.save(self.session)
        self._scroll_answers_to_bottom()

    def _on_failed(self, message: str, hint: str, recoverable: bool) -> None:
        if self._stream_bubble is not None:
            # Drop the empty bubble rather than leaving a blank message, and
            # keep the error out of conversation history so it is never sent
            # back to the model as context.
            self._stream_bubble.setParent(None)
            self._stream_bubble.deleteLater()
            self._stream_bubble = None
        self.btn_stop.hide()
        self.btn_send.setEnabled(True)
        full = f"{message} {hint}".strip()
        self.toast.show_message(
            full, kind="error", timeout=10000,
            action_text="Settings" if not recoverable else "",
            action_cb=self.open_settings if not recoverable else None)

    def _on_engine_state(self, state: str) -> None:
        if state == "thinking":
            self.thinking.start()
            self.status_dot.set_state("thinking")
        else:
            self.thinking.stop()
            self.status_dot.set_state(
                "listening" if self.listening else
                ("stealth" if self._stealth_report.fully_stealthed else "idle"))

    def new_session(self) -> None:
        if self.settings.behaviour.save_sessions:
            self.sessions.save(self.session)
        self.session = Session(mode=self.settings.active_mode)
        self._clear_widgets(self.answer_layout, keep={self.empty_hint})
        self._transcript_widgets = {}
        self._last_transcript_index = -1
        self._last_transcript_widget = None
        self._partial_widgets.clear()
        self._clear_widgets(self.transcript_layout)
        self.empty_hint.show()
        self.toast.show_message("New conversation", timeout=2000)

    @staticmethod
    def _clear_widgets(layout, keep: set | None = None) -> None:
        """
        Remove every widget from a layout except those in `keep`.

        Selecting by identity rather than by index: the answer pane holds
        [empty_hint, ...bubbles, stretch], so an index-based sweep removes the
        empty-state hint along with the messages.

        setParent(None) matters too -- deleteLater alone leaves the widget
        parented and findable until the event loop next spins, so cleared
        messages would still be rendered and counted straight after a reset.
        """
        keep = keep or set()
        for i in reversed(range(layout.count())):
            item = layout.itemAt(i)
            widget = item.widget() if item else None
            if widget is None or widget in keep:
                continue
            layout.takeAt(i)
            widget.setParent(None)
            widget.deleteLater()

    # ----------------------------------------------------------------- audio
    def toggle_listening(self) -> None:
        self.stop_listening() if self.listening else self.start_listening()

    def start_listening(self) -> None:
        if self.listening:
            return
        self.transcriber.start()
        self.audio.start(
            microphone=self.settings.audio.capture_microphone,
            system_audio=self.settings.audio.capture_system_audio)

        if not self.audio.active_sources:
            errors = "; ".join(self.audio.errors) or "no audio devices"
            self.toast.show_message(f"Could not start listening: {errors}",
                                    kind="error", timeout=9000)
            return

        self.listening = True
        self._utterance_pump.start(180)
        self.set_listening_appearance(True)
        self.status_dot.set_state("listening")
        self.level_meter.start()
        self.expand()
        self.transcript_pane.show()

        sources = self.audio.active_sources
        detail = ("you and the other participants"
                  if len(sources) == 2 else
                  ("the other participants only" if sources == ["them"]
                   else "your microphone only"))
        message = f"Listening to {detail}."
        if self.audio.errors:
            message += "  " + "; ".join(self.audio.errors)
        self.toast.show_message(message, kind="listening", timeout=6000)

    def set_listening_appearance(self, active: bool) -> None:
        """Update button icon/tooltip to reflect listening state."""
        if active:
            self._set_button_icon(self.btn_listen, "mic-off", PALETTE.danger)
            self.btn_listen.setToolTip("Stop listening  (Ctrl+Shift+L)")
        else:
            self._set_button_icon(self.btn_listen, "mic")
            self.btn_listen.setToolTip("Listen to this call  (Ctrl+Shift+L)")

    def stop_listening(self) -> None:
        if not self.listening:
            return
        self.listening = False
        self._utterance_pump.stop()
        self.audio.stop()
        # Provisional lines describe speech that will never be finalised now.
        for speaker in list(self._partial_widgets):
            self._clear_partial(speaker)
        self.set_listening_appearance(False)
        self.level_meter.stop()
        self.status_dot.set_state(
            "stealth" if self._stealth_report.fully_stealthed else "idle")
        if self.settings.behaviour.save_sessions:
            self.sessions.save(self.session)

    def _drain_utterances(self) -> None:
        """Move completed utterances from the capture queue to Whisper."""
        moved = 0
        while moved < 8:
            try:
                utterance = self.audio.utterances.get_nowait()
            except Exception:
                break
            self.transcriber.submit(utterance)
            moved += 1

    def _on_audio_level(self, speaker: str, rms: float) -> None:
        # Called from a capture thread; only touches plain floats, and the
        # widget repaints on its own timer on the GUI thread.
        self.level_meter.set_level(speaker, rms)

    def _on_transcript(self, speaker: str, text: str,
                       partial: bool = False) -> None:
        """
        Interim results are shown but not committed.

        A partial is provisional text for speech still in progress: it is
        rendered immediately (so the transcript moves while someone talks) but
        kept out of the session, because committing it would put half-sentences
        into the history that gets sent to the model, and would fire the
        question detector on fragments like "So what do you".
        """
        if partial:
            self._render_partial(speaker, text)
            return

        self._clear_partial(speaker)
        self.session.add_transcript(speaker, text)
        self._render_transcript_tail()

        if (speaker == "them" and self.settings.behaviour.auto_suggest
                and looks_like_question(text)
                and self.engine.should_auto_suggest(
                    self.settings.behaviour.auto_suggest_cooldown)):
            self.engine.mark_auto_suggest()
            self._add_bubble(f"[heard] {text}", is_user=True)
            self.engine.ask(
                self.session,
                f"They just asked: \"{text}\"\n\n"
                "Give me the answer I should say, right now. Lead with the "
                "direct answer in one line, then the supporting points.",
                include_transcript=True)

    def _render_partial(self, speaker: str, text: str) -> None:
        """Show or update the provisional line for a speaker."""
        line = self._partial_widgets.get(speaker)
        if line is None:
            line = TranscriptLine(speaker, text, partial=True)
            self.transcript_layout.insertWidget(
                self.transcript_layout.count() - 1, line)
            self._partial_widgets[speaker] = line
        else:
            line.set_text(text)
        bar = self.transcript_scroll.verticalScrollBar()
        QTimer.singleShot(16, lambda: bar.setValue(bar.maximum()))

    def _clear_partial(self, speaker: str) -> None:
        line = self._partial_widgets.pop(speaker, None)
        if line is not None:
            line.setParent(None)
            line.deleteLater()

    def _render_transcript_tail(self, speaker: str = "", text: str = "") -> None:
        """
        Sync the transcript pane with the last session entry.

        Session.add_transcript merges consecutive fragments from one speaker
        into a single entry, so the view must mirror that: update the existing
        widget when the tail entry grew, and only append when a new entry
        (i.e. a speaker change) started. Deriving both the speaker and the text
        from the entry itself keeps the tag and the words from disagreeing.
        """
        entries = self.session.transcript
        if not entries:
            return
        index = len(entries) - 1
        entry = entries[index]

        if self._last_transcript_index == index and \
                self._last_transcript_widget is not None:
            self._last_transcript_widget.set_text(entry["text"])
        else:
            line = TranscriptLine(entry["speaker"], entry["text"])
            self.transcript_layout.insertWidget(
                self.transcript_layout.count() - 1, line)
            self._last_transcript_index = index
            self._last_transcript_widget = line

        bar = self.transcript_scroll.verticalScrollBar()
        QTimer.singleShot(16, lambda: bar.setValue(bar.maximum()))

    def _on_status(self, message: str) -> None:
        if message:
            self.toast.show_message(message, timeout=6000)

    def summarise_call(self) -> None:
        if not self.session.transcript:
            self.toast.show_message("Nothing transcribed yet.", timeout=3000)
            return
        self.expand()
        prompt = (
            "Summarise this call. Give me:\n"
            "1. The key decisions made\n"
            "2. Action items, with owners where stated\n"
            "3. Open questions still unresolved\n"
            "4. Anything I committed to\n\n"
            "Be specific and quote figures and dates exactly.")
        self._add_bubble("Summarise the call", is_user=True)
        self.session.add_user(prompt)
        self.engine.ask(self.session, prompt, include_transcript=True)

    # ------------------------------------------------- answering from audio
    def answer_last_question(self) -> None:
        """
        Answer whatever the other side last asked.

        This is the hotkey that makes live-call assistance usable without
        typing: the transcript is already being captured, so the question is
        already known -- you should not have to retype it to get an answer.
        """
        if not self.session.transcript:
            self.toast.show_message(
                "Nothing has been transcribed yet. Start listening first "
                "(Ctrl+Shift+L).", timeout=5000)
            return

        question = self.session.last_question()
        if not question:
            self.toast.show_message(
                "No question from the other side yet.", timeout=4000)
            return

        self.expand()
        self._add_bubble(f"[heard] {question}", is_user=True)
        self.engine.ask(
            self.session,
            f"They just asked: \"{question}\"\n\n"
            "Give me the answer I should say, right now. Lead with the direct "
            "answer in one line, then the supporting points I can expand on.",
            include_transcript=True)

    def answer_from_context(self) -> None:
        """
        Answer using the whole recent exchange rather than one question.

        Useful when the question was spread over several sentences, or when
        the useful reply depends on what was said before it.
        """
        if not self.session.transcript:
            self.toast.show_message(
                "Nothing has been transcribed yet. Start listening first "
                "(Ctrl+Shift+L).", timeout=5000)
            return
        self.expand()
        self._add_bubble("Answer from the conversation so far", is_user=True)
        self.engine.ask(
            self.session,
            "Read the recent transcript. Work out what I am being asked or "
            "what I most need to say next, then give me exactly that -- "
            "phrased so I can say it out loud. If nothing needs answering, "
            "say so in one line instead of inventing something.",
            include_transcript=True)

    # -------------------------------------------------------------- settings
    def open_settings(self) -> None:
        from .settings_dialog import SettingsDialog
        dialog = SettingsDialog(self.config, self.secrets, self)
        dialog.applied.connect(self._on_settings_applied)
        dialog.exec()

    def _on_settings_applied(self) -> None:
        """
        Apply changed settings immediately.

        Appearance and geometry used to need a restart, which is a poor trade
        for a dialog whose whole purpose is adjusting them -- you could not
        see what you were choosing. Everything here now takes effect live.
        """
        self.settings = self.config.settings
        appearance = self.settings.appearance

        self._apply_stylesheet()

        # Geometry: resize in place, keeping the window on screen.
        target_w = appearance.compact_width
        target_h = (appearance.expanded_height if self.expanded
                    else self._collapsed_height())
        if target_w != self.width() or target_h != self.height():
            self.setMinimumSize(0, 0)
            self.setMaximumSize(16777215, 16777215)
            self.resize(target_w, target_h)
            self._keep_on_screen()

        self.stealth.apply(
            stealth=self.settings.behaviour.stealth,
            acrylic=appearance.acrylic,
            tint=tuple(appearance.tint),
            opacity=appearance.opacity,
            no_activate=not self._typing)

        # Audio settings that can change without a restart.
        self.audio.threshold = self.settings.audio.silence_threshold
        self.audio.partial_interval = self.settings.audio.partial_interval
        if self.transcriber.model_name != self.settings.audio.whisper_model:
            self.transcriber.model_name = self.settings.audio.whisper_model
            if self.listening:
                self.toast.show_message(
                    "The transcription model changes when you next start "
                    "listening.", timeout=6000)

        self._rebind_hotkeys()
        self._refresh_chips()
        self.update()

    def _keep_on_screen(self) -> None:
        """Nudge the window back into view after a resize moves it off-screen."""
        screen = QGuiApplication.screenAt(self.frameGeometry().center())
        if screen is None:
            screen = QGuiApplication.primaryScreen()
        area = screen.availableGeometry()
        x = min(max(self.x(), area.left()), area.right() - self.width())
        y = min(max(self.y(), area.top()), area.bottom() - self.height())
        if (x, y) != (self.x(), self.y()):
            self.move(x, y)

    def _rebind_hotkeys(self) -> None:
        """Re-register global hotkeys after the keymap changes."""
        self.hotkeys.unregister_all()
        self._register_hotkeys()

    def _show_command_palette(self) -> None:
        from .command_palette import CommandPalette
        palette = CommandPalette(self._commands(), self)
        palette.exec()

    def _commands(self) -> list[tuple[str, str, object]]:
        return [
            ("Answer the last question", "Reply to what they just asked",
             self.answer_last_question),
            ("Answer from the conversation", "Use the whole recent exchange",
             self.answer_from_context),
            ("Capture screen", "Answer about the whole display",
             lambda: self.capture_and_ask("screen")),
            ("Capture region", "Drag to select an area, then answer",
             self.capture_region),
            ("Capture active window", "Answer about the focused window",
             lambda: self.capture_and_ask("window")),
            ("Attach screenshot without sending",
             "Add the screen to your message, then type",
             lambda: self.capture_and_ask("screen", analyse=False)),
            ("Start / stop listening", "Toggle live call transcription",
             self.toggle_listening),
            ("Summarise the call", "Decisions, actions, open questions",
             self.summarise_call),
            ("Conversation history", "Reopen a past conversation",
             self.open_history),
            ("New conversation", "Clear history and transcript",
             self.new_session),
            ("Toggle click-through", "Let the mouse pass through the overlay",
             self.toggle_click_through),
            ("Settings", "Providers, audio, appearance, hotkeys",
             self.open_settings),
            ("Hide overlay", "Ctrl+\\ brings it back",
             self.toggle_visibility),
            ("Quit StealthIt", "Close the application", self.quit_app),
        ]

    def open_history(self) -> None:
        """Browse and reopen saved conversations."""
        from .history_dialog import HistoryDialog

        # Persist the current session first, or it will be missing from the
        # list the user is about to browse.
        if self.settings.behaviour.save_sessions:
            self.sessions.save(self.session)
        dialog = HistoryDialog(self.sessions, self)
        dialog.resumed.connect(self._resume_session)
        dialog.exec()

    def _resume_session(self, session: Session) -> None:
        """Load a saved conversation back into the panes."""
        if self.settings.behaviour.save_sessions:
            self.sessions.save(self.session)

        self.session = session
        self.settings.active_mode = (session.mode
                                     if session.mode in self.settings.modes
                                     else self.settings.active_mode)

        self._clear_widgets(self.answer_layout, keep={self.empty_hint})
        self._clear_widgets(self.transcript_layout)
        self._partial_widgets.clear()
        self._last_transcript_index = -1
        self._last_transcript_widget = None

        for turn in session.turns:
            self._add_bubble(turn.text, is_user=(turn.role == "user"))
        for index, entry in enumerate(session.transcript):
            line = TranscriptLine(entry["speaker"], entry["text"])
            self.transcript_layout.insertWidget(
                self.transcript_layout.count() - 1, line)
            self._last_transcript_index = index
            self._last_transcript_widget = line

        if session.turns:
            self.empty_hint.hide()
        if session.transcript:
            self.transcript_pane.show()

        self.expand()
        self._refresh_chips()
        self.toast.show_message(
            f"Reopened \"{session.title or 'conversation'}\"", timeout=3000)

    # ------------------------------------------------------------------ close
    def quit_app(self) -> None:
        self.stop_listening()
        self.transcriber.stop()
        if self.settings.behaviour.save_sessions:
            self.sessions.save(self.session)
        self.hotkeys.unregister_all()
        self.config.save()
        QApplication.quit()

    def closeEvent(self, event) -> None:
        self.quit_app()
        event.accept()
