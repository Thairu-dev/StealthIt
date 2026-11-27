import { contextBridge, ipcRenderer } from 'electron';
import type {
  AIProviderId,
  AIStreamChunkEvent,
  AIStreamDoneEvent,
  AIStreamErrorEvent,
  AppSettings,
  AskAIRequest,
  HotkeyActionEvent,
  PersonaPreset,
  SecretKeyName,
  SessionRecord,
  StealthItBridge,
  StealthStatus,
  TranscribeChunkRequest,
} from '@shared/types';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: StealthItBridge = {
  // Window & Stealth
  getStealthStatus: () => ipcRenderer.invoke('stealth:get-status'),
  setHudHeight: (height: number) => ipcRenderer.invoke('window:set-hud-height', height),
  setHudSize: (width: number, height: number) =>
    ipcRenderer.invoke('window:set-hud-size', width, height),
  setIgnoreMouseEvents: (ignore: boolean) =>
    ipcRenderer.invoke('window:set-ignore-mouse', ignore),
  toggleClickThrough: () => ipcRenderer.invoke('window:toggle-click-through'),
  toggleVisibility: () => ipcRenderer.invoke('window:toggle-visibility'),
  openDashboard: (tab?: string) => ipcRenderer.invoke('window:open-dashboard', tab),
  closeDashboard: () => ipcRenderer.invoke('window:close-dashboard'),
  minimizeDashboard: () => ipcRenderer.invoke('window:minimize-dashboard'),
  toggleMaximizeDashboard: () => ipcRenderer.invoke('window:toggle-maximize-dashboard'),
  moveHud: (dx: number, dy: number) => ipcRenderer.invoke('window:move-hud', dx, dy),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  quitApp: () => ipcRenderer.invoke('app:quit'),

  // Screen Capture
  captureScreen: () => ipcRenderer.invoke('capture:screen'),
  selectCaptureRegion: () => ipcRenderer.invoke('capture:select-region'),

  // Settings & Secrets
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:update', partial),
  getSecretStatus: () => ipcRenderer.invoke('secrets:status'),
  setSecret: (key: SecretKeyName, value: string) =>
    ipcRenderer.invoke('secrets:set', key, value),
  clearSecret: (key: SecretKeyName) => ipcRenderer.invoke('secrets:clear', key),
  getDeepgramToken: () => ipcRenderer.invoke('secrets:deepgram-token'),

  // Personas & Sessions
  getPersonas: () => ipcRenderer.invoke('personas:get'),
  savePersona: (persona: PersonaPreset) => ipcRenderer.invoke('personas:save', persona),
  deletePersona: (id: string) => ipcRenderer.invoke('personas:delete', id),
  getSessions: () => ipcRenderer.invoke('sessions:get'),
  saveSession: (session: SessionRecord) => ipcRenderer.invoke('sessions:save', session),
  deleteSession: (id: string) => ipcRenderer.invoke('sessions:delete', id),
  clearAllSessions: () => ipcRenderer.invoke('sessions:clear-all'),

  // AI & STT
  askAI: (req: AskAIRequest) => ipcRenderer.invoke('ai:ask', req),
  abortAI: (requestId: string) => ipcRenderer.invoke('ai:abort', requestId),
  testProvider: (provider: AIProviderId) => ipcRenderer.invoke('ai:test-provider', provider),
  fetchProviderModels: (provider: AIProviderId) =>
    ipcRenderer.invoke('ai:fetch-models', provider),
  fetchOllamaModels: (baseUrl: string) => ipcRenderer.invoke('ai:ollama-models', baseUrl),
  transcribeChunk: (req: TranscribeChunkRequest) => ipcRenderer.invoke('stt:transcribe', req),

  // Logs
  getLogs: () => ipcRenderer.invoke('logs:get'),
  clearLogs: () => ipcRenderer.invoke('logs:clear'),
  openLogsFolder: () => ipcRenderer.invoke('logs:open-folder'),
  sendBetaLogs: (note?: string) => ipcRenderer.invoke('logs:send-report', note),

  // Events
  onAIChunk: (cb: (event: AIStreamChunkEvent) => void) => subscribe('ai:chunk', cb),
  onAIDone: (cb: (event: AIStreamDoneEvent) => void) => subscribe('ai:done', cb),
  onAIError: (cb: (event: AIStreamErrorEvent) => void) => subscribe('ai:error', cb),
  onHotkey: (cb: (event: HotkeyActionEvent) => void) => subscribe('hotkey:action', cb),
  onSettingsChanged: (cb: (settings: AppSettings) => void) => subscribe('settings:changed', cb),
  onStealthStatusChanged: (cb: (status: StealthStatus) => void) =>
    subscribe('stealth:status', cb),
  onDashboardTab: (cb: (tab: string) => void) => subscribe('dashboard:tab', cb),
  onDashboardMaximized: (cb: (maximized: boolean) => void) =>
    subscribe('dashboard:maximized', cb),
};

contextBridge.exposeInMainWorld('stealthit', bridge);
