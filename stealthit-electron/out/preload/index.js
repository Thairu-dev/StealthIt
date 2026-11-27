"use strict";
const electron = require("electron");
function subscribe(channel, cb) {
  const listener = (_event, payload) => {
    cb(payload);
  };
  electron.ipcRenderer.on(channel, listener);
  return () => {
    electron.ipcRenderer.removeListener(channel, listener);
  };
}
const bridge = {
  // Window & Stealth
  getStealthStatus: () => electron.ipcRenderer.invoke("stealth:get-status"),
  setHudHeight: (height) => electron.ipcRenderer.invoke("window:set-hud-height", height),
  setHudSize: (width, height) => electron.ipcRenderer.invoke("window:set-hud-size", width, height),
  setIgnoreMouseEvents: (ignore) => electron.ipcRenderer.invoke("window:set-ignore-mouse", ignore),
  toggleClickThrough: () => electron.ipcRenderer.invoke("window:toggle-click-through"),
  toggleVisibility: () => electron.ipcRenderer.invoke("window:toggle-visibility"),
  openDashboard: (tab) => electron.ipcRenderer.invoke("window:open-dashboard", tab),
  closeDashboard: () => electron.ipcRenderer.invoke("window:close-dashboard"),
  minimizeDashboard: () => electron.ipcRenderer.invoke("window:minimize-dashboard"),
  toggleMaximizeDashboard: () => electron.ipcRenderer.invoke("window:toggle-maximize-dashboard"),
  moveHud: (dx, dy) => electron.ipcRenderer.invoke("window:move-hud", dx, dy),
  openExternal: (url) => electron.ipcRenderer.invoke("shell:open-external", url),
  quitApp: () => electron.ipcRenderer.invoke("app:quit"),
  // Screen Capture
  captureScreen: () => electron.ipcRenderer.invoke("capture:screen"),
  selectCaptureRegion: () => electron.ipcRenderer.invoke("capture:select-region"),
  // Settings & Secrets
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  updateSettings: (partial) => electron.ipcRenderer.invoke("settings:update", partial),
  getSecretStatus: () => electron.ipcRenderer.invoke("secrets:status"),
  setSecret: (key, value) => electron.ipcRenderer.invoke("secrets:set", key, value),
  clearSecret: (key) => electron.ipcRenderer.invoke("secrets:clear", key),
  getDeepgramToken: () => electron.ipcRenderer.invoke("secrets:deepgram-token"),
  // Personas & Sessions
  getPersonas: () => electron.ipcRenderer.invoke("personas:get"),
  savePersona: (persona) => electron.ipcRenderer.invoke("personas:save", persona),
  deletePersona: (id) => electron.ipcRenderer.invoke("personas:delete", id),
  getSessions: () => electron.ipcRenderer.invoke("sessions:get"),
  saveSession: (session) => electron.ipcRenderer.invoke("sessions:save", session),
  deleteSession: (id) => electron.ipcRenderer.invoke("sessions:delete", id),
  clearAllSessions: () => electron.ipcRenderer.invoke("sessions:clear-all"),
  // AI & STT
  askAI: (req) => electron.ipcRenderer.invoke("ai:ask", req),
  abortAI: (requestId) => electron.ipcRenderer.invoke("ai:abort", requestId),
  testProvider: (provider) => electron.ipcRenderer.invoke("ai:test-provider", provider),
  fetchProviderModels: (provider) => electron.ipcRenderer.invoke("ai:fetch-models", provider),
  fetchOllamaModels: (baseUrl) => electron.ipcRenderer.invoke("ai:ollama-models", baseUrl),
  transcribeChunk: (req) => electron.ipcRenderer.invoke("stt:transcribe", req),
  // Logs
  getLogs: () => electron.ipcRenderer.invoke("logs:get"),
  clearLogs: () => electron.ipcRenderer.invoke("logs:clear"),
  openLogsFolder: () => electron.ipcRenderer.invoke("logs:open-folder"),
  sendBetaLogs: (note) => electron.ipcRenderer.invoke("logs:send-report", note),
  // Events
  onAIChunk: (cb) => subscribe("ai:chunk", cb),
  onAIDone: (cb) => subscribe("ai:done", cb),
  onAIError: (cb) => subscribe("ai:error", cb),
  onHotkey: (cb) => subscribe("hotkey:action", cb),
  onSettingsChanged: (cb) => subscribe("settings:changed", cb),
  onStealthStatusChanged: (cb) => subscribe("stealth:status", cb),
  onDashboardTab: (cb) => subscribe("dashboard:tab", cb),
  onDashboardMaximized: (cb) => subscribe("dashboard:maximized", cb)
};
electron.contextBridge.exposeInMainWorld("stealthit", bridge);
