import { app, BrowserWindow, Menu, nativeImage, screen, shell, Tray } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { deflateSync } from 'zlib';
import type { StealthSettings, StealthStatus } from '@shared/types';
import type { LocalStore } from './storage';
import { enforceTrueFramelessWin32 } from './win32Frameless';

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function createTrayPngIcon(): Electron.NativeImage {
  const size = 32;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const distCenter = Math.hypot(x - cx, y - cy);

      // Rounded square SDF (half-size 13, corner radius 6)
      const qx = Math.max(dx - 7, 0);
      const qy = Math.max(dy - 7, 0);
      const sdf = Math.hypot(qx, qy) - 6.2;

      if (sdf <= 0) {
        if (distCenter <= 4.8) {
          // Cobalt center dot (#4f8cff)
          raw[px] = 79;
          raw[px + 1] = 140;
          raw[px + 2] = 255;
          raw[px + 3] = 255;
        } else if (sdf >= -2.1) {
          // Crisp cobalt rim (#4f8cff)
          raw[px] = 79;
          raw[px + 1] = 140;
          raw[px + 2] = 255;
          raw[px + 3] = 255;
        } else {
          // Deep slate fill (#191c24)
          raw[px] = 25;
          raw[px + 1] = 28;
          raw[px + 2] = 36;
          raw[px + 3] = 255;
        }
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

  return nativeImage.createFromBuffer(png);
}

function loadBrandIcon(size?: number): Electron.NativeImage {
  const candidates = [
    join(app.getAppPath(), 'build/icon.png'),
    join(__dirname, '../../build/icon.png'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        return size ? img.resize({ width: size, height: size, quality: 'best' }) : img;
      }
    }
  }
  return createTrayPngIcon();
}

const HUD_DEFAULT_WIDTH = 680;
const HUD_COLLAPSED_HEIGHT = 64;
const HUD_TOP_MARGIN = 18;

export class WindowManager {
  public hud: BrowserWindow | null = null;
  public dashboard: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private isQuitting = false;
  private clickThrough = false;
  private contentProtectionActive = true;
  private readonly store: LocalStore;

  constructor(store: LocalStore) {
    this.store = store;
    const stealth = store.getSettings().stealth;
    this.contentProtectionActive = stealth.contentProtection;
    this.clickThrough = stealth.clickThrough;
  }

  public setQuitting(quitting: boolean): void {
    this.isQuitting = quitting;
  }

  /** Fully terminates StealthIt (bypasses hide-on-close behaviour). */
  public quit(): void {
    this.isQuitting = true;
    app.quit();
  }

  private visibilityListener: ((visible: boolean) => void) | null = null;
  private lastReportedVisible: boolean | null = null;

  /** Notified whenever the HUD transitions between shown and hidden. */
  public onHudVisibilityChange(listener: (visible: boolean) => void): void {
    this.visibilityListener = listener;
  }

  /**
   * Window-local shortcuts that only fire while a StealthIt window has focus,
   * so they never hijack the same keys in other apps.
   */
  private attachLocalShortcuts(win: BrowserWindow): void {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const mod = input.control || input.meta;
      if (!mod || input.alt) return;
      const key = input.key.toLowerCase();

      // Ctrl+Q — quit completely from a focused StealthIt window
      if (key === 'q' && !input.shift) {
        event.preventDefault();
        this.quit();
      }
    });

    // Guard against in-app navigation or stray Electron popups from clicked links
    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
          void shell.openExternal(parsed.toString());
        }
      } catch {
        // ignore invalid URLs
      }
      return { action: 'deny' };
    });

    win.webContents.on('will-navigate', (event, url) => {
      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      const isAppUrl =
        (devUrl && url.startsWith(devUrl)) || url.startsWith('file://');
      if (!isAppUrl) {
        event.preventDefault();
      }
    });
  }

  public createWindows(): void {
    this.createHudWindow();
    this.createDashboardWindow();
    this.syncTray();

    screen.on('display-metrics-changed', () => {
      this.reassertStealthAll();
    });
  }

  private getPreloadPath(): string {
    return join(__dirname, '../preload/index.js');
  }

  private loadRendererPage(win: BrowserWindow, page: 'hud' | 'dashboard'): void {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl) {
      void win.loadURL(`${devUrl}/${page}.html`);
    } else {
      void win.loadFile(join(__dirname, `../renderer/${page}.html`));
    }
  }

  private applyStealthInvariants(win: BrowserWindow, isHud: boolean): void {
    if (win.isDestroyed()) return;
    win.setContentProtection(this.contentProtectionActive);
    if (isHud) {
      enforceTrueFramelessWin32(win);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  }

  public reassertStealthAll(): void {
    if (this.hud && !this.hud.isDestroyed()) {
      this.applyStealthInvariants(this.hud, true);
    }
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.applyStealthInvariants(this.dashboard, false);
    }
    this.broadcastStealthStatus();
  }

  private createHudWindow(): void {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x: workX, y: workY, width: workWidth } = primaryDisplay.workArea;
    const initialX = Math.round(workX + (workWidth - HUD_DEFAULT_WIDTH) / 2);
    const initialY = workY + HUD_TOP_MARGIN;

    const hud = new BrowserWindow({
      x: initialX,
      y: initialY,
      width: HUD_DEFAULT_WIDTH,
      height: HUD_COLLAPSED_HEIGHT,
      title: '',
      type: 'toolbar',
      frame: false,
      thickFrame: false,
      roundedCorners: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.hud = hud;
    hud.setTitle('');
    hud.on('page-title-updated', (e) => {
      e.preventDefault();
    });
    this.applyStealthInvariants(hud, true);

    if (this.clickThrough) {
      hud.setIgnoreMouseEvents(true, { forward: true });
    }

    hud.on('ready-to-show', () => {
      this.applyStealthInvariants(hud, true);
      hud.show();
      this.broadcastStealthStatus();
    });

    // Keep visibility-dependent state (e.g. Ctrl+Arrow move keys) in sync on every path
    hud.on('show', () => {
      enforceTrueFramelessWin32(hud);
      this.broadcastStealthStatus();
    });
    hud.on('hide', () => this.broadcastStealthStatus());

    hud.on('blur', () => {
      const cfg = this.store.getSettings().stealth;
      if (cfg.autoHideOnBlur && hud.isVisible()) {
        hud.hide();
        this.broadcastStealthStatus();
      }
    });

    hud.on('close', (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        if (!hud.isDestroyed()) {
          hud.hide();
          this.broadcastStealthStatus();
        }
      }
    });

    hud.on('closed', () => {
      this.hud = null;
    });

    this.attachLocalShortcuts(hud);
    this.loadRendererPage(hud, 'hud');
  }

  private createDashboardWindow(): void {
    const dashboard = new BrowserWindow({
      width: 980,
      height: 680,
      minWidth: 820,
      minHeight: 560,
      frame: false,
      transparent: false,
      skipTaskbar: true,
      show: false,
      center: true,
      icon: loadBrandIcon(),
      backgroundColor: '#0b0d12',
      webPreferences: {
        preload: this.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.dashboard = dashboard;
    this.applyStealthInvariants(dashboard, false);

    const reassertDashboard = (): void => this.applyStealthInvariants(dashboard, false);
    dashboard.on('show', reassertDashboard);
    dashboard.on('restore', reassertDashboard);
    dashboard.on('focus', reassertDashboard);
    dashboard.on('maximize', () => {
      reassertDashboard();
      if (!dashboard.isDestroyed()) {
        dashboard.webContents.send('dashboard:maximized', true);
      }
    });
    dashboard.on('unmaximize', () => {
      reassertDashboard();
      if (!dashboard.isDestroyed()) {
        dashboard.webContents.send('dashboard:maximized', false);
      }
    });

    dashboard.on('close', (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        dashboard.hide();
      }
    });

    this.attachLocalShortcuts(dashboard);
    this.loadRendererPage(dashboard, 'dashboard');
  }

  public syncStealthSettings(stealth: StealthSettings): void {
    this.contentProtectionActive = stealth.contentProtection;
    this.clickThrough = stealth.clickThrough;

    if (this.hud && !this.hud.isDestroyed()) {
      this.applyStealthInvariants(this.hud, true);
      this.hud.setIgnoreMouseEvents(this.clickThrough, { forward: true });
    }
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.applyStealthInvariants(this.dashboard, false);
    }

    this.syncTray();
    this.broadcastStealthStatus();
  }

  private syncTray(): void {
    const hideTray = this.store.getSettings().stealth.hideTrayIcon;
    if (hideTray) {
      if (this.tray) {
        this.tray.destroy();
        this.tray = null;
      }
      return;
    }

    if (this.tray) return;

    const icon = loadBrandIcon(32);

    this.tray = new Tray(icon);
    this.tray.setToolTip('StealthIt — Invisible AI Copilot');
    this.tray.on('click', () => {
      this.toggleVisibility();
    });
    this.rebuildTrayMenu();
  }

  private rebuildTrayMenu(): void {
    if (!this.tray) return;
    const menu = Menu.buildFromTemplate([
      {
        label: 'Show / Hide HUD (Ctrl+\\)',
        click: () => this.toggleVisibility(),
      },
      {
        label: this.clickThrough ? 'Disable Ghost Click-Through (Ctrl+Shift+T)' : 'Enable Ghost Click-Through (Ctrl+Shift+T)',
        click: () => this.toggleClickThrough(),
      },
      {
        label: 'Open Stealth Dashboard (Ctrl+Shift+D)',
        click: () => this.openDashboard(),
      },
      {
        label: 'Reset HUD Position',
        click: () => {
          this.showHud(false);
          this.recenterHud();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit StealthIt (Ctrl+Shift+Q)',
        click: () => this.quit(),
      },
    ]);
    this.tray.setContextMenu(menu);
  }

  public setHudSize(width: number, height: number): void {
    if (!this.hud || this.hud.isDestroyed()) return;
    const bounds = this.hud.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const work = display.workArea;
    const maxHeight = Math.max(320, work.height - 16);
    const clampedHeight = Math.min(maxHeight, Math.max(52, Math.round(height)));
    const clampedWidth = Math.min(work.width - 24, Math.max(360, Math.round(width)));

    // Keep HUD horizontally centered around its current center when resizing width
    const centerX = bounds.x + bounds.width / 2;
    const nextX = Math.max(
      work.x + 8,
      Math.min(work.x + work.width - clampedWidth - 8, Math.round(centerX - clampedWidth / 2))
    );

    // Keep bottom edge inside the screen work area when expanding tall
    const maxY = Math.max(work.y + 8, work.y + work.height - clampedHeight - 8);
    const nextY = Math.min(bounds.y, maxY);

    if (
      bounds.x === nextX &&
      bounds.y === nextY &&
      bounds.width === clampedWidth &&
      bounds.height === clampedHeight
    ) {
      return;
    }

    this.hud.setBounds({
      x: nextX,
      y: nextY,
      width: clampedWidth,
      height: clampedHeight,
    });
  }

  public setHudHeight(height: number): void {
    if (!this.hud || this.hud.isDestroyed()) return;
    const { width } = this.hud.getBounds();
    this.setHudSize(width, height);
  }

  public setIgnoreMouseEvents(ignore: boolean): void {
    if (!this.hud || this.hud.isDestroyed()) return;
    if (this.clickThrough) {
      this.hud.setIgnoreMouseEvents(true, { forward: true });
      return;
    }
    this.hud.setIgnoreMouseEvents(ignore, { forward: true });
  }

  public toggleClickThrough(): boolean {
    this.clickThrough = !this.clickThrough;
    this.store.updateSettings({
      stealth: {
        ...this.store.getSettings().stealth,
        clickThrough: this.clickThrough,
      },
    });
    if (this.hud && !this.hud.isDestroyed()) {
      this.hud.setIgnoreMouseEvents(this.clickThrough, { forward: true });
    }
    this.rebuildTrayMenu();
    this.broadcastStealthStatus();
    return this.clickThrough;
  }

  public toggleVisibility(): boolean {
    if (!this.hud || this.hud.isDestroyed()) return false;
    if (this.hud.isVisible()) {
      this.hud.hide();
      this.broadcastStealthStatus();
      return false;
    }
    this.applyStealthInvariants(this.hud, true);
    // Reveal without stealing focus so dropdowns/menus in the active app stay open
    this.hud.showInactive();
    this.broadcastStealthStatus();
    return true;
  }

  public showHud(focus = true): void {
    if (!this.hud || this.hud.isDestroyed()) return;
    this.applyStealthInvariants(this.hud, true);
    if (!this.hud.isVisible()) {
      if (focus && !this.clickThrough) {
        this.hud.show();
      } else {
        // showInactive() reveals the stealth HUD without stealing focus from Zoom/Meet/IDE
        this.hud.showInactive();
      }
    }
    if (focus && !this.clickThrough) {
      this.hud.focus();
    }
    this.broadcastStealthStatus();
  }

  public moveHud(dx: number, dy: number): void {
    if (!this.hud || this.hud.isDestroyed()) return;
    const bounds = this.hud.getBounds();

    // Resolve the display the HUD is heading towards (not just the one it's on),
    // so repeated nudges carry it smoothly across multi-monitor setups.
    const target = {
      x: Math.round(bounds.x + bounds.width / 2 + dx),
      y: Math.round(bounds.y + 28 + dy),
    };
    const work = screen.getDisplayNearestPoint(target).workArea;

    const minVisible = 56; // keep the pill bar grabbable
    const nextX = Math.max(work.x, Math.min(work.x + work.width - bounds.width, bounds.x + dx));
    const nextY = Math.max(work.y, Math.min(work.y + work.height - minVisible, bounds.y + dy));
    this.hud.setPosition(Math.round(nextX), Math.round(nextY));
  }

  /** Snap the HUD back to its default top-center spot on the display under the cursor. */
  public recenterHud(): void {
    if (!this.hud || this.hud.isDestroyed()) return;
    const bounds = this.hud.getBounds();
    const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    this.hud.setPosition(
      Math.round(work.x + (work.width - bounds.width) / 2),
      work.y + HUD_TOP_MARGIN
    );
  }

  public openDashboard(tab?: string): void {
    if (!this.dashboard || this.dashboard.isDestroyed()) {
      this.createDashboardWindow();
    }
    if (!this.dashboard) return;
    if (this.dashboard.isMinimized()) {
      this.dashboard.restore();
    }
    this.applyStealthInvariants(this.dashboard, false);
    this.dashboard.show();
    this.dashboard.focus();
    if (tab) {
      this.dashboard.webContents.send('dashboard:tab', tab);
    }
  }

  public toggleDashboard(): void {
    if (!this.dashboard || this.dashboard.isDestroyed()) {
      this.openDashboard();
      return;
    }
    if (this.dashboard.isVisible()) {
      this.dashboard.hide();
    } else {
      this.openDashboard();
    }
  }

  public closeDashboard(): void {
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.dashboard.hide();
    }
  }

  public minimizeDashboard(): void {
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      // Because the stealth dashboard uses skipTaskbar, hiding avoids Windows'
      // floating bottom-left minimized stub and reopens cleanly via Ctrl+Shift+D.
      this.dashboard.hide();
    }
  }

  public toggleMaximizeDashboard(): boolean {
    if (!this.dashboard || this.dashboard.isDestroyed()) return false;
    if (this.dashboard.isMaximized()) {
      this.dashboard.unmaximize();
      return false;
    }
    this.dashboard.maximize();
    return true;
  }

  /**
   * Ensures StealthIt's own HUD and Dashboard windows are excluded from desktop
   * screenshots even when the user has Stealth Mode turned off, so the vision
   * model never reads previous answers off the HUD itself.
   */
  public async withSelfExcludedFromCapture<T>(fn: () => Promise<T>): Promise<T> {
    if (this.contentProtectionActive) {
      return fn();
    }
    const targets = [this.hud, this.dashboard].filter(
      (w): w is BrowserWindow => Boolean(w && !w.isDestroyed())
    );
    for (const w of targets) {
      w.setContentProtection(true);
    }
    // Give DWM one frame (~35ms) to apply WDA_EXCLUDEFROMCAPTURE before grabbing the screen
    await new Promise((resolve) => setTimeout(resolve, 35));
    try {
      return await fn();
    } finally {
      for (const w of targets) {
        if (!w.isDestroyed()) {
          w.setContentProtection(this.contentProtectionActive);
        }
      }
    }
  }

  public getStealthStatus(): StealthStatus {
    const settings = this.store.getSettings();
    return {
      contentProtectionActive: this.contentProtectionActive,
      clickThrough: this.clickThrough,
      visible: Boolean(this.hud && !this.hud.isDestroyed() && this.hud.isVisible()),
      opacity: settings.stealth.opacity,
      platform: process.platform,
      encryptionAvailable: this.store.isEncryptionAvailable(),
    };
  }

  public broadcastStealthStatus(): void {
    const status = this.getStealthStatus();
    for (const win of [this.hud, this.dashboard]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('stealth:status', status);
      }
    }
    if (this.visibilityListener && status.visible !== this.lastReportedVisible) {
      this.lastReportedVisible = status.visible;
      this.visibilityListener(status.visible);
    }
  }

  public broadcastSettings(): void {
    const settings = this.store.getSettings();
    for (const win of [this.hud, this.dashboard]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('settings:changed', settings);
      }
    }
  }

  public sendHotkeyToHud(action: string): void {
    if (this.hud && !this.hud.isDestroyed()) {
      this.hud.webContents.send('hotkey:action', { action });
    }
  }
}
