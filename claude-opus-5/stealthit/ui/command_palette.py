"""
Command palette.

Fuzzy-matched action launcher, in the idiom of VS Code and Raycast. The
original exposed everything through a settings dialog and a handful of icon
buttons, so features that had no button were effectively undiscoverable.
"""
from __future__ import annotations

from typing import Callable

from PySide6.QtCore import Qt
from PySide6.QtGui import QKeyEvent
from PySide6.QtWidgets import (QDialog, QLabel, QLineEdit, QListWidget,
                               QListWidgetItem, QVBoxLayout, QWidget)

from .theme import PALETTE, SPACE, TYPE


def fuzzy_score(query: str, text: str) -> int:
    """
    Subsequence match with bonuses for word-start hits.

    Returns -1 for no match. Cheap enough to run over the whole command list
    on every keystroke, and good enough that "csr" finds "Capture screen".
    """
    if not query:
        return 0
    query, low = query.lower(), text.lower()
    score = qi = 0
    prev_hit = False
    for i, ch in enumerate(low):
        if qi < len(query) and ch == query[qi]:
            score += 10
            if i == 0 or low[i - 1] in " -/":
                score += 12       # word boundary
            if prev_hit:
                score += 6        # consecutive characters
            qi += 1
            prev_hit = True
        else:
            prev_hit = False
    if qi < len(query):
        return -1
    return score - len(text) // 8  # prefer shorter matches


class CommandPalette(QDialog):
    def __init__(self, commands: list[tuple[str, str, Callable]],
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.commands = commands
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.Dialog
                            | Qt.WindowStaysOnTopHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setFixedWidth(520)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        container = QWidget()
        container.setStyleSheet(
            f"background:{PALETTE.surface_raised};"
            f"border:1px solid {PALETTE.border_strong};"
            f"border-radius:{SPACE.radius_lg}px;")
        inner = QVBoxLayout(container)
        inner.setContentsMargins(SPACE.md, SPACE.md, SPACE.md, SPACE.md)
        inner.setSpacing(SPACE.sm)

        self.search = QLineEdit()
        self.search.setPlaceholderText("Type a command...")
        self.search.textChanged.connect(self._filter)
        inner.addWidget(self.search)

        self.list = QListWidget()
        self.list.setFrameShape(QListWidget.NoFrame)
        self.list.setStyleSheet(
            f"QListWidget{{background:transparent;outline:none;}}"
            f"QListWidget::item{{padding:8px 10px;border-radius:"
            f"{SPACE.radius_sm}px;color:{PALETTE.text_muted};}}"
            f"QListWidget::item:selected{{background:{PALETTE.accent_dim};"
            f"color:{PALETTE.text};}}")
        self.list.itemActivated.connect(self._run)
        self.list.setMaximumHeight(340)
        inner.addWidget(self.list)

        hint = QLabel("Enter to run    Esc to close")
        hint.setStyleSheet(
            f"color:{PALETTE.text_faint};font-size:{TYPE.size_xs}px;"
            f"padding-top:2px;")
        inner.addWidget(hint)

        layout.addWidget(container)
        self._filter("")
        self.search.setFocus()

        if parent is not None:
            geo = parent.frameGeometry()
            self.move(geo.center().x() - 260, geo.top() + 70)

    def _filter(self, query: str) -> None:
        self.list.clear()
        scored = []
        for title, subtitle, callback in self.commands:
            score = fuzzy_score(query, f"{title} {subtitle}")
            if score >= 0:
                scored.append((score, title, subtitle, callback))
        scored.sort(key=lambda x: -x[0])
        for _score, title, subtitle, callback in scored:
            item = QListWidgetItem(f"{title}    -    {subtitle}")
            item.setData(Qt.UserRole, callback)
            self.list.addItem(item)
        if self.list.count():
            self.list.setCurrentRow(0)

    def _run(self, item: QListWidgetItem) -> None:
        callback = item.data(Qt.UserRole)
        self.accept()
        if callable(callback):
            callback()

    def keyPressEvent(self, event: QKeyEvent) -> None:
        key = event.key()
        if key == Qt.Key_Escape:
            self.reject()
            return
        if key in (Qt.Key_Return, Qt.Key_Enter):
            item = self.list.currentItem()
            if item:
                self._run(item)
            return
        # Arrow keys drive the list while focus stays in the search box.
        if key in (Qt.Key_Down, Qt.Key_Up):
            row = self.list.currentRow()
            delta = 1 if key == Qt.Key_Down else -1
            self.list.setCurrentRow(
                max(0, min(self.list.count() - 1, row + delta)))
            return
        super().keyPressEvent(event)
