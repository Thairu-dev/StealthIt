import React, { useState } from 'react';
import { CheckCircle2, KeyRound, Lock, RefreshCw, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { DEFAULT_SETTINGS, isApiKeyOptional, PROVIDER_META } from '@shared/defaults';
import type { AIProviderId, AppSettings, SecretKeyName, SecretStatusMap } from '@shared/types';
import { InfoTooltip } from '../components/InfoTooltip';
import { getBridge } from '../lib/bridge';

interface ProvidersTabProps {
  settings: AppSettings;
  secrets: SecretStatusMap;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onSecretsChanged: (next: SecretStatusMap) => void;
}

const PROVIDER_ORDER: AIProviderId[] = ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama'];

export function ProvidersTab({
  settings,
  secrets,
  onUpdateSettings,
  onSecretsChanged,
}: ProvidersTabProps): React.JSX.Element {
  const bridge = getBridge();
  const [selected, setSelected] = useState<AIProviderId>(settings.activeProvider);
  const [keyDraft, setKeyDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);

  const meta = PROVIDER_META[selected];
  const cfg = settings.providers[selected];
  const hasSavedKey = selected === 'ollama' ? true : secrets[selected];
  const supportsCustomHosted = selected === 'openai' || selected === 'openrouter';
  const keyOptional = isApiKeyOptional(selected, cfg);
  const canFetchModels = hasSavedKey || keyOptional;

  const handleSelectProvider = (id: AIProviderId): void => {
    setSelected(id);
    setKeyDraft('');
    setEditingKey(false);
    setTestResult(null);
  };

  const handleSetActive = async (): Promise<void> => {
    await onUpdateSettings({ activeProvider: selected });
  };

  const handleUpdateProviderField = async (patch: Partial<typeof cfg>): Promise<void> => {
    await onUpdateSettings({
      providers: {
        ...settings.providers,
        [selected]: { ...cfg, ...patch },
      },
    });
  };

  const handleSaveKey = async (): Promise<void> => {
    if (selected === 'ollama' || !keyDraft.trim()) return;
    const next = await bridge.setSecret(selected as SecretKeyName, keyDraft.trim());
    onSecretsChanged(next);
    setKeyDraft('');
    setEditingKey(false);
    setTestResult({
      ok: true,
      message: 'API key encrypted and saved securely on this device. You can now fetch models.',
    });
  };

  const handleClearKey = async (): Promise<void> => {
    if (selected === 'ollama') return;
    const next = await bridge.clearSecret(selected as SecretKeyName);
    onSecretsChanged(next);
    setKeyDraft('');
    setEditingKey(false);
    setTestResult(null);
  };

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    const result = await bridge.testProvider(selected);
    setTestResult(result);
    setTesting(false);
  };

  const handleFetchModels = async (): Promise<void> => {
    setFetchingModels(true);
    setTestResult(null);
    try {
      const result = await bridge.fetchProviderModels(selected);
      if (result.ok) {
        setTestResult({
          ok: true,
          message: `Fetched & saved ${result.models.length} model${result.models.length === 1 ? '' : 's'} from ${meta.label}.`,
        });
      } else {
        setTestResult({
          ok: false,
          message: result.error || 'Could not fetch models.',
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Could not fetch models.',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const liveModels = cfg.cachedModels ?? [];
  const modelChoices = liveModels.length > 0 ? liveModels : [...meta.defaultModels];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--ink)]">API Keys &amp; Models</h2>
        <p className="mt-0.5 text-xs text-[var(--ink-2)]">
          Your API keys are encrypted on this device and only used to talk directly to your chosen AI provider.
        </p>
      </div>

      {/* Provider selector pills */}
      <div className="grid grid-cols-5 gap-2">
        {PROVIDER_ORDER.map((id) => {
          const isCurrentActive = settings.activeProvider === id;
          const isViewing = selected === id;
          const configured =
            id === 'ollama' ||
            secrets[id] ||
            isApiKeyOptional(id, settings.providers[id]);
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelectProvider(id)}
              className={`flex cursor-pointer flex-col items-start gap-1 rounded-xl p-3 text-left transition ${
                isViewing
                  ? 'bg-[var(--accent-tint)] ring-1 ring-[var(--accent)]'
                  : 'bg-[var(--surface)] ring-1 ring-[var(--line)] hover:bg-[var(--hover)]'
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-xs font-semibold text-[var(--ink)]">
                  {PROVIDER_META[id].label.split(' ')[0]}
                </span>
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: configured ? 'var(--green)' : 'var(--line-strong)' }}
                />
              </div>
              <span className="text-[10.5px] text-[var(--ink-2)]">
                {isCurrentActive ? 'Active' : configured ? 'Ready' : 'No key'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Selected provider config card */}
      <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">{meta.label}</h3>
            <p className="text-xs text-[var(--ink-2)]">
              {settings.activeProvider === selected
                ? 'Currently powering your HUD overlay'
                : 'Click "Use This Provider" to switch your live HUD'}
            </p>
          </div>
          {settings.activeProvider !== selected ? (
            <button
              type="button"
              onClick={() => void handleSetActive()}
              className="cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
              style={{ background: 'var(--accent)' }}
            >
              Use This Provider
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: 'var(--green-tint)', color: 'var(--green)' }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Active Provider
            </span>
          )}
        </div>

        {/* Custom hosted Base URL toggle (OpenAI & OpenRouter) */}
        {supportsCustomHosted && (
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3.5 py-2.5 transition hover:border-[var(--line-strong)]">
            <div className="min-w-0">
              <div className="text-xs font-medium text-[var(--ink)]">
                Using a custom / self-hosted Base URL
              </div>
              <div className="text-[11px] text-[var(--ink-2)]">
                Tick this for local, Colab, Tailscale, vLLM, or Ollama `/v1` servers — makes the API key optional and hides missing-key warnings.
              </div>
            </div>
            <input
              type="checkbox"
              checked={keyOptional}
              onChange={(e) => {
                const checked = e.target.checked;
                void handleUpdateProviderField({
                  useCustomBaseUrl: checked,
                  ...(checked
                    ? {}
                    : { baseUrl: DEFAULT_SETTINGS.providers[selected].baseUrl }),
                });
              }}
              className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
            />
          </label>
        )}

        {/* Encrypted API Key input */}
        {meta.requiresKey && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
                <KeyRound className="h-3.5 w-3.5 text-[var(--accent)]" />
                API Key{keyOptional ? ' (Optional for custom URL)' : ''}
                <InfoTooltip
                  align="left"
                  text="Encrypted and stored locally on this computer. Never shared with third parties."
                />
              </label>
              {hasSavedKey && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--green)]">
                  <Lock className="h-3 w-3" />
                  Encrypted &amp; saved
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={hasSavedKey && !editingKey ? '••••••••••••••••••••••••' : keyDraft}
                onFocus={() => {
                  if (hasSavedKey && !editingKey) {
                    setEditingKey(true);
                    setKeyDraft('');
                  }
                }}
                onBlur={() => {
                  if (hasSavedKey && !keyDraft.trim()) {
                    setEditingKey(false);
                  }
                }}
                onChange={(e) => {
                  if (!editingKey) setEditingKey(true);
                  setKeyDraft(e.target.value);
                }}
                placeholder="Paste API key…"
                className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                disabled={!keyDraft.trim()}
                onClick={() => void handleSaveKey()}
                className="bui-btn cursor-pointer px-4 py-2 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--hover)] disabled:opacity-40"
              >
                Save Key
              </button>
              {hasSavedKey && (
                <button
                  type="button"
                  onClick={() => void handleClearKey()}
                  className="inline-flex cursor-pointer items-center justify-center rounded-xl px-3 transition hover:opacity-85"
                  style={{ background: 'var(--red-tint)', color: 'var(--red)' }}
                  title="Remove saved key"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Model Selection */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
                Model
                <InfoTooltip
                  align="left"
                  text="Pick a vision-capable model (like GPT-4o, Claude Sonnet, Gemini 2.5, or llama3.2-vision) so Ctrl+Enter screen capture works."
                />
              </label>
              {canFetchModels && (
                <button
                  type="button"
                  disabled={fetchingModels}
                  onClick={() => void handleFetchModels()}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}
                  title={`Fetch available models from ${meta.label}`}
                >
                  <RefreshCw className={`h-3 w-3 ${fetchingModels ? 'animate-spin' : ''}`} />
                  <span>{fetchingModels ? 'Fetching…' : 'Fetch Models'}</span>
                </button>
              )}
            </div>

            {liveModels.length > 0 ? (
              <select
                value={liveModels.includes(cfg.model) ? cfg.model : '__custom__'}
                onChange={(e) => {
                  if (e.target.value !== '__custom__') {
                    void handleUpdateProviderField({ model: e.target.value });
                  }
                }}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
              >
                {!liveModels.includes(cfg.model) && (
                  <option value="__custom__">{cfg.model} (current)</option>
                )}
                {liveModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={cfg.model}
                onChange={(e) => void handleUpdateProviderField({ model: e.target.value })}
                list={`models-${selected}`}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
              />
            )}

            <datalist id={`models-${selected}`}>
              {modelChoices.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>

            <div className="flex flex-wrap gap-1 pt-1">
              {modelChoices.slice(0, 4).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => void handleUpdateProviderField({ model: m })}
                  className={`cursor-pointer rounded-md px-2 py-0.5 text-[10.5px] transition ${
                    cfg.model === m
                      ? 'bg-[var(--accent-tint)] text-[var(--accent-ink)]'
                      : 'bg-[var(--field)] text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
              Custom Server URL (Optional)
              <InfoTooltip
                align="right"
                text="Leave as default unless you route through a custom proxy, gateway, or local AI server."
              />
            </label>
            <input
              type="text"
              value={cfg.baseUrl ?? ''}
              onChange={(e) => {
                const nextUrl = e.target.value;
                if (supportsCustomHosted) {
                  const defaultUrl = (DEFAULT_SETTINGS.providers[selected].baseUrl ?? '').replace(
                    /\/+$/,
                    ''
                  );
                  const cleaned = nextUrl.trim().replace(/\/+$/, '');
                  const isDifferent = cleaned.length > 0 && cleaned !== defaultUrl;
                  void handleUpdateProviderField({
                    baseUrl: nextUrl,
                    ...(isDifferent ? { useCustomBaseUrl: true } : {}),
                  });
                } else {
                  void handleUpdateProviderField({ baseUrl: nextUrl });
                }
              }}
              placeholder="Default server address"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--accent)] focus:outline-none"
            />
            <p className="text-[10.5px] text-[var(--ink-3)]">
              Optional — only change this if you use a custom AI proxy or local model server.
            </p>
          </div>
        </div>

        {/* Test Connection */}
        <div className="flex items-center justify-between border-t border-[var(--line-soft)] pt-3">
          <div className="text-xs">
            {testResult && (
              <span
                className="inline-flex items-center gap-1.5"
                style={{ color: testResult.ok ? 'var(--green)' : 'var(--red)' }}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={testing}
            onClick={() => void handleTest()}
            className="bui-btn inline-flex cursor-pointer items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--hover)] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testing ? 'animate-spin' : ''}`} />
            <span>{testing ? 'Testing…' : 'Test Connection'}</span>
          </button>
        </div>
      </div>

      {/* Automatic Fallback Model Card */}
      {(() => {
        const fb = settings.fallback ?? DEFAULT_SETTINGS.fallback;
        const fbProviderCfg = settings.providers[fb.provider];
        const fbChoices =
          (fbProviderCfg.cachedModels && fbProviderCfg.cachedModels.length > 0
            ? fbProviderCfg.cachedModels
            : [...PROVIDER_META[fb.provider].defaultModels]);

        const updateFallback = (patch: Partial<typeof fb>): void => {
          void onUpdateSettings({ fallback: { ...fb, ...patch } });
        };

        return (
          <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                  <ShieldAlert className="h-3.5 w-3.5 text-[var(--accent)]" />
                  Automatic Fallback Model
                  <InfoTooltip
                    align="left"
                    text="If your active model fails (rate limit, network error) or takes longer than the timeout to start replying, StealthIt automatically fails over to this backup provider & model and logs the event."
                  />
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--ink-2)]">
                  Prevents hung requests (like 60s+ API stalls) by failing over to a backup model automatically.
                </p>
              </div>
              <input
                type="checkbox"
                checked={fb.enabled}
                onChange={(e) => updateFallback({ enabled: e.target.checked })}
                className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
              />
            </label>

            {fb.enabled && (
              <div className="grid grid-cols-3 gap-3 border-t border-[var(--line-soft)] pt-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[var(--ink-2)]">
                    Fallback Provider
                  </label>
                  <select
                    value={fb.provider}
                    onChange={(e) => {
                      const nextProvider = e.target.value as AIProviderId;
                      const nextModel =
                        settings.providers[nextProvider].model ||
                        PROVIDER_META[nextProvider].defaultModels[0];
                      updateFallback({ provider: nextProvider, model: nextModel });
                    }}
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-2.5 py-2 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  >
                    {PROVIDER_ORDER.map((id) => (
                      <option key={id} value={id}>
                        {PROVIDER_META[id].label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[var(--ink-2)]">
                    Fallback Model
                  </label>
                  <input
                    type="text"
                    list="fallback-model-choices"
                    value={fb.model}
                    onChange={(e) => updateFallback({ model: e.target.value })}
                    placeholder="e.g. gpt-4.1-mini"
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-2.5 py-2 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  <datalist id="fallback-model-choices">
                    {fbChoices.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[var(--ink-2)]">
                    First-Token Timeout (sec)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={fb.timeoutSec}
                    onChange={(e) => {
                      const val = Math.max(5, Math.min(180, Number(e.target.value) || 20));
                      updateFallback({ timeoutSec: val });
                    }}
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-2.5 py-2 font-mono text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
