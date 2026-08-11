"""
Chip-styled dropdowns for the composer.

These replace QMenu-based pickers. A QMenu that outgrows the screen scrolls
*on hover* -- moving the pointer toward an item near the edge silently scrolls
the list under it, so you land on the wrong model. There is no scrollbar to
grab and no way to turn the behaviour off.

A combo box popup is a real list view: it has a scrollbar, scrolls only when
you ask it to, and keyboard-selects by typing. Same pill styling, none of the
hover-scroll.
"""
from __future__ import annotations

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QComboBox, QListView, QWidget

from . import icons
from .theme import PALETTE, SPACE, TYPE


class ChipComboBox(QComboBox):
    """
    A combo box that looks like a pill chip.

    `activated` (not `currentIndexChanged`) is what callers should listen to:
    it fires only on a deliberate user choice, so repopulating the list does
    not look like the user picking something.
    """

    def __init__(self, icon_name: str = "", parent: QWidget | None = None):
        super().__init__(parent)
        self.setObjectName("ChipCombo")
        self.setCursor(Qt.PointingHandCursor)
        self.setFocusPolicy(Qt.NoFocus)  # keep focus in the prompt box
        self._icon_name = icon_name
        if icon_name:
            self.setIcon(icon_name)

        # A real list view popup, so the scrollbar is usable and the list
        # never scrolls just because the pointer passed over it.
        view = QListView()
        view.setUniformItemSizes(True)
        view.setVerticalScrollMode(QListView.ScrollPerPixel)
        view.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setView(view)
        self.setMaxVisibleItems(14)
        self.setSizeAdjustPolicy(QComboBox.AdjustToContents)
        self.setStyleSheet(self._style())

    def setIcon(self, name: str) -> None:
        self._icon_name = name
        super().setIconSize(QSize(14, 14))

    def _style(self) -> str:
        p, s, t = PALETTE, SPACE, TYPE
        return f"""
        QComboBox#ChipCombo {{
            background-color: {p.surface_hover};
            border: 1px solid {p.border};
            border-radius: {s.radius_pill}px;
            padding: 4px 10px 4px 12px;
            font-size: {t.size_sm}px;
            color: {p.text_muted};
            min-height: 18px;
        }}
        QComboBox#ChipCombo:hover {{
            background-color: {p.surface_active};
            color: {p.text};
            border-color: {p.border_strong};
        }}
        QComboBox#ChipCombo::drop-down {{
            border: none;
            width: 16px;
            subcontrol-position: right center;
        }}
        QComboBox#ChipCombo::down-arrow {{ image: none; width: 0; height: 0; }}
        QComboBox#ChipCombo QAbstractItemView {{
            background-color: #171A24;
            border: 1px solid {p.border_strong};
            border-radius: {s.radius_md}px;
            padding: 4px;
            outline: none;
            selection-background-color: {p.accent_dim};
            selection-color: {p.text};
            color: {p.text_muted};
        }}
        QComboBox#ChipCombo QAbstractItemView::item {{
            padding: 7px 10px;
            border-radius: {s.radius_sm}px;
            min-height: 20px;
        }}
        QComboBox#ChipCombo QAbstractItemView::item:disabled {{
            color: {p.text_faint};
            font-size: {t.size_xs}px;
        }}
        """

    def add_header(self, text: str) -> None:
        """A non-selectable group label, e.g. a provider name."""
        self.addItem(text)
        index = self.count() - 1
        item = self.model().item(index)
        item.setEnabled(False)
        item.setData(None, Qt.UserRole)

    def add_choice(self, label: str, value, tooltip: str = "",
                   enabled: bool = True, indent: bool = False) -> None:
        self.addItem(("   " + label) if indent else label, value)
        index = self.count() - 1
        item = self.model().item(index)
        if tooltip:
            item.setToolTip(tooltip)
        item.setEnabled(enabled)

    def select_value(self, value) -> bool:
        """
        Select by stored data without emitting `activated`.

        Compares element-wise rather than using findData: PySide6 stores a
        Python tuple as a list, so findData(("model", ...)) never matches what
        addItem(("model", ...)) put there.
        """
        wanted = list(value) if isinstance(value, (list, tuple)) else value
        for index in range(self.count()):
            data = self.itemData(index)
            current = list(data) if isinstance(data, (list, tuple)) else data
            if current == wanted:
                was = self.blockSignals(True)
                self.setCurrentIndex(index)
                self.blockSignals(was)
                return True
        return False

    def set_display(self, text: str) -> None:
        """
        Show a label that is not one of the items.

        Used when the configured model is not in the shortlist -- the chip
        should still say what is actually active rather than the first entry.
        """
        was = self.blockSignals(True)
        if self.findData("__display__") < 0:
            self.insertItem(0, text, "__display__")
            self.model().item(0).setEnabled(False)
        else:
            self.setItemText(0, text)
        self.setCurrentIndex(0)
        self.blockSignals(was)
    def paintEvent(self, event) -> None:
        super().paintEvent(event)
        if not self._icon_name:
            return
        # Draw the leading glyph and the chevron ourselves, so the chip keeps
        # the same visual language as the toolbar icon buttons.
        from PySide6.QtGui import QPainter
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        chevron = icons.pixmap("chevron-down", 12, PALETTE.text_faint)
        painter.drawPixmap(self.width() - 17,
                           (self.height() - 12) // 2, chevron)
        painter.end()
