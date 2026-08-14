"""
Conversation history browser.

Sessions were already being saved to disk, but nothing could open them -- so
"New conversation" was a one-way door and everything before it was gone from
the UI. This lists what is on disk, previews it, and loads it back.
"""
from __future__ import annotations

import time
from pathlib import Path

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtWidgets import (QDialog, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QMessageBox,
                               QPushButton, QSplitter, QTextBrowser,
                               QVBoxLayout, QWidget)

from ..core.session import Session, SessionStore
from . import markdown_view
from .theme import PALETTE, SPACE, TYPE


def _relative_time(stamp: float) -> str:
    """'12 minutes ago' reads better than a timestamp when scanning a list."""
    delta = max(0.0, time.time() - stamp)
    if delta < 60:
        return "just now"
    if delta < 3600:
        minutes = int(delta // 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    if delta < 86400:
        hours = int(delta // 3600)
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    if delta < 604800:
        days = int(delta // 86400)
        return f"{days} day{'s' if days != 1 else ''} ago"
    return time.strftime("%d %b %Y", time.localtime(stamp))


class HistoryDialog(QDialog):
    """Browse saved conversations and load one back into the overlay."""

    resumed = Signal(object)  # Session

    def __init__(self, store: SessionStore,
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.store = store
        self._entries: list[dict] = []

        self.setWindowTitle("Conversation history")
        self.setMinimumSize(760, 520)
        if parent is not None:
            self.setStyleSheet(parent.styleSheet())

        layout = QVBoxLayout(self)
        layout.setContentsMargins(SPACE.lg, SPACE.lg, SPACE.lg, SPACE.lg)
        layout.setSpacing(SPACE.sm)

        self.search = QLineEdit()
        self.search.setPlaceholderText("Search conversations...")
        self.search.textChanged.connect(self._refresh_list)
        layout.addWidget(self.search)

        split = QSplitter(Qt.Horizontal)
        split.setHandleWidth(1)
        split.setStyleSheet(f"QSplitter::handle{{background:{PALETTE.border};}}")

        self.list = QListWidget()
        self.list.setStyleSheet(
            f"QListWidget{{background:rgba(0,0,0,0.20);border:1px solid "
            f"{PALETTE.border};border-radius:{SPACE.radius_md}px;outline:none;}}"
            f"QListWidget::item{{padding:9px 10px;border-radius:"
            f"{SPACE.radius_sm}px;color:{PALETTE.text_muted};}}"
            f"QListWidget::item:selected{{background:{PALETTE.accent_dim};"
            f"color:{PALETTE.text};}}")
        self.list.currentItemChanged.connect(
            lambda item, _prev: self._preview(item))
        self.list.itemDoubleClicked.connect(self._resume_item)
        split.addWidget(self.list)

        self.preview = QTextBrowser()
        self.preview.setOpenExternalLinks(True)
        self.preview.setStyleSheet(
            f"QTextBrowser{{background:rgba(0,0,0,0.20);border:1px solid "
            f"{PALETTE.border};border-radius:{SPACE.radius_md}px;"
            f"padding:10px;color:{PALETTE.text};}}")
        split.addWidget(self.preview)
        split.setSizes([280, 470])
        layout.addWidget(split, 1)

        buttons = QHBoxLayout()
        self.btn_delete = QPushButton("Delete")
        self.btn_delete.setObjectName("Danger")
        self.btn_delete.clicked.connect(self._delete_current)
        buttons.addWidget(self.btn_delete)
        buttons.addStretch()
        close = QPushButton("Close")
        close.clicked.connect(self.reject)
        buttons.addWidget(close)
        self.btn_resume = QPushButton("Open conversation")
        self.btn_resume.setObjectName("Primary")
        self.btn_resume.setEnabled(False)
        self.btn_resume.clicked.connect(self._resume_current)
        buttons.addWidget(self.btn_resume)
        layout.addLayout(buttons)

        self._load()

    # ------------------------------------------------------------------ data
    def _load(self) -> None:
        self._entries = self.store.list_recent(limit=200)
        self._refresh_list()

    def _refresh_list(self) -> None:
        query = self.search.text().strip().lower()
        self.list.clear()
        for entry in self._entries:
            title = entry.get("title") or "(untitled)"
            if query and query not in title.lower():
                continue
            item = QListWidgetItem(
                f"{title}\n{_relative_time(entry.get('started', 0))}  ·  "
                f"{entry.get('turns', 0)} messages")
            item.setData(Qt.UserRole, entry)
            item.setSizeHint(QSize(0, 48))
            self.list.addItem(item)

        empty = self.list.count() == 0
        self.btn_resume.setEnabled(not empty)
        self.btn_delete.setEnabled(not empty)
        if empty:
            self.preview.setHtml(
                f'<div style="color:{PALETTE.text_faint};padding:20px;'
                f'text-align:center">'
                + ("No conversations match that search."
                   if query else
                   "No saved conversations yet.<br><br>They are stored "
                   "automatically unless you turn that off in "
                   "Settings &rarr; Privacy.")
                + "</div>")
        else:
            self.list.setCurrentRow(0)

    def _preview(self, item: QListWidgetItem | None) -> None:
        if item is None:
            return
        session = self.store.load(item.data(Qt.UserRole)["path"])
        if session is None:
            self.preview.setHtml(
                f'<div style="color:{PALETTE.danger}">Could not read this '
                f'conversation.</div>')
            return

        parts: list[str] = []
        for turn in session.turns:
            who = "You" if turn.role == "user" else "Assistant"
            colour = (PALETTE.speaker_you if turn.role == "user"
                      else PALETTE.accent)
            parts.append(
                f'<div style="color:{colour};font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;'
                f'font-weight:700;margin-top:10px">{who}</div>'
                + markdown_view.render(turn.text))

        if session.transcript:
            parts.append(
                f'<div style="color:{PALETTE.text_muted};'
                f'font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;font-weight:700;'
                f'margin-top:16px">TRANSCRIPT</div>')
            for entry in session.transcript:
                colour = (PALETTE.speaker_you if entry["speaker"] == "you"
                          else PALETTE.speaker_them)
                tag = "You" if entry["speaker"] == "you" else "Them"
                parts.append(
                    f'<div style="margin:3px 0"><span style="color:{colour};'
                    f'font-weight:700">{tag}</span> '
                    f'<span style="color:{PALETTE.text_muted}">'
                    f'{entry["text"]}</span></div>')

        self.preview.setHtml("".join(parts) or "(empty)")

    # ---------------------------------------------------------------- actions
    def _resume_item(self, item: QListWidgetItem) -> None:
        session = self.store.load(item.data(Qt.UserRole)["path"])
        if session is None:
            QMessageBox.warning(self, "Could not open",
                                "That conversation file could not be read.")
            return
        self.resumed.emit(session)
        self.accept()

    def _resume_current(self) -> None:
        item = self.list.currentItem()
        if item is not None:
            self._resume_item(item)

    def _delete_current(self) -> None:
        item = self.list.currentItem()
        if item is None:
            return
        entry = item.data(Qt.UserRole)
        title = entry.get("title") or "this conversation"
        confirm = QMessageBox.question(
            self, "Delete conversation",
            f"Permanently delete \"{title}\"?\nThis cannot be undone.")
        if confirm != QMessageBox.Yes:
            return
        try:
            Path(entry["path"]).unlink()
        except OSError as exc:
            QMessageBox.warning(self, "Could not delete", str(exc))
            return
        self._load()
