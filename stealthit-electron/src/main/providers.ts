import type { AssembledPrompt } from '@shared/context';
import { isApiKeyOptional } from '@shared/defaults';
import type { AIProviderId, AppSettings } from '@shared/types';
import type { LocalStore } from './storage';

export interface ParsedDataUrl {
  mimeType: string;
  base64: string;
}

export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

export function extractOpenAISseDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    return parsed.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

export function extractAnthropicSseDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as {
      type?: string;
      delta?: { type?: string; text?: string };
    };
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      return parsed.delta.text ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractGeminiSseDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const parts = parsed.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) return null;
    return parts.map((p) => p.text ?? '').join('');
  } catch {
    return null;
  }
}

export function extractOllamaNdjsonDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      message?: { content?: string };
    };
    return parsed.message?.content ?? null;
  } catch {
    return null;
  }
}

async function consumeLineStream(
  body: ReadableStream<Uint8Array>,
  extractor: (line: string) => string | null,
  onChunk: (delta: string) => void
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx = buffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      const delta = extractor(line);
      if (delta) {
        fullText += delta;
        onChunk(delta);
      }
      newlineIdx = buffer.indexOf('\n');
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

function getProviderApiKey(store: LocalStore, provider: AIProviderId): string | null {
  if (provider === 'ollama') return null;
  return store.getSecret(provider);
}

export async function streamAIResponse(params: {
  settings: AppSettings;
  store: LocalStore;
  assembled: AssembledPrompt;
  signal: AbortSignal;
  onChunk: (delta: string) => void;
  providerOverride?: AIProviderId;
  modelOverride?: string;
}): Promise<string> {
  const { settings, store, assembled, signal, onChunk, providerOverride, modelOverride } = params;
  const providerId = providerOverride ?? settings.activeProvider;
  const baseConfig = settings.providers[providerId];
  const config = modelOverride ? { ...baseConfig, model: modelOverride } : baseConfig;
  const apiKey = getProviderApiKey(store, providerId);

  if (!isApiKeyOptional(providerId, config) && !apiKey) {
    throw new Error(
      `No API key configured for ${providerId.toUpperCase()}. Open Dashboard (Ctrl+Shift+D) -> AI Providers to add one.`
    );
  }

  if (providerId === 'openai' || providerId === 'openrouter') {
    const baseUrl = (
      config.baseUrl ||
      (providerId === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1')
    ).replace(/\/+$/, '');

    const messages = [
      { role: 'system', content: assembled.systemPrompt },
      ...assembled.messages.map((msg) => {
        if (msg.screenshotDataUrl) {
          return {
            role: msg.role,
            content: [
              { type: 'text', text: msg.content },
              {
                type: 'image_url',
                image_url: { url: msg.screenshotDataUrl, detail: 'high' },
              },
            ],
          };
        }
        return { role: msg.role, content: msg.content };
      }),
    ];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    if (providerId === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/Thairu-dev/StealthIt';
      headers['X-Title'] = 'StealthIt';
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: 0.4,
      }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`${providerId.toUpperCase()} error (${res.status}): ${errText.slice(0, 300)}`);
    }

    return consumeLineStream(res.body, extractOpenAISseDelta, onChunk);
  }

  if (providerId === 'anthropic') {
    const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    const messages = assembled.messages.map((msg) => {
      if (msg.screenshotDataUrl) {
        const parsed = parseDataUrl(msg.screenshotDataUrl);
        if (parsed) {
          return {
            role: msg.role,
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: parsed.mimeType,
                  data: parsed.base64,
                },
              },
              { type: 'text', text: msg.content },
            ],
          };
        }
      }
      return { role: msg.role, content: msg.content };
    });

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      signal,
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        system: assembled.systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic error (${res.status}): ${errText.slice(0, 300)}`);
    }

    return consumeLineStream(res.body, extractAnthropicSseDelta, onChunk);
  }

  if (providerId === 'gemini') {
    const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(
      /\/+$/,
      ''
    );
    const contents = assembled.messages.map((msg) => {
      const parts: Array<Record<string, unknown>> = [];
      if (msg.screenshotDataUrl) {
        const parsed = parseDataUrl(msg.screenshotDataUrl);
        if (parsed) {
          parts.push({
            inlineData: {
              mimeType: parsed.mimeType,
              data: parsed.base64,
            },
          });
        }
      }
      parts.push({ text: msg.content });
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });

    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey ?? '')}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: assembled.systemPrompt }],
        },
        contents,
        generationConfig: {
          temperature: 0.4,
        },
      }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini error (${res.status}): ${errText.slice(0, 300)}`);
    }

    return consumeLineStream(res.body, extractGeminiSseDelta, onChunk);
  }

  // Ollama local
  const baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const messages = [
    { role: 'system', content: assembled.systemPrompt },
    ...assembled.messages.map((msg) => {
      const parsed = msg.screenshotDataUrl ? parseDataUrl(msg.screenshotDataUrl) : null;
      return {
        role: msg.role,
        content: msg.content,
        ...(parsed ? { images: [parsed.base64] } : {}),
      };
    }),
  ];

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(
      `Ollama error (${res.status}): ${errText.slice(0, 300)}. Ensure Ollama is running at ${baseUrl}.`
    );
  }

  return consumeLineStream(res.body, extractOllamaNdjsonDelta, onChunk);
}

export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const cleanUrl = (baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/api/tags`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}`);
  }
  const data = (await res.json()) as { models?: Array<{ name?: string }> };
  return (data.models ?? [])
    .map((m) => m.name ?? '')
    .filter((name) => name.length > 0);
}

export async function fetchProviderModels(
  store: LocalStore,
  providerId: AIProviderId
): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const settings = store.getSettings();
  const config = settings.providers[providerId];

  try {
    if (providerId === 'ollama') {
      const models = await fetchOllamaModels(config.baseUrl || 'http://localhost:11434');
      return { ok: true, models };
    }

    const apiKey = store.getSecret(providerId);
    const keyOptional = isApiKeyOptional(providerId, config);
    if (!keyOptional && !apiKey) {
      return { ok: false, models: [], error: 'Save an API key first to fetch models.' };
    }

    if (providerId === 'openai' || providerId === 'openrouter') {
      const baseUrl = (
        config.baseUrl ||
        (providerId === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1')
      ).replace(/\/+$/, '');
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const res = await fetch(`${baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return {
          ok: false,
          models: [],
          error: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`,
        };
      }
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      const models = (data.data ?? [])
        .map((m) => m.id ?? '')
        .filter((id) => id.length > 0)
        .sort((a, b) => a.localeCompare(b));
      return { ok: true, models };
    }

    if (providerId === 'anthropic') {
      const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          'x-api-key': apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return {
          ok: false,
          models: [],
          error: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`,
        };
      }
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      const models = (data.data ?? [])
        .map((m) => m.id ?? '')
        .filter((id) => id.length > 0);
      return { ok: true, models };
    }

    if (providerId === 'gemini') {
      const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(
        /\/+$/,
        ''
      );
      const res = await fetch(
        `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey ?? '')}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) {
        return {
          ok: false,
          models: [],
          error: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`,
        };
      }
      const data = (await res.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      };
      const models = (data.models ?? [])
        .filter(
          (m) =>
            !m.supportedGenerationMethods ||
            m.supportedGenerationMethods.includes('generateContent')
        )
        .map((m) => (m.name ?? '').replace(/^models\//, ''))
        .filter((name) => name.length > 0);
      return { ok: true, models };
    }

    return { ok: false, models: [], error: 'Unsupported provider.' };
  } catch (err) {
    return {
      ok: false,
      models: [],
      error: err instanceof Error ? err.message : 'Failed to fetch models.',
    };
  }
}

export async function testProviderConnection(
  store: LocalStore,
  providerId: AIProviderId
): Promise<{ ok: boolean; message: string }> {
  const settings = store.getSettings();
  const config = settings.providers[providerId];

  try {
    if (providerId === 'ollama') {
      const models = await fetchOllamaModels(config.baseUrl || 'http://localhost:11434');
      return {
        ok: true,
        message: `Connected to Ollama (${models.length} local model${models.length === 1 ? '' : 's'} found).`,
      };
    }

    const apiKey = store.getSecret(providerId);
    const keyOptional = isApiKeyOptional(providerId, config);
    if (!keyOptional && !apiKey) {
      return { ok: false, message: 'No API key saved yet.' };
    }

    if (providerId === 'openai' || providerId === 'openrouter') {
      const baseUrl = (
        config.baseUrl ||
        (providerId === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1')
      ).replace(/\/+$/, '');
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const res = await fetch(`${baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      return res.ok
        ? { ok: true, message: `Connected to ${providerId.toUpperCase()} successfully.` }
        : { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}` };
    }

    if (providerId === 'anthropic') {
      const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: {
          'x-api-key': apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok
        ? { ok: true, message: 'Connected to Anthropic successfully.' }
        : { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}` };
    }

    if (providerId === 'gemini') {
      const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(
        /\/+$/,
        ''
      );
      const res = await fetch(
        `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey ?? '')}`,
        { signal: AbortSignal.timeout(8000) }
      );
      return res.ok
        ? { ok: true, message: 'Connected to Google Gemini successfully.' }
        : { ok: false, message: `HTTP ${res.status}: ${(await res.text()).slice(0, 140)}` };
    }

    return { ok: false, message: 'Unsupported provider.' };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'Connection failed.',
    };
  }
}
