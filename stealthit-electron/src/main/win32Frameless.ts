import type { BrowserWindow } from 'electron';

// Win32 DWM attributes (safe, non-reentrant, preserves full per-pixel alpha compositing)
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_DONOTROUND = 1;
const DWMWA_BORDER_COLOR = 34;
const DWMWA_CAPTION_COLOR = 35;
const DWMWA_SYSTEMBACKDROP_TYPE = 38;
const DWMSBT_NONE = 1;
const DWMWA_COLOR_NONE = 0xfffffffe;

interface DwmApi {
  DwmSetWindowAttribute: (
    hwnd: number | bigint,
    dwAttribute: number,
    pvAttribute: Buffer,
    cbAttribute: number
  ) => number;
}

let cachedApi: DwmApi | null | undefined;

function loadDwmApi(): DwmApi | null {
  if (process.platform !== 'win32') return null;
  if (cachedApi !== undefined) return cachedApi;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as {
      load: (lib: string) => { func: (sig: string) => (...args: unknown[]) => unknown };
    };
    const dwmapi = koffi.load('dwmapi.dll');

    cachedApi = {
      DwmSetWindowAttribute: dwmapi.func(
        'long __stdcall DwmSetWindowAttribute(uintptr hwnd, uint dwAttribute, void *pvAttribute, uint cbAttribute)'
      ) as DwmApi['DwmSetWindowAttribute'],
    };
    return cachedApi;
  } catch (err) {
    console.warn('[StealthIt] Win32 DWM helper unavailable:', err);
    cachedApi = null;
    return null;
  }
}

function readHwnd(win: BrowserWindow): bigint | number | null {
  const buf = win.getNativeWindowHandle();
  if (buf.length >= 8) {
    return buf.readBigUInt64LE(0);
  }
  if (buf.length >= 4) {
    return buf.readUInt32LE(0);
  }
  return null;
}

function setDwmUint32(api: DwmApi, hwnd: bigint | number, attr: number, value: number): void {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  api.DwmSetWindowAttribute(hwnd, attr, buf, 4);
}

/**
 * Clears Windows 11 DWM backdrop, native corners, border color, and caption
 * color on a transparent frameless Electron BrowserWindow while preserving
 * full per-pixel alpha compositing (no faint wrapping rectangle).
 */
export function enforceTrueFramelessWin32(win: BrowserWindow): void {
  if (process.platform !== 'win32' || win.isDestroyed()) return;
  const api = loadDwmApi();
  if (!api) return;

  try {
    const hwnd = readHwnd(win);
    if (hwnd === null || hwnd === 0 || hwnd === 0n) return;

    setDwmUint32(api, hwnd, DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_NONE);
    setDwmUint32(api, hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND);
    setDwmUint32(api, hwnd, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE);
    setDwmUint32(api, hwnd, DWMWA_CAPTION_COLOR, DWMWA_COLOR_NONE);
  } catch (err) {
    console.warn('[StealthIt] Failed to enforce Win32 DWM attributes:', err);
  }
}
