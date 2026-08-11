"""
Window treatment: stealth, acrylic, rounded corners, focus behaviour.

The original app called SetWindowDisplayAffinity once inside __init__, against
a window handle that is not yet stable, and never re-applied it. Qt can and
does recreate native handles (on reparenting, on some flag changes), and when
it does, the affinity is silently lost -- the window becomes visible to screen
capture with no error anywhere. `StealthController` instead treats stealth as
an invariant to be re-asserted and verified on every relevant event.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
from dataclasses import dataclass

from .win32 import (
    ACCENT_ENABLE_ACRYLICBLURBEHIND, ACCENT_ENABLE_TRANSPARENTGRADIENT,
    ACCENT_POLICY, DWMSBT_TRANSIENTWINDOW,
    DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_IMMERSIVE_DARK_MODE,
    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND, GWL_EXSTYLE,
    WCA_ACCENT_POLICY, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    WINDOWCOMPOSITIONATTRIBDATA, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT, dwmapi, last_error, user32,
)


@dataclass(frozen=True)
class StealthReport:
    """Outcome of asserting stealth. Surfaced in the UI, never swallowed."""
    hidden_from_capture: bool
    excluded_from_taskbar: bool
    never_takes_focus: bool
    detail: str = ""

    @property
    def fully_stealthed(self) -> bool:
        return (self.hidden_from_capture and self.excluded_from_taskbar
                and self.never_takes_focus)


def _abgr(r: int, g: int, b: int, a: int) -> int:
    """
    ACCENT_POLICY.GradientColor is 0xAABBGGRR -- byte-reversed from the RGBA
    you would write in CSS. Getting this backwards tints the window the wrong
    hue, which is a confusing bug to chase, so it lives in one function.
    """
    return (a << 24) | (b << 16) | (g << 8) | r


class StealthController:
    """
    Owns the native window treatment for one HWND.

    Call `apply()` after the window is first shown, and again from showEvent
    so a recreated handle is re-protected.
    """

    def __init__(self, hwnd: int) -> None:
        self.hwnd = wintypes.HWND(hwnd)
        self._raw = hwnd
        self._enabled = True

    # ---------------------------------------------------------------- stealth
    def set_capture_exclusion(self, enabled: bool) -> bool:
        """
        The core guarantee: WDA_EXCLUDEFROMCAPTURE makes the window render
        normally on the physical display but come out as solid black (or be
        absent entirely) in OBS, Teams, Zoom, Discord and PrintScreen.

        We read the affinity back rather than trusting the return value,
        because on builds below 19041 the OS accepts the call and silently
        downgrades to WDA_MONITOR -- which blanks the window on the real
        screen too, the opposite of what we want.
        """
        want = WDA_EXCLUDEFROMCAPTURE if enabled else WDA_NONE
        if not user32.SetWindowDisplayAffinity(self.hwnd, want):
            return False
        got = wintypes.DWORD()
        if not user32.GetWindowDisplayAffinity(self.hwnd, ctypes.byref(got)):
            return False
        self._enabled = enabled
        return got.value == want

    def verify_capture_exclusion(self) -> bool:
        """Cheap re-check, used by the watchdog after window events."""
        got = wintypes.DWORD()
        if not user32.GetWindowDisplayAffinity(self.hwnd, ctypes.byref(got)):
            return False
        return got.value == WDA_EXCLUDEFROMCAPTURE

    # ------------------------------------------------------------ ex-styles
    def _update_ex_style(self, add: int = 0, remove: int = 0) -> int:
        ex = user32.GetWindowLongW(self.hwnd, GWL_EXSTYLE)
        new = (ex | add) & ~remove
        if new != ex:
            user32.SetWindowLongW(self.hwnd, GWL_EXSTYLE, new)
        return user32.GetWindowLongW(self.hwnd, GWL_EXSTYLE)

    def set_no_activate(self, enabled: bool) -> bool:
        """
        WS_EX_NOACTIVATE: clicking the overlay does not deactivate whatever
        the user was working in. Without this, clicking the HUD during a
        screen share visibly steals focus -- which defeats the whole point.
        Qt has no API for this; it is one SetWindowLongW call here.

        The catch: a window with this flag can never take keyboard focus, so
        typing goes to whatever window IS focused. It therefore has to be
        dropped for as long as the user is deliberately typing at us -- see
        `allow_typing()`.
        """
        ex = self._update_ex_style(
            add=WS_EX_NOACTIVATE if enabled else 0,
            remove=0 if enabled else WS_EX_NOACTIVATE)
        self._no_activate = bool(ex & WS_EX_NOACTIVATE)
        return self._no_activate == enabled

    def allow_typing(self, enabled: bool) -> None:
        """
        Temporarily permit keyboard focus.

        Called when the user clicks into the prompt or presses the focus
        hotkey, and reversed when the prompt loses focus. This is the
        difference between a passive overlay you cannot type into and one that
        stays out of the way until you actually address it.
        """
        self.set_no_activate(not enabled)

    @property
    def no_activate(self) -> bool:
        return getattr(self, "_no_activate", True)

    def set_tool_window(self, enabled: bool) -> bool:
        """WS_EX_TOOLWINDOW removes us from the taskbar and the Alt-Tab list."""
        ex = self._update_ex_style(
            add=WS_EX_TOOLWINDOW if enabled else 0,
            remove=0 if enabled else WS_EX_TOOLWINDOW)
        return bool(ex & WS_EX_TOOLWINDOW) == enabled

    def set_click_through(self, enabled: bool) -> None:
        """
        WS_EX_TRANSPARENT makes mouse input pass straight through to the app
        underneath, so the HUD can sit over a video call without intercepting
        clicks. Toggled, not permanent -- we need input back to type.
        """
        self._update_ex_style(
            add=WS_EX_TRANSPARENT if enabled else 0,
            remove=0 if enabled else WS_EX_TRANSPARENT)

    # -------------------------------------------------------------- cosmetics
    def apply_acrylic(self, tint: tuple[int, int, int] = (14, 16, 22),
                      opacity: int = 168) -> bool:
        """
        Real Windows acrylic: the OS blurs the actual desktop behind the
        window. CSS backdrop-filter cannot do this -- it only blurs content
        inside the page -- which is why the web attempts looked flat.

        opacity is the tint alpha, 0-255. Lower = more of the desktop shows.
        """
        r, g, b = tint
        accent = ACCENT_POLICY(
            AccentState=ACCENT_ENABLE_ACRYLICBLURBEHIND,
            AccentFlags=0x20 | 0x40 | 0x80 | 0x100,  # draw all four borders
            GradientColor=_abgr(r, g, b, opacity),
            AnimationId=0)
        data = WINDOWCOMPOSITIONATTRIBDATA(
            Attribute=WCA_ACCENT_POLICY,
            Data=ctypes.cast(ctypes.byref(accent), ctypes.c_void_p),
            SizeOfData=ctypes.sizeof(accent))
        return bool(user32.SetWindowCompositionAttribute(
            self.hwnd, ctypes.byref(data)))

    def clear_acrylic(self) -> bool:
        """Turn the blur off, leaving a plain translucent window."""
        accent = ACCENT_POLICY(AccentState=0, AccentFlags=0,
                               GradientColor=0, AnimationId=0)
        data = WINDOWCOMPOSITIONATTRIBDATA(
            Attribute=WCA_ACCENT_POLICY,
            Data=ctypes.cast(ctypes.byref(accent), ctypes.c_void_p),
            SizeOfData=ctypes.sizeof(accent))
        return bool(user32.SetWindowCompositionAttribute(
            self.hwnd, ctypes.byref(data)))

    def apply_tint_without_blur(self, tint: tuple[int, int, int],
                                opacity: int) -> bool:
        """
        Honour the opacity setting with the blur switched off.

        Opacity was implemented purely through the acrylic accent policy, so
        turning acrylic off left the slider doing nothing at all.

        The tint is deliberately opaque-ish here. With acrylic on, the blur
        darkens and diffuses whatever is behind the window, and the panel's
        own low-alpha surface reads as glass over it. With no blur there is
        nothing doing that work: the raw desktop shows through the panel and
        averages out to a pale grey slab. So the compositor layer has to
        supply the darkness the blur used to.
        """
        r, g, b = tint
        accent = ACCENT_POLICY(
            AccentState=ACCENT_ENABLE_TRANSPARENTGRADIENT,
            AccentFlags=0x20 | 0x40 | 0x80 | 0x100,
            GradientColor=_abgr(r, g, b, opacity),
            AnimationId=0)
        data = WINDOWCOMPOSITIONATTRIBDATA(
            Attribute=WCA_ACCENT_POLICY,
            Data=ctypes.cast(ctypes.byref(accent), ctypes.c_void_p),
            SizeOfData=ctypes.sizeof(accent))
        return bool(user32.SetWindowCompositionAttribute(
            self.hwnd, ctypes.byref(data)))

    def apply_backdrop(self, acrylic: bool, tint: tuple[int, int, int],
                       opacity: int) -> bool:
        """Apply the backdrop for the current settings, blurred or not."""
        if acrylic:
            # The Win11 system backdrop ignores our tint and opacity, so the
            # accent policy is applied second and wins.
            self.apply_system_backdrop()
            return self.apply_acrylic(tint, opacity)
        return self.apply_tint_without_blur(tint, opacity)

    def apply_system_backdrop(self) -> bool:
        """
        Win11 22H2+ native acrylic backdrop. Better sampled and cheaper than
        the legacy accent policy, but unavailable below 22621, so it is an
        upgrade layered on top rather than a replacement.
        """
        val = ctypes.c_int(DWMSBT_TRANSIENTWINDOW)
        hr = dwmapi.DwmSetWindowAttribute(
            self.hwnd, DWMWA_SYSTEMBACKDROP_TYPE,
            ctypes.byref(val), ctypes.sizeof(val))
        return hr == 0

    def apply_rounded_corners(self) -> bool:
        """Win11 rounded corners, matched to the OS's own radius."""
        val = ctypes.c_int(DWMWCP_ROUND)
        hr = dwmapi.DwmSetWindowAttribute(
            self.hwnd, DWMWA_WINDOW_CORNER_PREFERENCE,
            ctypes.byref(val), ctypes.sizeof(val))
        return hr == 0

    def apply_dark_mode(self) -> bool:
        """Dark scrollbars/menus in any native chrome DWM draws for us."""
        val = ctypes.c_int(1)
        hr = dwmapi.DwmSetWindowAttribute(
            self.hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE,
            ctypes.byref(val), ctypes.sizeof(val))
        return hr == 0

    # ------------------------------------------------------------------ apply
    def apply(self, stealth: bool = True, acrylic: bool = True,
              tint: tuple[int, int, int] = (14, 16, 22),
              opacity: int = 168,
              no_activate: bool = True) -> StealthReport:
        """
        Assert the full window treatment. Idempotent, and safe to call on
        every showEvent -- which is exactly how we defend against Qt
        recreating the handle and dropping the affinity.

        `no_activate` is a parameter rather than a constant because the flag
        must stay off while the user is typing; re-applying it unconditionally
        here would silently kill keyboard input mid-sentence.
        """
        self.apply_dark_mode()
        self.apply_rounded_corners()

        if stealth:
            # When stealth is active, DWM accent policies (acrylic blur,
            # transparent gradient) create a compositor-owned layer that the OS
            # renders as a solid black rectangle when the window is excluded
            # from capture. Clearing the accent policy leaves the window purely
            # transparent via Qt's WA_TranslucentBackground and CSS rgba()
            # backgrounds, which WDA_EXCLUDEFROMCAPTURE can make fully
            # invisible -- exactly how the original version worked.
            self.clear_acrylic()
        elif acrylic:
            # The Win11 system backdrop ignores our tint and opacity, so it
            # is only useful when the user wants the stock look. The accent
            # policy is what actually honours the opacity slider, so it is
            # applied second and wins.
            self.apply_system_backdrop()
            self.apply_acrylic(tint, opacity)
        else:
            # Still honour opacity -- just without the blur.
            self.apply_tint_without_blur(tint, opacity)

        hidden = self.set_capture_exclusion(stealth) if stealth else False
        no_taskbar = self.set_tool_window(True)
        no_focus = self.set_no_activate(no_activate)

        problems = []
        if stealth and not hidden:
            problems.append(
                "screen-capture exclusion refused by the OS "
                f"(needs Windows 10 build 19041+); {last_error()}")
        if not no_taskbar:
            problems.append("could not leave the taskbar")
        if not no_focus:
            problems.append("could not suppress focus stealing")

        return StealthReport(
            hidden_from_capture=hidden,
            excluded_from_taskbar=no_taskbar,
            never_takes_focus=no_focus,
            detail="; ".join(problems))

