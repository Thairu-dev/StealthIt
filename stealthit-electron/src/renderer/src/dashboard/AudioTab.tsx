import React, { useEffect, useState } from 'react';
import { CheckCircle2, Lock, Mic, Radio, RefreshCw, Server, Volume2 } from 'lucide-react';
import type { AppSettings, SecretKeyName, SecretStatusMap, STTProviderId } from '@shared/types';
import { InfoTooltip } from '../components/InfoTooltip';
import { getBridge } from '../lib/bridge';

interface AudioTabProps {
  settings: AppSettings;
  secrets: SecretStatusMap;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onSecretsChanged: (next: SecretStatusMap) => void;
}

const STT_OPTIONS: Array<{
  id: STTProviderId;
  title: string;
  badge: string;
  desc: string;
  defaultModel: string;
  secretKey?: SecretKeyName;
  sharedProviderLabel?: string;
}> = [
  {
    id: 'deepgram',
    title: 'Deepgram Live',
    badge: 'Real-Time',
    desc: 'Instant word-by-word live captions with automatic punctuation as people speak.',
    defaultModel: 'nova-3',
    secretKey: 'deepgram',
  },
  {
    id: 'groq-whisper',
    title: 'Groq Whisper',
    badge: 'Free Tier',
    desc: 'Ultra-fast speech-to-text with a generous free tier (up to 8 hrs/day).',
    defaultModel: 'whisper-large-v3-turbo',
    secretKey: 'groq',
  },
  {
    id: 'openai-whisper',
    title: 'OpenAI Whisper',
    badge: 'Uses OpenAI Key',
    desc: 'High-accuracy transcription powered by your saved OpenAI API key.',
    defaultModel: 'whisper-1',
    secretKey: 'openai',
    sharedProviderLabel: 'OpenAI',
  },
  {
    id: 'gemini-audio',
    title: 'Google Gemini Audio',
    badge: 'Uses Gemini Key',
    desc: 'Native multimodal audio transcription powered by your saved Google Gemini API key.',
    defaultModel: 'gemini-2.5-flash',
    secretKey: 'gemini',
    sharedProviderLabel: 'Google Gemini',
  },
  {
    id: 'local-whisper',
    title: 'Local Offline Server',
    badge: '100% Offline',
    desc: 'Send audio to a local transcription server running on your own computer.',
    defaultModel: 'Systran/faster-whisper-small',
  },
];

export function AudioTab({
  settings,
  secrets,
  onUpdateSettings,
  onSecretsChanged,
}: AudioTabProps): React.JSX.Element {
  const bridge = getBridge();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [keyDraft, setKeyDraft] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => setMics(devices.filter((d) => d.kind === 'audioinput')))
      .catch(() => {});
  }, []);

  const stt = settings.stt;
  const activeOption = STT_OPTIONS.find((o) => o.id === stt.provider) ?? STT_OPTIONS[0];

  const updateStt = async (patch: Partial<typeof stt>): Promise<void> => {
    await onUpdateSettings({ stt: { ...stt, ...patch } });
  };

  const handleSaveSttKey = async (): Promise<void> => {
    if (!activeOption.secretKey || !keyDraft.trim()) return;
    const next = await bridge.setSecret(activeOption.secretKey, keyDraft.trim());
    onSecretsChanged(next);
    setKeyDraft('');
    setEditingKey(false);
    setSavedNotice('Encrypted and saved.');
    window.setTimeout(() => setSavedNotice(null), 2000);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--ink)]">Audio &amp; Live Transcription</h2>
        <p className="mt-0.5 text-xs text-[var(--ink-2)]">
          Listens to both meeting audio (<strong className="text-[var(--accent-ink)]">THEM</strong>) and your microphone (<strong className="text-[var(--green)]">ME</strong>) at the same time — no extra setup needed.
        </p>
      </div>

      {/* STT Engine Cards */}
      <div className="grid grid-cols-2 gap-2.5">
        {STT_OPTIONS.map((opt) => {
          const active = stt.provider === opt.id;
          const hasKey = opt.secretKey ? secrets[opt.secretKey] : false;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setKeyDraft('');
                setEditingKey(false);
                setFetchError(null);
                const nextModel =
                  opt.id === 'gemini-audio'
                    ? settings.providers.gemini.model || opt.defaultModel
                    : opt.defaultModel;
                void updateStt({
                  provider: opt.id,
                  model: nextModel,
                });
              }}
              className={`flex cursor-pointer flex-col gap-1.5 rounded-2xl p-3.5 text-left transition ${
                active
                  ? 'bg-[var(--accent-tint)] ring-1 ring-[var(--accent)]'
                  : 'bg-[var(--surface)] ring-1 ring-[var(--line)] hover:bg-[var(--hover)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ink)]">{opt.title}</span>
                {opt.sharedProviderLabel && hasKey ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: 'var(--green-tint)', color: 'var(--green)' }}
                  >
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Key Ready
                  </span>
                ) : (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent-ink)]">
                    {opt.badge}
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--ink-2)]">{opt.desc}</p>
            </button>
          );
        })}
      </div>

      {/* Engine-specific Key or Local URL */}
      <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        {activeOption.sharedProviderLabel &&
          activeOption.secretKey &&
          secrets[activeOption.secretKey] && (
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11.5px]"
              style={{ background: 'var(--green-tint)', color: 'var(--green)' }}
            >
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>
                Your saved <strong>{activeOption.sharedProviderLabel}</strong> API key from{' '}
                <strong>API Keys</strong> is already connected and will be used automatically — no extra key needed.
              </span>
            </div>
          )}

        {activeOption.secretKey && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
                <Radio className="h-3.5 w-3.5 text-[var(--accent)]" />
                {activeOption.title} API Key
              </label>
              {secrets[activeOption.secretKey] && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--green)]">
                  <Lock className="h-3 w-3" />
                  Encrypted & saved
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={
                  secrets[activeOption.secretKey] && !editingKey
                    ? '••••••••••••••••••••••••'
                    : keyDraft
                }
                onFocus={() => {
                  if (secrets[activeOption.secretKey!] && !editingKey) {
                    setEditingKey(true);
                    setKeyDraft('');
                  }
                }}
                onBlur={() => {
                  if (secrets[activeOption.secretKey!] && !keyDraft.trim()) {
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
                onClick={() => void handleSaveSttKey()}
                className="rounded-xl bg-white/10 px-4 py-2 text-xs font-medium text-[var(--ink)] hover:bg-white/20 disabled:opacity-40"
              >
                Save Key
              </button>
            </div>
            {savedNotice && <p className="text-[11px] text-[var(--green)]">{savedNotice}</p>}
          </div>
        )}

        {stt.provider === 'local-whisper' && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)]">
              <Server className="h-3.5 w-3.5 text-[var(--accent)]" />
              Local Transcription Server URL
            </label>
            <input
              type="text"
              value={stt.localUrl}
              onChange={(e) => void updateStt({ localUrl: e.target.value })}
              placeholder="http://localhost:8000/v1/audio/transcriptions"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] focus:border-sky-400/50 focus:outline-none"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-[var(--ink-2)]">Transcription Model</label>
              {stt.provider === 'gemini-audio' && secrets.gemini && (
                <button
                  type="button"
                  disabled={fetchingModels}
                  onClick={() => {
                    setFetchingModels(true);
                    setFetchError(null);
                    void bridge
                      .fetchProviderModels('gemini')
                      .then((res) => {
                        if (!res.ok) {
                          setFetchError(res.error || 'Could not fetch Gemini models.');
                        }
                      })
                      .finally(() => setFetchingModels(false));
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2 py-0.5 text-[10.5px] font-medium transition hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}
                >
                  <RefreshCw className={`h-2.5 w-2.5 ${fetchingModels ? 'animate-spin' : ''}`} />
                  <span>{fetchingModels ? 'Fetching…' : 'Fetch Models'}</span>
                </button>
              )}
            </div>
            {stt.provider === 'gemini-audio' &&
            (settings.providers.gemini.cachedModels?.length ?? 0) > 0 ? (
              <select
                value={
                  settings.providers.gemini.cachedModels!.includes(stt.model)
                    ? stt.model
                    : '__custom__'
                }
                onChange={(e) => {
                  if (e.target.value !== '__custom__') {
                    void updateStt({ model: e.target.value });
                  }
                }}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
              >
                {!settings.providers.gemini.cachedModels!.includes(stt.model) && (
                  <option value="__custom__">{stt.model} (current)</option>
                )}
                {settings.providers.gemini.cachedModels!.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={stt.model}
                onChange={(e) => void updateStt({ model: e.target.value })}
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] focus:border-sky-400/50 focus:outline-none"
              />
            )}
            {fetchError && (
              <p className="text-[10.5px]" style={{ color: 'var(--red)' }}>
                {fetchError}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--ink-2)]">Language Code</label>
            <input
              type="text"
              value={stt.language}
              onChange={(e) => void updateStt({ language: e.target.value })}
              placeholder="en or auto"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] focus:border-sky-400/50 focus:outline-none"
            />
          </div>
        </div>

        {/* Audio Sources */}
        <div className="grid grid-cols-2 gap-3 border-t border-[var(--line-soft)] pt-3">
          <label className="flex cursor-pointer items-center justify-between rounded-xl bg-[var(--inset)] px-3 py-2.5 ring-1 ring-[var(--line-soft)]">
            <span className="flex items-center gap-2 text-xs text-[var(--ink)]">
              <Volume2 className="h-4 w-4 text-[var(--accent)]" />
              Meeting / Computer Audio (THEM)
              <InfoTooltip
                align="left"
                text="Listens to what other people say in Zoom, Teams, Meet, or videos directly from your computer — no extra audio drivers needed."
              />
            </span>
            <input
              type="checkbox"
              checked={stt.captureSystemAudio}
              onChange={(e) => void updateStt({ captureSystemAudio: e.target.checked })}
              className="accent-sky-400"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-xl bg-[var(--inset)] px-3 py-2.5 ring-1 ring-[var(--line-soft)]">
            <span className="flex items-center gap-2 text-xs text-[var(--ink)]">
              <Mic className="h-4 w-4 text-[var(--green)]" />
              Microphone Input (YOU)
              <InfoTooltip
                align="right"
                text="Captures your own voice separately and labels it YOU so the AI knows who asked the question vs. what you already answered."
              />
            </span>
            <input
              type="checkbox"
              checked={stt.captureMicrophone}
              onChange={(e) => void updateStt({ captureMicrophone: e.target.checked })}
              className="accent-emerald-400"
            />
          </label>
        </div>

        {/* Microphone Selector & VAD Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--ink-2)]">Microphone Device</label>
            <select
              value={stt.micDeviceId}
              onChange={(e) => void updateStt({ micDeviceId: e.target.value })}
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink)] focus:border-sky-400/50 focus:outline-none"
            >
              <option value="default">System Default Microphone</option>
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label || `Microphone (${m.deviceId.slice(0, 8)})`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-[var(--ink-2)]">
                Speech Pause Delay
                <InfoTooltip
                  align="right"
                  text="How long to wait after someone stops talking before finishing a sentence and transcribing it (used for Whisper modes)."
                />
              </span>
              <span className="font-mono text-[var(--ink-2)]">{stt.vadSilenceMs} ms</span>
            </div>
            <input
              type="range"
              min={500}
              max={2500}
              step={100}
              value={stt.vadSilenceMs}
              onChange={(e) => void updateStt({ vadSilenceMs: Number(e.target.value) })}
              className="w-full accent-sky-400"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
