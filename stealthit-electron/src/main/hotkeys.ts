import { globalShortcut } from 'electron';
import type { WindowManager } from './windows';

const MOVE_STEP = 40;

/**
 * Ctrl+Arrows is the standard "jump word" shortcut in every text field and editor.
 * To avoid breaking that system-wide, the move keys are only registered while the
 * HUD is visible, and are released again as soon as it's hidden (Ctrl+\).
 */
const MOVE_BINDINGS: Array<{ accelerator: string; dx: number; dy: number }> = [
  { accelerator: 'CommandOrControl+Up', dx: 0, dy: -MOVE_STEP },
  { accelerator: 'CommandOrControl+Down', dx: 0, dy: MOVE_STEP },
  { accelerator: 'CommandOrControl+Left', dx: -MOVE_STEP, dy: 0 },
  { accelerator: 'CommandOrControl+Right', dx: MOVE_STEP, dy: 0 },
];

let moveKeysActive = false;

function tryRegister(accelerator: string, handler: () => void): boolean {
  try {
    const ok = globalShortcut.register(accelerator, handler);
    if (!ok) {
      console.warn(`[StealthIt] Hotkey ${accelerator} is already owned by another app.`);
    }
    return ok;
  } catch (err) {
    console.warn(`[StealthIt] Failed to register ${accelerator}:`, err);
    return false;
  }
}

export function setMoveHotkeysEnabled(windows: WindowManager, enabled: boolean): void {
  if (enabled === moveKeysActive) return;

  if (enabled) {
    for (const { accelerator, dx, dy } of MOVE_BINDINGS) {
      tryRegister(accelerator, () => windows.moveHud(dx, dy));
    }
  } else {
    for (const { accelerator } of MOVE_BINDINGS) {
      if (globalShortcut.isRegistered(accelerator)) {
        globalShortcut.unregister(accelerator);
      }
    }
  }
  moveKeysActive = enabled;
}

export function registerGlobalHotkeys(windows: WindowManager): void {
  globalShortcut.unregisterAll();
  moveKeysActive = false;

  // Always-on shortcuts (work even while the HUD is hidden)
  tryRegister('CommandOrControl+\\', () => {
    windows.toggleVisibility();
  });

  tryRegister('CommandOrControl+Shift+E', () => {
    windows.showHud(true);
    windows.sendHotkeyToHud('toggle-expand');
  });

  tryRegister('CommandOrControl+Enter', () => {
    // Do not steal focus so open browser dropdowns/menus stay open during screen capture
    windows.showHud(false);
    windows.sendHotkeyToHud('ask-screen');
  });

  tryRegister('CommandOrControl+Shift+Enter', () => {
    // Do not steal focus from the meeting/IDE window when triggering live assist
    windows.showHud(false);
    windows.sendHotkeyToHud('ask-assist');
  });

  tryRegister('CommandOrControl+Shift+Space', () => {
    windows.showHud(false);
    windows.sendHotkeyToHud('toggle-listen');
  });

  tryRegister('CommandOrControl+Shift+T', () => {
    windows.toggleClickThrough();
  });

  tryRegister('CommandOrControl+Shift+D', () => {
    windows.toggleDashboard();
  });

  tryRegister('CommandOrControl+Shift+Backspace', () => {
    windows.sendHotkeyToHud('panic-clear');
  });

  // Quit completely — global so it works even with the tray icon hidden
  tryRegister('CommandOrControl+Shift+Q', () => {
    windows.quit();
  });

  // Move keys follow HUD visibility
  windows.onHudVisibilityChange((visible) => {
    setMoveHotkeysEnabled(windows, visible);
  });
  setMoveHotkeysEnabled(windows, windows.getStealthStatus().visible);
}

export function unregisterGlobalHotkeys(): void {
  globalShortcut.unregisterAll();
  moveKeysActive = false;
}
