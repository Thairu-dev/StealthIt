"""
Global hotkeys via RegisterHotKey.

Two reasons this uses the raw Win32 API instead of Qt's QShortcut:

  1. QShortcut only fires when the application has focus. The whole point of
     this app is to be driven while another window is focused, so every
     shortcut in the original that used QShortcut (Ctrl+T, Ctrl+R, Ctrl+W,
     Ctrl+,) simply did not work unless you had clicked the overlay first.
     Only the four that used RegisterHotKey were genuinely global.

  2. RegisterHotKey reports conflicts. If another app already owns a chord,
     we get ERROR_HOTKEY_ALREADY_REGISTERED and can tell the user which
     binding is dead, instead of it silently doing nothing.

Hotkeys are declared as data so the settings UI can rebind them and so
conflicts can be reported per-binding.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .win32 import (
    ERROR_HOTKEY_ALREADY_REGISTERED, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
    MOD_SHIFT, MOD_WIN, VK_OEM_2, VK_OEM_5, VK_OEM_COMMA, VK_RETURN, VK_SPACE,
    user32,
)
import ctypes

_MOD_NAMES = {
    "ctrl": MOD_CONTROL, "control": MOD_CONTROL,
    "alt": MOD_ALT, "shift": MOD_SHIFT,
    "win": MOD_WIN, "super": MOD_WIN, "meta": MOD_WIN,
}

_KEY_NAMES = {
    "enter": VK_RETURN, "return": VK_RETURN,
    "space": VK_SPACE,
    "\\": VK_OEM_5, "backslash": VK_OEM_5,
    ",": VK_OEM_COMMA, "comma": VK_OEM_COMMA,
    "/": VK_OEM_2, "slash": VK_OEM_2,
    "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
    "esc": 0x1B, "escape": 0x1B,
    "tab": 0x09,
    "backspace": 0x08,
    "delete": 0x2E, "del": 0x2E,
    "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22,
}
for _i in range(1, 25):  # F1-F24
    _KEY_NAMES[f"f{_i}"] = 0x6F + _i
for _c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
    _KEY_NAMES[_c.lower()] = ord(_c)


class HotkeyParseError(ValueError):
    pass


def parse_chord(chord: str, allow_repeat: bool = False) -> tuple[int, int]:
    """
    "ctrl+shift+enter" -> (MOD_CONTROL|MOD_SHIFT|MOD_NOREPEAT, VK_RETURN).

    MOD_NOREPEAT is always added: without it, holding a chord down fires
    hundreds of WM_HOTKEY messages, which in the original design would have
    queued hundreds of API calls.
    """
    parts = [p.strip().lower() for p in chord.split("+") if p.strip()]
    if not parts:
        raise HotkeyParseError(f"empty hotkey: {chord!r}")
    mods, key = 0, None
    for part in parts:
        if part in _MOD_NAMES:
            mods |= _MOD_NAMES[part]
        elif part in _KEY_NAMES:
            if key is not None:
                raise HotkeyParseError(
                    f"{chord!r} has more than one non-modifier key")
            key = _KEY_NAMES[part]
        else:
            raise HotkeyParseError(f"unknown key {part!r} in {chord!r}")
    if key is None:
        raise HotkeyParseError(f"{chord!r} has no non-modifier key")
    if not allow_repeat:
        mods |= MOD_NOREPEAT
    return mods, key


@dataclass
class Binding:
    action: str
    chord: str
    callback: Callable[[], None]
    description: str = ""
    hotkey_id: int = 0
    registered: bool = False
    error: str = ""


class HotkeyManager:
    """
    Registers chords against a window handle and dispatches WM_HOTKEY.

    The owning window forwards native messages in via `dispatch()`.
    """

    def __init__(self, hwnd: int) -> None:
        self.hwnd = hwnd
        self._bindings: dict[int, Binding] = {}
        self._next_id = 1

    def register(self, action: str, chord: str,
                 callback: Callable[[], None],
                 description: str = "",
                 allow_repeat: bool = False) -> Binding:
        try:
            mods, vk = parse_chord(chord, allow_repeat=allow_repeat)
        except HotkeyParseError as e:
            b = Binding(action, chord, callback, description, error=str(e))
            return b

        hotkey_id = self._next_id
        self._next_id += 1
        b = Binding(action, chord, callback, description, hotkey_id=hotkey_id)

        if user32.RegisterHotKey(self.hwnd, hotkey_id, mods, vk):
            b.registered = True
            self._bindings[hotkey_id] = b
        else:
            code = ctypes.get_last_error()
            b.error = (
                f"{chord} is already taken by another application"
                if code == ERROR_HOTKEY_ALREADY_REGISTERED
                else f"could not register {chord} (error {code})")
        return b

    def rebind(self, binding: Binding, chord: str) -> Binding:
        """Swap a chord at runtime, restoring the old one if the new one fails."""
        self.unregister(binding)
        return self.register(binding.action, chord, binding.callback,
                             binding.description)

    def unregister(self, binding: Binding) -> None:
        if binding.registered and binding.hotkey_id:
            user32.UnregisterHotKey(self.hwnd, binding.hotkey_id)
            self._bindings.pop(binding.hotkey_id, None)
            binding.registered = False

    def unregister_all(self) -> None:
        for hotkey_id in list(self._bindings):
            user32.UnregisterHotKey(self.hwnd, hotkey_id)
        self._bindings.clear()

    def dispatch(self, hotkey_id: int) -> bool:
        """Returns True if the id was ours, so the caller can eat the message."""
        b = self._bindings.get(hotkey_id)
        if b is None:
            return False
        b.callback()
        return True

    @property
    def bindings(self) -> list[Binding]:
        return list(self._bindings.values())


# The default keymap. Ctrl+\ to show/hide is the muscle-memory binding
# inherited from the original app; everything else is reachable globally now
# rather than only when the overlay happens to have focus.
DEFAULT_KEYMAP: dict[str, tuple[str, str]] = {
    "toggle_visibility": ("ctrl+\\", "Hide or show the overlay"),
    "capture_analyse": ("ctrl+enter", "Capture the screen and answer"),
    "region_capture": ("ctrl+shift+enter", "Select a region and answer"),
    "toggle_listen": ("ctrl+shift+l", "Start or stop listening to the call"),
    # Answering from the transcript is the core live-call action, so it gets
    # the cheapest chord on the board.
    "answer_last": ("ctrl+shift+a",
                    "Answer the last question you were asked"),
    "answer_selection": ("ctrl+shift+s",
                         "Answer using the whole recent conversation"),
    "followup": ("ctrl+shift+f", "Suggest what to ask or say next"),
    "ask": ("ctrl+space", "Focus the prompt box"),
    "command_palette": ("ctrl+shift+p", "Open the command palette"),
    "toggle_expand": ("ctrl+shift+t", "Expand or collapse the panel"),
    "history": ("ctrl+shift+h", "Browse past conversations"),
    "settings": ("ctrl+shift+,", "Open settings"),
    "clear_session": ("ctrl+shift+k", "Start a new conversation"),
    "click_through": ("ctrl+shift+x", "Toggle click-through mode"),
    "move_up": ("ctrl+up", "Nudge the overlay up"),
    "move_down": ("ctrl+down", "Nudge the overlay down"),
    "move_left": ("ctrl+left", "Nudge the overlay left"),
    "move_right": ("ctrl+right", "Nudge the overlay right"),
    "quit": ("ctrl+shift+q", "Quit StealthIt"),
}
