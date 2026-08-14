"""
Settings.

Sectioned rather than tabbed-per-provider, and every field explains its
consequence. The original's dialog showed five provider tabs of bare key
fields with no indication of which were configured, whether a model supported
vision, or whether Ollama was even running -- so misconfiguration only
surfaced as a failed request later.
"""
from __future__ import annotations

import re

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFormLayout,
                               QFrame, QGroupBox, QHBoxLayout, QLabel,
                               QLineEdit, QListWidget, QListWidgetItem,
                               QMessageBox, QPlainTextEdit, QPushButton,
                               QScrollArea, QSlider, QSpinBox, QTabWidget,
                               QVBoxLayout, QWidget)

from ..audio import AudioCapture, MODEL_CHOICES
from ..core.config import (BUILTIN_MODES, KNOWN_MODELS, ConfigManager,
                           ProviderConfig)
from ..core.secrets import SecretStore
from ..native import DEFAULT_KEYMAP, parse_chord
from ..native.hotkeys import HotkeyParseError
from ..providers import (PROVIDER_BLURBS, PROVIDER_CLASSES, PROVIDER_LABELS,
                         build_provider)
from ..providers.base import normalise_base_url
from .theme import PALETTE, SPACE, TYPE, stylesheet

KEY_URLS = {
    "gemini": "https://aistudio.google.com/app/apikey",
    "openai": "https://platform.openai.com/api-keys",
    "anthropic": "https://console.anthropic.com/settings/keys",
    "openrouter": "https://openrouter.ai/keys",
}


def _section(title: str) -> QLabel:
    label = QLabel(title.upper())
    label.setObjectName("SectionLabel")
    return label


def _hint(text: str) -> QLabel:
    label = QLabel(text)
    label.setWordWrap(True)
    label.setStyleSheet(
        f"color:{PALETTE.text_faint};font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;")
    return label


class SettingsDialog(QDialog):
    applied = Signal()

    def __init__(self, config: ConfigManager, secrets: SecretStore,
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.config = config
        self.settings = config.settings
        self.secrets = secrets

        self.setWindowTitle("StealthIt Settings")
        self.setMinimumSize(640, 620)
        self.setStyleSheet(stylesheet(self.settings.appearance.accent,
                                      self.settings.appearance.font_size))
        # The dialog is a child of a stealthed window, but stealth is
        # per-HWND -- so it needs its own exclusion or API keys would be
        # visible in a screen share while the overlay behind them is not.
        self.setWindowFlags(self.windowFlags() | Qt.WindowStaysOnTopHint)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(SPACE.lg, SPACE.lg, SPACE.lg, SPACE.lg)
        layout.setSpacing(SPACE.md)

        self.tabs = QTabWidget()
        self.tabs.addTab(self._providers_tab(), "Providers")
        self.tabs.addTab(self._modes_tab(), "Modes")
        self.tabs.addTab(self._audio_tab(), "Audio")
        self.tabs.addTab(self._appearance_tab(), "Appearance")
        self.tabs.addTab(self._hotkeys_tab(), "Hotkeys")
        self.tabs.addTab(self._privacy_tab(), "Privacy")
        layout.addWidget(self.tabs, 1)

        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self._cancel)
        buttons.addWidget(cancel)
        save = QPushButton("Save")
        save.setObjectName("Primary")
        save.clicked.connect(self._save)
        buttons.addWidget(save)
        layout.addLayout(buttons)

    def showEvent(self, event) -> None:
        super().showEvent(event)
        try:
            from ..native.window import StealthController
            if self.settings.behaviour.stealth:
                StealthController(int(self.winId())).set_capture_exclusion(True)
        except Exception:
            pass

    # ------------------------------------------------------------- providers
    def _providers_tab(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        layout = QVBoxLayout(body)
        layout.setContentsMargins(2, 2, SPACE.sm, 2)
        layout.setSpacing(SPACE.md)

        layout.addWidget(_section("Active provider"))
        self.provider_combo = QComboBox()
        for name in KNOWN_MODELS:
            self.provider_combo.addItem(PROVIDER_LABELS[name], name)
        # Custom user-created providers also appear in the dropdown.
        for name in self.settings.custom_providers:
            cfg = self.settings.provider(name)
            self.provider_combo.addItem(
                f"{cfg.label or name}  (custom)", name)
        idx = self.provider_combo.findData(self.settings.active_provider)
        self.provider_combo.setCurrentIndex(max(0, idx))
        self.provider_combo.currentIndexChanged.connect(self._provider_changed)
        layout.addWidget(self.provider_combo)

        self.provider_blurb = _hint("")
        layout.addWidget(self.provider_blurb)

        self.model_combo = QComboBox()
        self.model_combo.setEditable(True)  # allow any model id
        model_row = QHBoxLayout()
        model_row.setSpacing(SPACE.sm)
        model_row.addWidget(self.model_combo, 1)
        self.btn_browse = QPushButton("Browse models...")
        self.btn_browse.setToolTip(
            "Search the provider's full catalogue, filter by free and by "
            "screenshot support")
        self.btn_browse.clicked.connect(self._browse_models)
        model_row.addWidget(self.btn_browse)
        layout.addWidget(QLabel("Model"))
        layout.addLayout(model_row)
        self.model_hint = _hint("")
        layout.addWidget(self.model_hint)

        self.endpoint_override_widget = QWidget()
        eo_layout = QVBoxLayout(self.endpoint_override_widget)
        eo_layout.setContentsMargins(0, 0, 0, 0)
        
        eo_layout.addWidget(_section("Custom endpoint"))
        self.base_url_field = QLineEdit()
        self.base_url_field.setPlaceholderText(
            "Leave blank to use the provider's own API")
        self.base_url_field.editingFinished.connect(self._base_url_changed)
        eo_layout.addWidget(self.base_url_field)
        eo_layout.addWidget(_section("Custom headers"))
        self.headers_field = QPlainTextEdit()
        self.headers_field.setMaximumHeight(70)
        self.headers_field.setPlaceholderText(
            "One per line:  Header-Name: value")
        eo_layout.addWidget(self.headers_field)
        eo_layout.addWidget(_hint(
            "Sent with every request to this provider, overriding the "
            "defaults. Needed for gateways that require a particular client "
            "identity or a non-standard auth header.\n"
            "Note: if a gateway rejects StealthIt as an \"unauthorized "
            "client\", it is deliberately restricting which apps may use it. "
            "Overriding that may breach its terms and risk your key."))

        layout.addWidget(self.endpoint_override_widget)

        self.base_url_hint = _hint("")
        layout.addWidget(self.base_url_hint)

        test_row = QHBoxLayout()
        self.btn_test_endpoint = QPushButton("Test connection")
        self.btn_test_endpoint.setToolTip(
            "Try the endpoint and report exactly what it says")
        self.btn_test_endpoint.clicked.connect(self._test_endpoint)
        test_row.addWidget(self.btn_test_endpoint)
        test_row.addStretch()
        layout.addLayout(test_row)

        self.key_fields: dict[str, QLineEdit] = {}
        self.key_status: dict[str, QLabel] = {}

        layout.addWidget(_section("API keys"))
        layout.addWidget(_hint(
            "Keys are encrypted with Windows DPAPI and tied to your user "
            "account. They are never stored in plain text and never written "
            "to the process environment."))

        for name in ("gemini", "anthropic", "openai", "openrouter"):
            row = QFrame()
            row_layout = QVBoxLayout(row)
            row_layout.setContentsMargins(0, SPACE.xs, 0, SPACE.xs)
            row_layout.setSpacing(SPACE.xs)

            header = QHBoxLayout()
            header.addWidget(QLabel(PROVIDER_LABELS[name]))
            header.addStretch()
            status = QLabel()
            status.setStyleSheet(f"font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;")
            self.key_status[name] = status
            header.addWidget(status)
            link = QPushButton("Get a key")
            link.setObjectName("Chip")
            link.setCursor(Qt.PointingHandCursor)
            link.clicked.connect(
                lambda _c=False, n=name: self._open_url(KEY_URLS[n]))
            header.addWidget(link)
            row_layout.addLayout(header)

            field_row = QHBoxLayout()
            field_row.setSpacing(SPACE.xs)
            field = QLineEdit()
            field.setEchoMode(QLineEdit.Password)
            existing = self.secrets.get(name)
            if existing:
                # Populate the field with the real key rather than leaving it
                # blank. An empty box after saving gives the user no way to
                # tell whether the key was stored, which is exactly the
                # confusion this replaces. Echo mode keeps it masked on
                # screen, and it is only ever written back if it changes.
                field.setText(existing)
            else:
                field.setPlaceholderText("Not set -- paste your key here")
            self.key_fields[name] = field
            field_row.addWidget(field, 1)

            reveal = QPushButton("Show")
            reveal.setCheckable(True)
            reveal.setFixedWidth(52)
            reveal.setToolTip("Show or hide the key")
            reveal.setCursor(Qt.PointingHandCursor)
            reveal.toggled.connect(
                lambda shown, f=field, b=reveal: (
                    f.setEchoMode(QLineEdit.Normal if shown
                                  else QLineEdit.Password),
                    b.setText("Hide" if shown else "Show")))
            field_row.addWidget(reveal)
            row_layout.addLayout(field_row)
            layout.addWidget(row)

        layout.addWidget(_section("Ollama"))
        self.ollama_host = QLineEdit(self.settings.provider("ollama").host)
        layout.addWidget(QLabel("Host"))
        layout.addWidget(self.ollama_host)
        self.ollama_status = _hint("")
        layout.addWidget(self.ollama_status)
        check = QPushButton("Test connection")
        check.clicked.connect(self._test_ollama)
        layout.addWidget(check)

        # ---- custom OpenAI-compatible providers ----
        layout.addWidget(_section("Custom OpenAI-compatible providers"))
        layout.addWidget(_hint(
            "Add any endpoint that speaks the OpenAI /chat/completions "
            "API -- AgentRouter, LiteLLM, vLLM, Together, a corporate "
            "proxy, or a self-hosted gateway."))

        self.custom_list = QListWidget()
        self.custom_list.setMaximumHeight(120)
        self.custom_list.itemDoubleClicked.connect(
            lambda: self._edit_custom_provider())
        self._refresh_custom_list()
        layout.addWidget(self.custom_list)

        custom_btn_row = QHBoxLayout()
        custom_btn_row.setSpacing(SPACE.sm)
        btn_add_custom = QPushButton("Add provider")
        btn_add_custom.clicked.connect(self._add_custom_provider)
        custom_btn_row.addWidget(btn_add_custom)
        btn_edit_custom = QPushButton("Edit")
        btn_edit_custom.clicked.connect(self._edit_custom_provider)
        custom_btn_row.addWidget(btn_edit_custom)
        btn_remove_custom = QPushButton("Remove")
        btn_remove_custom.setObjectName("Danger")
        btn_remove_custom.clicked.connect(self._remove_custom_provider)
        custom_btn_row.addWidget(btn_remove_custom)
        custom_btn_row.addStretch()
        layout.addLayout(custom_btn_row)

        layout.addStretch()
        scroll.setWidget(body)
        self._provider_changed()
        self._refresh_key_status()
        return scroll

    def _provider_changed(self) -> None:
        name = self.provider_combo.currentData()
        cfg = self.settings.provider(name)
        is_custom = cfg.is_custom
        self.provider_blurb.setText(
            PROVIDER_BLURBS.get(name, "")
            if not is_custom
            else f"Custom OpenAI-compatible endpoint: {cfg.base_url or '(not set)'}")
        
        self.endpoint_override_widget.setVisible(not is_custom)

        # Show this provider's endpoint; each keeps its own.
        self.base_url_field.setText(cfg.base_url)
        self.headers_field.setPlainText(
            self._format_headers(cfg.custom_headers))
        self.base_url_hint.setStyleSheet(
            f"color:{PALETTE.text_faint};font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;")
        if not is_custom:
            self._update_base_url_hint(name)
        else:
            self.base_url_hint.setText("")
            
        self.model_combo.clear()
        entries = KNOWN_MODELS.get(name, [])
        seen = set()
        for entry in entries:
            suffix = "" if entry["vision"] else "   (text only)"
            self.model_combo.addItem(entry["label"] + suffix, entry["id"])
            seen.add(entry["id"])
        for model in cfg.cached_models:
            if model not in seen:
                self.model_combo.addItem(model, model)
        idx = self.model_combo.findData(cfg.model)
        if idx >= 0:
            self.model_combo.setCurrentIndex(idx)
        else:
            self.model_combo.setEditText(cfg.model)
        hint = ""
        if is_custom:
            hint = ("Type a model name, or use \"Test connection\" to "
                    "discover available models.")
        elif name in ("ollama", "openrouter"):
            hint = "Screenshot analysis needs a vision-capable model."
        self.model_hint.setText(hint)

    def _refresh_key_status(self) -> None:
        for name, label in self.key_status.items():
            source = self.secrets.source(name)
            if source == "not set":
                label.setText("not set")
                label.setStyleSheet(
                    f"color:{PALETTE.text_faint};font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;")
            else:
                # A tick plus the source, so "is my key saved?" is answerable
                # at a glance rather than by trial and error.
                label.setText(f"saved ({source})")
                label.setStyleSheet(
                    f"color:{PALETTE.success};font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;")

    def _base_url_changed(self) -> None:
        """Store and echo back the normalised URL as the user types it."""
        name = self.provider_combo.currentData()
        raw = self.base_url_field.text().strip()
        cleaned = normalise_base_url(raw)
        self.settings.provider(name).base_url = cleaned
        if cleaned and cleaned != raw:
            # Show what will actually be called, so a pasted full endpoint
            # does not look like it was ignored.
            self.base_url_field.setText(cleaned)
        self._update_base_url_hint(name)

    def _update_base_url_hint(self, name: str) -> None:
        cls = PROVIDER_CLASSES.get(name)
        default = getattr(cls, "default_base_url", "") if cls else ""
        current = self.settings.provider(name).base_url
        if name == "ollama":
            self.base_url_hint.setText(
                "Ollama is addressed by the Host field above; a URL here is "
                "treated as that host.")
            return
        if current:
            self.base_url_hint.setText(
                f"Requests go to {current}/chat/completions instead of "
                f"{default}. The API key is sent as a Bearer token.")
        else:
            self.base_url_hint.setText(
                f"Using {default}. Set a URL here to route through a gateway "
                f"or aggregator (agentrouter.org, LiteLLM, vLLM, a corporate "
                f"proxy) that speaks the same API.")

    @staticmethod
    def _parse_headers(text: str) -> dict[str, str]:
        """Parse "Name: value" lines, ignoring blanks and comments."""
        out: dict[str, str] = {}
        for line in (text or "").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or ":" not in line:
                continue
            name, _, value = line.partition(":")
            name, value = name.strip(), value.strip()
            if name and value:
                out[name] = value
        return out

    @staticmethod
    def _format_headers(headers: dict[str, str]) -> str:
        return "\n".join(f"{k}: {v}" for k, v in headers.items())

    def _test_endpoint(self) -> None:
        """
        Try the endpoint and report exactly what came back.

        Uses discover_models, which probes the common API roots and returns a
        reason when the catalogue is empty -- so a wrong path, a rejected key
        and a gateway that simply has no catalogue are told apart instead of
        all surfacing as "no models returned".
        """
        name = self.provider_combo.currentData()
        self.btn_test_endpoint.setEnabled(False)
        self.btn_test_endpoint.setText("Testing...")
        try:
            cfg = self.settings.provider(name)
            if not cfg.is_custom:
                self._base_url_changed()
                cfg.custom_headers = self._parse_headers(
                    self.headers_field.toPlainText())

            # Commit the typed key so build_provider can use it.
            self._commit_current_key(name)

            provider = build_provider(name, self.settings, self.secrets)
            models, note = provider.discover_models()

            if models:
                # Remember the root that worked, so later calls skip probing.
                if provider.base_url != cfg.base_url and provider.base_url:
                    cfg.base_url = provider.base_url
                    if not cfg.is_custom:
                        self.base_url_field.setText(provider.base_url)
                cfg.cached_models = [m.id for m in models[:400]]
                cfg.capabilities = {
                    m.id: {"vision": m.vision, "audio": m.audio,
                           "free": m.free} for m in models}
                self._set_endpoint_status(
                    f"Connected to {provider.base_url} -- {len(models)} "
                    f"models. Use \"Browse models...\" to pick one.",
                    PALETTE.success)
            else:
                # No catalogue is a valid configuration, not a failure: type
                # the model name instead.
                self._set_endpoint_status(note, PALETTE.warning)
        except Exception as exc:
            self._set_endpoint_status(f"Could not connect: {exc}",
                                      PALETTE.danger)
        finally:
            self.btn_test_endpoint.setEnabled(True)
            self.btn_test_endpoint.setText("Test connection")

    def _commit_current_key(self, name: str) -> None:
        """Save the API key currently typed in the UI, if it changed."""
        field = self.key_fields.get(name)
        if field is not None:
            typed = field.text().strip()
            if typed and typed != self.secrets.get(name):
                self.secrets.set(name, typed)
                self._refresh_key_status()

    def _set_endpoint_status(self, text: str, colour: str) -> None:
        self.base_url_hint.setText(text)
        self.base_url_hint.setStyleSheet(
            f"color:{colour};font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;")

    def _browse_models(self) -> None:
        """
        Open the searchable catalogue.

        The key and headers typed into the form are committed first, so
        browsing works immediately after pasting one rather than requiring a
        save-and-reopen.
        """
        from .model_picker import ModelPicker

        name = self.provider_combo.currentData()
        if name == "ollama":
            self.settings.provider("ollama").host = \
                ConfigManager._clean_host(self.ollama_host.text())
        self._commit_current_key(name)
        
        cfg = self.settings.provider(name)
        if not cfg.is_custom:
            cfg.custom_headers = self._parse_headers(self.headers_field.toPlainText())

        label = (cfg.label or name) if cfg.is_custom \
            else PROVIDER_LABELS.get(name, name)

        try:
            provider = build_provider(name, self.settings, self.secrets)
        except Exception as exc:
            self.model_hint.setText(f"Could not reach {name}: {exc}")
            return

        current = (self.model_combo.currentData()
                   or self.model_combo.currentText().strip())
        picker = ModelPicker(provider, label, current, self)
        # A gateway with no catalogue must not silently show an empty dialog;
        # the picker says so and lets the user type a model name instead.
        if not provider.list_models():
            self._set_endpoint_status(
                "This gateway does not publish a model list -- type the "
                "model name in the Model box instead.",
                PALETTE.warning)
            return
        picker.chosen.connect(lambda model_id: self._select_model(
            name, model_id, picker._models))
        picker.exec()

    def _select_model(self, provider: str, model_id: str,
                      catalogue: list) -> None:
        """Adopt a model chosen in the picker, and remember the catalogue."""
        cfg = self.settings.provider(provider)
        if catalogue:
            cfg.cached_models = [m.id for m in catalogue[:400]]
            # Persist what the catalogue told us about each model. Without
            # this, a vision-capable OpenRouter model was re-judged by name
            # matching at send time and refused with "cannot read images".
            cfg.capabilities = {
                m.id: {"vision": m.vision, "audio": m.audio, "free": m.free}
                for m in catalogue}
        idx = self.model_combo.findData(model_id)
        if idx >= 0:
            self.model_combo.setCurrentIndex(idx)
        else:
            self.model_combo.insertItem(0, model_id, model_id)
            self.model_combo.setCurrentIndex(0)

        info = next((m for m in catalogue if m.id == model_id), None)
        if info is not None:
            bits = [b for b in (info.price_summary(), info.context_summary(),
                                "reads screenshots" if info.vision
                                else "text only",
                                "accepts audio" if info.audio else "") if b]
            self.model_hint.setText(f"{model_id} -- " + " · ".join(bits))
        else:
            self.model_hint.setText(model_id)

    def _test_ollama(self) -> None:
        from ..providers.ollama import OllamaProvider
        host = ConfigManager._clean_host(self.ollama_host.text())
        provider = OllamaProvider(host=host)
        if provider.is_running():
            models = provider.list_models()
            self.ollama_status.setText(
                f"Connected. {len(models)} model(s) installed."
                + (f" Vision-capable: "
                   f"{', '.join(m for m in models if 'llava' in m or 'vision' in m) or 'none'}"
                   if models else ""))
            self.ollama_status.setStyleSheet(
                f"color:{PALETTE.success};font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;")
        else:
            self.ollama_status.setText(
                f"Not reachable at {host}. Is Ollama running?")
            self.ollama_status.setStyleSheet(
                f"color:{PALETTE.danger};font-size:{TYPE.size_xs/TYPE.size_md:.2f}em;")

    # ---------------------------------------------------- custom providers
    @staticmethod
    def _slugify(name: str) -> str:
        """Turn a display name into a safe provider key."""
        slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
        return f"custom_{slug}" if slug else ""

    def _refresh_custom_list(self) -> None:
        prev_slug = None
        if self.custom_list.currentItem():
            prev_slug = self.custom_list.currentItem().data(Qt.UserRole)
        self.custom_list.clear()
        restore_row = 0
        for i, name in enumerate(self.settings.custom_providers):
            cfg = self.settings.provider(name)
            label = cfg.label or name
            url = cfg.base_url or "(no URL)"
            item = QListWidgetItem(f"{label}  —  {url}")
            item.setData(Qt.UserRole, name)
            self.custom_list.addItem(item)
            if name == prev_slug:
                restore_row = i
        # Always keep an item selected so Edit / Remove don't silently fail.
        if self.custom_list.count():
            self.custom_list.setCurrentRow(
                min(restore_row, self.custom_list.count() - 1))

    def _rebuild_provider_combo(self) -> None:
        """Re-populate the active-provider dropdown after a custom change."""
        current = self.provider_combo.currentData()
        self.provider_combo.blockSignals(True)
        self.provider_combo.clear()
        for name in KNOWN_MODELS:
            self.provider_combo.addItem(PROVIDER_LABELS[name], name)
        for name in self.settings.custom_providers:
            cfg = self.settings.provider(name)
            self.provider_combo.addItem(
                f"{cfg.label or name}  (custom)", name)
        idx = self.provider_combo.findData(current)
        self.provider_combo.setCurrentIndex(max(0, idx))
        self.provider_combo.blockSignals(False)

    def _add_custom_provider(self) -> None:
        dlg = _CustomProviderDialog(parent=self)
        if dlg.exec() != QDialog.Accepted:
            return
        display_name = dlg.name_field.text().strip()
        if not display_name:
            return
        slug = self._slugify(display_name)
        if not slug:
            QMessageBox.warning(self, "Invalid name",
                                "The provider name must contain at least one "
                                "letter or digit.")
            return
        if slug in self.settings.providers:
            QMessageBox.warning(self, "Name taken",
                                f"A provider with the key '{slug}' already "
                                f"exists. Choose a different name.")
            return

        base_url = normalise_base_url(dlg.url_field.text())
        model = dlg.model_field.text().strip()
        headers = self._parse_headers(dlg.headers_field.toPlainText())
        api_key = dlg.key_field.text().strip()

        cfg = ProviderConfig(
            model=model,
            base_url=base_url,
            custom_headers=headers,
            is_custom=True,
            label=display_name)
        self.settings.providers[slug] = cfg
        self.settings.custom_providers.append(slug)
        if api_key:
            self.secrets.set(slug, api_key)
        self._refresh_custom_list()
        # Select the newly added item.
        self.custom_list.setCurrentRow(self.custom_list.count() - 1)
        self._rebuild_provider_combo()

    def _edit_custom_provider(self) -> None:
        item = self.custom_list.currentItem()
        if item is None:
            QMessageBox.information(
                self, "No provider selected",
                "Select a provider from the list above first.")
            return
        slug = item.data(Qt.UserRole)
        cfg = self.settings.provider(slug)
        if not cfg.is_custom:
            return
        dlg = _CustomProviderDialog(
            name=cfg.label, url=cfg.base_url, model=cfg.model,
            headers=self._format_headers(cfg.custom_headers),
            api_key=self.secrets.get(slug),
            parent=self)
        if dlg.exec() != QDialog.Accepted:
            return
        cfg.label = dlg.name_field.text().strip() or cfg.label
        cfg.base_url = normalise_base_url(dlg.url_field.text())
        cfg.model = dlg.model_field.text().strip()
        cfg.custom_headers = self._parse_headers(
            dlg.headers_field.toPlainText())
        api_key = dlg.key_field.text().strip()
        if api_key != self.secrets.get(slug):
            self.secrets.set(slug, api_key)
        self._refresh_custom_list()
        self._rebuild_provider_combo()

    def _remove_custom_provider(self) -> None:
        item = self.custom_list.currentItem()
        if item is None:
            QMessageBox.information(
                self, "No provider selected",
                "Select a provider from the list above first.")
            return
        slug = item.data(Qt.UserRole)
        cfg = self.settings.provider(slug)
        label = cfg.label or slug
        confirm = QMessageBox.question(
            self, "Remove provider",
            f"Remove custom provider \"{label}\"?\n"
            "Its API key will also be deleted.")
        if confirm != QMessageBox.Yes:
            return
        self.settings.providers.pop(slug, None)
        if slug in self.settings.custom_providers:
            self.settings.custom_providers.remove(slug)
        self.secrets.set(slug, "")  # delete key
        # If this was the active provider, fall back to gemini.
        if self.settings.active_provider == slug:
            self.settings.active_provider = "gemini"
        self._refresh_custom_list()
        self._rebuild_provider_combo()
        self._provider_changed()

    # ----------------------------------------------------------------- modes
    def _modes_tab(self) -> QWidget:
        body = QWidget()
        layout = QHBoxLayout(body)
        layout.setContentsMargins(2, 2, 2, 2)
        layout.setSpacing(SPACE.md)

        left = QVBoxLayout()
        left.addWidget(_section("Modes"))
        self.mode_list = QListWidget()
        self.mode_list.addItems(self.settings.modes.keys())
        self.mode_list.currentTextChanged.connect(self._mode_selected)
        left.addWidget(self.mode_list)

        row = QHBoxLayout()
        add = QPushButton("Add")
        add.clicked.connect(self._add_mode)
        row.addWidget(add)
        delete = QPushButton("Delete")
        delete.setObjectName("Danger")
        delete.clicked.connect(self._delete_mode)
        row.addWidget(delete)
        left.addLayout(row)
        left_wrap = QWidget()
        left_wrap.setLayout(left)
        left_wrap.setFixedWidth(190)
        layout.addWidget(left_wrap)

        right = QVBoxLayout()
        right.addWidget(_section("System prompt"))
        right.addWidget(_hint(
            "This is sent with every request in this mode. Modes let you keep "
            "an interview co-pilot and a code reviewer without rewriting the "
            "prompt each time."))
        self.mode_editor = QPlainTextEdit()
        right.addWidget(self.mode_editor, 1)

        right.addWidget(_section("Screenshot prompt"))
        right.addWidget(_hint(
            "Added whenever a screenshot is attached, in any mode."))
        self.vision_editor = QPlainTextEdit(self.settings.vision_prompt)
        self.vision_editor.setMaximumHeight(96)
        right.addWidget(self.vision_editor)

        right.addWidget(_section("About you"))
        right.addWidget(_hint(
            "Persistent context sent with every request -- your role, your "
            "stack, what you are working on. Good context here improves every "
            "answer."))
        self.notes_editor = QPlainTextEdit(self.settings.context_notes)
        self.notes_editor.setMaximumHeight(84)
        right.addWidget(self.notes_editor)

        right_wrap = QWidget()
        right_wrap.setLayout(right)
        layout.addWidget(right_wrap, 1)

        if self.mode_list.count():
            self.mode_list.setCurrentRow(0)
        return body

    def _mode_selected(self, name: str) -> None:
        # Persist edits to the previously selected mode before switching, so
        # clicking away does not silently discard them.
        if getattr(self, "_editing_mode", None) and self._editing_mode in \
                self.settings.modes:
            self.settings.modes[self._editing_mode] = \
                self.mode_editor.toPlainText()
        self._editing_mode = name
        self.mode_editor.setPlainText(self.settings.modes.get(name, ""))

    def _add_mode(self) -> None:
        from PySide6.QtWidgets import QInputDialog
        name, ok = QInputDialog.getText(self, "New mode", "Mode name:")
        name = name.strip()
        if not ok or not name:
            return
        if name in self.settings.modes:
            QMessageBox.information(self, "Mode exists",
                                    f"'{name}' already exists.")
            return
        self.settings.modes[name] = "You are a helpful assistant."
        self.mode_list.addItem(name)
        self.mode_list.setCurrentRow(self.mode_list.count() - 1)

    def _delete_mode(self) -> None:
        name = self.mode_list.currentItem().text() if \
            self.mode_list.currentItem() else ""
        if not name:
            return
        if name in BUILTIN_MODES:
            QMessageBox.information(
                self, "Built-in mode",
                f"'{name}' is built in. Edit its prompt instead of deleting it.")
            return
        self.settings.modes.pop(name, None)
        self.mode_list.takeItem(self.mode_list.currentRow())

    # ----------------------------------------------------------------- audio
    def _audio_tab(self) -> QWidget:
        body = QWidget()
        layout = QVBoxLayout(body)
        layout.setContentsMargins(2, 2, 2, 2)
        layout.setSpacing(SPACE.md)

        layout.addWidget(_section("What to listen to"))
        devices = AudioCapture.describe_devices()

        self.cb_system = QCheckBox("System audio -- what the other person says")
        self.cb_system.setChecked(self.settings.audio.capture_system_audio)
        layout.addWidget(self.cb_system)
        layout.addWidget(_hint(
            f"Captured via WASAPI loopback from: {devices['system_audio']}.\n"
            "This is what lets the assistant hear the other side of a call. "
            "Nothing is injected into the call itself."))

        self.cb_mic = QCheckBox("Microphone -- what you say")
        self.cb_mic.setChecked(self.settings.audio.capture_microphone)
        layout.addWidget(self.cb_mic)
        layout.addWidget(_hint(f"Device: {devices['microphone']}."))

        layout.addWidget(_section("Transcription"))
        self.whisper_combo = QComboBox()
        for model_id, label in MODEL_CHOICES:
            self.whisper_combo.addItem(label, model_id)
        idx = self.whisper_combo.findData(self.settings.audio.whisper_model)
        self.whisper_combo.setCurrentIndex(max(0, idx))
        layout.addWidget(self.whisper_combo)
        layout.addWidget(_hint(
            "Transcription runs entirely on your machine with Whisper -- no "
            "audio ever leaves the computer, and it works with no API key and "
            "no internet. The model downloads once on first use."))

        layout.addWidget(_section("Sensitivity"))
        self.threshold_slider = QSlider(Qt.Horizontal)
        self.threshold_slider.setRange(2, 40)
        self.threshold_slider.setValue(
            int(self.settings.audio.silence_threshold * 1000))
        layout.addWidget(self.threshold_slider)
        layout.addWidget(_hint(
            "Lower picks up quiet speech but may transcribe background noise. "
            "Raise it in a noisy room."))

        layout.addWidget(_section("Proactive answers"))
        self.cb_auto = QCheckBox(
            "Answer automatically when the other person asks a question")
        self.cb_auto.setChecked(self.settings.behaviour.auto_suggest)
        layout.addWidget(self.cb_auto)
        self.cooldown_spin = QSpinBox()
        self.cooldown_spin.setRange(2, 60)
        self.cooldown_spin.setSuffix(" s minimum between answers")
        self.cooldown_spin.setValue(
            int(self.settings.behaviour.auto_suggest_cooldown))
        layout.addWidget(self.cooldown_spin)
        layout.addWidget(_hint(
            "Without a cooldown, every sentence would trigger a request."))

        layout.addStretch()
        return body

    def _cancel(self) -> None:
        """Undo the live appearance preview before closing."""
        parent = self.parent()
        stealth = getattr(parent, "stealth", None)
        if stealth is not None:
            appearance = self.settings.appearance
            stealth.apply_backdrop(appearance.acrylic,
                                   tuple(appearance.tint), appearance.opacity)
        self.reject()

    def _update_opacity_label(self, value: int) -> None:
        pct = round(value / 255 * 100)
        self.opacity_label.setText(
            f"{pct}% tint -- lower lets more of the desktop show through.")

    def _preview_opacity(self, value: int) -> None:
        """Repaint the live overlay so the slider shows its own effect."""
        self._update_opacity_label(value)
        parent = self.parent()
        stealth = getattr(parent, "stealth", None)
        if stealth is None:
            return
        # Works whether or not the blur is on -- opacity used to be routed
        # only through the acrylic policy, so unticking acrylic silently made
        # the slider inert.
        acrylic = self.cb_acrylic.isChecked()
        stealth.apply_backdrop(acrylic,
                               tuple(self.settings.appearance.tint), value)
        # With the blur off the panel itself has to carry the opacity, so the
        # stylesheet must be rebuilt too or the preview shows no change.
        preview = getattr(parent, "_preview_appearance", None)
        if callable(preview):
            preview(acrylic, value)

    def _preview_acrylic(self, enabled: bool) -> None:
        self._preview_opacity(self.opacity_slider.value())

    # ------------------------------------------------------------ appearance
    def _appearance_tab(self) -> QWidget:
        body = QWidget()
        layout = QVBoxLayout(body)
        layout.setContentsMargins(2, 2, 2, 2)
        layout.setSpacing(SPACE.md)

        layout.addWidget(_section("Glass"))
        self.cb_acrylic = QCheckBox("Acrylic blur behind the window")
        self.cb_acrylic.setChecked(self.settings.appearance.acrylic)
        self.cb_acrylic.toggled.connect(self._preview_acrylic)
        layout.addWidget(self.cb_acrylic)
        layout.addWidget(_hint(
            "Uses the Windows compositor to blur the real desktop behind the "
            "overlay. Turn it off on a low-powered machine."))

        layout.addWidget(QLabel("Opacity"))
        self.opacity_slider = QSlider(Qt.Horizontal)
        self.opacity_slider.setRange(60, 245)
        self.opacity_slider.setValue(self.settings.appearance.opacity)
        # Live preview: an opacity control you cannot see the effect of until
        # you save and restart is not usable. This repaints the overlay behind
        # the dialog as the slider moves.
        self.opacity_slider.valueChanged.connect(self._preview_opacity)
        layout.addWidget(self.opacity_slider)
        self.opacity_label = _hint("")
        layout.addWidget(self.opacity_label)
        self._update_opacity_label(self.settings.appearance.opacity)

        layout.addWidget(_section("Font Size"))
        self.font_spin = QSpinBox()
        self.font_spin.setRange(10, 20)
        self.font_spin.setSuffix(" px")
        self.font_spin.setValue(self.settings.appearance.font_size)
        layout.addWidget(self.font_spin)

        layout.addWidget(_section("Size"))
        self.width_spin = QSpinBox()
        self.width_spin.setRange(420, 1200)
        self.width_spin.setSuffix(" px wide")
        self.width_spin.setValue(self.settings.appearance.compact_width)
        layout.addWidget(self.width_spin)

        self.height_spin = QSpinBox()
        self.height_spin.setRange(320, 1000)
        self.height_spin.setSuffix(" px tall when expanded")
        self.height_spin.setValue(self.settings.appearance.expanded_height)
        layout.addWidget(self.height_spin)

        self.cb_animations = QCheckBox("Animate expand and collapse")
        self.cb_animations.setChecked(self.settings.appearance.animations)
        layout.addWidget(self.cb_animations)

        layout.addStretch()
        return body

    # -------------------------------------------------------------- hotkeys
    def _hotkeys_tab(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        layout = QFormLayout(body)
        layout.setContentsMargins(2, 2, SPACE.sm, 2)
        layout.setSpacing(SPACE.sm)

        self.hotkey_fields: dict[str, QLineEdit] = {}
        for action, (default, description) in DEFAULT_KEYMAP.items():
            field = QLineEdit(self.settings.keymap.get(action, default))
            field.setPlaceholderText(default)
            self.hotkey_fields[action] = field
            layout.addRow(description, field)

        note = _hint(
            "These work globally, even when another application has focus. "
            "If a chord is already owned by another app, StealthIt will say so "
            "on the next launch rather than failing silently.")
        layout.addRow("", note)
        scroll.setWidget(body)
        return scroll

    # -------------------------------------------------------------- privacy
    def _privacy_tab(self) -> QWidget:
        body = QWidget()
        layout = QVBoxLayout(body)
        layout.setContentsMargins(2, 2, 2, 2)
        layout.setSpacing(SPACE.md)

        layout.addWidget(_section("Stealth"))
        self.cb_stealth = QCheckBox("Hide from screen capture and recording")
        self.cb_stealth.setChecked(self.settings.behaviour.stealth)
        layout.addWidget(self.cb_stealth)
        layout.addWidget(_hint(
            "Sets WDA_EXCLUDEFROMCAPTURE on the window, so screen sharing, "
            "recording software and PrintScreen do not see it, while it stays "
            "visible on your physical display. Requires Windows 10 build "
            "19041 or newer."))

        layout.addWidget(_section("History"))
        self.cb_sessions = QCheckBox("Save conversations and transcripts")
        self.cb_sessions.setChecked(self.settings.behaviour.save_sessions)
        layout.addWidget(self.cb_sessions)
        layout.addWidget(_hint(
            f"Stored unencrypted as JSON in {self.config.dir / 'sessions'} so "
            "you can search and review them. Turn this off for sensitive "
            "calls; nothing is written to disk then."))

        self.history_spin = QSpinBox()
        self.history_spin.setRange(0, 40)
        self.history_spin.setSuffix(" turns of history sent as context")
        self.history_spin.setValue(self.settings.behaviour.history_turns)
        layout.addWidget(self.history_spin)
        layout.addWidget(_hint(
            "More history means better follow-up answers and higher token "
            "cost. Zero makes every question independent."))

        layout.addWidget(_section("Where your data goes"))
        layout.addWidget(_hint(
            "Audio is transcribed locally and never uploaded. Screenshots and "
            "prompt text go only to the provider you have selected. With "
            "Ollama, nothing leaves your machine at all."))

        clear = QPushButton("Delete all saved conversations")
        clear.setObjectName("Danger")
        clear.clicked.connect(self._clear_sessions)
        layout.addWidget(clear)

        layout.addStretch()
        return body

    def _clear_sessions(self) -> None:
        directory = self.config.dir / "sessions"
        files = list(directory.glob("*.json")) if directory.exists() else []
        if not files:
            QMessageBox.information(self, "Nothing to delete",
                                    "There are no saved conversations.")
            return
        confirm = QMessageBox.question(
            self, "Delete conversations",
            f"Permanently delete {len(files)} saved conversation(s)?\n"
            "This cannot be undone.")
        if confirm != QMessageBox.Yes:
            return
        removed = 0
        for path in files:
            try:
                path.unlink()
                removed += 1
            except OSError:
                pass
        QMessageBox.information(self, "Deleted",
                                f"Deleted {removed} conversation(s).")

    # ------------------------------------------------------------------ save
    def _save(self) -> None:
        s = self.settings

        # Validate hotkeys before committing: a bad chord should be rejected
        # here, not silently produce a dead key at next launch.
        keymap: dict[str, str] = {}
        for action, field in self.hotkey_fields.items():
            chord = field.text().strip() or DEFAULT_KEYMAP[action][0]
            try:
                parse_chord(chord)
            except HotkeyParseError as exc:
                QMessageBox.warning(
                    self, "Invalid hotkey",
                    f"{DEFAULT_KEYMAP[action][1]}: {exc}")
                self.tabs.setCurrentIndex(4)
                field.setFocus()
                return
            keymap[action] = chord
        s.keymap = keymap

        s.active_provider = self.provider_combo.currentData()
        idx = self.model_combo.currentIndex()
        text = self.model_combo.currentText().strip()
        if idx >= 0 and self.model_combo.itemText(idx) == text:
            model = self.model_combo.currentData()
        else:
            model = text
        s.provider(s.active_provider).model = model
        s.provider("ollama").host = ConfigManager._clean_host(
            self.ollama_host.text())
        
        active_cfg = s.provider(s.active_provider)
        if not active_cfg.is_custom:
            # Custom endpoint for whichever provider is on screen. Other
            # providers keep whatever they already had.
            active_cfg.base_url = normalise_base_url(
                self.base_url_field.text())
            active_cfg.custom_headers = \
                self._parse_headers(self.headers_field.toPlainText())

        # Persist API keys for custom providers (already saved during
        # add/edit, but the active one may have been typed into the
        # built-in key field if the user switched to it in the dropdown).
        if active_cfg.is_custom:
            field = self.key_fields.get(s.active_provider)
            if field is not None:
                typed = field.text().strip()
                if typed != self.secrets.get(s.active_provider):
                    self.secrets.set(s.active_provider, typed)

        for name, field in self.key_fields.items():
            text = field.text().strip()
            # Only write when the value actually changed. The field is now
            # prefilled with the stored key, so an unconditional set would
            # re-encrypt an unchanged secret on every save.
            if text != self.secrets.get(name):
                self.secrets.set(name, text)

        if getattr(self, "_editing_mode", None) in s.modes:
            s.modes[self._editing_mode] = self.mode_editor.toPlainText()
        s.vision_prompt = self.vision_editor.toPlainText().strip() or \
            s.vision_prompt
        s.context_notes = self.notes_editor.toPlainText().strip()
        if s.active_mode not in s.modes:
            s.active_mode = next(iter(s.modes), "General")

        s.audio.capture_system_audio = self.cb_system.isChecked()
        s.audio.capture_microphone = self.cb_mic.isChecked()
        s.audio.whisper_model = self.whisper_combo.currentData()
        s.audio.silence_threshold = self.threshold_slider.value() / 1000
        s.behaviour.auto_suggest = self.cb_auto.isChecked()
        s.behaviour.auto_suggest_cooldown = float(self.cooldown_spin.value())

        s.appearance.acrylic = self.cb_acrylic.isChecked()
        s.appearance.opacity = self.opacity_slider.value()
        s.appearance.font_size = self.font_spin.value()
        s.appearance.compact_width = self.width_spin.value()
        s.appearance.expanded_height = self.height_spin.value()
        s.appearance.animations = self.cb_animations.isChecked()

        s.behaviour.stealth = self.cb_stealth.isChecked()
        s.behaviour.save_sessions = self.cb_sessions.isChecked()
        s.behaviour.history_turns = self.history_spin.value()

        self.config.save()
        self._refresh_key_status()
        self.applied.emit()
        self.accept()

    @staticmethod
    def _open_url(url: str) -> None:
        from PySide6.QtGui import QDesktopServices
        from PySide6.QtCore import QUrl
        QDesktopServices.openUrl(QUrl(url))


class _CustomProviderDialog(QDialog):
    """Modal form for adding or editing a custom OpenAI-compatible provider."""

    def __init__(self, *, name: str = "", url: str = "", model: str = "",
                 headers: str = "", api_key: str = "",
                 parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Custom OpenAI-Compatible Provider")
        self.setMinimumWidth(480)
        if parent and hasattr(parent, 'settings'):
            self.setStyleSheet(stylesheet(
                parent.settings.appearance.accent,
                parent.settings.appearance.font_size))
        self.setWindowFlags(self.windowFlags() | Qt.WindowStaysOnTopHint)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(SPACE.lg, SPACE.lg, SPACE.lg, SPACE.lg)
        layout.setSpacing(SPACE.md)

        layout.addWidget(QLabel("Provider name"))
        self.name_field = QLineEdit(name)
        self.name_field.setPlaceholderText(
            "e.g. AgentRouter, My vLLM, Corporate Proxy")
        layout.addWidget(self.name_field)
        layout.addWidget(_hint("A display name for this provider."))

        layout.addWidget(QLabel("Base URL"))
        self.url_field = QLineEdit(url)
        self.url_field.setPlaceholderText(
            "e.g. https://agentrouter.org/v1")
        layout.addWidget(self.url_field)
        layout.addWidget(_hint(
            "The root of the OpenAI-compatible API. StealthIt appends "
            "/chat/completions, /models, etc. automatically."))

        layout.addWidget(QLabel("API key"))
        key_row = QHBoxLayout()
        key_row.setSpacing(SPACE.xs)
        self.key_field = QLineEdit(api_key)
        self.key_field.setEchoMode(QLineEdit.Password)
        self.key_field.setPlaceholderText("Paste your key here (encrypted)")
        key_row.addWidget(self.key_field, 1)
        reveal = QPushButton("Show")
        reveal.setCheckable(True)
        reveal.setFixedWidth(52)
        reveal.toggled.connect(
            lambda shown: (
                self.key_field.setEchoMode(
                    QLineEdit.Normal if shown else QLineEdit.Password),
                reveal.setText("Hide" if shown else "Show")))
        key_row.addWidget(reveal)
        layout.addLayout(key_row)
        layout.addWidget(_hint(
            "Sent as a Bearer token. Encrypted with Windows DPAPI."))

        layout.addWidget(QLabel("Model"))
        self.model_field = QLineEdit(model)
        self.model_field.setPlaceholderText(
            "e.g. gpt-4o, claude-sonnet-4-5, llama-3.1-70b")
        layout.addWidget(self.model_field)
        layout.addWidget(_hint(
            "The model name the gateway expects. Use \"Test connection\" in "
            "Settings after saving to discover available models."))

        layout.addWidget(QLabel("Custom headers (optional)"))
        self.headers_field = QPlainTextEdit(headers)
        self.headers_field.setMaximumHeight(60)
        self.headers_field.setPlaceholderText("One per line:  Header-Name: value")
        layout.addWidget(self.headers_field)
        layout.addWidget(_hint(
            "Extra HTTP headers sent with every request to this endpoint."))

        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.reject)
        buttons.addWidget(cancel)
        save = QPushButton("Save")
        save.setObjectName("Primary")
        save.clicked.connect(self._validate_and_accept)
        buttons.addWidget(save)
        layout.addLayout(buttons)

    def _validate_and_accept(self) -> None:
        if not self.name_field.text().strip():
            QMessageBox.warning(self, "Missing name",
                                "Enter a name for this provider.")
            self.name_field.setFocus()
            return
        if not self.url_field.text().strip():
            QMessageBox.warning(self, "Missing URL",
                                "Enter the base URL of the API endpoint.")
            self.url_field.setFocus()
            return
        self.accept()

