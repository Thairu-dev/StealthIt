export type AIProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'ollama';

export type STTProviderId =
  | 'deepgram'
  | 'openai-whisper'
  | 'groq-whisper'
  | 'gemini-audio'
  | 'local-whisper';

export type SpeakerRole = 'them' | 'you';

export interface TranscriptSegment {
  id: string;
  speaker: SpeakerRole;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface ThinkingStep {
  id: string;
  label: string;
  detail?: string;
  status: 'done' | 'active';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  hasScreenshot?: boolean;
  quickAction?: string;
  thinkingSteps?: ThinkingStep[];
  durationMs?: number;
}

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  personaId: string;
  messages: ChatMessage[];
  transcript: TranscriptSegment[];
}

export interface PersonaPreset {
  id: string;
  name: string;
  tagline: string;
  systemPrompt: string;
  builtIn?: boolean;
}

export interface ProviderConfig {
  id: AIProviderId;
  model: string;
  baseUrl?: string;
  useCustomBaseUrl?: boolean;
  cachedModels?: string[];
}

export interface STTConfig {
  provider: STTProviderId;
  model: string;
  language: string;
  localUrl: string;
  captureSystemAudio: boolean;
  captureMicrophone: boolean;
  micDeviceId: string;
  vadSilenceMs: number;
  vadThreshold: number;
}

export interface StealthSettings {
  contentProtection: boolean;
  clickThrough: boolean;
  opacity: number; // 0.35 - 1.0
  hideTrayIcon: boolean;
  autoHideOnBlur: boolean;
}

export interface FallbackConfig {
  enabled: boolean;
  provider: AIProviderId;
  model: string;
  /** Seconds to wait for the first token before automatically failing over */
  timeoutSec: number;
}

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'ai' | 'stt' | 'capture' | 'system';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  meta?: Record<string, string | number | boolean>;
}

export interface AppSettings {
  activeProvider: AIProviderId;
  providers: Record<AIProviderId, ProviderConfig>;
  fallback: FallbackConfig;
  stt: STTConfig;
  stealth: StealthSettings;
  activePersonaId: string;
  userContext: string; // Resume, role, meeting notes, product sheet
  attachUserContext: boolean; // Attached by default; can be toggled off on the HUD
  screenCapturePrompt: string; // Default prompt used for Ctrl+Enter & Analyze Screen
  captureRegion: boolean; // When on, captures only the saved screen area
  captureRegionBounds?: CaptureRegionBounds | null;
  responseStyle: 'concise' | 'balanced' | 'detailed';
  theme: 'dark' | 'light';
  /** Opt-in (off by default): auto-send sanitized error/warning logs to help improve Beta */
  shareBetaLogs: boolean;
}

export type SecretKeyName =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'deepgram'
  | 'groq';

export interface SecretStatusMap {
  openai: boolean;
  anthropic: boolean;
  gemini: boolean;
  openrouter: boolean;
  deepgram: boolean;
  groq: boolean;
}

export interface QuickAction {
  id: string;
  label: string;
  shortLabel: string;
  prompt: string;
  includeScreenshot?: boolean;
}

export interface AskAIRequest {
  sessionId: string;
  prompt: string;
  screenshotDataUrl?: string;
  quickActionLabel?: string;
  transcript: TranscriptSegment[];
  history: ChatMessage[];
}

export interface AIStreamChunkEvent {
  requestId: string;
  delta: string;
}

export interface AIStreamDoneEvent {
  requestId: string;
  fullText: string;
}

export interface AIStreamErrorEvent {
  requestId: string;
  error: string;
}

export interface TranscribeChunkRequest {
  wavBase64: string;
  speaker: SpeakerRole;
}

export interface TranscribeChunkResult {
  text: string;
  speaker: SpeakerRole;
  error?: string;
}

export interface StealthStatus {
  contentProtectionActive: boolean;
  clickThrough: boolean;
  visible: boolean;
  opacity: number;
  platform: string;
  encryptionAvailable: boolean;
}

export interface CaptureRegionBounds {
  displayId: string;
  /** Normalized 0..1 coordinates within the captured display */
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
  displayLabel: string;
}

export interface HotkeyActionEvent {
  action:
    | 'toggle-visibility'
    | 'toggle-expand'
    | 'ask-screen'
    | 'ask-assist'
    | 'toggle-listen'
    | 'toggle-click-through'
    | 'open-dashboard'
    | 'panic-clear';
}

export interface StealthItBridge {
  // Window & Stealth
  getStealthStatus: () => Promise<StealthStatus>;
  setHudHeight: (height: number) => Promise<void>;
  setHudSize: (width: number, height: number) => Promise<void>;
  setIgnoreMouseEvents: (ignore: boolean) => Promise<void>;
  toggleClickThrough: () => Promise<boolean>;
  toggleVisibility: () => Promise<boolean>;
  openDashboard: (tab?: string) => Promise<void>;
  closeDashboard: () => Promise<void>;
  minimizeDashboard: () => Promise<void>;
  toggleMaximizeDashboard: () => Promise<boolean>;
  moveHud: (dx: number, dy: number) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  quitApp: () => Promise<void>;

  // Screen Capture
  captureScreen: () => Promise<CaptureResult | null>;
  selectCaptureRegion: () => Promise<CaptureRegionBounds | null>;

  // Settings & Secrets
  getSettings: () => Promise<AppSettings>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  getSecretStatus: () => Promise<SecretStatusMap>;
  setSecret: (key: SecretKeyName, value: string) => Promise<SecretStatusMap>;
  clearSecret: (key: SecretKeyName) => Promise<SecretStatusMap>;
  getDeepgramToken: () => Promise<string | null>;

  // Personas & Sessions
  getPersonas: () => Promise<PersonaPreset[]>;
  savePersona: (persona: PersonaPreset) => Promise<PersonaPreset[]>;
  deletePersona: (id: string) => Promise<PersonaPreset[]>;
  getSessions: () => Promise<SessionRecord[]>;
  saveSession: (session: SessionRecord) => Promise<void>;
  deleteSession: (id: string) => Promise<SessionRecord[]>;
  clearAllSessions: () => Promise<void>;

  // AI & STT
  askAI: (req: AskAIRequest) => Promise<{ requestId: string }>;
  abortAI: (requestId: string) => Promise<void>;
  testProvider: (provider: AIProviderId) => Promise<{ ok: boolean; message: string }>;
  fetchProviderModels: (
    provider: AIProviderId
  ) => Promise<{ ok: boolean; models: string[]; error?: string }>;
  fetchOllamaModels: (baseUrl: string) => Promise<string[]>;
  transcribeChunk: (req: TranscribeChunkRequest) => Promise<TranscribeChunkResult>;

  // Logs
  getLogs: () => Promise<LogEntry[]>;
  clearLogs: () => Promise<void>;
  openLogsFolder: () => Promise<void>;
  sendBetaLogs: (note?: string) => Promise<{ ok: boolean; message: string }>;

  // Events
  onAIChunk: (cb: (event: AIStreamChunkEvent) => void) => () => void;
  onAIDone: (cb: (event: AIStreamDoneEvent) => void) => () => void;
  onAIError: (cb: (event: AIStreamErrorEvent) => void) => () => void;
  onHotkey: (cb: (event: HotkeyActionEvent) => void) => () => void;
  onSettingsChanged: (cb: (settings: AppSettings) => void) => () => void;
  onStealthStatusChanged: (cb: (status: StealthStatus) => void) => () => void;
  onDashboardTab: (cb: (tab: string) => void) => () => void;
  onDashboardMaximized: (cb: (maximized: boolean) => void) => () => void;
}
