"""
Screen capture.

Uses BitBlt against the screen DC rather than PIL's ImageGrab. Three reasons:

  1. Speed. ImageGrab.grab() round-trips through a temporary bitmap and is
     noticeably slow at 4K; BitBlt into a pre-made DIB section is direct.
  2. Multi-monitor. The original called ImageGrab.grab() with no arguments,
     which silently captures only the primary display -- so on a two-monitor
     setup, analysing the screen you were actually looking at was a coin flip.
  3. Self-exclusion. Because the overlay sets WDA_EXCLUDEFROMCAPTURE, it is
     already absent from anything we capture. That is a happy consequence of
     the stealth flag: the AI never sees the HUD in its own screenshot, so it
     never gets confused by its own previous answer.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
from dataclasses import dataclass

from PIL import Image

from .win32 import (
    BI_RGB, BITMAPINFO, CAPTUREBLT, DIB_RGB_COLORS, MONITORINFO,
    MonitorEnumProc, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SRCCOPY, gdi32, last_error, user32,
)

MONITOR_DEFAULTTONEAREST = 0x00000002


@dataclass(frozen=True)
class Monitor:
    index: int
    x: int
    y: int
    width: int
    height: int
    primary: bool = False

    @property
    def rect(self) -> tuple[int, int, int, int]:
        return (self.x, self.y, self.width, self.height)

    def __str__(self) -> str:
        tag = " (primary)" if self.primary else ""
        return f"Display {self.index + 1}: {self.width}x{self.height}{tag}"


def enumerate_monitors() -> list[Monitor]:
    """Every display, in virtual-desktop coordinates (which may be negative)."""
    found: list[Monitor] = []

    def _cb(hmon, hdc, lprect, lparam):
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(MONITORINFO)
        primary = False
        if user32.GetMonitorInfoW(hmon, ctypes.byref(info)):
            primary = bool(info.dwFlags & 1)  # MONITORINFOF_PRIMARY
        r = lprect.contents
        found.append(Monitor(len(found), r.left, r.top,
                             r.right - r.left, r.bottom - r.top, primary))
        return True

    # The callback must stay referenced for the duration of the call, or
    # CPython may collect the thunk mid-enumeration and crash.
    cb = MonitorEnumProc(_cb)
    if not user32.EnumDisplayMonitors(None, None, cb, 0):
        raise OSError(f"EnumDisplayMonitors failed: {last_error()}")
    return found


def virtual_desktop_rect() -> tuple[int, int, int, int]:
    """Bounding box of all displays combined."""
    return (user32.GetSystemMetrics(SM_XVIRTUALSCREEN),
            user32.GetSystemMetrics(SM_YVIRTUALSCREEN),
            user32.GetSystemMetrics(SM_CXVIRTUALSCREEN),
            user32.GetSystemMetrics(SM_CYVIRTUALSCREEN))


def monitor_under_cursor() -> Monitor:
    """
    The display the mouse is on -- the best proxy for "the screen the user
    means" when they hit the capture hotkey.
    """
    pt = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    hmon = user32.MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
    info = MONITORINFO()
    info.cbSize = ctypes.sizeof(MONITORINFO)
    if user32.GetMonitorInfoW(hmon, ctypes.byref(info)):
        r = info.rcMonitor
        for m in enumerate_monitors():
            if m.x == r.left and m.y == r.top:
                return m
    mons = enumerate_monitors()
    return next((m for m in mons if m.primary), mons[0])


def grab(x: int, y: int, width: int, height: int) -> Image.Image:
    """
    BitBlt an arbitrary virtual-desktop rectangle into a PIL image.

    Every GDI object is released in a finally block; leaking DCs here would
    exhaust the desktop heap after a few hundred captures, which is exactly
    the kind of slow failure that only shows up in a long meeting.
    """
    if width <= 0 or height <= 0:
        raise ValueError(f"invalid capture size {width}x{height}")

    screen_dc = user32.GetDC(None)
    if not screen_dc:
        raise OSError(f"GetDC failed: {last_error()}")

    mem_dc = bitmap = old_obj = None
    try:
        mem_dc = gdi32.CreateCompatibleDC(screen_dc)
        if not mem_dc:
            raise OSError(f"CreateCompatibleDC failed: {last_error()}")
        bitmap = gdi32.CreateCompatibleBitmap(screen_dc, width, height)
        if not bitmap:
            raise OSError(f"CreateCompatibleBitmap failed: {last_error()}")
        old_obj = gdi32.SelectObject(mem_dc, bitmap)

        # CAPTUREBLT is needed to include layered windows -- without it,
        # translucent overlays from other apps come out missing.
        if not gdi32.BitBlt(mem_dc, 0, 0, width, height,
                            screen_dc, x, y, SRCCOPY | CAPTUREBLT):
            raise OSError(f"BitBlt failed: {last_error()}")

        info = BITMAPINFO()
        info.bmiHeader.biSize = ctypes.sizeof(info.bmiHeader)
        info.bmiHeader.biWidth = width
        # Negative height requests a top-down DIB. With a positive height GDI
        # returns bottom-up rows and the image arrives vertically mirrored.
        info.bmiHeader.biHeight = -height
        info.bmiHeader.biPlanes = 1
        info.bmiHeader.biBitCount = 32
        info.bmiHeader.biCompression = BI_RGB

        buf = ctypes.create_string_buffer(width * height * 4)
        if not gdi32.GetDIBits(mem_dc, bitmap, 0, height, buf,
                               ctypes.byref(info), DIB_RGB_COLORS):
            raise OSError(f"GetDIBits failed: {last_error()}")

        # GDI hands back BGRA; the alpha byte is undefined for screen content
        # so we drop it rather than let it render as transparent.
        return Image.frombuffer(
            "RGB", (width, height), buf, "raw", "BGRX", 0, 1)
    finally:
        if mem_dc and old_obj:
            gdi32.SelectObject(mem_dc, old_obj)
        if bitmap:
            gdi32.DeleteObject(bitmap)
        if mem_dc:
            gdi32.DeleteDC(mem_dc)
        user32.ReleaseDC(None, screen_dc)


def grab_monitor(monitor: Monitor | None = None) -> Image.Image:
    """Capture one display, defaulting to the one under the cursor."""
    m = monitor or monitor_under_cursor()
    return grab(m.x, m.y, m.width, m.height)


def grab_all_screens() -> Image.Image:
    """Capture the entire virtual desktop across every display."""
    return grab(*virtual_desktop_rect())


def grab_active_window() -> Image.Image:
    """
    Capture just the focused window.

    Because the overlay carries WS_EX_NOACTIVATE, the foreground window is
    still the user's real app even while they are typing at us -- so this
    captures what they are working in, not the HUD.
    """
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return grab_monitor()
    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return grab_monitor()
    w, h = rect.right - rect.left, rect.bottom - rect.top
    if w <= 0 or h <= 0:
        return grab_monitor()
    return grab(rect.left, rect.top, w, h)


def downscale_for_vision(img: Image.Image, max_edge: int = 1568) -> Image.Image:
    """
    Shrink to the longest edge most vision models actually consume.

    A raw 4K screenshot is ~2.5x the tokens of a 1568px one with no accuracy
    gain -- every major provider downsamples server-side anyway. Doing it here
    cuts cost and upload time. LANCZOS keeps small UI text legible, which
    matters because screenshots are mostly text.
    """
    w, h = img.size
    longest = max(w, h)
    if longest <= max_edge:
        return img
    scale = max_edge / longest
    return img.resize((max(1, int(w * scale)), max(1, int(h * scale))),
                      Image.Resampling.LANCZOS)
