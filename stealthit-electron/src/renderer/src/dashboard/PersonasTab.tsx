import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Crop, Plus, RotateCcw, Sparkles, Trash2, Upload } from 'lucide-react';
import { DEFAULT_SCREEN_CAPTURE_PROMPT, SCREEN_CAPTURE_PRESETS } from '@shared/defaults';
import type { AppSettings, PersonaPreset } from '@shared/types';
import { InfoTooltip } from '../components/InfoTooltip';
import { getBridge } from '../lib/bridge';
import { readAttachmentFile } from '../lib/fileReader';

interface PersonasTabProps {
  settings: AppSettings;
  personas: PersonaPreset[];
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onPersonasChanged: (next: PersonaPreset[]) => void;
}

export function PersonasTab({
  settings,
  personas,
  onUpdateSettings,
  onPersonasChanged,
}: PersonasTabProps): React.JSX.Element {
  const bridge = getBridge();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftTagline, setDraftTagline] = useState('');
  const [draftPrompt, setDraftPrompt] = useState('');

  const [contextDraft, setContextDraft] = useState(settings.userContext);
  const [screenPromptDraft, setScreenPromptDraft] = useState(settings.screenCapturePrompt);
  const [importError, setImportError] = useState<string | null>(null);
  const contextTimerRef = useRef<number | null>(null);
  const screenTimerRef = useRef<number | null>(null);
  const contextFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setContextDraft(settings.userContext);
  }, [settings.userContext]);

  useEffect(() => {
    setScreenPromptDraft(settings.screenCapturePrompt);
  }, [settings.screenCapturePrompt]);

  useEffect(() => {
    return () => {
      if (contextTimerRef.current !== null) window.clearTimeout(contextTimerRef.current);
      if (screenTimerRef.current !== null) window.clearTimeout(screenTimerRef.current);
    };
  }, []);

  const handleContextChange = (next: string): void => {
    setContextDraft(next);
    if (contextTimerRef.current !== null) window.clearTimeout(contextTimerRef.current);
    contextTimerRef.current = window.setTimeout(() => {
      void onUpdateSettings({ userContext: next });
    }, 350);
  };

  const handleScreenPromptChange = (next: string): void => {
    setScreenPromptDraft(next);
    if (screenTimerRef.current !== null) window.clearTimeout(screenTimerRef.current);
    screenTimerRef.current = window.setTimeout(() => {
      void onUpdateSettings({ screenCapturePrompt: next });
    }, 350);
  };

  const startNew = (): void => {
    setEditingId(`custom-${Date.now()}`);
    setDraftName('');
    setDraftTagline('');
    setDraftPrompt('');
  };

  const startEdit = (p: PersonaPreset): void => {
    setEditingId(p.id);
    setDraftName(p.name);
    setDraftTagline(p.tagline);
    setDraftPrompt(p.systemPrompt);
  };

  const handleSavePersona = async (): Promise<void> => {
    if (!editingId || !draftName.trim() || !draftPrompt.trim()) return;
    const existing = personas.find((p) => p.id === editingId);
    const updated = await bridge.savePersona({
      id: editingId,
      name: draftName.trim(),
      tagline: draftTagline.trim() || 'Custom copilot persona',
      systemPrompt: draftPrompt.trim(),
      builtIn: existing?.builtIn ?? false,
    });
    onPersonasChanged(updated);
    await onUpdateSettings({ activePersonaId: editingId });
    setEditingId(null);
  };

  const handleDeletePersona = async (id: string): Promise<void> => {
    const updated = await bridge.deletePersona(id);
    onPersonasChanged(updated);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">Personas & Persistent Context</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">
            Tailor how StealthIt responds and give it background context (resume, product specs, or meeting agenda).
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent-tint)] px-3 py-1.5 text-xs font-medium text-[var(--accent-ink)] ring-1 ring-[var(--accent)] hover:bg-sky-500/30"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New Persona</span>
        </button>
      </div>

      {/* Persona grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {personas.map((p) => {
          const isActive = settings.activePersonaId === p.id;
          return (
            <div
              key={p.id}
              onClick={() => void onUpdateSettings({ activePersonaId: p.id })}
              className={`group cursor-pointer rounded-2xl p-3.5 transition ${
                isActive
                  ? 'bg-[var(--accent-tint)] ring-1 ring-[var(--accent)]'
                  : 'bg-[var(--surface)] ring-1 ring-[var(--line)] hover:bg-[var(--hover)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
                  {p.name}
                </span>
                <div className="flex items-center gap-1">
                  {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-[var(--green)]" />}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(p);
                    }}
                    className="rounded px-1.5 py-0.5 text-[10.5px] text-[var(--ink-2)] opacity-0 hover:bg-white/10 hover:text-[var(--ink)] group-hover:opacity-100"
                  >
                    Edit
                  </button>
                  {!p.builtIn && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeletePersona(p.id);
                      }}
                      className="rounded p-1 text-[var(--ink-3)] opacity-0 hover:bg-rose-500/20 hover:text-rose-300 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-[var(--ink-2)]">{p.tagline}</p>
            </div>
          );
        })}
      </div>

      {/* Inline Persona Editor */}
      {editingId && (
        <div className="space-y-3 rounded-2xl border border-sky-400/30 bg-sky-500/[0.06] p-4">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Persona name (e.g., Staff Systems Design)"
              className="rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-sky-400/50 focus:outline-none"
            />
            <input
              type="text"
              value={draftTagline}
              onChange={(e) => setDraftTagline(e.target.value)}
              placeholder="Short tagline"
              className="rounded-xl border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-sky-400/50 focus:outline-none"
            />
          </div>
          <textarea
            rows={4}
            value={draftPrompt}
            onChange={(e) => setDraftPrompt(e.target.value)}
            placeholder="System instructions for this persona…"
            className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] p-3 text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-sky-400/50 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="rounded-xl bg-[var(--field)] px-3 py-1.5 text-xs text-[var(--ink-2)] hover:bg-white/[0.12]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSavePersona()}
              className="rounded-xl bg-sky-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              Save Persona
            </button>
          </div>
        </div>
      )}

      {/* Response Style & User Background Context */}
      <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
            Response Verbosity
            <InfoTooltip
              align="left"
              text="Controls how long answers are. Concise gives fast, scannable bullets ideal for live calls; Detailed adds full edge cases and explanations."
            />
          </label>
          <div className="inline-flex rounded-xl bg-[var(--inset)] p-1 ring-1 ring-[var(--line)]">
            {(['concise', 'balanced', 'detailed'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => void onUpdateSettings({ responseStyle: style })}
                className={`rounded-lg px-3 py-1 text-[11px] font-medium capitalize transition ${
                  settings.responseStyle === style
                    ? 'bg-[var(--accent-tint)] text-[var(--accent-ink)]'
                    : 'text-[var(--ink-2)] hover:text-[var(--ink)]'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
              Personal / Meeting Background Context
              <InfoTooltip
                align="left"
                text="Added automatically as background context on every answer. Great for your resume, product specs, pricing sheets, or call notes. Auto-saves as you type."
              />
            </label>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1 rounded-lg bg-[var(--inset)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] ring-1 ring-[var(--line-soft)] transition hover:bg-[var(--hover)]">
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={settings.attachUserContext !== false}
                    onChange={(e) =>
                      void onUpdateSettings({ attachUserContext: e.target.checked })
                    }
                    className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
                  />
                  <span>
                    {settings.attachUserContext !== false ? 'Attached (On)' : 'Paused (Off)'}
                  </span>
                </label>
                <InfoTooltip
                  align="right"
                  text="When On, your background notes and resume are sent silently with every AI prompt. Turn Off when asking general questions that don't need personal context."
                />
              </div>
              <input
                ref={contextFileRef}
                type="file"
                accept=".txt,.md,.csv,.json,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  setImportError(null);
                  void readAttachmentFile(file)
                    .then((parsed) => {
                      if (parsed.kind !== 'text') {
                        setImportError('Please select a text, Markdown, CSV, JSON, or PDF file.');
                        return;
                      }
                      const combined = contextDraft.trim()
                        ? `${contextDraft.trim()}\n\n--- ${parsed.name} ---\n${parsed.content}`
                        : parsed.content;
                      setContextDraft(combined);
                      void onUpdateSettings({ userContext: combined });
                    })
                    .catch((err: unknown) => {
                      setImportError(
                        err instanceof Error ? err.message : 'Could not read file.'
                      );
                    });
                }}
              />
              <button
                type="button"
                onClick={() => contextFileRef.current?.click()}
                className="bui-btn inline-flex cursor-pointer items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                title="Import text from a resume, brief, or notes file"
              >
                <Upload className="h-3 w-3 text-[var(--accent)]" />
                <span>Import File</span>
              </button>
              <span className="text-[10.5px] text-[var(--ink-3)]">Auto-saves</span>
            </div>
          </div>
          {importError && (
            <p className="text-[11px]" style={{ color: 'var(--red)' }}>
              {importError}
            </p>
          )}
          <textarea
            rows={4}
            value={contextDraft}
            onChange={(e) => handleContextChange(e.target.value)}
            onBlur={() => {
              if (contextDraft !== settings.userContext) {
                if (contextTimerRef.current !== null) window.clearTimeout(contextTimerRef.current);
                void onUpdateSettings({ userContext: contextDraft });
              }
            }}
            placeholder="Paste your resume highlights, product pricing/SLA sheet, or meeting agenda here. StealthIt injects this silently into every answer."
            className={`w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] p-3 text-xs leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-sky-400/50 focus:outline-none transition ${
              settings.attachUserContext === false ? 'opacity-55' : ''
            }`}
          />
        </div>
      </div>

      {/* Saved capture area toggle */}
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
              <Crop className="h-3.5 w-3.5 text-[var(--accent)]" />
              Capture Selected Area Only
              <InfoTooltip
                align="left"
                text="When enabled, you drag a box once to save the area you want captured. Every Ctrl+Enter and capture button will then capture only that saved area automatically until you turn this off."
              />
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--ink-2)]">
              Select the region once when enabling — future captures use it automatically with no prompt.
            </p>
          </div>
          <input
            type="checkbox"
            checked={Boolean(settings.captureRegion && settings.captureRegionBounds)}
            onChange={(e) => {
              const enable = e.target.checked;
              if (!enable) {
                void onUpdateSettings({ captureRegion: false, captureRegionBounds: null });
                return;
              }
              void (async () => {
                const bounds = await bridge.selectCaptureRegion();
                if (bounds) {
                  await onUpdateSettings({ captureRegion: true, captureRegionBounds: bounds });
                }
              })();
            }}
            className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
          />
        </label>

        {settings.captureRegion && settings.captureRegionBounds && (
          <div className="mt-2.5 flex items-center justify-between rounded-xl bg-[var(--inset)] px-3 py-2 text-[11px] text-[var(--ink-2)] ring-1 ring-[var(--line-soft)]">
            <span>
              Saved area:{' '}
              <strong className="font-mono text-[var(--ink)]">
                {settings.captureRegionBounds.pixelWidth} × {settings.captureRegionBounds.pixelHeight} px
              </strong>
            </span>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const bounds = await bridge.selectCaptureRegion();
                  if (bounds) {
                    await onUpdateSettings({ captureRegion: true, captureRegionBounds: bounds });
                  }
                })();
              }}
              className="cursor-pointer rounded-md bg-[var(--field)] px-2 py-0.5 font-medium text-[var(--ink)] transition hover:bg-[var(--hover)]"
            >
              Re-select Area
            </button>
          </div>
        )}
      </div>

      {/* Editable Screen Capture Prompt */}
      <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
              <Camera className="h-3.5 w-3.5 text-[var(--accent)]" />
              Screen Capture Prompt
              <InfoTooltip
                align="left"
                text="The default instruction sent with your screenshot when you hit Ctrl+Enter or click Analyze screen without typing a question. Auto-saves as you type."
              />
            </label>
            <p className="mt-0.5 text-[11px] text-[var(--ink-2)]">
              Sent automatically whenever you press <kbd className="rounded bg-white/10 px-1 py-0.5 font-mono text-[10px] text-[var(--ink-2)]">Ctrl+Enter</kbd> or click <strong>Analyze screen</strong> without typing a custom question.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setScreenPromptDraft(DEFAULT_SCREEN_CAPTURE_PROMPT);
              void onUpdateSettings({ screenCapturePrompt: DEFAULT_SCREEN_CAPTURE_PROMPT });
            }}
            disabled={screenPromptDraft === DEFAULT_SCREEN_CAPTURE_PROMPT}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--hover)] px-2.5 py-1 text-[11px] text-[var(--ink-2)] transition hover:bg-white/[0.12] hover:text-[var(--ink)] disabled:opacity-40"
            title="Reset to default screen capture prompt"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SCREEN_CAPTURE_PRESETS.map((preset) => {
            const isSelected = screenPromptDraft.trim() === preset.prompt.trim();
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setScreenPromptDraft(preset.prompt);
                  void onUpdateSettings({ screenCapturePrompt: preset.prompt });
                }}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  isSelected
                    ? 'bg-[var(--accent-tint)] text-[var(--accent-ink)] ring-1 ring-[var(--accent)]'
                    : 'bg-[var(--field)] text-[var(--ink-2)] hover:bg-white/[0.1] hover:text-[var(--ink)]'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <textarea
          rows={3}
          value={screenPromptDraft}
          onChange={(e) => handleScreenPromptChange(e.target.value)}
          onBlur={() => {
            if (screenPromptDraft !== settings.screenCapturePrompt) {
              if (screenTimerRef.current !== null) window.clearTimeout(screenTimerRef.current);
              void onUpdateSettings({ screenCapturePrompt: screenPromptDraft });
            }
          }}
          placeholder={DEFAULT_SCREEN_CAPTURE_PROMPT}
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--inset)] p-3 text-xs leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-sky-400/50 focus:outline-none"
        />
      </div>
    </div>
  );
}
