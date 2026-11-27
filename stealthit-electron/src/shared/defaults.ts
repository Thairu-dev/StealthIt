import type { AIProviderId, AppSettings, PersonaPreset, ProviderConfig, QuickAction } from './types';

export const BUILT_IN_PERSONAS: PersonaPreset[] = [
  {
    id: 'general',
    name: 'General',
    tagline: 'Everyday assistant for quick answers, writing, research, and screen help',
    builtIn: true,
    systemPrompt:
      'You are StealthIt, a fast, helpful desktop AI assistant. Answer the user’s message directly, accurately, and concisely. If a screenshot or live transcript is attached, use it carefully; otherwise reply naturally to their question without assuming extra context.',
  },
  {
    id: 'general-meeting',
    name: 'Meeting Copilot',
    tagline: 'Crisp answers, live talking points, and structured recaps',
    builtIn: true,
    systemPrompt:
      'You are StealthIt, a fast, helpful meeting copilot. When a live transcript or screenshot is provided, give immediately usable talking points, crisp bullets, or exact phrasing the user can say out loud. When no transcript or screenshot is provided, reply naturally without making up meeting details.',
  },
  {
    id: 'technical-interview',
    name: 'Technical & Coding',
    tagline: 'Algorithms, system design, complexity, and edge cases',
    builtIn: true,
    systemPrompt:
      'You are StealthIt, an expert principal engineer copilot for technical discussions and coding sessions. Lead with the optimal approach in 2-3 concise bullets, state time/space complexity clearly, highlight key edge cases, and provide clean, production-quality code. Avoid fluff.',
  },
  {
    id: 'sales-discovery',
    name: 'Sales & Objections',
    tagline: 'Objection handling, discovery questions, and value framing',
    builtIn: true,
    systemPrompt:
      'You are StealthIt, a sharp enterprise solutions engineer and sales copilot. When an objection, pricing question, or competitor mention appears in the transcript or screen, give: (1) a 1-sentence empathetic bridge, (2) a crisp value rebuttal, and (3) one high-leverage follow-up question to keep momentum.',
  },
];

export const DEFAULT_SCREEN_CAPTURE_PROMPT =
  'Analyze what is currently visible on my screen. Explain the core problem or content clearly and give me the sharpest, most actionable answer or solution.';

export const SCREEN_CAPTURE_PRESETS: Array<{ label: string; prompt: string }> = [
  {
    label: 'General Screen',
    prompt: DEFAULT_SCREEN_CAPTURE_PROMPT,
  },
  {
    label: 'Coding / LeetCode',
    prompt:
      'Read the coding problem or error on my screen. Give me: (1) optimal approach in 2-3 bullets, (2) time & space complexity, (3) edge cases to mention, and (4) clean, bug-free solution code.',
  },
  {
    label: 'Sales / Deck',
    prompt:
      'Read the slide, document, or pricing table on my screen. Give me 3 sharp talking points, likely client objections, and one strong follow-up question.',
  },
  {
    label: 'Data / Charts',
    prompt:
      'Extract the key metrics, anomalies, and trends from the spreadsheet, chart, or dashboard on my screen. Summarize the takeaway in 3 concise executive bullets.',
  },
];

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'what-to-say',
    label: 'What should I say?',
    shortLabel: 'Assist',
    prompt:
      'Based on the recent conversation transcript and current context, give me the sharpest, most natural response I can say right now. Lead with a direct 1-2 sentence spoken answer, followed by 2-3 brief supporting bullets if helpful.',
  },
  {
    id: 'analyze-screen',
    label: 'Analyze screen',
    shortLabel: 'Screen',
    includeScreenshot: true,
    prompt: DEFAULT_SCREEN_CAPTURE_PROMPT,
  },
  {
    id: 'follow-up',
    label: 'Follow-up questions',
    shortLabel: 'Follow-up',
    prompt:
      'Give me 3 sharp, thoughtful follow-up questions I can ask next based on the conversation so far. Keep each question under 20 words.',
  },
  {
    id: 'recap',
    label: 'Recap meeting',
    shortLabel: 'Recap',
    prompt:
      'Summarize the conversation so far into: Key Decisions, Open Questions, and Action Items. Be terse and scannable.',
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: 'openai',
  providers: {
    openai: {
      id: 'openai',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
    },
    anthropic: {
      id: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.anthropic.com',
    },
    gemini: {
      id: 'gemini',
      model: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com',
    },
    openrouter: {
      id: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    ollama: {
      id: 'ollama',
      model: 'llama3.2-vision',
      baseUrl: 'http://localhost:11434',
    },
  },
  fallback: {
    enabled: false,
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash',
    timeoutSec: 20,
  },
  stt: {
    provider: 'deepgram',
    model: 'nova-3',
    language: 'en',
    localUrl: 'http://localhost:8000/v1/audio/transcriptions',
    captureSystemAudio: true,
    captureMicrophone: true,
    micDeviceId: 'default',
    vadSilenceMs: 1100,
    vadThreshold: 0.026,
  },
  stealth: {
    contentProtection: true,
    clickThrough: false,
    opacity: 0.96,
    hideTrayIcon: false,
    autoHideOnBlur: false,
  },
  activePersonaId: 'general',
  userContext: '',
  attachUserContext: true,
  screenCapturePrompt: DEFAULT_SCREEN_CAPTURE_PROMPT,
  captureRegion: false,
  captureRegionBounds: null,
  responseStyle: 'concise',
  theme: 'dark',
  shareBetaLogs: false,
};

export const PROVIDER_META = {
  openai: {
    label: 'OpenAI',
    defaultModels: ['gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
    requiresKey: true,
  },
  anthropic: {
    label: 'Anthropic Claude',
    defaultModels: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest'],
    requiresKey: true,
  },
  gemini: {
    label: 'Google Gemini',
    defaultModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    requiresKey: true,
  },
  openrouter: {
    label: 'OpenRouter / Custom',
    defaultModels: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.5-flash', 'deepseek/deepseek-r1'],
    requiresKey: true,
  },
  ollama: {
    label: 'Ollama (Local)',
    defaultModels: ['llama3.2-vision', 'qwen2.5-coder:14b', 'llama3.2', 'gemma3:12b'],
    requiresKey: false,
  },
} as const;

export function isApiKeyOptional(
  providerId: AIProviderId,
  config?: Pick<ProviderConfig, 'baseUrl' | 'useCustomBaseUrl'>
): boolean {
  if (providerId === 'ollama') return true;
  if (providerId !== 'openai' && providerId !== 'openrouter') return false;
  if (config?.useCustomBaseUrl === true) return true;
  if (config?.useCustomBaseUrl === false) return false;
  const cleaned = (config?.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!cleaned) return false;
  const defaultUrl = (DEFAULT_SETTINGS.providers[providerId].baseUrl ?? '').replace(/\/+$/, '');
  return cleaned !== defaultUrl;
}
