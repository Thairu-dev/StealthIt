import { BrowserWindow, desktopCapturer, screen, type Display, type NativeImage } from 'electron';
import type { CaptureRegionBounds, CaptureResult } from '@shared/types';

const MAX_OUTPUT_WIDTH = 1920;

async function grabDisplay(display: Display, maxWidth: number): Promise<{ image: NativeImage; label: string }> {
  const scale = display.scaleFactor || 1;
  const rawWidth = Math.round(display.size.width * scale);
  const rawHeight = Math.round(display.size.height * scale);
  const ratio = rawWidth > maxWidth ? maxWidth / rawWidth : 1;
  const targetWidth = Math.max(640, Math.round(rawWidth * ratio));
  const targetHeight = Math.max(360, Math.round(rawHeight * ratio));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetWidth, height: targetHeight },
  });
  if (sources.length === 0) {
    throw new Error('No display sources available for screen capture.');
  }
  const matched = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  return { image: matched.thumbnail, label: matched.name || 'Primary Display' };
}

function toResult(image: NativeImage, label: string): CaptureResult {
  const size = image.getSize();
  return {
    dataUrl: `data:image/jpeg;base64,${image.toJPEG(86).toString('base64')}`,
    width: size.width,
    height: size.height,
    displayLabel: label,
  };
}

function activeDisplay(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/**
 * Instantly captures either the full active display or, when a saved
 * CaptureRegionBounds is provided, crops strictly to that saved region.
 */
export async function captureActiveScreen(
  region?: CaptureRegionBounds | null
): Promise<CaptureResult> {
  if (!region) {
    const { image, label } = await grabDisplay(activeDisplay(), MAX_OUTPUT_WIDTH);
    return toResult(image, label);
  }

  const allDisplays = screen.getAllDisplays();
  const targetDisplay =
    allDisplays.find((d) => String(d.id) === region.displayId) ?? activeDisplay();
  const scale = targetDisplay.scaleFactor || 1;
  const { image, label } = await grabDisplay(
    targetDisplay,
    Math.round(targetDisplay.size.width * scale)
  );
  const imgSize = image.getSize();

  const crop = {
    x: Math.max(0, Math.min(imgSize.width - 1, Math.round(region.x * imgSize.width))),
    y: Math.max(0, Math.min(imgSize.height - 1, Math.round(region.y * imgSize.height))),
    width: Math.max(1, Math.round(region.width * imgSize.width)),
    height: Math.max(1, Math.round(region.height * imgSize.height)),
  };
  crop.width = Math.max(1, Math.min(crop.width, imgSize.width - crop.x));
  crop.height = Math.max(1, Math.min(crop.height, imgSize.height - crop.y));

  let cropped = image.crop(crop);
  if (crop.width > MAX_OUTPUT_WIDTH) {
    cropped = cropped.resize({ width: MAX_OUTPUT_WIDTH, quality: 'best' });
  }
  return toResult(cropped, `${label} (saved area)`);
}

/** Grabs a full-resolution frozen frame of the active display (used for one-time region picking). */
export async function grabFrozenFrame(): Promise<{ display: Display; image: NativeImage; label: string }> {
  const display = activeDisplay();
  const scale = display.scaleFactor || 1;
  const { image, label } = await grabDisplay(display, Math.round(display.size.width * scale));
  return { display, image, label };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const SELECT_PREFIX = 'STEALTHIT_SELECT:';
const CANCEL_TITLE = 'STEALTHIT_CANCEL';

const OVERLAY_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>overlay</title><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;cursor:crosshair;user-select:none;background:#000;font-family:"Segoe UI",sans-serif}
#shot{position:fixed;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
#dim{position:fixed;inset:0;background:rgba(0,0,0,.45);pointer-events:none}
#sel{position:fixed;display:none;border:1.5px solid #4f8cff;box-shadow:0 0 0 9999px rgba(0,0,0,.45);pointer-events:none}
#size{position:absolute;right:0;bottom:-24px;padding:2px 6px;border-radius:5px;background:#4f8cff;color:#fff;font:600 11px Consolas,monospace;white-space:nowrap}
#hint{position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:7px 14px;border-radius:9px;background:rgba(20,22,28,.9);color:#e8eaf0;font-size:12.5px;box-shadow:0 0 0 1px rgba(255,255,255,.12);pointer-events:none}
#hint b{color:#8fb4ff;font-weight:600}
</style></head><body>
<img id="shot" alt=""><div id="dim"></div><div id="sel"><span id="size"></span></div>
<div id="hint">Drag to save the screen area for future captures · <b>Esc</b> or <b>Right-click</b> to cancel</div>
<script>
const sel=document.getElementById('sel'),dim=document.getElementById('dim'),sizeEl=document.getElementById('size');
let start=null,done=false;
window.__setShot=(src)=>{document.getElementById('shot').src=src;};
function finish(t){if(done)return;done=true;document.title=t;}
function rectFrom(e){const x=Math.min(start.x,e.clientX),y=Math.min(start.y,e.clientY);return{x,y,w:Math.abs(e.clientX-start.x),h:Math.abs(e.clientY-start.y)};}
window.addEventListener('mousedown',(e)=>{if(e.button===2){finish('${CANCEL_TITLE}');return;}if(e.button!==0)return;start={x:e.clientX,y:e.clientY};dim.style.display='none';sel.style.display='block';sel.style.left=start.x+'px';sel.style.top=start.y+'px';sel.style.width='0px';sel.style.height='0px';});
window.addEventListener('mousemove',(e)=>{if(!start)return;const r=rectFrom(e);sel.style.left=r.x+'px';sel.style.top=r.y+'px';sel.style.width=r.w+'px';sel.style.height=r.h+'px';sizeEl.textContent=Math.round(r.w*devicePixelRatio)+' × '+Math.round(r.h*devicePixelRatio);});
window.addEventListener('mouseup',(e)=>{if(!start||e.button!==0)return;const r=rectFrom(e);start=null;if(r.w<16||r.h<16){sel.style.display='none';dim.style.display='block';return;}finish('${SELECT_PREFIX}'+[r.x,r.y,r.w,r.h,innerWidth,innerHeight].map(Math.round).join(','));});
window.addEventListener('keydown',(e)=>{if(e.key==='Escape')finish('${CANCEL_TITLE}');});
window.addEventListener('contextmenu',(e)=>e.preventDefault());
</script></body></html>`;

let activeOverlay: BrowserWindow | null = null;

function selectRegionOnFrozenFrame(
  display: Display,
  frozenDataUrl: string
): Promise<{ rect: Rect; viewW: number; viewH: number } | null> {
  if (activeOverlay && !activeOverlay.isDestroyed()) {
    activeOverlay.close();
  }

  return new Promise((resolve) => {
    const { x, y, width, height } = display.bounds;
    const overlay = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#000000',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    activeOverlay = overlay;
    // Never visible to Zoom/Teams/Meet/OBS
    overlay.setContentProtection(true);
    overlay.setAlwaysOnTop(true, 'screen-saver');

    let settled = false;
    const settle = (value: { rect: Rect; viewW: number; viewH: number } | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (!overlay.isDestroyed()) overlay.close();
      if (activeOverlay === overlay) activeOverlay = null;
    };

    overlay.webContents.on('page-title-updated', (e, title) => {
      e.preventDefault();
      if (title === CANCEL_TITLE) {
        settle(null);
      } else if (title.startsWith(SELECT_PREFIX)) {
        const [rx, ry, rw, rh, vw, vh] = title.slice(SELECT_PREFIX.length).split(',').map(Number);
        if ([rx, ry, rw, rh, vw, vh].every((n) => Number.isFinite(n)) && rw > 0 && rh > 0 && vw > 0 && vh > 0) {
          settle({ rect: { x: rx, y: ry, width: rw, height: rh }, viewW: vw, viewH: vh });
        } else {
          settle(null);
        }
      }
    });
    overlay.on('blur', () => settle(null));
    overlay.on('closed', () => settle(null));
    overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    overlay.webContents.on('will-navigate', (e) => e.preventDefault());

    overlay.webContents.once('did-finish-load', () => {
      void overlay.webContents
        .executeJavaScript(`window.__setShot(${JSON.stringify(frozenDataUrl)}); true;`)
        .then(() => {
          if (overlay.isDestroyed()) return;
          overlay.setBounds({ x, y, width, height });
          overlay.show();
          overlay.moveTop();
          overlay.focus();
        })
        .catch(() => settle(null));
    });

    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);
  });
}

/**
 * Opens the stealth selection overlay once so the user can drag-select a saved
 * capture region. Returns normalized bounds or null if cancelled.
 */
export async function pickCaptureRegion(
  grab: () => Promise<{ display: Display; image: NativeImage; label: string }>
): Promise<CaptureRegionBounds | null> {
  const { display, image } = await grab();
  const imgSize = image.getSize();
  const preview = image.toJPEG(82).toString('base64');
  const selection = await selectRegionOnFrozenFrame(display, `data:image/jpeg;base64,${preview}`);
  if (!selection) return null;

  const x = Math.max(0, Math.min(1, selection.rect.x / selection.viewW));
  const y = Math.max(0, Math.min(1, selection.rect.y / selection.viewH));
  const width = Math.max(0.01, Math.min(1 - x, selection.rect.width / selection.viewW));
  const height = Math.max(0.01, Math.min(1 - y, selection.rect.height / selection.viewH));

  return {
    displayId: String(display.id),
    x,
    y,
    width,
    height,
    pixelWidth: Math.round(width * imgSize.width),
    pixelHeight: Math.round(height * imgSize.height),
  };
}
