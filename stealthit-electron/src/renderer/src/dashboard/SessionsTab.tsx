import React, { useEffect, useMemo, useState } from 'react';
import {
  AudioLines,
  Camera,
  Check,
  Copy,
  Download,
  MessageSquare,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatMessage, SessionRecord, TranscriptSegment } from '@shared/types';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

interface SessionsTabProps {
  sessions: SessionRecord[];
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

type DetailView = 'conversation' | 'transcript';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function groupLabel(ts: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  if (day === today) return 'Today';
  if (day === today - DAY_MS) return 'Yesterday';
  if (day > today - 7 * DAY_MS) return 'Previous 7 days';
  if (day > today - 30 * DAY_MS) return 'Previous 30 days';
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatRowTime(ts: number): string {
  const today = startOfDay(Date.now());
  if (startOfDay(ts) === today) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (startOfDay(ts) > today - 7 * DAY_MS) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function sessionPreview(s: SessionRecord): string {
  const lastAssistant = [...s.messages].reverse().find((m) => m.role === 'assistant');
  const raw = lastAssistant?.content ?? s.transcript[s.transcript.length - 1]?.text ?? '';
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMarkdownExport(session: SessionRecord): string {
  const lines: string[] = [
    `# ${session.title}`,
    `*Recorded ${new Date(session.createdAt).toLocaleString()}*`,
    '',
  ];
  if (session.messages.length > 0) {
    lines.push('## Conversation', '');
    for (const msg of session.messages) {
      lines.push(`### ${msg.role === 'user' ? 'You' : 'StealthIt'}`);
      lines.push(msg.content, '');
    }
  }
  if (session.transcript.length > 0) {
    lines.push('## Live Transcript', '');
    for (const seg of session.transcript) {
      const who = seg.speaker === 'them' ? 'THEM' : 'YOU';
      lines.push(`- **[${who}]** ${seg.text}`);
    }
  }
  return lines.join('\n');
}

/* ---------- Small primitives ---------- */

function CountBadge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex h-5 items-center rounded-[6px] bg-[var(--inset)] px-1.5 font-mono text-[10.5px] font-medium tabular-nums text-[var(--ink-2)] shadow-[0_0_0_1px_var(--line)]">
      {children}
    </span>
  );
}

function IconButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-3)] transition ${
        danger
          ? 'hover:bg-[var(--red-tint)] hover:text-[var(--red)]'
          : 'hover:bg-[var(--hover)] hover:text-[var(--ink)]'
      }`}
    >
      {children}
    </button>
  );
}

/* ---------- Conversation thread ---------- */

function UserBubble({ msg }: { msg: ChatMessage }): React.JSX.Element {
  return (
    <div className="flex flex-col items-end gap-1 pl-16">
      {msg.hasScreenshot && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--inset)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--ink-2)] shadow-[0_0_0_1px_var(--line)]">
          <Camera className="h-3 w-3" />
          Screen attached
        </span>
      )}
      <div className="max-w-full rounded-[12px] bg-[var(--field)] px-3 py-1.5 text-[13px] leading-[1.45] whitespace-pre-wrap break-words text-[var(--ink)] select-text">
        {msg.content}
      </div>
    </div>
  );
}

function AssistantTurn({ msg }: { msg: ChatMessage }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const seconds = msg.durationMs !== undefined ? Math.max(0.1, msg.durationMs / 1000).toFixed(1) : null;

  return (
    <div className="group/turn flex w-full flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[12px] leading-[1.3]">
        <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span className="font-medium text-[var(--ink)]">StealthIt</span>
        {msg.quickAction && <span className="text-[var(--ink-2)]">{msg.quickAction}</span>}
        {seconds && <span className="text-[var(--ink-3)]">for {seconds}s</span>}
        <span className="ml-auto font-mono text-[10.5px] tabular-nums text-[var(--ink-3)]">
          {formatClock(msg.timestamp)}
        </span>
      </div>
      <div className="text-[13px] leading-relaxed text-[var(--ink)] select-text">
        <MarkdownRenderer content={msg.content} />
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition group-hover/turn:opacity-100">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(msg.content);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
          className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-[6px] px-1.5 text-[11px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
        >
          {copied ? <Check className="h-3 w-3 text-[var(--green)]" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function ConversationView({ messages }: { messages: ChatMessage[] }): React.JSX.Element {
  if (messages.length === 0) {
    return <EmptyPane icon={MessageSquare} title="No AI messages" hint="This session only has a live transcript." />;
  }
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-5">
      {messages.map((msg) =>
        msg.role === 'user' ? <UserBubble key={msg.id} msg={msg} /> : <AssistantTurn key={msg.id} msg={msg} />
      )}
    </div>
  );
}

/* ---------- Transcript timeline ---------- */

interface SpeakerGroup {
  speaker: TranscriptSegment['speaker'];
  start: number;
  lines: TranscriptSegment[];
}

function groupTranscript(transcript: TranscriptSegment[]): SpeakerGroup[] {
  const groups: SpeakerGroup[] = [];
  for (const seg of transcript) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === seg.speaker && seg.timestamp - last.lines[last.lines.length - 1].timestamp < 60_000) {
      last.lines.push(seg);
    } else {
      groups.push({ speaker: seg.speaker, start: seg.timestamp, lines: [seg] });
    }
  }
  return groups;
}

function TranscriptView({ transcript }: { transcript: TranscriptSegment[] }): React.JSX.Element {
  const groups = useMemo(() => groupTranscript(transcript), [transcript]);
  if (transcript.length === 0) {
    return <EmptyPane icon={AudioLines} title="No transcript" hint="Press Listen in the HUD to capture meeting audio." />;
  }
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3.5 px-6 py-5">
      {groups.map((g, idx) => {
        const isThem = g.speaker === 'them';
        if (!isThem) {
          return (
            <div key={`${g.start}-${idx}`} className="flex flex-col items-end gap-1 pl-16">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-[10.5px] tabular-nums text-[var(--ink-3)]">{formatClock(g.start)}</span>
                <span className="font-semibold" style={{ color: 'var(--green)' }}>
                  Me
                </span>
              </div>
              <div className="max-w-full rounded-[12px] bg-[var(--field)] px-3 py-1.5 text-[13px] leading-relaxed text-[var(--ink)] select-text">
                {g.lines.map((l) => l.text).join(' ')}
              </div>
            </div>
          );
        }
        return (
          <div key={`${g.start}-${idx}`} className="flex flex-col items-start gap-0.5 pr-12">
            <div className="flex items-center gap-2 text-[11.5px]">
              <span className="font-semibold" style={{ color: 'var(--accent-ink)' }}>
                Them
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-[var(--ink-3)]">{formatClock(g.start)}</span>
            </div>
            <p className="text-[13px] leading-relaxed text-[var(--ink)] select-text">
              {g.lines.map((l) => l.text).join(' ')}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Empty states ---------- */

function EmptyPane({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <div className="mb-1.5 flex h-9 w-9 items-center justify-center rounded-[9px] bg-[var(--inset)] text-[var(--ink-3)] shadow-[0_0_0_1px_var(--line)]">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-[13px] font-medium text-[var(--ink)]">{title}</p>
      <p className="max-w-[280px] text-[12px] text-[var(--ink-3)]">{hint}</p>
    </div>
  );
}

/* ---------- Smart full-text search ---------- */

interface SearchResult {
  session: SessionRecord;
  score: number;
  snippet: string;
  source: 'title' | 'message' | 'transcript';
}

function stripMarkdown(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeQuery(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const part of query.trim().toLowerCase().split(/\s+/)) {
    if (part && !seen.has(part)) {
      seen.add(part);
      terms.push(part);
    }
  }
  return terms;
}

function extractSnippet(text: string, terms: string[], maxLen = 92): string {
  const clean = stripMarkdown(text);
  if (!clean) return '';
  const lower = clean.toLowerCase();
  let firstIdx = -1;
  for (const t of terms) {
    const idx = lower.indexOf(t);
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
      firstIdx = idx;
    }
  }
  if (firstIdx === -1 || clean.length <= maxLen) return clean;
  const start = Math.max(0, firstIdx - 28);
  const end = Math.min(clean.length, start + maxLen);
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

function matchSession(session: SessionRecord, terms: string[]): SearchResult | null {
  if (terms.length === 0) {
    return {
      session,
      score: 0,
      snippet: sessionPreview(session),
      source: 'title',
    };
  }

  const titleLower = session.title.toLowerCase();
  const msgTexts = session.messages.map((m) => m.content);
  const transcriptTexts = session.transcript.map((t) => t.text);

  const combinedLower = [titleLower, ...msgTexts.map((m) => m.toLowerCase()), ...transcriptTexts.map((t) => t.toLowerCase())].join('\n');
  if (!terms.every((t) => combinedLower.includes(t))) {
    return null;
  }

  const titleMatches = terms.filter((t) => titleLower.includes(t)).length;
  const score = titleMatches === terms.length ? 3 : titleMatches > 0 ? 2 : 1;

  // Prefer the message with the most matched terms for the preview snippet
  let bestMsg = '';
  let bestMsgHits = 0;
  for (const content of msgTexts) {
    const low = content.toLowerCase();
    const hits = terms.filter((t) => low.includes(t)).length;
    if (hits > bestMsgHits) {
      bestMsgHits = hits;
      bestMsg = content;
    }
  }
  if (bestMsgHits > 0) {
    return {
      session,
      score,
      snippet: extractSnippet(bestMsg, terms),
      source: 'message',
    };
  }

  // Next check transcript segments
  let bestSeg = '';
  let bestSegHits = 0;
  for (const text of transcriptTexts) {
    const low = text.toLowerCase();
    const hits = terms.filter((t) => low.includes(t)).length;
    if (hits > bestSegHits) {
      bestSegHits = hits;
      bestSeg = text;
    }
  }
  if (bestSegHits > 0) {
    return {
      session,
      score,
      snippet: extractSnippet(bestSeg, terms),
      source: 'transcript',
    };
  }

  return {
    session,
    score,
    snippet: sessionPreview(session),
    source: 'title',
  };
}

function HighlightText({ text, terms }: { text: string; terms: string[] }): React.JSX.Element {
  if (terms.length === 0 || !text) return <>{text}</>;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, idx) =>
        terms.some((t) => part.toLowerCase() === t) ? (
          <mark
            key={idx}
            className="rounded-[3px] bg-[var(--accent-tint)] px-0.5 font-medium text-[var(--ink)]"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

/* ---------- Main tab ---------- */

export function SessionsTab({ sessions, onDelete, onClearAll }: SessionsTabProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(sessions[0]?.id ?? null);
  const [view, setView] = useState<DetailView>('conversation');
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const sorted = useMemo(() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt), [sessions]);
  const terms = useMemo(() => tokenizeQuery(query), [query]);

  const results = useMemo(() => {
    const matched: SearchResult[] = [];
    for (const s of sorted) {
      const m = matchSession(s, terms);
      if (m) matched.push(m);
    }
    if (terms.length > 0) {
      matched.sort((a, b) => b.score - a.score || b.session.updatedAt - a.session.updatedAt);
    }
    return matched;
  }, [sorted, terms]);

  const grouped = useMemo(() => {
    if (terms.length > 0) {
      // During search, preserve relevance order (title matches first)
      const titleHits = results.filter((r) => r.score >= 2);
      const bodyHits = results.filter((r) => r.score < 2);
      const groups: Array<{ label: string; items: SearchResult[] }> = [];
      if (titleHits.length > 0) groups.push({ label: 'Title matches', items: titleHits });
      if (bodyHits.length > 0) groups.push({ label: 'Content matches', items: bodyHits });
      return groups;
    }
    const out: Array<{ label: string; items: SearchResult[] }> = [];
    for (const r of results) {
      const label = groupLabel(r.session.updatedAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(r);
      else out.push({ label, items: [r] });
    }
    return out;
  }, [results, terms.length]);

  const activeResult = results.find((r) => r.session.id === selectedId) ?? results[0] ?? null;
  const active = activeResult?.session ?? null;

  // Pick the most useful default view for the selected session
  useEffect(() => {
    if (!active || !activeResult) return;
    if (terms.length > 0 && activeResult.source === 'transcript') {
      setView('transcript');
    } else {
      setView(active.messages.length === 0 && active.transcript.length > 0 ? 'transcript' : 'conversation');
    }
  }, [active?.id, activeResult?.source]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!confirmClear) return;
    const t = window.setTimeout(() => setConfirmClear(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmClear]);

  const handleCopyMarkdown = (): void => {
    if (!active) return;
    void navigator.clipboard.writeText(formatMarkdownExport(active));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const handleDownloadMarkdown = (): void => {
    if (!active) return;
    const blob = new Blob([formatMarkdownExport(active)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stealthit-session-${active.id.slice(-6)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0">
      {/* ---------- Session list rail ---------- */}
      <aside className="flex w-[264px] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--canvas)]">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold text-[var(--ink)]">History</h2>
            <CountBadge>
              {terms.length > 0 ? `${results.length}/${sessions.length}` : sessions.length}
            </CountBadge>
          </div>
        </div>

        <div className="px-3 pb-2">
          <div className="flex h-8 items-center gap-2 rounded-[8px] bg-[var(--field)] px-2.5 shadow-[0_0_0_1px_var(--line)] focus-within:shadow-[0_0_0_1px_var(--line-strong)]">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-3)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats & transcripts"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                aria-label="Clear search"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="stealth-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {results.length === 0 ? (
            query ? (
              <EmptyPane icon={Search} title="No results found" hint="Adjust your search to try again." />
            ) : (
              <EmptyPane
                icon={MessageSquare}
                title="No sessions yet"
                hint="Ask a question or press Listen in the HUD — sessions save here automatically."
              />
            )
          ) : (
            grouped.map((group) => (
              <div key={group.label} className="mb-2">
                <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-[var(--ink-3)]">{group.label}</div>
                <div className="flex flex-col gap-px">
                  {group.items.map((result) => {
                    const s = result.session;
                    const isSelected = active?.id === s.id;
                    const preview = result.snippet;
                    return (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedId(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedId(s.id);
                          }
                        }}
                        className={`group relative flex cursor-pointer flex-col gap-0.5 rounded-[8px] px-2.5 py-2 transition active:scale-[0.99] ${
                          isSelected ? 'bg-[var(--field)] shadow-[var(--shadow-btn)]' : 'hover:bg-[var(--hover)]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`min-w-0 flex-1 truncate text-[13px] font-medium ${
                              isSelected ? 'text-[var(--ink)]' : 'text-[var(--ink-2)] group-hover:text-[var(--ink)]'
                            }`}
                          >
                            <HighlightText text={s.title} terms={terms} />
                          </span>
                          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-[var(--ink-3)] group-hover:hidden">
                            {formatRowTime(s.updatedAt)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(s.id);
                            }}
                            className="hidden h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-[var(--ink-3)] transition group-hover:inline-flex hover:bg-[var(--red-tint)] hover:text-[var(--red)]"
                            title="Delete session"
                            aria-label="Delete session"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        {preview && (
                          <p className="truncate text-[11.5px] leading-snug text-[var(--ink-3)]">
                            <HighlightText text={preview} terms={terms} />
                          </p>
                        )}
                        <div className="mt-0.5 flex items-center gap-2.5 text-[10.5px] text-[var(--ink-3)]">
                          {s.messages.length > 0 && (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <MessageSquare className="h-3 w-3" />
                              {s.messages.length}
                            </span>
                          )}
                          {s.transcript.length > 0 && (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <AudioLines className="h-3 w-3" />
                              {s.transcript.length}
                            </span>
                          )}
                          {s.messages.some((m) => m.hasScreenshot) && (
                            <span className="inline-flex items-center gap-1">
                              <Camera className="h-3 w-3" />
                            </span>
                          )}
                          {terms.length > 0 && result.source === 'transcript' && (
                            <span className="ml-auto rounded-[4px] bg-[var(--inset)] px-1.5 py-px text-[9.5px] font-medium text-[var(--accent-ink)]">
                              in transcript
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {sessions.length > 0 && (
          <div className="border-t border-[var(--line)] p-2">
            <button
              type="button"
              onClick={() => {
                if (confirmClear) {
                  setConfirmClear(false);
                  onClearAll();
                } else {
                  setConfirmClear(true);
                }
              }}
              className={`inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-[8px] text-[12px] font-medium transition ${
                confirmClear
                  ? 'bg-[var(--red-tint)] text-[var(--red)]'
                  : 'text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-[var(--red)]'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmClear ? 'Click again to delete all' : 'Clear all history'}
            </button>
          </div>
        )}
      </aside>

      {/* ---------- Detail pane ---------- */}
      <section className="flex min-w-0 flex-1 flex-col bg-[var(--page)]">
        {!active ? (
          <EmptyPane
            icon={MessageSquare}
            title="No session selected"
            hint="Every conversation and meeting transcript is saved locally on this device."
          />
        ) : (
          <>
            <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-6 pt-4 pb-3">
              <div className="min-w-0">
                <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                  {active.title}
                </h2>
                <p className="mt-0.5 text-[11.5px] text-[var(--ink-3)]">
                  {new Date(active.createdAt).toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}{' '}
                  · {formatClock(active.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <IconButton title={copied ? 'Copied' : 'Copy as Markdown'} onClick={handleCopyMarkdown}>
                  {copied ? <Check className="h-3.5 w-3.5 text-[var(--green)]" /> : <Copy className="h-3.5 w-3.5" />}
                </IconButton>
                <IconButton title="Export Markdown file" onClick={handleDownloadMarkdown}>
                  <Download className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton title="Delete session" danger onClick={() => onDelete(active.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </header>

            {/* Segmented view switch */}
            <div className="flex items-center gap-1 border-b border-[var(--line)] px-5 py-1.5">
              {(
                [
                  { id: 'conversation', label: 'Conversation', icon: MessageSquare, count: active.messages.length },
                  { id: 'transcript', label: 'Transcript', icon: AudioLines, count: active.transcript.length },
                ] as const
              ).map((tab) => {
                const isActive = view === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setView(tab.id)}
                    aria-pressed={isActive}
                    className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] font-medium transition ${
                      isActive
                        ? 'bg-[var(--field)] text-[var(--ink)]'
                        : 'text-[var(--ink-2)] opacity-70 hover:bg-[var(--hover)] hover:opacity-100'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                    <span className="font-mono text-[10.5px] tabular-nums text-[var(--ink-3)]">{tab.count}</span>
                  </button>
                );
              })}
            </div>

            <div className="stealth-scroll min-h-0 flex-1 overflow-y-auto">
              {view === 'conversation' ? (
                <ConversationView messages={active.messages} />
              ) : (
                <TranscriptView transcript={active.transcript} />
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
