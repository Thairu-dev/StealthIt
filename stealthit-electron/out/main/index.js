"use strict";
const electron = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const STYLE_INSTRUCTIONS = {
  concise: "Be maximally concise: short sentences, bullet points, zero preamble, instant scannability.",
  balanced: "Balance clarity with brevity: lead with the direct answer, then include brief context or code.",
  detailed: "Provide thorough reasoning, edge cases, and structured steps while remaining well-formatted."
};
function formatTranscriptWindow(transcript, maxChars = 6e3) {
  const finals = transcript.filter((seg) => seg.text.trim().length > 0);
  if (finals.length === 0) return "";
  const lines = [];
  let total = 0;
  for (let i = finals.length - 1; i >= 0; i--) {
    const seg = finals[i];
    const speakerLabel = seg.speaker === "them" ? "THEM" : "YOU";
    const time = new Date(seg.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const line = `[${time}] ${speakerLabel}: ${seg.text.trim()}`;
    if (total + line.length + 1 > maxChars && lines.length > 0) {
      break;
    }
    lines.unshift(line);
    total += line.length + 1;
  }
  return lines.join("\n");
}
function assemblePromptContext(params) {
  const {
    persona,
    settings,
    prompt,
    transcript,
    history,
    screenshotDataUrl,
    maxHistoryMessages = 10
  } = params;
  const systemParts = [
    persona.systemPrompt.trim(),
    `Response style: ${STYLE_INSTRUCTIONS[settings.responseStyle]}`,
    "Always respond directly to the user’s actual message. Never invent or fabricate screen contents, open applications, participants, or meeting details that were not provided."
  ];
  if (settings.attachUserContext !== false && settings.userContext.trim()) {
    systemParts.push(
      `User background / meeting context (use silently when relevant):
${settings.userContext.trim()}`
    );
  }
  const transcriptBlock = formatTranscriptWindow(transcript);
  if (transcriptBlock) {
    systemParts.push(
      `Live audio transcript (recent rolling window; THEM = system/meeting audio, YOU = user microphone):
${transcriptBlock}`
    );
  }
  if (screenshotDataUrl) {
    systemParts.push(
      "A fresh screenshot of the user’s current screen is attached. Base your answer strictly on what is visible in this new image — never repeat, recycle, or mix in answers or question numbers from earlier screens."
    );
  } else if (!transcriptBlock) {
    systemParts.push(
      "No screenshot or live audio transcript is attached to this message. Reply naturally and concisely to the user’s text alone."
    );
  }
  const recentHistory = history.filter((msg) => msg.content.trim().length > 0).slice(-maxHistoryMessages).map((msg) => ({
    role: msg.role,
    content: msg.content
  }));
  const userContent = screenshotDataUrl ? `[Fresh screen capture ${Date.now().toString(36)}]
${prompt.trim()}` : prompt.trim();
  return {
    systemPrompt: systemParts.join("\n\n"),
    messages: [
      ...recentHistory,
      {
        role: "user",
        content: userContent,
        screenshotDataUrl
      }
    ]
  };
}
const MAX_OUTPUT_WIDTH = 1920;
async function grabDisplay(display, maxWidth) {
  const scale = display.scaleFactor || 1;
  const rawWidth = Math.round(display.size.width * scale);
  const rawHeight = Math.round(display.size.height * scale);
  const ratio = rawWidth > maxWidth ? maxWidth / rawWidth : 1;
  const targetWidth = Math.max(640, Math.round(rawWidth * ratio));
  const targetHeight = Math.max(360, Math.round(rawHeight * ratio));
  const sources = await electron.desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: targetWidth, height: targetHeight }
  });
  if (sources.length === 0) {
    throw new Error("No display sources available for screen capture.");
  }
  const matched = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  return { image: matched.thumbnail, label: matched.name || "Primary Display" };
}
function toResult(image, label) {
  const size = image.getSize();
  return {
    dataUrl: `data:image/jpeg;base64,${image.toJPEG(86).toString("base64")}`,
    width: size.width,
    height: size.height,
    displayLabel: label
  };
}
function activeDisplay() {
  return electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint());
}
async function captureActiveScreen(region) {
  if (!region) {
    const { image: image2, label: label2 } = await grabDisplay(activeDisplay(), MAX_OUTPUT_WIDTH);
    return toResult(image2, label2);
  }
  const allDisplays = electron.screen.getAllDisplays();
  const targetDisplay = allDisplays.find((d) => String(d.id) === region.displayId) ?? activeDisplay();
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
    height: Math.max(1, Math.round(region.height * imgSize.height))
  };
  crop.width = Math.max(1, Math.min(crop.width, imgSize.width - crop.x));
  crop.height = Math.max(1, Math.min(crop.height, imgSize.height - crop.y));
  let cropped = image.crop(crop);
  if (crop.width > MAX_OUTPUT_WIDTH) {
    cropped = cropped.resize({ width: MAX_OUTPUT_WIDTH, quality: "best" });
  }
  return toResult(cropped, `${label} (saved area)`);
}
async function grabFrozenFrame() {
  const display = activeDisplay();
  const scale = display.scaleFactor || 1;
  const { image, label } = await grabDisplay(display, Math.round(display.size.width * scale));
  return { display, image, label };
}
const SELECT_PREFIX = "STEALTHIT_SELECT:";
const CANCEL_TITLE = "STEALTHIT_CANCEL";
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
<\/script></body></html>`;
let activeOverlay = null;
function selectRegionOnFrozenFrame(display, frozenDataUrl) {
  if (activeOverlay && !activeOverlay.isDestroyed()) {
    activeOverlay.close();
  }
  return new Promise((resolve) => {
    const { x, y, width, height } = display.bounds;
    const overlay = new electron.BrowserWindow({
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
      backgroundColor: "#000000",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    activeOverlay = overlay;
    overlay.setContentProtection(true);
    overlay.setAlwaysOnTop(true, "screen-saver");
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (!overlay.isDestroyed()) overlay.close();
      if (activeOverlay === overlay) activeOverlay = null;
    };
    overlay.webContents.on("page-title-updated", (e, title) => {
      e.preventDefault();
      if (title === CANCEL_TITLE) {
        settle(null);
      } else if (title.startsWith(SELECT_PREFIX)) {
        const [rx, ry, rw, rh, vw, vh] = title.slice(SELECT_PREFIX.length).split(",").map(Number);
        if ([rx, ry, rw, rh, vw, vh].every((n) => Number.isFinite(n)) && rw > 0 && rh > 0 && vw > 0 && vh > 0) {
          settle({ rect: { x: rx, y: ry, width: rw, height: rh }, viewW: vw, viewH: vh });
        } else {
          settle(null);
        }
      }
    });
    overlay.on("blur", () => settle(null));
    overlay.on("closed", () => settle(null));
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    overlay.webContents.on("will-navigate", (e) => e.preventDefault());
    overlay.webContents.once("did-finish-load", () => {
      void overlay.webContents.executeJavaScript(`window.__setShot(${JSON.stringify(frozenDataUrl)}); true;`).then(() => {
        if (overlay.isDestroyed()) return;
        overlay.setBounds({ x, y, width, height });
        overlay.show();
        overlay.moveTop();
        overlay.focus();
      }).catch(() => settle(null));
    });
    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);
  });
}
async function pickCaptureRegion(grab) {
  const { display, image } = await grab();
  const imgSize = image.getSize();
  const preview = image.toJPEG(82).toString("base64");
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
    pixelHeight: Math.round(height * imgSize.height)
  };
}
const MOVE_STEP = 40;
const MOVE_BINDINGS = [
  { accelerator: "CommandOrControl+Up", dx: 0, dy: -MOVE_STEP },
  { accelerator: "CommandOrControl+Down", dx: 0, dy: MOVE_STEP },
  { accelerator: "CommandOrControl+Left", dx: -MOVE_STEP, dy: 0 },
  { accelerator: "CommandOrControl+Right", dx: MOVE_STEP, dy: 0 }
];
let moveKeysActive = false;
function tryRegister(accelerator, handler) {
  try {
    const ok = electron.globalShortcut.register(accelerator, handler);
    if (!ok) {
      console.warn(`[StealthIt] Hotkey ${accelerator} is already owned by another app.`);
    }
    return ok;
  } catch (err) {
    console.warn(`[StealthIt] Failed to register ${accelerator}:`, err);
    return false;
  }
}
function setMoveHotkeysEnabled(windows2, enabled) {
  if (enabled === moveKeysActive) return;
  if (enabled) {
    for (const { accelerator, dx, dy } of MOVE_BINDINGS) {
      tryRegister(accelerator, () => windows2.moveHud(dx, dy));
    }
  } else {
    for (const { accelerator } of MOVE_BINDINGS) {
      if (electron.globalShortcut.isRegistered(accelerator)) {
        electron.globalShortcut.unregister(accelerator);
      }
    }
  }
  moveKeysActive = enabled;
}
function registerGlobalHotkeys(windows2) {
  electron.globalShortcut.unregisterAll();
  moveKeysActive = false;
  tryRegister("CommandOrControl+\\", () => {
    windows2.toggleVisibility();
  });
  tryRegister("CommandOrControl+Shift+E", () => {
    windows2.showHud(true);
    windows2.sendHotkeyToHud("toggle-expand");
  });
  tryRegister("CommandOrControl+Enter", () => {
    windows2.showHud(true);
    windows2.sendHotkeyToHud("ask-screen");
  });
  tryRegister("CommandOrControl+Shift+Enter", () => {
    windows2.showHud(false);
    windows2.sendHotkeyToHud("ask-assist");
  });
  tryRegister("CommandOrControl+Shift+Space", () => {
    windows2.showHud(false);
    windows2.sendHotkeyToHud("toggle-listen");
  });
  tryRegister("CommandOrControl+Shift+T", () => {
    windows2.toggleClickThrough();
  });
  tryRegister("CommandOrControl+Shift+D", () => {
    windows2.toggleDashboard();
  });
  tryRegister("CommandOrControl+Shift+Backspace", () => {
    windows2.sendHotkeyToHud("panic-clear");
  });
  tryRegister("CommandOrControl+Shift+Q", () => {
    windows2.quit();
  });
  windows2.onHudVisibilityChange((visible) => {
    setMoveHotkeysEnabled(windows2, visible);
  });
  setMoveHotkeysEnabled(windows2, windows2.getStealthStatus().visible);
}
function unregisterGlobalHotkeys() {
  electron.globalShortcut.unregisterAll();
  moveKeysActive = false;
}
const BUILT_IN_PERSONAS = [
  {
    id: "general",
    name: "General",
    tagline: "Everyday assistant for quick answers, writing, research, and screen help",
    builtIn: true,
    systemPrompt: "You are StealthIt, a fast, helpful desktop AI assistant. Answer the user’s message directly, accurately, and concisely. If a screenshot or live transcript is attached, use it carefully; otherwise reply naturally to their question without assuming extra context."
  },
  {
    id: "general-meeting",
    name: "Meeting Copilot",
    tagline: "Crisp answers, live talking points, and structured recaps",
    builtIn: true,
    systemPrompt: "You are StealthIt, a fast, helpful meeting copilot. When a live transcript or screenshot is provided, give immediately usable talking points, crisp bullets, or exact phrasing the user can say out loud. When no transcript or screenshot is provided, reply naturally without making up meeting details."
  },
  {
    id: "technical-interview",
    name: "Technical & Coding",
    tagline: "Algorithms, system design, complexity, and edge cases",
    builtIn: true,
    systemPrompt: "You are StealthIt, an expert principal engineer copilot for technical discussions and coding sessions. Lead with the optimal approach in 2-3 concise bullets, state time/space complexity clearly, highlight key edge cases, and provide clean, production-quality code. Avoid fluff."
  },
  {
    id: "sales-discovery",
    name: "Sales & Objections",
    tagline: "Objection handling, discovery questions, and value framing",
    builtIn: true,
    systemPrompt: "You are StealthIt, a sharp enterprise solutions engineer and sales copilot. When an objection, pricing question, or competitor mention appears in the transcript or screen, give: (1) a 1-sentence empathetic bridge, (2) a crisp value rebuttal, and (3) one high-leverage follow-up question to keep momentum."
  }
];
const DEFAULT_SCREEN_CAPTURE_PROMPT = "Analyze what is currently visible on my screen. Explain the core problem or content clearly and give me the sharpest, most actionable answer or solution.";
const DEFAULT_SETTINGS = {
  activeProvider: "openai",
  providers: {
    openai: {
      id: "openai",
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1"
    },
    anthropic: {
      id: "anthropic",
      model: "claude-sonnet-4-20250514",
      baseUrl: "https://api.anthropic.com"
    },
    gemini: {
      id: "gemini",
      model: "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com"
    },
    openrouter: {
      id: "openrouter",
      model: "anthropic/claude-sonnet-4",
      baseUrl: "https://openrouter.ai/api/v1"
    },
    ollama: {
      id: "ollama",
      model: "llama3.2-vision",
      baseUrl: "http://localhost:11434"
    }
  },
  fallback: {
    enabled: false,
    provider: "openrouter",
    model: "google/gemini-2.5-flash",
    timeoutSec: 20
  },
  stt: {
    provider: "deepgram",
    model: "nova-3",
    language: "en",
    localUrl: "http://localhost:8000/v1/audio/transcriptions",
    captureSystemAudio: true,
    captureMicrophone: true,
    micDeviceId: "default",
    vadSilenceMs: 1100,
    vadThreshold: 0.026
  },
  stealth: {
    contentProtection: true,
    clickThrough: false,
    opacity: 0.96,
    hideTrayIcon: false,
    autoHideOnBlur: false
  },
  activePersonaId: "general",
  userContext: "",
  attachUserContext: true,
  screenCapturePrompt: DEFAULT_SCREEN_CAPTURE_PROMPT,
  captureRegion: false,
  captureRegionBounds: null,
  responseStyle: "concise",
  theme: "dark",
  shareBetaLogs: false
};
function isApiKeyOptional(providerId, config) {
  if (providerId === "ollama") return true;
  if (providerId !== "openai" && providerId !== "openrouter") return false;
  if (config?.useCustomBaseUrl === true) return true;
  if (config?.useCustomBaseUrl === false) return false;
  const cleaned = (config?.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!cleaned) return false;
  const defaultUrl = (DEFAULT_SETTINGS.providers[providerId].baseUrl ?? "").replace(/\/+$/, "");
  return cleaned !== defaultUrl;
}
function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}
function extractOpenAISseDelta(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}
function extractAnthropicSseDelta(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
      return parsed.delta.text ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
function extractGeminiSseDelta(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    const parts = parsed.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) return null;
    return parts.map((p) => p.text ?? "").join("");
  } catch {
    return null;
  }
}
function extractOllamaNdjsonDelta(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed.message?.content ?? null;
  } catch {
    return null;
  }
}
async function consumeLineStream(body, extractor, onChunk) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx = buffer.indexOf("\n");
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      const delta = extractor(line);
      if (delta) {
        fullText += delta;
        onChunk(delta);
      }
      newlineIdx = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) {
    const delta = extractor(buffer);
    if (delta) {
      fullText += delta;
      onChunk(delta);
    }
  }
  return fullText;
}
function getProviderApiKey(store2, provider) {
  if (provider === "ollama") return null;
  return store2.getSecret(provider);
}
async function streamAIResponse(params) {
  const { settings, store: store2, assembled, signal, onChunk, providerOverride, modelOverride } = params;
  const providerId = providerOverride ?? settings.activeProvider;
  const baseConfig = settings.providers[providerId];
  const config = modelOverride ? { ...baseConfig, model: modelOverride } : baseConfig;
  const apiKey = getProviderApiKey(store2, providerId);
  if (!isApiKeyOptional(providerId, config) && !apiKey) {
    throw new Error(
      `No API key configured for ${providerId.toUpperCase()}. Open Dashboard (Ctrl+Shift+D) -> AI Providers to add one.`
    );
  }
  if (providerId === "openai" || providerId === "openrouter") {
    const baseUrl2 = (config.baseUrl || (providerId === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1")).replace(/\/+$/, "");
    const messages2 = [
      { role: "system", content: assembled.systemPrompt },
      ...assembled.messages.map((msg) => {
        if (msg.screenshotDataUrl) {
          return {
            role: msg.role,
            content: [
              { type: "text", text: msg.content },
              {
                type: "image_url",
                image_url: { url: msg.screenshotDataUrl, detail: "high" }
              }
            ]
          };
        }
        return { role: msg.role, content: msg.content };
      })
    ];
    const headers = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    if (providerId === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/Thairu-dev/StealthIt";
      headers["X-Title"] = "StealthIt";
    }
    const res2 = await fetch(`${baseUrl2}/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: config.model,
        messages: messages2,
        stream: true,
        temperature: 0.4
      })
    });
    if (!res2.ok || !res2.body) {
      const errText = await res2.text().catch(() => res2.statusText);
      throw new Error(`${providerId.toUpperCase()} error (${res2.status}): ${errText.slice(0, 300)}`);
    }
    return consumeLineStream(res2.body, extractOpenAISseDelta, onChunk);
  }
  if (providerId === "anthropic") {
    const baseUrl2 = (config.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
    const messages2 = assembled.messages.map((msg) => {
      if (msg.screenshotDataUrl) {
        const parsed = parseDataUrl(msg.screenshotDataUrl);
        if (parsed) {
          return {
            role: msg.role,
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: parsed.mimeType,
                  data: parsed.base64
                }
              },
              { type: "text", text: msg.content }
            ]
          };
        }
      }
      return { role: msg.role, content: msg.content };
    });
    const res2 = await fetch(`${baseUrl2}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey ?? "",
        "anthropic-version": "2023-06-01"
      },
      signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        system: assembled.systemPrompt,
        messages: messages2,
        stream: true
      })
    });
    if (!res2.ok || !res2.body) {
      const errText = await res2.text().catch(() => res2.statusText);
      throw new Error(`Anthropic error (${res2.status}): ${errText.slice(0, 300)}`);
    }
    return consumeLineStream(res2.body, extractAnthropicSseDelta, onChunk);
  }
  if (providerId === "gemini") {
    const baseUrl2 = (config.baseUrl || "https://generativelanguage.googleapis.com").replace(
      /\/+$/,
      ""
    );
    const contents = assembled.messages.map((msg) => {
      const parts = [];
      if (msg.screenshotDataUrl) {
        const parsed = parseDataUrl(msg.screenshotDataUrl);
        if (parsed) {
          parts.push({
            inlineData: {
              mimeType: parsed.mimeType,
              data: parsed.base64
            }
          });
        }
      }
      parts.push({ text: msg.content });
      return {
        role: msg.role === "assistant" ? "model" : "user",
        parts
      };
    });
    const url = `${baseUrl2}/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey ?? "")}`;
    const res2 = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: assembled.systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.4
        }
      })
    });
    if (!res2.ok || !res2.body) {
      const errText = await res2.text().catch(() => res2.statusText);
      throw new Error(`Gemini error (${res2.status}): ${errText.slice(0, 300)}`);
    }
    return consumeLineStream(res2.body, extractGeminiSseDelta, onChunk);
  }
  const baseUrl = (config.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
  const messages = [
    { role: "system", content: assembled.systemPrompt },
    ...assembled.messages.map((msg) => {
      const parsed = msg.screenshotDataUrl ? parseDataUrl(msg.screenshotDataUrl) : null;
      return {
        role: msg.role,
        content: msg.content,
        ...parsed ? { images: [parsed.base64] } : {}
      };
    })
  ];
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true
    })
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(
      `Ollama error (${res.status}): ${errText.slice(0, 300)}. Ensure Ollama is running at ${baseUrl}.`
    );
  }
  return consumeLineStream(res.body, extractOllamaNdjsonDelta, onChunk);
}
async function fetchOllamaModels(baseUrl) {
  const cleanUrl = (baseUrl || "http://localhost:11434").replace(/\/+$/, "");
  const res = await fetch(`${cleanUrl}/api/tags`, {
    signal: AbortSignal.timeout(4e3)
  });
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}`);
  }
  const data = await res.json();
  return (data.models ?? []).map((m) => m.name ?? "").filter((name) => name.length > 0);
}
async function fetchProviderModels(store2, providerId) {
  const settings = store2.getSettings();
  const config = settings.providers[providerId];
  try {
    if (providerId === "ollama") {
      const models = await fetchOllamaModels(config.baseUrl || "http://localhost:11434");
      return { ok: true, models };
    }
    const apiKey = store2.getSecret(providerId);
    const keyOptional = isApiKeyOptional(providerId, config);
    if (!keyOptional && !apiKey) {
      return { ok: false, models: [], error: "Save an API key first to fetch models." };
    }
    if (providerId === "openai" || providerId === "openrouter") {
      const baseUrl = (config.baseUrl || (providerId === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1")).replace(/\/+$/, "");
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const res = await fetch(`${baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(1e4)
      });
      if (!res.ok) {
        return {
          ok: false,
          models: [],
          error: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`
        };
      }
      const data = await res.json();
      const models = (data.data ?? []).map((m) => m.id ?? "").filter((id) => id.length > 0).sort((a, b) => a.localeCompare(b));
      return { ok: true, models };
    }
    if (providerId === "anthropic") {
      const baseUrl = (config.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          "x-api-key": apiKey ?? "",
          "anthropic-version": "2023-06-01"
        },
        signal: AbortSignal.timeout(1e4)
      });
      if (!res.ok) {
        return {
          ok: false,
          models: [],
          error: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`
        };
      }
      const data = await res.json();
      const models = (data.data ?? []).map((m) => m.id ?? "").filter((id) => id.length > 0);
      return { ok: true, models };
    }
    if (providerId === "gemini") {
      const baseUrl = (config.baseUrl || "https://generativelanguage.googleapis.com").replace(
        /\/+$/,
        ""
      );
      const res = await fetch(
        `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey ?? "")}`,
        { signal: AbortSignal.timeout(1e4) }
      );
      if (!res.ok) {
        return {
          ok: false,
          models: [],
          error: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`
        };
      }
      const data = await res.json();
      const models = (data.models ?? []).filter(
        (m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")
      ).map((m) => (m.name ?? "").replace(/^models\//, "")).filter((name) => name.length > 0);
      return { ok: true, models };
    }
    return { ok: false, models: [], error: "Unsupported provider." };
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : "Failed to fetch models."
    };
  }
}
async function testProviderConnection(store2, providerId) {
  const settings = store2.getSettings();
  const config = settings.providers[providerId];
  try {
    if (providerId === "ollama") {
      const models = await fetchOllamaModels(config.baseUrl || "http://localhost:11434");
      return {
        ok: true,
        message: `Connected to Ollama (${models.length} local model${models.length === 1 ? "" : "s"} found).`
      };
    }
    const apiKey = store2.getSecret(providerId);
    const keyOptional = isApiKeyOptional(providerId, config);
    if (!keyOptional && !apiKey) {
      return { ok: false, message: "No API key saved yet." };
    }
    if (providerId === "openai" || providerId === "openrouter") {
      const baseUrl = (config.baseUrl || (providerId === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1")).replace(/\/+$/, "");
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const res = await fetch(`${baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(8e3)
      });
      return res.ok ? { ok: true, message: `Connected to ${providerId.toUpperCase()} successfully.` } : { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}` };
    }
    if (providerId === "anthropic") {
      const baseUrl = (config.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          "x-api-key": apiKey ?? "",
          "anthropic-version": "2023-06-01"
        },
        signal: AbortSignal.timeout(8e3)
      });
      return res.ok ? { ok: true, message: "Connected to Anthropic successfully." } : { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}` };
    }
    if (providerId === "gemini") {
      const baseUrl = (config.baseUrl || "https://generativelanguage.googleapis.com").replace(
        /\/+$/,
        ""
      );
      const res = await fetch(
        `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey ?? "")}`,
        { signal: AbortSignal.timeout(8e3) }
      );
      return res.ok ? { ok: true, message: "Connected to Google Gemini successfully." } : { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}` };
    }
    return { ok: false, message: "Unsupported provider." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Connection failed."
    };
  }
}
const SECRET_KEYS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "deepgram",
  "groq"
];
function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}
function mergeSettings(raw) {
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    providers: {
      openai: { ...DEFAULT_SETTINGS.providers.openai, ...raw.providers?.openai },
      anthropic: { ...DEFAULT_SETTINGS.providers.anthropic, ...raw.providers?.anthropic },
      gemini: { ...DEFAULT_SETTINGS.providers.gemini, ...raw.providers?.gemini },
      openrouter: { ...DEFAULT_SETTINGS.providers.openrouter, ...raw.providers?.openrouter },
      ollama: { ...DEFAULT_SETTINGS.providers.ollama, ...raw.providers?.ollama }
    },
    fallback: {
      ...DEFAULT_SETTINGS.fallback,
      ...raw.fallback
    },
    stt: {
      ...DEFAULT_SETTINGS.stt,
      ...raw.stt
    },
    stealth: {
      ...DEFAULT_SETTINGS.stealth,
      ...raw.stealth
    }
  };
}
class LocalStore {
  baseDir;
  dataPath;
  secretsPath;
  data;
  secretsCache = {};
  constructor(customBaseDir) {
    this.baseDir = customBaseDir ?? path.join(electron.app.getPath("userData"), "stealthit-data");
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    this.dataPath = path.join(this.baseDir, "state.json");
    this.secretsPath = path.join(this.baseDir, "secrets.enc.json");
    this.data = this.loadData();
    this.secretsCache = this.loadSecrets();
  }
  isEncryptionAvailable() {
    try {
      return electron.safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }
  loadData() {
    if (!fs.existsSync(this.dataPath)) {
      return {
        settings: structuredClone(DEFAULT_SETTINGS),
        personas: structuredClone(BUILT_IN_PERSONAS),
        sessions: []
      };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.dataPath, "utf8"));
      const customPersonas = (parsed.personas ?? []).filter((p) => !p.builtIn);
      const mergedBuiltIns = BUILT_IN_PERSONAS.map((bi) => {
        const override = (parsed.personas ?? []).find((p) => p.id === bi.id);
        return override ? { ...bi, ...override, builtIn: true } : structuredClone(bi);
      });
      return {
        settings: mergeSettings(parsed.settings),
        personas: [...mergedBuiltIns, ...customPersonas],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
      };
    } catch {
      return {
        settings: structuredClone(DEFAULT_SETTINGS),
        personas: structuredClone(BUILT_IN_PERSONAS),
        sessions: []
      };
    }
  }
  saveData() {
    atomicWriteJson(this.dataPath, this.data);
  }
  loadSecrets() {
    if (!fs.existsSync(this.secretsPath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.secretsPath, "utf8"));
      const result = {};
      const canDecrypt = this.isEncryptionAvailable();
      for (const key of SECRET_KEYS) {
        const rawVal = parsed.values?.[key];
        if (!rawVal) continue;
        if (parsed.encrypted && canDecrypt) {
          try {
            result[key] = electron.safeStorage.decryptString(Buffer.from(rawVal, "base64"));
          } catch {
          }
        } else if (!parsed.encrypted) {
          result[key] = rawVal;
        }
      }
      return result;
    } catch {
      return {};
    }
  }
  persistSecrets() {
    const canEncrypt = this.isEncryptionAvailable();
    const values = {};
    for (const key of SECRET_KEYS) {
      const plain = this.secretsCache[key];
      if (!plain) continue;
      if (canEncrypt) {
        values[key] = electron.safeStorage.encryptString(plain).toString("base64");
      } else {
        values[key] = plain;
      }
    }
    const payload = {
      encrypted: canEncrypt,
      values
    };
    atomicWriteJson(this.secretsPath, payload);
  }
  getSettings() {
    return structuredClone(this.data.settings);
  }
  updateSettings(partial) {
    this.data.settings = mergeSettings({
      ...this.data.settings,
      ...partial,
      providers: partial.providers ? { ...this.data.settings.providers, ...partial.providers } : this.data.settings.providers,
      stt: partial.stt ? { ...this.data.settings.stt, ...partial.stt } : this.data.settings.stt,
      stealth: partial.stealth ? { ...this.data.settings.stealth, ...partial.stealth } : this.data.settings.stealth
    });
    this.saveData();
    return this.getSettings();
  }
  getSecret(key) {
    return this.secretsCache[key] ?? null;
  }
  setSecret(key, value) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      delete this.secretsCache[key];
    } else {
      this.secretsCache[key] = trimmed;
    }
    this.persistSecrets();
    return this.getSecretStatus();
  }
  clearSecret(key) {
    delete this.secretsCache[key];
    this.persistSecrets();
    return this.getSecretStatus();
  }
  getSecretStatus() {
    return {
      openai: Boolean(this.secretsCache.openai),
      anthropic: Boolean(this.secretsCache.anthropic),
      gemini: Boolean(this.secretsCache.gemini),
      openrouter: Boolean(this.secretsCache.openrouter),
      deepgram: Boolean(this.secretsCache.deepgram),
      groq: Boolean(this.secretsCache.groq)
    };
  }
  getPersonas() {
    return structuredClone(this.data.personas);
  }
  getActivePersona() {
    const found = this.data.personas.find((p) => p.id === this.data.settings.activePersonaId);
    return structuredClone(found ?? this.data.personas[0] ?? BUILT_IN_PERSONAS[0]);
  }
  savePersona(persona) {
    const idx = this.data.personas.findIndex((p) => p.id === persona.id);
    if (idx >= 0) {
      this.data.personas[idx] = { ...persona };
    } else {
      this.data.personas.push({ ...persona, builtIn: false });
    }
    this.saveData();
    return this.getPersonas();
  }
  deletePersona(id) {
    this.data.personas = this.data.personas.filter((p) => p.builtIn || p.id !== id);
    if (this.data.settings.activePersonaId === id) {
      this.data.settings.activePersonaId = BUILT_IN_PERSONAS[0].id;
    }
    this.saveData();
    return this.getPersonas();
  }
  getSessions() {
    return structuredClone(
      [...this.data.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
    );
  }
  saveSession(session) {
    const idx = this.data.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.data.sessions[idx] = structuredClone(session);
    } else {
      this.data.sessions.unshift(structuredClone(session));
    }
    if (this.data.sessions.length > 100) {
      this.data.sessions = this.data.sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100);
    }
    this.saveData();
  }
  deleteSession(id) {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    this.saveData();
    return this.getSessions();
  }
  clearAllSessions() {
    this.data.sessions = [];
    this.saveData();
  }
}
const MAX_MEMORY_ENTRIES = 400;
const MAX_FILE_BYTES = 512 * 1024;
const BETA_LOGS_ENDPOINT = "https://stealthit-web.vercel.app/api/beta-logs";
class AppLogger {
  entries = [];
  logPath = null;
  logDir = null;
  autoSendEnabled = false;
  pendingBatch = [];
  flushTimer = null;
  setAutoSend(enabled) {
    this.autoSendEnabled = enabled;
    if (!enabled) {
      this.pendingBatch = [];
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    }
  }
  queueForAutoSend(entry) {
    if (!this.autoSendEnabled) return;
    if (entry.level !== "warn" && entry.level !== "error") return;
    this.pendingBatch.push(entry);
    if (this.pendingBatch.length > 50) {
      this.pendingBatch.shift();
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const batch = this.pendingBatch.splice(0, this.pendingBatch.length);
        if (batch.length === 0) return;
        void this.postBatch(batch, "auto");
      }, 8e3);
    }
  }
  async postBatch(entries, source, note) {
    try {
      const res = await fetch(BETA_LOGS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appVersion: electron.app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          source,
          ...note?.trim() ? { note: note.trim().slice(0, 500) } : {},
          entries: entries.slice(-80)
        }),
        signal: AbortSignal.timeout(8e3)
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }
      return { ok: true, status: res.status };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Network error"
      };
    }
  }
  async sendDiagnosticReport(note) {
    if (this.entries.length === 0) {
      return { ok: false, message: "No log entries to send yet." };
    }
    const result = await this.postBatch(this.entries, "manual", note);
    if (result.ok) {
      return {
        ok: true,
        message: `Sent ${Math.min(this.entries.length, 80)} sanitized log entries. Thank you for helping test StealthIt Beta!`
      };
    }
    return {
      ok: false,
      message: `Could not reach ${BETA_LOGS_ENDPOINT} (${result.error ?? "offline"}). You can use "Report Bug" to open a GitHub issue instead.`
    };
  }
  ensurePath() {
    if (this.logPath) return this.logPath;
    try {
      const dir = path.join(electron.app.getPath("userData"), "stealthit-data");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.logDir = dir;
      this.logPath = path.join(dir, "app.log");
      return this.logPath;
    } catch {
      return null;
    }
  }
  getLogDir() {
    this.ensurePath();
    return this.logDir;
  }
  log(level, category, message, meta) {
    const cleanMeta = {};
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        if (v !== void 0) cleanMeta[k] = v;
      }
    }
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      level,
      category,
      message,
      ...Object.keys(cleanMeta).length > 0 ? { meta: cleanMeta } : {}
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_MEMORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_MEMORY_ENTRIES);
    }
    this.queueForAutoSend(entry);
    const filePath = this.ensurePath();
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_FILE_BYTES) {
        const backup = `${filePath}.old`;
        fs.renameSync(filePath, backup);
      }
      const ts = new Date(entry.timestamp).toISOString();
      const metaStr = entry.meta && Object.keys(entry.meta).length > 0 ? ` ${JSON.stringify(entry.meta)}` : "";
      fs.appendFileSync(
        filePath,
        `[${ts}] [${level.toUpperCase()}] [${category}] ${message}${metaStr}
`,
        "utf8"
      );
    } catch {
    }
  }
  info(category, message, meta) {
    this.log("info", category, message, meta);
  }
  warn(category, message, meta) {
    this.log("warn", category, message, meta);
  }
  error(category, message, meta) {
    this.log("error", category, message, meta);
  }
  getEntries() {
    return [...this.entries].reverse();
  }
  clear() {
    this.entries = [];
    const filePath = this.ensurePath();
    if (filePath) {
      try {
        fs.writeFileSync(filePath, "", "utf8");
      } catch {
      }
    }
  }
}
const logger = new AppLogger();
const WHISPER_HALLUCINATION_EXACT = /* @__PURE__ */ new Set([
  "thank you",
  "thank you.",
  "thanks",
  "thanks.",
  "thanks for watching",
  "thanks for watching.",
  "thank you for watching",
  "thank you for watching.",
  "please subscribe",
  "subscribe",
  "you",
  "you.",
  "bye",
  "bye.",
  "goodbye",
  "goodbye.",
  "hmm",
  "uh",
  "um",
  "mbc 뉴스",
  "subtitles by the amara.org community"
]);
function filterWhisperHallucination(raw) {
  const cleaned = raw.trim();
  if (!cleaned) return "";
  if (/\d{1,2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(cleaned)) return "";
  if (/^\[?\s*silence\s*\]?\.?$/i.test(cleaned)) return "";
  const withoutTags = cleaned.replace(/\[[^\]]*\]|\([^)]*\)|♪+/g, "").replace(/\s+/g, " ").trim();
  if (!withoutTags || /^[\p{P}\p{S}\s]+$/u.test(withoutTags)) return "";
  const normalized = withoutTags.toLowerCase().replace(/[!?,.\s]+$/g, "").trim();
  if (WHISPER_HALLUCINATION_EXACT.has(normalized) || WHISPER_HALLUCINATION_EXACT.has(withoutTags.toLowerCase())) {
    return "";
  }
  return withoutTags;
}
function extractReliableWhisperText(data) {
  if (Array.isArray(data.segments) && data.segments.length > 0) {
    const kept = data.segments.filter((seg) => {
      const noSpeech = seg.no_speech_prob ?? 0;
      const logprob = seg.avg_logprob ?? 0;
      return noSpeech <= 0.6 && logprob >= -1.05;
    }).map((seg) => (seg.text ?? "").trim()).filter(Boolean).join(" ");
    return filterWhisperHallucination(kept);
  }
  return filterWhisperHallucination(data.text ?? "");
}
async function transcribeAudioChunk(store2, req) {
  const settings = store2.getSettings();
  const stt = settings.stt;
  const wavBuffer = Buffer.from(req.wavBase64, "base64");
  if (wavBuffer.byteLength < 1e3) {
    return { text: "", speaker: req.speaker };
  }
  let endpoint = "";
  let apiKey = null;
  let model = stt.model;
  if (stt.provider === "openai-whisper") {
    endpoint = "https://api.openai.com/v1/audio/transcriptions";
    apiKey = store2.getSecret("openai");
    model = model || "whisper-1";
    if (!apiKey) {
      return {
        text: "",
        speaker: req.speaker,
        error: "OpenAI API key missing for Whisper transcription."
      };
    }
  } else if (stt.provider === "groq-whisper") {
    endpoint = "https://api.groq.com/openai/v1/audio/transcriptions";
    apiKey = store2.getSecret("groq");
    model = model || "whisper-large-v3-turbo";
    if (!apiKey) {
      return {
        text: "",
        speaker: req.speaker,
        error: "Groq API key missing for Groq Whisper transcription."
      };
    }
  } else if (stt.provider === "gemini-audio") {
    const geminiKey = store2.getSecret("gemini");
    if (!geminiKey) {
      return {
        text: "",
        speaker: req.speaker,
        error: "Google Gemini API key missing. Add it in Dashboard -> API Keys or Audio & Voice."
      };
    }
    const baseUrl = (settings.providers.gemini.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const geminiModel = model || "gemini-2.5-flash";
    const langHint = stt.language && stt.language !== "auto" ? ` The speaker is likely speaking "${stt.language}".` : "";
    try {
      const res = await fetch(
        `${baseUrl}/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/wav",
                      data: req.wavBase64
                    }
                  },
                  {
                    text: `Transcribe only clear spoken human speech in this audio verbatim.${langHint} Return ONLY the exact spoken words with normal punctuation. Never include timestamps, SRT/VTT timecodes, or guesses. If the audio is silent, muffled, or only background noise, return ONLY: [SILENCE]`
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0
            }
          }),
          signal: AbortSignal.timeout(15e3)
        }
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        return {
          text: "",
          speaker: req.speaker,
          error: `Gemini Audio error (${res.status}): ${errText.slice(0, 160)}`
        };
      }
      const data = await res.json();
      const rawText = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(" ");
      return {
        text: filterWhisperHallucination(rawText),
        speaker: req.speaker
      };
    } catch (err) {
      return {
        text: "",
        speaker: req.speaker,
        error: err instanceof Error ? err.message : "Gemini audio transcription failed"
      };
    }
  } else if (stt.provider === "local-whisper") {
    endpoint = stt.localUrl || "http://localhost:8000/v1/audio/transcriptions";
    model = model || "Systran/faster-whisper-small";
  } else {
    const dgKey = store2.getSecret("deepgram");
    if (!dgKey) {
      return {
        text: "",
        speaker: req.speaker,
        error: "Deepgram API key missing."
      };
    }
    try {
      const res = await fetch(
        `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(stt.model || "nova-3")}&language=${encodeURIComponent(stt.language || "en")}&smart_format=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${dgKey}`,
            "Content-Type": "audio/wav"
          },
          body: wavBuffer,
          signal: AbortSignal.timeout(12e3)
        }
      );
      if (!res.ok) {
        return {
          text: "",
          speaker: req.speaker,
          error: `Deepgram HTTP ${res.status}`
        };
      }
      const data = await res.json();
      const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
      return { text, speaker: req.speaker };
    } catch (err) {
      return {
        text: "",
        speaker: req.speaker,
        error: err instanceof Error ? err.message : "Deepgram request failed"
      };
    }
  }
  try {
    const formData = new FormData();
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    formData.append("file", blob, "chunk.wav");
    formData.append("model", model);
    formData.append("temperature", "0");
    if (stt.provider === "groq-whisper" || stt.provider === "openai-whisper") {
      formData.append("response_format", "verbose_json");
    }
    if (stt.language && stt.language !== "auto") {
      formData.append("language", stt.language);
    }
    const headers = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: formData,
      signal: AbortSignal.timeout(15e3)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return {
        text: "",
        speaker: req.speaker,
        error: `STT error (${res.status}): ${errText.slice(0, 160)}`
      };
    }
    const data = await res.json();
    return {
      text: extractReliableWhisperText(data),
      speaker: req.speaker
    };
  } catch (err) {
    return {
      text: "",
      speaker: req.speaker,
      error: err instanceof Error ? err.message : "Transcription request failed"
    };
  }
}
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_DONOTROUND = 1;
const DWMWA_BORDER_COLOR = 34;
const DWMWA_CAPTION_COLOR = 35;
const DWMWA_SYSTEMBACKDROP_TYPE = 38;
const DWMSBT_NONE = 1;
const DWMWA_COLOR_NONE = 4294967294;
let cachedApi;
function loadDwmApi() {
  if (process.platform !== "win32") return null;
  if (cachedApi !== void 0) return cachedApi;
  try {
    const koffi = require("koffi");
    const dwmapi = koffi.load("dwmapi.dll");
    cachedApi = {
      DwmSetWindowAttribute: dwmapi.func(
        "long __stdcall DwmSetWindowAttribute(uintptr hwnd, uint dwAttribute, void *pvAttribute, uint cbAttribute)"
      )
    };
    return cachedApi;
  } catch (err) {
    console.warn("[StealthIt] Win32 DWM helper unavailable:", err);
    cachedApi = null;
    return null;
  }
}
function readHwnd(win) {
  const buf = win.getNativeWindowHandle();
  if (buf.length >= 8) {
    return buf.readBigUInt64LE(0);
  }
  if (buf.length >= 4) {
    return buf.readUInt32LE(0);
  }
  return null;
}
function setDwmUint32(api, hwnd, attr, value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  api.DwmSetWindowAttribute(hwnd, attr, buf, 4);
}
function enforceTrueFramelessWin32(win) {
  if (process.platform !== "win32" || win.isDestroyed()) return;
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
    console.warn("[StealthIt] Failed to enforce Win32 DWM attributes:", err);
  }
}
function crc32(buf) {
  let c = 4294967295;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c >>> 1 ^ (c & 1 ? 3988292384 : 0);
    }
  }
  return (c ^ 4294967295) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function createTrayPngIcon() {
  const size = 32;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      const distCenter = Math.hypot(x - cx, y - cy);
      const qx = Math.max(dx - 7, 0);
      const qy = Math.max(dy - 7, 0);
      const sdf = Math.hypot(qx, qy) - 6.2;
      if (sdf <= 0) {
        if (distCenter <= 4.8) {
          raw[px] = 79;
          raw[px + 1] = 140;
          raw[px + 2] = 255;
          raw[px + 3] = 255;
        } else if (sdf >= -2.1) {
          raw[px] = 79;
          raw[px + 1] = 140;
          raw[px + 2] = 255;
          raw[px + 3] = 255;
        } else {
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  return electron.nativeImage.createFromBuffer(png);
}
function loadBrandIcon(size) {
  const candidates = [
    path.join(electron.app.getAppPath(), "build/icon.png"),
    path.join(__dirname, "../../build/icon.png")
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const img = electron.nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        return size ? img.resize({ width: size, height: size, quality: "best" }) : img;
      }
    }
  }
  return createTrayPngIcon();
}
const HUD_DEFAULT_WIDTH = 680;
const HUD_COLLAPSED_HEIGHT = 64;
const HUD_TOP_MARGIN = 18;
class WindowManager {
  hud = null;
  dashboard = null;
  tray = null;
  isQuitting = false;
  clickThrough = false;
  contentProtectionActive = true;
  store;
  constructor(store2) {
    this.store = store2;
    const stealth = store2.getSettings().stealth;
    this.contentProtectionActive = stealth.contentProtection;
    this.clickThrough = stealth.clickThrough;
  }
  setQuitting(quitting) {
    this.isQuitting = quitting;
  }
  /** Fully terminates StealthIt (bypasses hide-on-close behaviour). */
  quit() {
    this.isQuitting = true;
    electron.app.quit();
  }
  visibilityListener = null;
  lastReportedVisible = null;
  /** Notified whenever the HUD transitions between shown and hidden. */
  onHudVisibilityChange(listener) {
    this.visibilityListener = listener;
  }
  /**
   * Window-local shortcuts that only fire while a StealthIt window has focus,
   * so they never hijack the same keys in other apps.
   */
  attachLocalShortcuts(win) {
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const mod = input.control || input.meta;
      if (!mod || input.alt) return;
      const key = input.key.toLowerCase();
      if (key === "q" && !input.shift) {
        event.preventDefault();
        this.quit();
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
          void electron.shell.openExternal(parsed.toString());
        }
      } catch {
      }
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      const devUrl = process.env["ELECTRON_RENDERER_URL"];
      const isAppUrl = devUrl && url.startsWith(devUrl) || url.startsWith("file://");
      if (!isAppUrl) {
        event.preventDefault();
      }
    });
  }
  createWindows() {
    this.createHudWindow();
    this.createDashboardWindow();
    this.syncTray();
    electron.screen.on("display-metrics-changed", () => {
      this.reassertStealthAll();
    });
  }
  getPreloadPath() {
    return path.join(__dirname, "../preload/index.js");
  }
  loadRendererPage(win, page) {
    const devUrl = process.env["ELECTRON_RENDERER_URL"];
    if (devUrl) {
      void win.loadURL(`${devUrl}/${page}.html`);
    } else {
      void win.loadFile(path.join(__dirname, `../renderer/${page}.html`));
    }
  }
  applyStealthInvariants(win, isHud) {
    if (win.isDestroyed()) return;
    win.setContentProtection(this.contentProtectionActive);
    if (isHud) {
      enforceTrueFramelessWin32(win);
      win.setAlwaysOnTop(true, "screen-saver");
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  }
  reassertStealthAll() {
    if (this.hud && !this.hud.isDestroyed()) {
      this.applyStealthInvariants(this.hud, true);
    }
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.applyStealthInvariants(this.dashboard, false);
    }
    this.broadcastStealthStatus();
  }
  createHudWindow() {
    const primaryDisplay = electron.screen.getPrimaryDisplay();
    const { x: workX, y: workY, width: workWidth } = primaryDisplay.workArea;
    const initialX = Math.round(workX + (workWidth - HUD_DEFAULT_WIDTH) / 2);
    const initialY = workY + HUD_TOP_MARGIN;
    const hud = new electron.BrowserWindow({
      x: initialX,
      y: initialY,
      width: HUD_DEFAULT_WIDTH,
      height: HUD_COLLAPSED_HEIGHT,
      title: "",
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
      backgroundColor: "#00000000",
      webPreferences: {
        preload: this.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    this.hud = hud;
    hud.setTitle("");
    hud.on("page-title-updated", (e) => {
      e.preventDefault();
    });
    this.applyStealthInvariants(hud, true);
    if (this.clickThrough) {
      hud.setIgnoreMouseEvents(true, { forward: true });
    }
    hud.on("ready-to-show", () => {
      this.applyStealthInvariants(hud, true);
      hud.show();
      this.broadcastStealthStatus();
    });
    hud.on("show", () => {
      enforceTrueFramelessWin32(hud);
      this.broadcastStealthStatus();
    });
    hud.on("hide", () => this.broadcastStealthStatus());
    hud.on("blur", () => {
      const cfg = this.store.getSettings().stealth;
      if (cfg.autoHideOnBlur && hud.isVisible()) {
        hud.hide();
        this.broadcastStealthStatus();
      }
    });
    hud.on("close", (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        if (!hud.isDestroyed()) {
          hud.hide();
          this.broadcastStealthStatus();
        }
      }
    });
    hud.on("closed", () => {
      this.hud = null;
    });
    this.attachLocalShortcuts(hud);
    this.loadRendererPage(hud, "hud");
  }
  createDashboardWindow() {
    const dashboard = new electron.BrowserWindow({
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
      backgroundColor: "#0b0d12",
      webPreferences: {
        preload: this.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    this.dashboard = dashboard;
    this.applyStealthInvariants(dashboard, false);
    const reassertDashboard = () => this.applyStealthInvariants(dashboard, false);
    dashboard.on("show", reassertDashboard);
    dashboard.on("restore", reassertDashboard);
    dashboard.on("focus", reassertDashboard);
    dashboard.on("maximize", () => {
      reassertDashboard();
      if (!dashboard.isDestroyed()) {
        dashboard.webContents.send("dashboard:maximized", true);
      }
    });
    dashboard.on("unmaximize", () => {
      reassertDashboard();
      if (!dashboard.isDestroyed()) {
        dashboard.webContents.send("dashboard:maximized", false);
      }
    });
    dashboard.on("close", (e) => {
      if (!this.isQuitting) {
        e.preventDefault();
        dashboard.hide();
      }
    });
    this.attachLocalShortcuts(dashboard);
    this.loadRendererPage(dashboard, "dashboard");
  }
  syncStealthSettings(stealth) {
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
  syncTray() {
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
    this.tray = new electron.Tray(icon);
    this.tray.setToolTip("StealthIt — Invisible AI Copilot");
    this.tray.on("click", () => {
      this.toggleVisibility();
    });
    this.rebuildTrayMenu();
  }
  rebuildTrayMenu() {
    if (!this.tray) return;
    const menu = electron.Menu.buildFromTemplate([
      {
        label: "Show / Hide HUD (Ctrl+\\)",
        click: () => this.toggleVisibility()
      },
      {
        label: this.clickThrough ? "Disable Ghost Click-Through (Ctrl+Shift+T)" : "Enable Ghost Click-Through (Ctrl+Shift+T)",
        click: () => this.toggleClickThrough()
      },
      {
        label: "Open Stealth Dashboard (Ctrl+Shift+D)",
        click: () => this.openDashboard()
      },
      {
        label: "Reset HUD Position",
        click: () => {
          this.showHud(false);
          this.recenterHud();
        }
      },
      { type: "separator" },
      {
        label: "Quit StealthIt (Ctrl+Shift+Q)",
        click: () => this.quit()
      }
    ]);
    this.tray.setContextMenu(menu);
  }
  setHudSize(width, height) {
    if (!this.hud || this.hud.isDestroyed()) return;
    const bounds = this.hud.getBounds();
    const display = electron.screen.getDisplayMatching(bounds);
    const work = display.workArea;
    const maxHeight = Math.max(320, work.height - 16);
    const clampedHeight = Math.min(maxHeight, Math.max(52, Math.round(height)));
    const clampedWidth = Math.min(work.width - 24, Math.max(360, Math.round(width)));
    const centerX = bounds.x + bounds.width / 2;
    const nextX = Math.max(
      work.x + 8,
      Math.min(work.x + work.width - clampedWidth - 8, Math.round(centerX - clampedWidth / 2))
    );
    const maxY = Math.max(work.y + 8, work.y + work.height - clampedHeight - 8);
    const nextY = Math.min(bounds.y, maxY);
    if (bounds.x === nextX && bounds.y === nextY && bounds.width === clampedWidth && bounds.height === clampedHeight) {
      return;
    }
    this.hud.setBounds({
      x: nextX,
      y: nextY,
      width: clampedWidth,
      height: clampedHeight
    });
  }
  setHudHeight(height) {
    if (!this.hud || this.hud.isDestroyed()) return;
    const { width } = this.hud.getBounds();
    this.setHudSize(width, height);
  }
  setIgnoreMouseEvents(ignore) {
    if (!this.hud || this.hud.isDestroyed()) return;
    if (this.clickThrough) {
      this.hud.setIgnoreMouseEvents(true, { forward: true });
      return;
    }
    this.hud.setIgnoreMouseEvents(ignore, { forward: true });
  }
  toggleClickThrough() {
    this.clickThrough = !this.clickThrough;
    this.store.updateSettings({
      stealth: {
        ...this.store.getSettings().stealth,
        clickThrough: this.clickThrough
      }
    });
    if (this.hud && !this.hud.isDestroyed()) {
      this.hud.setIgnoreMouseEvents(this.clickThrough, { forward: true });
    }
    this.rebuildTrayMenu();
    this.broadcastStealthStatus();
    return this.clickThrough;
  }
  toggleVisibility() {
    if (!this.hud || this.hud.isDestroyed()) return false;
    if (this.hud.isVisible()) {
      this.hud.hide();
      this.broadcastStealthStatus();
      return false;
    }
    this.applyStealthInvariants(this.hud, true);
    this.hud.show();
    if (!this.clickThrough) {
      this.hud.focus();
    }
    this.broadcastStealthStatus();
    return true;
  }
  showHud(focus = true) {
    if (!this.hud || this.hud.isDestroyed()) return;
    this.applyStealthInvariants(this.hud, true);
    if (!this.hud.isVisible()) {
      if (focus && !this.clickThrough) {
        this.hud.show();
      } else {
        this.hud.showInactive();
      }
    }
    if (focus && !this.clickThrough) {
      this.hud.focus();
    }
    this.broadcastStealthStatus();
  }
  moveHud(dx, dy) {
    if (!this.hud || this.hud.isDestroyed()) return;
    const bounds = this.hud.getBounds();
    const target = {
      x: Math.round(bounds.x + bounds.width / 2 + dx),
      y: Math.round(bounds.y + 28 + dy)
    };
    const work = electron.screen.getDisplayNearestPoint(target).workArea;
    const minVisible = 56;
    const nextX = Math.max(work.x, Math.min(work.x + work.width - bounds.width, bounds.x + dx));
    const nextY = Math.max(work.y, Math.min(work.y + work.height - minVisible, bounds.y + dy));
    this.hud.setPosition(Math.round(nextX), Math.round(nextY));
  }
  /** Snap the HUD back to its default top-center spot on the display under the cursor. */
  recenterHud() {
    if (!this.hud || this.hud.isDestroyed()) return;
    const bounds = this.hud.getBounds();
    const work = electron.screen.getDisplayNearestPoint(electron.screen.getCursorScreenPoint()).workArea;
    this.hud.setPosition(
      Math.round(work.x + (work.width - bounds.width) / 2),
      work.y + HUD_TOP_MARGIN
    );
  }
  openDashboard(tab) {
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
      this.dashboard.webContents.send("dashboard:tab", tab);
    }
  }
  toggleDashboard() {
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
  closeDashboard() {
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.dashboard.hide();
    }
  }
  minimizeDashboard() {
    if (this.dashboard && !this.dashboard.isDestroyed()) {
      this.dashboard.hide();
    }
  }
  toggleMaximizeDashboard() {
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
  async withSelfExcludedFromCapture(fn) {
    if (this.contentProtectionActive) {
      return fn();
    }
    const targets = [this.hud, this.dashboard].filter(
      (w) => Boolean(w && !w.isDestroyed())
    );
    for (const w of targets) {
      w.setContentProtection(true);
    }
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
  getStealthStatus() {
    const settings = this.store.getSettings();
    return {
      contentProtectionActive: this.contentProtectionActive,
      clickThrough: this.clickThrough,
      visible: Boolean(this.hud && !this.hud.isDestroyed() && this.hud.isVisible()),
      opacity: settings.stealth.opacity,
      platform: process.platform,
      encryptionAvailable: this.store.isEncryptionAvailable()
    };
  }
  broadcastStealthStatus() {
    const status = this.getStealthStatus();
    for (const win of [this.hud, this.dashboard]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send("stealth:status", status);
      }
    }
    if (this.visibilityListener && status.visible !== this.lastReportedVisible) {
      this.lastReportedVisible = status.visible;
      this.visibilityListener(status.visible);
    }
  }
  broadcastSettings() {
    const settings = this.store.getSettings();
    for (const win of [this.hud, this.dashboard]) {
      if (win && !win.isDestroyed()) {
        win.webContents.send("settings:changed", settings);
      }
    }
  }
  sendHotkeyToHud(action) {
    if (this.hud && !this.hud.isDestroyed()) {
      this.hud.webContents.send("hotkey:action", { action });
    }
  }
}
const gotSingleInstanceLock = electron.app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  electron.app.quit();
}
let store;
let windows;
const activeStreams = /* @__PURE__ */ new Map();
function setupSystemAudioLoopbackHandler() {
  electron.session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await electron.desktopCapturer.getSources({ types: ["screen"] });
      if (sources.length > 0) {
        callback({ video: sources[0], audio: "loopback" });
      } else {
        callback({});
      }
    } catch {
      callback({});
    }
  });
}
function registerIpcHandlers() {
  electron.ipcMain.handle("stealth:get-status", () => windows.getStealthStatus());
  electron.ipcMain.handle("window:set-hud-height", (_e, height) => {
    windows.setHudHeight(height);
  });
  electron.ipcMain.handle("window:set-hud-size", (_e, width, height) => {
    windows.setHudSize(width, height);
  });
  electron.ipcMain.handle("window:set-ignore-mouse", (_e, ignore) => {
    windows.setIgnoreMouseEvents(ignore);
  });
  electron.ipcMain.handle("window:toggle-click-through", () => windows.toggleClickThrough());
  electron.ipcMain.handle("window:toggle-visibility", () => windows.toggleVisibility());
  electron.ipcMain.handle("window:open-dashboard", (_e, tab) => {
    windows.openDashboard(tab);
  });
  electron.ipcMain.handle("window:close-dashboard", () => {
    windows.closeDashboard();
  });
  electron.ipcMain.handle("window:minimize-dashboard", () => {
    windows.minimizeDashboard();
  });
  electron.ipcMain.handle("window:toggle-maximize-dashboard", () => windows.toggleMaximizeDashboard());
  electron.ipcMain.handle("window:move-hud", (_e, dx, dy) => {
    windows.moveHud(dx, dy);
  });
  electron.ipcMain.handle("shell:open-external", async (_e, rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
        await electron.shell.openExternal(parsed.toString());
      }
    } catch {
    }
  });
  electron.ipcMain.handle("app:quit", () => {
    windows.quit();
  });
  electron.ipcMain.handle("capture:screen", async () => {
    const settings = store.getSettings();
    const savedRegion = settings.captureRegion ? settings.captureRegionBounds : null;
    const t0 = Date.now();
    const res = await windows.withSelfExcludedFromCapture(() => captureActiveScreen(savedRegion));
    logger.info("capture", "Captured screen", {
      width: res.width,
      height: res.height,
      region: Boolean(savedRegion),
      ms: Date.now() - t0
    });
    return res;
  });
  electron.ipcMain.handle(
    "capture:select-region",
    async () => pickCaptureRegion(() => windows.withSelfExcludedFromCapture(() => grabFrozenFrame()))
  );
  electron.ipcMain.handle("settings:get", () => store.getSettings());
  electron.ipcMain.handle("settings:update", (_e, partial) => {
    const updated = store.updateSettings(partial);
    if (partial.stealth) {
      windows.syncStealthSettings(updated.stealth);
    }
    if (partial.shareBetaLogs !== void 0) {
      logger.setAutoSend(Boolean(updated.shareBetaLogs));
    }
    windows.broadcastSettings();
    return updated;
  });
  electron.ipcMain.handle("secrets:status", () => store.getSecretStatus());
  electron.ipcMain.handle("secrets:set", (_e, key, value) => {
    const status = store.setSecret(key, value);
    if ((key === "openai" || key === "gemini") && status[key]) {
      const current = store.getSettings();
      if (current.stt.provider === "deepgram" && !status.deepgram) {
        store.updateSettings({
          stt: {
            ...current.stt,
            provider: key === "openai" ? "openai-whisper" : "gemini-audio",
            model: key === "openai" ? "whisper-1" : "gemini-2.5-flash"
          }
        });
      }
    }
    windows.broadcastSettings();
    return status;
  });
  electron.ipcMain.handle("secrets:clear", (_e, key) => {
    const status = store.clearSecret(key);
    if (key === "openai" || key === "anthropic" || key === "gemini" || key === "openrouter") {
      const current = store.getSettings();
      store.updateSettings({
        providers: {
          ...current.providers,
          [key]: { ...current.providers[key], cachedModels: [] }
        }
      });
      windows.broadcastSettings();
    }
    return status;
  });
  electron.ipcMain.handle("secrets:deepgram-token", () => store.getSecret("deepgram"));
  electron.ipcMain.handle("personas:get", () => store.getPersonas());
  electron.ipcMain.handle("personas:save", (_e, persona) => store.savePersona(persona));
  electron.ipcMain.handle("personas:delete", (_e, id) => store.deletePersona(id));
  electron.ipcMain.handle("sessions:get", () => store.getSessions());
  electron.ipcMain.handle("sessions:save", (_e, sessionRecord) => {
    store.saveSession(sessionRecord);
  });
  electron.ipcMain.handle("sessions:delete", (_e, id) => store.deleteSession(id));
  electron.ipcMain.handle("sessions:clear-all", () => {
    store.clearAllSessions();
  });
  electron.ipcMain.handle("ai:ask", (event, req) => {
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    activeStreams.set(requestId, controller);
    const settings = store.getSettings();
    const persona = store.getActivePersona();
    const assembled = assemblePromptContext({
      persona,
      settings,
      prompt: req.prompt,
      transcript: req.transcript,
      history: req.history,
      screenshotDataUrl: req.screenshotDataUrl
    });
    const sender = event.sender;
    const primaryProvider = settings.activeProvider;
    const primaryModel = settings.providers[primaryProvider].model;
    const fb = settings.fallback;
    const canFallback = Boolean(fb?.enabled) && Boolean(fb.model?.trim()) && (fb.provider !== primaryProvider || fb.model.trim() !== primaryModel);
    const startedAt = Date.now();
    logger.info("ai", "AI request started", {
      provider: primaryProvider,
      model: primaryModel,
      hasScreenshot: Boolean(req.screenshotDataUrl),
      history: req.history.length,
      transcriptLines: req.transcript.length,
      fallbackEnabled: canFallback
    });
    const runAttempt = async (providerId, modelName, timeoutMs) => {
      const attemptController = new AbortController();
      const onOuterAbort = () => attemptController.abort();
      controller.signal.addEventListener("abort", onOuterAbort, { once: true });
      let firstTokenAt = null;
      let timedOut = false;
      const attemptStart = Date.now();
      let watchdog = null;
      if (timeoutMs && timeoutMs > 0) {
        watchdog = setTimeout(() => {
          if (firstTokenAt === null && !controller.signal.aborted) {
            timedOut = true;
            attemptController.abort();
          }
        }, timeoutMs);
      }
      try {
        const fullText = await streamAIResponse({
          settings,
          store,
          assembled,
          signal: attemptController.signal,
          providerOverride: providerId,
          modelOverride: modelName,
          onChunk: (delta) => {
            if (firstTokenAt === null) {
              firstTokenAt = Date.now();
              if (watchdog) {
                clearTimeout(watchdog);
                watchdog = null;
              }
            }
            if (!sender.isDestroyed()) {
              sender.send("ai:chunk", { requestId, delta });
            }
          }
        });
        logger.info("ai", "AI request completed", {
          provider: providerId,
          model: modelName,
          ttftMs: firstTokenAt ? firstTokenAt - attemptStart : Date.now() - attemptStart,
          totalMs: Date.now() - attemptStart,
          chars: fullText.length
        });
        return fullText;
      } catch (err) {
        if (timedOut) {
          throw new Error(
            `${providerId.toUpperCase()} (${modelName}) timed out waiting ${Math.round((timeoutMs ?? 0) / 1e3)}s for first token.`
          );
        }
        throw err;
      } finally {
        if (watchdog) clearTimeout(watchdog);
        controller.signal.removeEventListener("abort", onOuterAbort);
      }
    };
    void (async () => {
      try {
        const timeoutMs = canFallback ? Math.max(5, Math.min(180, fb.timeoutSec || 20)) * 1e3 : null;
        let fullText;
        try {
          fullText = await runAttempt(primaryProvider, primaryModel, timeoutMs);
        } catch (primaryErr) {
          if (controller.signal.aborted) {
            throw primaryErr;
          }
          const primaryMsg = primaryErr instanceof Error ? primaryErr.message : "Primary provider failed.";
          if (!canFallback) {
            throw primaryErr;
          }
          logger.warn("ai", `Primary failed — switching to fallback`, {
            primary: `${primaryProvider}/${primaryModel}`,
            fallback: `${fb.provider}/${fb.model.trim()}`,
            elapsedMs: Date.now() - startedAt,
            reason: primaryMsg.slice(0, 180)
          });
          fullText = await runAttempt(fb.provider, fb.model.trim(), null);
        }
        activeStreams.delete(requestId);
        if (!sender.isDestroyed()) {
          sender.send("ai:done", { requestId, fullText });
        }
      } catch (err) {
        activeStreams.delete(requestId);
        if (controller.signal.aborted) {
          logger.info("ai", "AI request aborted by user", {
            provider: primaryProvider,
            elapsedMs: Date.now() - startedAt
          });
          if (!sender.isDestroyed()) {
            sender.send("ai:done", { requestId, fullText: "" });
          }
          return;
        }
        const message = err instanceof Error ? err.message : "AI request failed.";
        logger.error("ai", "AI request failed", {
          provider: primaryProvider,
          model: primaryModel,
          elapsedMs: Date.now() - startedAt,
          error: message.slice(0, 220)
        });
        if (!sender.isDestroyed()) {
          sender.send("ai:error", { requestId, error: message });
        }
      }
    })();
    return { requestId };
  });
  electron.ipcMain.handle("ai:abort", (_e, requestId) => {
    const controller = activeStreams.get(requestId);
    if (controller) {
      controller.abort();
      activeStreams.delete(requestId);
    }
  });
  electron.ipcMain.handle(
    "ai:test-provider",
    async (_e, provider) => testProviderConnection(store, provider)
  );
  electron.ipcMain.handle("ai:fetch-models", async (_e, provider) => {
    const result = await fetchProviderModels(store, provider);
    if (result.ok && result.models.length > 0) {
      const current = store.getSettings();
      store.updateSettings({
        providers: {
          ...current.providers,
          [provider]: {
            ...current.providers[provider],
            cachedModels: result.models
          }
        }
      });
      windows.broadcastSettings();
    }
    return result;
  });
  electron.ipcMain.handle("ai:ollama-models", async (_e, baseUrl) => fetchOllamaModels(baseUrl));
  electron.ipcMain.handle("stt:transcribe", async (_e, req) => {
    const t0 = Date.now();
    const result = await transcribeAudioChunk(store, req);
    const ms = Date.now() - t0;
    if (result.error) {
      logger.error("stt", "STT transcription error", {
        provider: store.getSettings().stt.provider,
        speaker: req.speaker,
        ms,
        error: result.error.slice(0, 180)
      });
    } else if (ms > 3e3) {
      logger.warn("stt", "Slow STT transcription", {
        provider: store.getSettings().stt.provider,
        speaker: req.speaker,
        ms,
        chars: result.text.length
      });
    }
    return result;
  });
  logger.setAutoSend(Boolean(store.getSettings().shareBetaLogs));
  electron.ipcMain.handle("logs:get", () => logger.getEntries());
  electron.ipcMain.handle("logs:clear", () => {
    logger.clear();
  });
  electron.ipcMain.handle("logs:open-folder", async () => {
    const dir = logger.getLogDir();
    if (dir) {
      await electron.shell.openPath(dir);
    }
  });
  electron.ipcMain.handle(
    "logs:send-report",
    async (_e, note) => logger.sendDiagnosticReport(note)
  );
}
electron.app.on("second-instance", () => {
  windows?.showHud(true);
});
void electron.app.whenReady().then(() => {
  store = new LocalStore();
  windows = new WindowManager(store);
  setupSystemAudioLoopbackHandler();
  registerIpcHandlers();
  windows.createWindows();
  registerGlobalHotkeys(windows);
});
electron.app.on("will-quit", () => {
  unregisterGlobalHotkeys();
  for (const ctrl of activeStreams.values()) {
    ctrl.abort();
  }
  activeStreams.clear();
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
