import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bug,
  Check,
  CheckCircle2,
  Copy,
  FolderOpen,
  RefreshCw,
  ScrollText,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { AppSettings, LogCategory, LogEntry, LogLevel } from '@shared/types';
import { getBridge } from '../lib/bridge';

interface LogsTabProps {
  settings: AppSettings;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
}

type FilterMode = 'all' | 'error' | LogCategory;

const LEVEL_STYLES: Record<LogLevel, { bg: string; fg: string }> = {
  info: { bg: 'var(--field)', fg: 'var(--ink-2)' },
  warn: { bg: 'var(--orange-tint)', fg: 'var(--orange)' },
  error: { bg: 'var(--red-tint)', fg: 'var(--red)' },
};

const GITHUB_ISSUES_URL = 'https://github.com/Thairu-dev/StealthIt/issues/new';

function formatLogLine(l: LogEntry): string {
  const ts = new Date(l.timestamp).toISOString();
  const meta = l.meta ? ` ${JSON.stringify(l.meta)}` : '';
  return `[${ts}] [${l.level.toUpperCase()}] [${l.category}] ${l.message}${meta}`;
}

export function LogsTab({ settings, onUpdateSettings }: LogsTabProps): React.JSX.Element {
  const bridge = useMemo(() => getBridge(), []);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const loadLogs = useCallback(async () => {
    const next = await bridge.getLogs();
    setLogs(next);
  }, [bridge]);

  useEffect(() => {
    void loadLogs();
    const timer = window.setInterval(() => void loadLogs(), 3000);
    return () => window.clearInterval(timer);
  }, [loadLogs]);

  const filtered = useMemo(() => {
    if (filter === 'all') return logs;
    if (filter === 'error') return logs.filter((l) => l.level === 'error' || l.level === 'warn');
    return logs.filter((l) => l.category === filter);
  }, [logs, filter]);

  const handleCopy = (): void => {
    const text = filtered.map(formatLogLine).join('\n');
    void navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleSendBetaLogs = async (): Promise<void> => {
    setSending(true);
    setSendStatus(null);
    try {
      const res = await bridge.sendBetaLogs();
      setSendStatus(res);
    } finally {
      setSending(false);
    }
  };

  const handleReportBug = (): void => {
    const recent = logs.slice(0, 20).map(formatLogLine).join('\n');
    if (recent) {
      void navigator.clipboard.writeText(recent);
    }
    const body = [
      '### What happened?',
      '<!-- Describe what you were doing and what went wrong -->',
      '',
      '### Environment',
      `- **Active AI Provider:** ${settings.activeProvider} (${settings.providers[settings.activeProvider].model})`,
      `- **Audio / STT Provider:** ${settings.stt.provider} (${settings.stt.model})`,
      `- **Fallback Enabled:** ${settings.fallback?.enabled ? `${settings.fallback.provider} / ${settings.fallback.model}` : 'No'}`,
      '',
      '### Recent Diagnostic Logs (sanitized)',
      '```text',
      recent || '(no logs recorded yet)',
      '```',
    ].join('\n');

    const params = new URLSearchParams({
      title: '[Beta Bug] ',
      body: body.slice(0, 3500),
    });
    void bridge.openExternal(`${GITHUB_ISSUES_URL}?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">Activity &amp; Diagnostics Log</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-2)]">
            Tracks AI latency, timeouts, automatic fallbacks, audio transcription, and screen captures locally (never logs API keys, prompts, transcripts, or screenshots).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void loadLogs()}
            className="bui-btn inline-flex cursor-pointer items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            title="Refresh logs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={filtered.length === 0}
            className="bui-btn inline-flex cursor-pointer items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-40"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[var(--green)]" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            type="button"
            onClick={() => void bridge.openLogsFolder()}
            className="bui-btn inline-flex cursor-pointer items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            title="Open app.log folder"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>Folder</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void bridge.clearLogs().then(() => {
                setLogs([]);
                setSendStatus(null);
              });
            }}
            disabled={logs.length === 0}
            className="inline-flex cursor-pointer items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-xs font-medium transition hover:opacity-90 disabled:opacity-40"
            style={{ background: 'var(--red-tint)', color: 'var(--red)' }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Beta Diagnostics & Bug Reporting Bar */}
      <div className="space-y-2.5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={Boolean(settings.shareBetaLogs)}
              onChange={(e) => void onUpdateSettings({ shareBetaLogs: e.target.checked })}
              className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
            />
            <div>
              <div className="text-xs font-medium text-[var(--ink)]">
                Auto-send anonymous error &amp; warning logs (Beta opt-in)
              </div>
              <div className="text-[11px] text-[var(--ink-3)]">
                Off by default. Sends only sanitized error/latency metadata to help fix Beta issues — never keys, prompts, transcripts, or screenshots.
              </div>
            </div>
          </label>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={sending || logs.length === 0}
              onClick={() => void handleSendBetaLogs()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition hover:opacity-90 disabled:opacity-40"
              style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}
              title="Upload sanitized diagnostic logs to StealthIt Beta"
            >
              <Send className="h-3.5 w-3.5" />
              <span>{sending ? 'Sending…' : 'Send Logs'}</span>
            </button>
            <button
              type="button"
              onClick={handleReportBug}
              className="bui-btn inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--hover)]"
              title="Open a pre-filled GitHub Bug Report with recent sanitized logs"
            >
              <Bug className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>Report Bug</span>
            </button>
          </div>
        </div>

        {sendStatus && (
          <div
            className="flex items-center gap-1.5 text-[11.5px]"
            style={{ color: sendStatus.ok ? 'var(--green)' : 'var(--red)' }}
          >
            {sendStatus.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{sendStatus.message}</span>
          </div>
        )}
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { id: 'all', label: `All (${logs.length})` },
            {
              id: 'error',
              label: `Warnings & Errors (${logs.filter((l) => l.level !== 'info').length})`,
            },
            { id: 'ai', label: 'AI Requests' },
            { id: 'stt', label: 'Audio / STT' },
            { id: 'capture', label: 'Screen Capture' },
          ] as Array<{ id: FilterMode; label: string }>
        ).map((pill) => {
          const active = filter === pill.id;
          return (
            <button
              key={pill.id}
              type="button"
              onClick={() => setFilter(pill.id)}
              className={`cursor-pointer rounded-full px-3 py-1 text-[11.5px] font-medium transition ${
                active
                  ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-btn)]'
                  : 'text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)]'
              }`}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      {/* Log table */}
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center">
            <ScrollText className="h-6 w-6 text-[var(--ink-3)]" />
            <p className="text-xs font-medium text-[var(--ink-2)]">No log entries yet</p>
            <p className="text-[11px] text-[var(--ink-3)]">
              Send an AI prompt, test a provider, or start Listen mode to see live diagnostics here.
            </p>
          </div>
        ) : (
          <div className="stealth-scroll max-h-[460px] divide-y divide-[var(--line-soft)] overflow-y-auto font-mono text-[11.5px]">
            {filtered.map((entry) => {
              const style = LEVEL_STYLES[entry.level];
              return (
                <div key={entry.id} className="flex items-start gap-2.5 px-3.5 py-2 hover:bg-[var(--hover)]">
                  <span className="shrink-0 tabular-nums text-[var(--ink-3)]">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase"
                    style={{ background: style.bg, color: style.fg }}
                  >
                    {entry.level}
                  </span>
                  <span className="shrink-0 rounded bg-[var(--inset)] px-1.5 py-px text-[10px] text-[var(--accent-ink)]">
                    {entry.category}
                  </span>
                  <div className="min-w-0 flex-1 break-words text-[var(--ink)]">
                    <span>{entry.message}</span>
                    {entry.meta && (
                      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10.5px] text-[var(--ink-3)]">
                        {Object.entries(entry.meta).map(([k, v]) => (
                          <span key={k} className="rounded bg-[var(--inset)] px-1.5 py-px">
                            {k}=<span className="text-[var(--ink-2)]">{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
