"""
Searchable model picker.

The old flow ended at "Found 317 models." -- a count, with the models
themselves buried in a combo box you had to scroll. With OpenRouter's
catalogue running to hundreds of entries that is unusable: you cannot find a
model unless you already know its exact id.

This is a search field over the live catalogue with the filters that actually
decide the choice: free, vision-capable. Free models sort first and are
badged, so someone who has just pasted a key with no credit on it can start
with something that costs nothing.

Fetching happens on a worker thread -- the OpenRouter catalogue is ~300 KB and
blocking the GUI thread on it freezes the dialog for a noticeable beat.
"""
from __future__ import annotations

from PySide6.QtCore import QObject, QSize, Qt, QThread, Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (QCheckBox, QDialog, QHBoxLayout, QLabel,
                               QLineEdit, QListWidget, QListWidgetItem,
                               QPushButton, QVBoxLayout, QWidget)

from ..providers.base import ModelInfo, Provider
from .theme import PALETTE, SPACE, TYPE


class _FetchWorker(QThread):
    """Loads the model catalogue off the GUI thread."""

    loaded = Signal(list)
    failed = Signal(str)

    def __init__(self, provider: Provider, parent: QObject | None = None):
        super().__init__(parent)
        self.provider = provider

    def run(self) -> None:
        try:
            models = self.provider.list_model_info()
        except Exception as exc:
            self.failed.emit(str(exc)[:200])
            return
        if not models:
            self.failed.emit(
                "No models returned. Check the API key, or your connection.")
            return
        self.loaded.emit(models)


class ModelPicker(QDialog):
    """Search, filter and choose a model. Returns the chosen id via `chosen`."""

    chosen = Signal(str)

    def __init__(self, provider: Provider, provider_label: str,
                 current: str = "", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.provider = provider
        self.current = current
        self._models: list[ModelInfo] = []

        self.setWindowTitle(f"Choose a {provider_label} model")
        self.setMinimumSize(600, 520)
        if parent is not None:
            self.setStyleSheet(parent.styleSheet())

        layout = QVBoxLayout(self)
        layout.setContentsMargins(SPACE.lg, SPACE.lg, SPACE.lg, SPACE.lg)
        layout.setSpacing(SPACE.sm)

        self.search = QLineEdit()
        self.search.setPlaceholderText(
            "Search models...  (try 'claude', 'free', 'vision')")
        self.search.textChanged.connect(self._apply_filters)
        layout.addWidget(self.search)

        filters = QHBoxLayout()
        filters.setSpacing(SPACE.md)
        self.cb_free = QCheckBox("Free only")
        self.cb_free.setToolTip(
            "Models that cost nothing to run -- ideal for trying the app out")
        self.cb_free.stateChanged.connect(self._apply_filters)
        filters.addWidget(self.cb_free)

        self.cb_vision = QCheckBox("Can read screenshots")
        self.cb_vision.setToolTip(
            "Only models that accept images, needed for screen analysis")
        self.cb_vision.stateChanged.connect(self._apply_filters)
        filters.addWidget(self.cb_vision)

        self.cb_audio = QCheckBox("Can transcribe audio")
        self.cb_audio.setToolTip(
            "Models that accept audio directly.\n\n"
            "StealthIt transcribes locally with Whisper by default, which "
            "keeps call audio on your machine. These models are an "
            "alternative if you would rather send audio to the provider.")
        self.cb_audio.stateChanged.connect(self._apply_filters)
        filters.addWidget(self.cb_audio)

        filters.addStretch()
        self.count_label = QLabel()
        self.count_label.setStyleSheet(
            f"color:{PALETTE.text_faint};font-size:{TYPE.size_xs}px;")
        filters.addWidget(self.count_label)
        layout.addLayout(filters)

        self.list = QListWidget()
        self.list.setAlternatingRowColors(False)
        self.list.itemDoubleClicked.connect(self._accept_item)
        self.list.setStyleSheet(
            f"QListWidget{{background:rgba(0,0,0,0.20);border:1px solid "
            f"{PALETTE.border};border-radius:{SPACE.radius_md}px;outline:none;}}"
            f"QListWidget::item{{padding:8px 10px;border-radius:"
            f"{SPACE.radius_sm}px;color:{PALETTE.text_muted};}}"
            f"QListWidget::item:selected{{background:{PALETTE.accent_dim};"
            f"color:{PALETTE.text};}}")
        layout.addWidget(self.list, 1)

        self.status = QLabel("Loading models...")
        self.status.setWordWrap(True)
        self.status.setStyleSheet(
            f"color:{PALETTE.text_faint};font-size:{TYPE.size_xs}px;")
        layout.addWidget(self.status)

        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.reject)
        buttons.addWidget(cancel)
        self.btn_use = QPushButton("Use this model")
        self.btn_use.setObjectName("Primary")
        self.btn_use.setEnabled(False)
        self.btn_use.clicked.connect(self._accept_current)
        buttons.addWidget(self.btn_use)
        layout.addLayout(buttons)

        self.list.currentItemChanged.connect(
            lambda item, _prev: self.btn_use.setEnabled(item is not None))

        self._worker = _FetchWorker(provider, self)
        self._worker.loaded.connect(self._on_loaded)
        self._worker.failed.connect(self._on_failed)
        self._worker.finished.connect(self._worker.deleteLater)
        self._worker.start()

    # ------------------------------------------------------------------ data
    def _on_loaded(self, models: list) -> None:
        self._models = models
        free = sum(1 for m in models if m.free)
        vision = sum(1 for m in models if m.vision)
        self.status.setText(
            f"{len(models)} models available -- {free} free, "
            f"{vision} can read screenshots. Double-click to choose.")
        self._apply_filters()

    def _on_failed(self, message: str) -> None:
        self.status.setText(message)
        self.status.setStyleSheet(
            f"color:{PALETTE.danger};font-size:{TYPE.size_xs}px;")

    # --------------------------------------------------------------- filters
    def _apply_filters(self) -> None:
        query = self.search.text().strip()
        free_only = self.cb_free.isChecked()
        vision_only = self.cb_vision.isChecked()
        audio_only = self.cb_audio.isChecked()

        self.list.clear()
        shown = 0
        for model in self._models:
            if free_only and not model.free:
                continue
            if vision_only and not model.vision:
                continue
            if audio_only and not model.audio:
                continue
            if not model.matches(query):
                continue
            self.list.addItem(self._make_item(model))
            shown += 1
            if shown >= 400:  # keep the widget responsive on huge catalogues
                break

        self.count_label.setText(
            f"{shown} shown" + (f" of {len(self._models)}"
                                if shown != len(self._models) else ""))
        if not shown and (audio_only or vision_only or free_only):
            self.status.setText(
                "No models match those filters. Audio-capable models are rare "
                "-- local Whisper transcription needs no model at all.")
        if shown:
            # Preselect whatever is already configured, so reopening the
            # picker shows you where you are rather than jumping to the top.
            for i in range(self.list.count()):
                if self.list.item(i).data(Qt.UserRole) == self.current:
                    self.list.setCurrentRow(i)
                    break
            else:
                self.list.setCurrentRow(0)

    def _make_item(self, model: ModelInfo) -> QListWidgetItem:
        badges = []
        if model.free:
            badges.append("FREE")
        if model.vision:
            badges.append("vision")
        if model.audio:
            badges.append("audio")
        if model.context:
            badges.append(model.context_summary())
        price = model.price_summary()
        if price and not model.free:
            badges.append(price)

        text = model.display
        if badges:
            text += "\n" + "  ·  ".join(badges)
        item = QListWidgetItem(text)
        item.setData(Qt.UserRole, model.id)
        item.setToolTip(f"{model.id}\n\n{model.description}"
                        if model.description else model.id)
        item.setSizeHint(QSize(0, 46))
        if model.free:
            item.setForeground(QColor(PALETTE.success))
        return item

    # ---------------------------------------------------------------- accept
    def _accept_item(self, item: QListWidgetItem) -> None:
        self.chosen.emit(item.data(Qt.UserRole))
        self.accept()

    def _accept_current(self) -> None:
        item = self.list.currentItem()
        if item is not None:
            self._accept_item(item)
