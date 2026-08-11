"""
Design tokens.

One source of truth for colour, type, spacing and motion. The original
scattered inline stylesheets across ~15 widgets, each with slightly different
hardcoded rgba values -- which is why the result looked assembled rather than
designed. Every visual constant lives here.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Palette:
    # Surfaces sit over live acrylic, so they are deliberately low-alpha:
    # the desktop blur behind supplies most of the depth. The answer pane in
    # particular is kept near-transparent so what is behind the overlay stays
    # readable -- the panel is a tint over the desktop, not a window on top
    # of it.
    surface: str = "rgba(16, 18, 26, 0.46)"
    surface_raised: str = "rgba(28, 31, 43, 0.72)"
    surface_hover: str = "rgba(255, 255, 255, 0.07)"
    surface_active: str = "rgba(255, 255, 255, 0.12)"
    surface_sunken: str = "rgba(0, 0, 0, 0.18)"

    border: str = "rgba(255, 255, 255, 0.09)"
    border_strong: str = "rgba(255, 255, 255, 0.16)"
    border_focus: str = "rgba(255, 255, 255, 0.42)"

    text: str = "#EDEFF5"
    text_muted: str = "#A7AEC0"
    text_faint: str = "#6E7688"

    # Neutral by default. A saturated brand colour on every chip, border and
    # bubble is exactly what makes an overlay look like a toy sitting on top
    # of the desktop rather than part of it -- and it fights with whatever is
    # behind the glass. Colour is now reserved for things that carry meaning:
    # speaker identity, and success/warning/error.
    accent: str = "#D5D9E4"
    accent_hover: str = "#FFFFFF"
    accent_dim: str = "rgba(255, 255, 255, 0.10)"

    success: str = "#4ADE80"
    warning: str = "#FBBF24"
    danger: str = "#F87171"
    danger_dim: str = "rgba(248, 113, 113, 0.16)"

    # Speaker colours. These stay distinct because telling "you" from "them"
    # at a glance is the whole point of the transcript.
    speaker_you: str = "#9AA4BF"
    speaker_them: str = "#4ADE80"

    # User message bubbles: a neutral raised surface, not a blue slab.
    bubble_user: str = "rgba(255, 255, 255, 0.07)"
    bubble_user_border: str = "rgba(255, 255, 255, 0.13)"

    code_bg: str = "rgba(0, 0, 0, 0.38)"
    code_border: str = "rgba(255, 255, 255, 0.08)"


@dataclass(frozen=True)
class Type:
    ui: str = "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"
    mono: str = "'Cascadia Code', 'JetBrains Mono', Consolas, monospace"
    size_xs: int = 10
    size_sm: int = 11
    size_md: int = 13
    size_lg: int = 15
    size_xl: int = 18


@dataclass(frozen=True)
class Space:
    xs: int = 4
    sm: int = 8
    md: int = 12
    lg: int = 16
    xl: int = 24
    radius_sm: int = 6
    radius_md: int = 10
    radius_lg: int = 14
    radius_pill: int = 999


@dataclass(frozen=True)
class Motion:
    """
    Durations and curves.

    The original animated window height over 300ms with OutCubic, which reads
    as sluggish. Sub-200ms with a decelerating curve feels responsive; the
    spring curve is reserved for the panel, where a little overshoot reads as
    physical rather than mechanical.
    """
    instant: int = 90
    fast: int = 140
    normal: int = 190
    slow: int = 280


PALETTE = Palette()
TYPE = Type()
SPACE = Space()
MOTION = Motion()


def stylesheet(accent: str = PALETTE.accent, font_size: int = TYPE.size_md,
               acrylic: bool = True, opacity: int = 132) -> str:
    """
    The application-wide QSS.

    `acrylic` is not cosmetic here. With the blur on, the compositor darkens
    and diffuses whatever is behind the window, so the panel can sit at a low
    alpha and still read as dark glass. With the blur off there is nothing
    doing that: the raw desktop shows straight through a 0.46-alpha panel and
    averages out to a pale grey slab. So when acrylic is disabled the surfaces
    take on the opacity themselves.
    """
    p, t, s = PALETTE, TYPE, SPACE

    if acrylic:
        surface = p.surface
        surface_raised = p.surface_raised
        input_wrap = p.surface_sunken
    else:
        # Map the opacity setting onto the panel itself, with a floor: below
        # about 0.72 the desktop bleeds through enough to wash the text out.
        alpha = max(0.72, min(0.97, opacity / 255.0 + 0.30))
        r, g, b = 16, 18, 26
        surface = f"rgba({r}, {g}, {b}, {alpha:.3f})"
        surface_raised = (f"rgba({r + 12}, {g + 13}, {b + 17}, "
                          f"{min(0.99, alpha + 0.06):.3f})")
        input_wrap = f"rgba(0, 0, 0, {min(0.55, alpha * 0.35):.3f})"

    return f"""
    QWidget {{
        color: {p.text};
        font-family: {t.ui};
        font-size: {font_size}px;
    }}

    #Root {{ background: transparent; }}

    #Panel {{
        background-color: {surface};
        border: 1px solid {p.border};
        border-radius: {s.radius_lg}px;
    }}

    #CommandBar {{
        background-color: {surface_raised};
        border: 1px solid {p.border};
        border-radius: {s.radius_lg}px;
    }}

    #InputWrap {{
        background-color: {input_wrap};
        border-top: 1px solid {p.border};
        border-bottom-left-radius: {s.radius_lg}px;
        border-bottom-right-radius: {s.radius_lg}px;
    }}

    QPushButton {{
        background-color: transparent;
        border: none;
        border-radius: {s.radius_sm}px;
        color: {p.text_muted};
        padding: 6px 10px;
    }}
    QPushButton:hover {{
        background-color: {p.surface_hover};
        color: {p.text};
    }}
    QPushButton:pressed {{ background-color: {p.surface_active}; }}
    QPushButton:disabled {{ color: {p.text_faint}; }}

    QPushButton#Primary {{
        background-color: {p.surface_active};
        border: 1px solid {p.border_strong};
        color: {p.text};
        font-weight: 600;
    }}
    QPushButton#Primary:hover {{
        background-color: rgba(255, 255, 255, 0.20);
        border-color: {p.text_faint};
    }}
    QPushButton#Primary:disabled {{
        background-color: {p.surface_hover};
        color: {p.text_faint};
    }}

    QPushButton#Danger:hover {{
        background-color: {p.danger_dim};
        color: {p.danger};
    }}

    QPushButton#Chip {{
        background-color: {p.surface_hover};
        border: 1px solid {p.border};
        border-radius: {s.radius_pill}px;
        padding: 5px 12px;
        font-size: {t.size_sm}px;
        color: {p.text_muted};
        text-align: left;
    }}
    QPushButton#Chip:hover {{
        background-color: {p.surface_active};
        color: {p.text};
        border-color: {p.border_strong};
    }}
    QPushButton#Chip:checked {{
        background-color: {p.accent_dim};
        border-color: {accent};
        color: {p.text};
    }}

    QPushButton#Send {{
        background-color: {p.surface_active};
        border: 1px solid {p.border_strong};
        border-radius: {s.radius_md}px;
    }}
    QPushButton#Send:hover {{
        background-color: rgba(255, 255, 255, 0.20);
        border-color: {p.text_faint};
    }}
    QPushButton#Send:disabled {{ background-color: {p.surface_hover}; }}

    QLineEdit, QTextEdit, QPlainTextEdit {{
        background-color: rgba(255, 255, 255, 0.04);
        border: 1px solid {p.border};
        border-radius: {s.radius_md}px;
        padding: 8px 12px;
        selection-background-color: {p.accent_dim};
        selection-color: {p.text};
    }}
    QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus {{
        border-color: {p.border_focus};
        background-color: rgba(255, 255, 255, 0.06);
    }}

    QComboBox {{
        background-color: rgba(255, 255, 255, 0.05);
        border: 1px solid {p.border};
        border-radius: {s.radius_sm}px;
        padding: 6px 10px;
        min-height: 20px;
    }}
    QComboBox:hover {{ border-color: {p.border_strong}; }}
    QComboBox::drop-down {{ border: none; width: 22px; }}
    QComboBox QAbstractItemView {{
        background-color: #1A1D28;
        border: 1px solid {p.border_strong};
        border-radius: {s.radius_sm}px;
        selection-background-color: {p.accent_dim};
        outline: none;
        padding: 4px;
    }}

    QScrollArea {{ background: transparent; border: none; }}
    QScrollArea > QWidget > QWidget {{ background: transparent; }}
    #ScrollBody {{ background: transparent; }}
    QSplitter {{ background: transparent; }}
    QScrollBar:vertical {{
        background: transparent; width: 8px; margin: 2px;
    }}
    QScrollBar::handle:vertical {{
        background: rgba(255, 255, 255, 0.14);
        border-radius: 4px; min-height: 28px;
    }}
    QScrollBar::handle:vertical:hover {{ background: rgba(255,255,255,0.24); }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
    QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}
    QScrollBar:horizontal {{ height: 0px; }}

    QToolTip {{
        background-color: #1A1D28;
        color: {p.text};
        border: 1px solid {p.border_strong};
        border-radius: {s.radius_sm}px;
        padding: 5px 8px;
        font-size: {t.size_sm}px;
    }}

    QMenu {{
        background-color: #1A1D28;
        border: 1px solid {p.border_strong};
        border-radius: {s.radius_md}px;
        padding: 6px;
    }}
    QMenu::item {{
        padding: 7px 26px 7px 12px;
        border-radius: {s.radius_sm}px;
        color: {p.text_muted};
    }}
    QMenu::item:selected {{
        background-color: {p.accent_dim};
        color: {p.text};
    }}
    QMenu::separator {{
        height: 1px;
        background: {p.border};
        margin: 5px 8px;
    }}

    QTabWidget::pane {{ border: none; background: transparent; }}
    QTabBar::tab {{
        background: transparent;
        color: {p.text_faint};
        padding: 7px 14px;
        margin-right: 2px;
        border-radius: {s.radius_sm}px;
        font-size: {t.size_sm}px;
        font-weight: 600;
    }}
    QTabBar::tab:selected {{
        color: {p.text};
        background: {p.surface_hover};
    }}
    QTabBar::tab:hover:!selected {{ color: {p.text_muted}; }}

    QLabel#Heading {{
        font-size: {t.size_lg}px;
        font-weight: 600;
        color: {p.text};
    }}
    QLabel#Subtle {{
        color: {p.text_faint};
        font-size: {t.size_sm}px;
    }}
    QLabel#SectionLabel {{
        color: {p.text_muted};
        font-size: {t.size_xs}px;
        font-weight: 700;
        letter-spacing: 1px;
    }}

    QCheckBox {{ spacing: 8px; color: {p.text_muted}; }}
    QCheckBox::indicator {{
        width: 16px; height: 16px;
        border: 1px solid {p.border_strong};
        border-radius: 4px;
        background: rgba(255,255,255,0.04);
    }}
    QCheckBox::indicator:checked {{
        background: {accent};
        border-color: {accent};
    }}

    QSlider::groove:horizontal {{
        height: 4px; background: {p.surface_active}; border-radius: 2px;
    }}
    QSlider::handle:horizontal {{
        width: 14px; height: 14px; margin: -5px 0;
        background: {p.text}; border-radius: 7px;
    }}
    QSlider::sub-page:horizontal {{ background: {accent}; border-radius: 2px; }}
    """
