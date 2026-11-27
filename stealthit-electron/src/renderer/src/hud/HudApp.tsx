import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  EyeOff,
  FileText,
  Ghost,
  GripVertical,
  Maximize2,
  Mic,
  Minimize2,
  Paperclip,
  Pencil,
  Plus,
  RotateCw,
  Send,
  Settings,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  BUILT_IN_PERSONAS,
  DEFAULT_SCREEN_CAPTURE_PROMPT,
  DEFAULT_SETTINGS,
  isApiKeyOptional,
  PROVIDER_META,
  QUICK_ACTIONS,
} from '@shared/defaults';
import type {
  AppSettings,
  ChatMessage,
  PersonaPreset,
  QuickAction,
  SecretStatusMap,
  SessionRecord,
  StealthStatus,
  ThinkingStep,
  TranscriptSegment,
} from '@shared/types';
import { AudioWaveform } from '../components/AudioWaveform';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { ThinkingTrace } from '../components/ThinkingTrace';
import { DualAudioEngine } from '../lib/audioEngine';
import { getBridge } from '../lib/bridge';
import { readAttachmentFile, type AttachedFile } from '../lib/fileReader';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function HudApp(): React.JSX.Element {
  const bridge = useMemo(() => getBridge(), []);
  const audioEngineRef = useRef<DualAudioEngine | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [secrets, setSecrets] = useState<SecretStatusMap>({
    openai: false,
    anthropic: false,
    gemini: false,
    openrouter: false,
    deepgram: false,
    groq: false,
  });
  const [personas, setPersonas] = useState<PersonaPreset[]>(BUILT_IN_PERSONAS);
  const [stealthStatus, setStealthStatus] = useState<StealthStatus>({
    contentProtectionActive: true,
    clickThrough: false,
    visible: true,
    opacity: 0.96,
    platform: 'win32',
    encryptionAvailable: true,
  });

  const [expanded, setExpanded] = useState(false);
  const [tallMode, setTallMode] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [fetchingHudModels, setFetchingHudModels] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [sessionId, setSessionId] = useState(() => makeId('session'));
  const [sessionCreatedAt, setSessionCreatedAt] = useState(() => Date.now());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [interimSegments, setInterimSegments] = useState<Record<string, TranscriptSegment>>({});

  const [inputValue, setInputValue] = useState('');
  const [pendingScreenshot, setPendingScreenshot] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [streamingRequestId, setStreamingRequestId] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<string>('');

  // Live audio state
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [listenSeconds, setListenSeconds] = useState(0);
  const [audioStatus, setAudioStatus] = useState<string>('');

  // Keep fresh refs for hotkey & stream callbacks
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const sessionCreatedAtRef = useRef(sessionCreatedAt);
  sessionCreatedAtRef.current = sessionCreatedAt;
  const streamingMsgIdRef = useRef<string | null>(streamingMessageId);
  streamingMsgIdRef.current = streamingMessageId;
  const streamingReqIdRef = useRef<string | null>(streamingRequestId);
  streamingReqIdRef.current = streamingRequestId;
  const streamStartedAtRef = useRef<number>(0);

  const activePersona = useMemo(
    () => personas.find((p) => p.id === settings.activePersonaId) ?? personas[0] ?? BUILT_IN_PERSONAS[0],
    [personas, settings.activePersonaId]
  );

  const activeProviderMeta = PROVIDER_META[settings.activeProvider];
  const activeProviderConfig = settings.providers[settings.activeProvider];
  const needsApiKey =
    activeProviderMeta.requiresKey &&
    settings.activeProvider !== 'ollama' &&
    !isApiKeyOptional(settings.activeProvider, activeProviderConfig) &&
    !secrets[settings.activeProvider];

  // Persist current session whenever messages or finalized transcript change
  const persistCurrentSession = useCallback(
    (nextMessages: ChatMessage[], nextTranscript: TranscriptSegment[]) => {
      if (nextMessages.length === 0 && nextTranscript.length === 0) return;
      const firstUserMsg = nextMessages.find((m) => m.role === 'user')?.content;
      const firstTranscript = nextTranscript[0]?.text;
      const rawTitle = firstUserMsg || firstTranscript || 'Live Session';
      const title = rawTitle.length > 56 ? `${rawTitle.slice(0, 56).trim()}…` : rawTitle;

      const record: SessionRecord = {
        id: sessionIdRef.current,
        title,
        createdAt: sessionCreatedAtRef.current,
        updatedAt: Date.now(),
        personaId: settingsRef.current.activePersonaId,
        messages: nextMessages,
        transcript: nextTranscript,
      };
      void bridge.saveSession(record);
    },
    [attachedFiles, bridge]
  );

  // Resize Electron HUD window seamlessly to match rendered glass card height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafId = 0;
    const syncHeight = (): void => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const targetHeight = Math.ceil(rect.height) + 12;
        void bridge.setHudHeight(targetHeight);
      });
    };

    const observer = new ResizeObserver(syncHeight);
    observer.observe(el);
    syncHeight();

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [
    bridge,
    expanded,
    tallMode,
    showTranscript,
    showModelPicker,
    messages.length,
    pendingScreenshot,
    errorBanner,
  ]);

  // Sync Light/Dark theme class with persisted setting
  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme !== 'light');
  }, [settings.theme]);

  // Listen timer
  useEffect(() => {
    if (!isListening) {
      setListenSeconds(0);
      return;
    }
    const timer = window.setInterval(() => {
      setListenSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isListening]);

  // Auto-scroll conversation & live transcript as new lines arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    if (showTranscript) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [transcript, interimSegments, showTranscript]);

  const handleToggleListen = useCallback(async () => {
    setErrorBanner(null);
    if (!audioEngineRef.current) {
      audioEngineRef.current = new DualAudioEngine();
    }

    if (audioEngineRef.current.isRunning()) {
      audioEngineRef.current.stop();
      setIsListening(false);
      setAudioLevel(0);
      setAudioStatus('');
      setInterimSegments({});
      return;
    }

    setIsListening(true);
    setExpanded(true);
    setShowTranscript(true);
    await audioEngineRef.current.start(settingsRef.current.stt, {
      onTranscript: (seg) => {
        if (seg.isFinal) {
          setInterimSegments((prev) => {
            const copy = { ...prev };
            delete copy[seg.speaker];
            return copy;
          });
          setTranscript((prev) => {
            const wordsOf = (s: string): Set<string> =>
              new Set(
                s
                  .toLowerCase()
                  .replace(/[^a-z0-9 ]/g, ' ')
                  .split(/\s+/)
                  .filter((w) => w.length > 2)
              );

            const overlaps = (a: string, b: string): boolean => {
              const wa = wordsOf(a);
              const wb = wordsOf(b);
              if (wa.size === 0 || wb.size === 0) return false;
              let shared = 0;
              for (const w of wa) {
                if (wb.has(w)) shared++;
              }
              return shared >= Math.min(3, Math.min(wa.size, wb.size));
            };

            let working = [...prev];

            // Bidirectional echo dedup:
            // 1) If YOU arrives and overlaps a recent THEM segment, drop it.
            if (seg.speaker === 'you') {
              const echoOfThem = working.slice(-6).some(
                (old) =>
                  old.speaker === 'them' &&
                  seg.timestamp - old.timestamp < 15000 &&
                  overlaps(old.text, seg.text)
              );
              if (echoOfThem) return prev;
            } else {
              // 2) If THEM arrives, purge any recent YOU echo fragments that overlap it.
              working = working.filter(
                (old) =>
                  !(
                    old.speaker === 'you' &&
                    seg.timestamp - old.timestamp < 15000 &&
                    overlaps(old.text, seg.text)
                  )
              );
            }

            // Merge consecutive segments from the same speaker within 14s so speech
            // reads as one clean flowing paragraph instead of fragmented mini-sentences.
            const last = working[working.length - 1];
            if (
              last &&
              last.speaker === seg.speaker &&
              seg.timestamp - last.timestamp < 14000
            ) {
              working[working.length - 1] = {
                ...last,
                text: `${last.text.trim()} ${seg.text.trim()}`.trim(),
                timestamp: seg.timestamp,
              };
            } else {
              working.push(seg);
            }

            const next = working.slice(-150);
            persistCurrentSession(messagesRef.current, next);
            return next;
          });
        } else {
          setInterimSegments((prev) => ({ ...prev, [seg.speaker]: seg }));
        }
      },
      onAudioLevel: (lvl) => setAudioLevel(lvl),
      onStatus: (st) => setAudioStatus(st),
      onError: (msg) => {
        setErrorBanner(msg);
        if (!audioEngineRef.current?.isRunning()) {
          setIsListening(false);
        }
      },
    });

    if (!audioEngineRef.current.isRunning()) {
      setIsListening(false);
    }
  }, [persistCurrentSession]);

  const handleAttachFiles = useCallback(async (fileList: FileList | File[]) => {
    setErrorBanner(null);
    const files = Array.from(fileList);
    for (const file of files) {
      try {
        const parsed = await readAttachmentFile(file);
        if (parsed.kind === 'image') {
          setPendingScreenshot(parsed.content);
        } else {
          setAttachedFiles((prev) => [...prev.slice(-3), parsed]);
        }
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : `Could not attach ${file.name}`);
      }
    }
  }, []);

  const handleCaptureScreen = useCallback(async (): Promise<string | null> => {
    try {
      setIsCapturing(true);
      setErrorBanner(null);
      const result = await bridge.captureScreen();
      if (!result) return null; // user cancelled region selection
      setPendingScreenshot(result.dataUrl);
      return result.dataUrl;
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Screen capture failed.');
      return null;
    } finally {
      setIsCapturing(false);
    }
  }, [bridge]);

  const sendPrompt = useCallback(
    async (opts: {
      prompt: string;
      screenshotDataUrl?: string | null;
      quickActionLabel?: string;
      historyOverride?: ChatMessage[];
    }) => {
      const cleanPrompt = opts.prompt.trim();
      if (!cleanPrompt) return;

      // Abort any in-flight stream cleanly
      if (streamingReqIdRef.current) {
        void bridge.abortAI(streamingReqIdRef.current);
      }

      setExpanded(true);
      setErrorBanner(null);
      setEditingMsgId(null);

      const currentSettings = settingsRef.current;
      const filesToSend = attachedFiles;
      const steps: ThinkingStep[] = [];
      if (opts.screenshotDataUrl) {
        steps.push({
          id: 'screen',
          label: 'Captured active display',
          detail: 'in-memory',
          status: 'done',
        });
      }
      if (filesToSend.length > 0) {
        steps.push({
          id: 'files',
          label: `Attached ${filesToSend.length === 1 ? 'file' : `${filesToSend.length} files`}`,
          detail: filesToSend.map((f) => f.name).join(', '),
          status: 'done',
        });
      }
      if (transcriptRef.current.length > 0) {
        steps.push({
          id: 'transcript',
          label: 'Attached live transcript',
          detail: `${transcriptRef.current.length} lines`,
          status: 'done',
        });
      }
      if (currentSettings.attachUserContext !== false && currentSettings.userContext.trim()) {
        steps.push({
          id: 'context',
          label: 'Applied background context',
          status: 'done',
        });
      }
      steps.push({
        id: 'model',
        label: 'Generating response',
        detail: currentSettings.providers[currentSettings.activeProvider].model,
        status: 'active',
      });

      const fileContextBlock =
        filesToSend.length > 0
          ? filesToSend
              .map((f) => `--- Attached file: ${f.name} ---\n${f.content}`)
              .join('\n\n')
          : '';
      const finalPrompt = fileContextBlock
        ? `${cleanPrompt}\n\n${fileContextBlock}`
        : cleanPrompt;

      const userLabel =
        opts.quickActionLabel ??
        (filesToSend.length > 0
          ? `${cleanPrompt} [${filesToSend.map((f) => f.name).join(', ')}]`
          : cleanPrompt);

      const userMsg: ChatMessage = {
        id: makeId('user'),
        role: 'user',
        content: userLabel,
        timestamp: Date.now(),
        hasScreenshot: Boolean(opts.screenshotDataUrl),
        quickAction: opts.quickActionLabel,
      };
      const assistantMsgId = makeId('assistant');
      streamStartedAtRef.current = Date.now();
      const assistantPlaceholder: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        thinkingSteps: steps,
      };

      const historyBefore = opts.historyOverride ?? messagesRef.current;
      // For fresh "Analyze screen" captures, send a clean history to the vision model
      // so earlier screenshots' answers never bleed into or confuse the new screen.
      const isFreshScreenScan =
        Boolean(opts.screenshotDataUrl) && opts.quickActionLabel === 'Analyze screen';
      const historyForModel = isFreshScreenScan ? [] : historyBefore;
      const nextMessages = [...historyBefore, userMsg, assistantPlaceholder];
      setMessages(nextMessages);
      setStreamingMessageId(assistantMsgId);
      setInputValue('');
      setPendingScreenshot(null);
      setAttachedFiles([]);

      try {
        const { requestId } = await bridge.askAI({
          sessionId: sessionIdRef.current,
          prompt: finalPrompt,
          screenshotDataUrl: opts.screenshotDataUrl ?? undefined,
          quickActionLabel: opts.quickActionLabel,
          transcript: transcriptRef.current,
          history: historyForModel,
        });
        setStreamingRequestId(requestId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start AI request.';
        setErrorBanner(message);
        setStreamingMessageId(null);
        setStreamingRequestId(null);
      }
    },
    [attachedFiles, bridge]
  );

  const getScreenPrompt = useCallback((): string => {
    const custom = settingsRef.current.screenCapturePrompt?.trim();
    return custom || DEFAULT_SCREEN_CAPTURE_PROMPT;
  }, []);

  const handleAskScreen = useCallback(async () => {
    setExpanded(true);
    const dataUrl = await handleCaptureScreen();
    if (!dataUrl) return;
    const userText = inputValue.trim();
    await sendPrompt({
      prompt: userText || getScreenPrompt(),
      screenshotDataUrl: dataUrl,
      quickActionLabel: userText ? undefined : 'Analyze screen',
    });
  }, [getScreenPrompt, handleCaptureScreen, inputValue, sendPrompt]);

  const handleQuickAction = useCallback(
    async (action: QuickAction) => {
      // Always capture a fresh screen when running a screenshot quick action
      const shot = action.includeScreenshot
        ? await handleCaptureScreen()
        : pendingScreenshot;
      if (action.includeScreenshot && !shot) return;
      await sendPrompt({
        prompt: action.includeScreenshot ? getScreenPrompt() : action.prompt,
        screenshotDataUrl: shot,
        quickActionLabel: action.label,
      });
    },
    [getScreenPrompt, handleCaptureScreen, pendingScreenshot, sendPrompt]
  );

  const handleQuickActionRef = useRef(handleQuickAction);
  handleQuickActionRef.current = handleQuickAction;

  const handleAskScreenRef = useRef(handleAskScreen);
  handleAskScreenRef.current = handleAskScreen;

  const handleToggleListenRef = useRef(handleToggleListen);
  handleToggleListenRef.current = handleToggleListen;

  const persistCurrentSessionRef = useRef(persistCurrentSession);
  persistCurrentSessionRef.current = persistCurrentSession;

  const handleStopStreaming = useCallback(() => {
    if (streamingReqIdRef.current) {
      void bridge.abortAI(streamingReqIdRef.current);
      setStreamingRequestId(null);
      setStreamingMessageId(null);
    }
  }, [bridge]);

  const handleNewSession = useCallback(() => {
    if (streamingReqIdRef.current) {
      void bridge.abortAI(streamingReqIdRef.current);
    }
    if (audioEngineRef.current?.isRunning()) {
      audioEngineRef.current.stop();
    }
    setIsListening(false);
    setAudioLevel(0);
    setAudioStatus('');
    setShowTranscript(false);
    setStreamingRequestId(null);
    setStreamingMessageId(null);
    setMessages([]);
    setTranscript([]);
    setInterimSegments({});
    setPendingScreenshot(null);
    setAttachedFiles([]);
    setErrorBanner(null);
    setSessionId(makeId('session'));
    setSessionCreatedAt(Date.now());
  }, [bridge]);

  const handleNewSessionRef = useRef(handleNewSession);
  handleNewSessionRef.current = handleNewSession;

  // Stop audio only when the HUD window actually unmounts (never on keystrokes/re-renders)
  useEffect(() => {
    return () => {
      audioEngineRef.current?.stop();
    };
  }, []);

  // Initial load & IPC subscriptions (mount-only so typing never tears down listeners or audio)
  useEffect(() => {
    void (async () => {
      const [s, sec, p, st] = await Promise.all([
        bridge.getSettings(),
        bridge.getSecretStatus(),
        bridge.getPersonas(),
        bridge.getStealthStatus(),
      ]);
      setSettings(s);
      setSecrets(sec);
      setPersonas(p);
      setStealthStatus(st);
    })();

    const unsubChunk = bridge.onAIChunk(({ requestId, delta }) => {
      if (streamingReqIdRef.current && requestId !== streamingReqIdRef.current) return;
      const targetId = streamingMsgIdRef.current;
      if (!targetId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === targetId ? { ...m, content: m.content + delta } : m))
      );
    });

    const unsubDone = bridge.onAIDone(({ requestId, fullText }) => {
      if (streamingReqIdRef.current && requestId !== streamingReqIdRef.current) return;
      const targetId = streamingMsgIdRef.current;
      const elapsed = streamStartedAtRef.current ? Date.now() - streamStartedAtRef.current : undefined;
      setStreamingRequestId(null);
      setStreamingMessageId(null);

      setMessages((prev) => {
        const next = prev.map((m) => {
          if (m.id !== targetId) return m;
          const completedSteps = m.thinkingSteps?.map((s) => ({
            ...s,
            status: 'done' as const,
            label: s.id === 'model' ? 'Generated response' : s.label,
          }));
          return {
            ...m,
            content: fullText || m.content,
            thinkingSteps: completedSteps,
            durationMs: elapsed,
          };
        });
        persistCurrentSessionRef.current(next, transcriptRef.current);
        return next;
      });
    });

    const unsubError = bridge.onAIError(({ requestId, error }) => {
      if (streamingReqIdRef.current && requestId !== streamingReqIdRef.current) return;
      const targetId = streamingMsgIdRef.current;
      setStreamingRequestId(null);
      setStreamingMessageId(null);
      setErrorBanner(error);
      // Remove empty assistant placeholder on error
      if (targetId) {
        setMessages((prev) => prev.filter((m) => !(m.id === targetId && m.content.trim() === '')));
      }
    });

    const unsubSettings = bridge.onSettingsChanged((next) => {
      setSettings(next);
      void bridge.getSecretStatus().then(setSecrets);
      void bridge.getPersonas().then(setPersonas);
    });

    const unsubStealth = bridge.onStealthStatusChanged((status) => {
      setStealthStatus(status);
    });

    const unsubHotkey = bridge.onHotkey(({ action }) => {
      if (action === 'ask-screen') {
        void handleAskScreenRef.current();
      } else if (action === 'ask-assist') {
        const assistAction = QUICK_ACTIONS.find((a) => a.id === 'what-to-say') ?? QUICK_ACTIONS[0];
        if (assistAction) {
          void handleQuickActionRef.current(assistAction);
        }
      } else if (action === 'toggle-expand') {
        setExpanded((prev) => {
          const next = !prev;
          if (next) {
            window.setTimeout(() => inputRef.current?.focus(), 60);
          }
          return next;
        });
      } else if (action === 'toggle-listen') {
        void handleToggleListenRef.current();
      } else if (action === 'panic-clear') {
        handleNewSessionRef.current();
        setExpanded(false);
        setTallMode(false);
        void bridge.toggleVisibility();
      }
    });

    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
      unsubSettings();
      unsubStealth();
      unsubHotkey();
    };
  }, [bridge]);

  const handleCopyMessage = (msg: ChatMessage): void => {
    void navigator.clipboard.writeText(msg.content);
    setCopiedMsgId(msg.id);
    window.setTimeout(() => setCopiedMsgId(null), 1500);
  };

  const handleSelectHudModel = useCallback(
    async (model: string) => {
      const activeId = settingsRef.current.activeProvider;
      const updated = await bridge.updateSettings({
        providers: {
          ...settingsRef.current.providers,
          [activeId]: {
            ...settingsRef.current.providers[activeId],
            model,
          },
        },
      });
      setSettings(updated);
      setShowModelPicker(false);
      setModelSearch('');
    },
    [attachedFiles, bridge]
  );

  const handleFetchHudModels = useCallback(async () => {
    setFetchingHudModels(true);
    try {
      const res = await bridge.fetchProviderModels(settingsRef.current.activeProvider);
      if (!res.ok && res.error) {
        setErrorBanner(res.error);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to fetch models.');
    } finally {
      setFetchingHudModels(false);
    }
  }, [bridge]);

  useEffect(() => {
    setModelSearch('');
  }, [settings.activeProvider]);

  const cachedProviderModels = settings.providers[settings.activeProvider].cachedModels ?? [];

  const availableHudModels = useMemo(() => {
    const base =
      cachedProviderModels.length > 0
        ? cachedProviderModels
        : [...activeProviderMeta.defaultModels];
    const current = settings.providers[settings.activeProvider].model;
    const merged = base.includes(current) ? base : [current, ...base];
    const q = modelSearch.trim().toLowerCase();
    return q ? merged.filter((m) => m.toLowerCase().includes(q)) : merged;
  }, [
    cachedProviderModels,
    activeProviderMeta.defaultModels,
    settings.providers,
    settings.activeProvider,
    modelSearch,
  ]);

  const liveTranscriptPreview = useMemo(() => {
    const interims = Object.values(interimSegments);
    return [...transcript.slice(-40), ...interims];
  }, [transcript, interimSegments]);

  return (
    <div
      className="flex w-full flex-col items-center px-1.5 pt-1 select-none transition-opacity duration-150"
      style={{ opacity: Math.min(1, Math.max(0.35, stealthStatus.opacity)) }}
    >
      <div ref={containerRef} className="flex w-full flex-col gap-2">
        {/* TOP FLOATING PILL BAR */}
        <div className="glass-pill drag-region flex h-[50px] w-full items-center justify-between gap-2 rounded-[14px] px-2.5">
          {/* Left: Drag grip + Listen + Ask */}
          <div className="flex items-center gap-1.5">
            <div
              className="flex h-7 w-5 items-center justify-center text-[var(--ink-3)]"
              title="Drag to reposition (or Ctrl+Arrow keys)"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </div>

            {/* Listen Toggle */}
            <button
              type="button"
              onClick={() => void handleToggleListen()}
              className="no-drag inline-flex h-8 cursor-pointer items-center gap-2 rounded-[9px] px-3 text-xs font-medium transition"
              style={{
                background: isListening ? 'var(--green-tint)' : 'var(--field)',
                color: isListening ? 'var(--green)' : 'var(--ink-2)',
              }}
              title="Toggle live system & mic listening (Ctrl+Shift+Space)"
            >
              {isListening ? (
                <>
                  <AudioWaveform level={audioLevel} active={isListening} />
                  <span className="font-mono text-[11px] tabular-nums">
                    {formatElapsed(listenSeconds)}
                  </span>
                </>
              ) : (
                <>
                  <Mic className="h-3.5 w-3.5 text-[var(--accent)]" />
                  <span>Listen</span>
                </>
              )}
            </button>

            {/* Primary Ask / Screen Trigger */}
            <button
              type="button"
              onClick={() => {
                if (!expanded) {
                  setExpanded(true);
                  window.setTimeout(() => inputRef.current?.focus(), 60);
                } else {
                  void handleAskScreen();
                }
              }}
              className="no-drag inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] px-3 text-xs font-medium transition hover:opacity-90"
              style={{
                background: 'var(--accent-tint)',
                color: 'var(--accent-ink)',
              }}
              title="Ask AI or capture active screen (Ctrl+Enter)"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{expanded ? 'Snap & Ask' : 'Ask AI'}</span>
              <kbd className="ml-0.5 rounded bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-2)] shadow-[var(--shadow-btn)]">
                Ctrl↵
              </kbd>
            </button>

            {/* Quick Assist when listening */}
            {isListening && (
              <button
                type="button"
                onClick={() => void handleQuickAction(QUICK_ACTIONS[0])}
                className="no-drag inline-flex h-8 cursor-pointer items-center gap-1 rounded-[9px] px-2.5 text-xs font-medium transition hover:opacity-90"
                style={{
                  background: 'var(--accent)',
                  color: '#ffffff',
                }}
                title="Generate instant talking points from live transcript"
              >
                <span>What to say</span>
              </button>
            )}
          </div>

          {/* Right: Persona/Model chip + Stealth badge + Controls */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowModelPicker((prev) => !prev)}
              className="no-drag hidden sm:inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[7px] bg-[var(--field)] px-2.5 text-[11px] text-[var(--ink-2)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
              title={`Switch model (${activeProviderMeta.label})`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: needsApiKey ? 'var(--orange)' : 'var(--green)' }}
              />
              <span className="max-w-[115px] truncate font-mono font-medium">
                {settings.providers[settings.activeProvider].model}
              </span>
              <ChevronDown
                className={`h-3 w-3 text-[var(--ink-3)] transition-transform ${
                  showModelPicker ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Stealth / Ghost Indicator */}
            <button
              type="button"
              onClick={() => void bridge.openDashboard('stealth')}
              className="no-drag inline-flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2 text-[11px] font-medium transition"
              style={
                stealthStatus.clickThrough
                  ? { background: 'var(--orange-tint)', color: 'var(--orange)' }
                  : stealthStatus.contentProtectionActive
                    ? { background: 'var(--green-tint)', color: 'var(--green)' }
                    : { background: 'var(--red-tint)', color: 'var(--red)' }
              }
              title={
                stealthStatus.clickThrough
                  ? 'Ghost Click-Through ON (Ctrl+Shift+T to disable)'
                  : stealthStatus.contentProtectionActive
                    ? 'Invisible to Zoom, Teams, Meet, Discord & OBS'
                    : 'Screen-share protection disabled'
              }
            >
              {stealthStatus.clickThrough ? (
                <Ghost className="h-3.5 w-3.5" />
              ) : stealthStatus.contentProtectionActive ? (
                <ShieldCheck className="h-3.5 w-3.5" />
              ) : (
                <ShieldOff className="h-3.5 w-3.5" />
              )}
              <span className="hidden md:inline">
                {stealthStatus.clickThrough
                  ? 'Ghost'
                  : stealthStatus.contentProtectionActive
                    ? 'Hidden'
                    : 'Visible'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="no-drag inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
              title={expanded ? 'Collapse HUD (Ctrl+Shift+E)' : 'Expand HUD (Ctrl+Shift+E)'}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {expanded && (
              <button
                type="button"
                onClick={() => setTallMode((prev) => !prev)}
                className="no-drag inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                title={tallMode ? 'Compact height' : 'Expand height for long answers'}
              >
                {tallMode ? (
                  <Minimize2 className="h-3.5 w-3.5 text-[var(--accent)]" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => void bridge.openDashboard('sessions')}
              className="no-drag inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
              title="Open Stealth Dashboard (Ctrl+Shift+D)"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => void bridge.toggleVisibility()}
              className="no-drag inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
              title="Hide HUD (Ctrl+\)"
            >
              <EyeOff className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* INLINE MODEL PICKER POPOVER */}
        <AnimatePresence initial={false}>
          {showModelPicker && (
            <motion.div
              key="hud-model-picker"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="glass-panel no-drag flex w-full flex-col overflow-hidden rounded-2xl p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-[var(--ink)]">
                    {activeProviderMeta.label} Models
                  </span>
                  <span className="rounded bg-[var(--field)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-3)]">
                    {availableHudModels.length}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {!needsApiKey && (
                    <button
                      type="button"
                      disabled={fetchingHudModels}
                      onClick={() => void handleFetchHudModels()}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium transition hover:opacity-90 disabled:opacity-50"
                      style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}
                    >
                      <RotateCw className={`h-3 w-3 ${fetchingHudModels ? 'animate-spin' : ''}`} />
                      <span>{fetchingHudModels ? 'Fetching…' : 'Fetch Models'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowModelPicker(false);
                      void bridge.openDashboard('providers');
                    }}
                    className="bui-btn cursor-pointer px-2 py-1 text-[11px] font-medium text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                  >
                    API Keys
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowModelPicker(false)}
                    className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] text-[var(--ink-3)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {(cachedProviderModels.length > 6 || modelSearch.length > 0) && (
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Filter models…"
                  className="w-full rounded-[8px] border border-[var(--line)] bg-[var(--inset)] px-2.5 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--accent)] focus:outline-none"
                />
              )}

              <div className="stealth-scroll grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                {availableHudModels.map((model) => {
                  const isCurrent = settings.providers[settings.activeProvider].model === model;
                  return (
                    <button
                      key={model}
                      type="button"
                      onClick={() => void handleSelectHudModel(model)}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-left font-mono text-[11.5px] transition ${
                        isCurrent
                          ? 'bg-[var(--accent-tint)] font-semibold text-[var(--accent-ink)]'
                          : 'bg-[var(--field)] text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)]'
                      }`}
                    >
                      <span className="truncate">{model}</span>
                      {isCurrent && (
                        <Check className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--green)' }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* EXPANDABLE GLASS PANEL */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="hud-expanded"
              initial={{ opacity: 0, y: -6, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.985 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingFile(true);
              }}
              onDragLeave={() => setIsDraggingFile(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingFile(false);
                if (e.dataTransfer.files?.length) {
                  void handleAttachFiles(e.dataTransfer.files);
                }
              }}
              className={`glass-panel no-drag flex w-full flex-col overflow-hidden rounded-2xl ${
                isDraggingFile ? 'ring-2 ring-[var(--accent)]' : ''
              }`}
            >
              {/* Sub-header: Quick actions + Notes toggle + New Session */}
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line-soft)] px-3 py-2">
                <div className="flex items-center gap-1.5 overflow-x-auto stealth-scroll">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      disabled={Boolean(streamingRequestId)}
                      onClick={() => void handleQuickAction(action)}
                      title={
                        action.id === 'what-to-say'
                          ? 'What should I say? (Ctrl+Shift+Enter)'
                          : action.includeScreenshot
                            ? 'Analyze screen (Ctrl+Enter)'
                            : action.label
                      }
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] bg-[var(--field)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-2)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-40"
                    >
                      {action.includeScreenshot && (
                        <Camera className="h-3 w-3 text-[var(--accent)]" />
                      )}
                      <span>{action.label}</span>
                      {action.id === 'what-to-say' && (
                        <kbd className="rounded bg-[var(--surface)] px-1 py-px font-mono text-[9.5px] text-[var(--ink-3)]">
                          Ctrl+⇧+↵
                        </kbd>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {(isListening || transcript.length > 0) && (
                    <button
                      type="button"
                      onClick={() => setShowTranscript((prev) => !prev)}
                      className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-[6px] px-2 text-[11px] font-medium transition"
                      style={
                        showTranscript
                          ? { background: 'var(--green-tint)', color: 'var(--green)' }
                          : { background: 'var(--field)', color: 'var(--ink-2)' }
                      }
                      title={showTranscript ? 'Hide live transcript' : 'Show live transcript'}
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span>{showTranscript ? 'Hide Notes' : 'Notes'}</span>
                      {transcript.length > 0 && (
                        <span className="rounded-full bg-[var(--surface)] px-1.5 font-mono text-[10px] text-[var(--ink)]">
                          {transcript.length}
                        </span>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleNewSession}
                    className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-[6px] bg-[var(--field)] px-2 text-[11px] font-medium text-[var(--ink-2)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                    title="Start a new chat session"
                  >
                    <Plus className="h-3 w-3 shrink-0" />
                    <span>New</span>
                  </button>
                </div>
              </div>

              {/* API Key Setup Hint */}
              {needsApiKey && (
                <div className="flex items-center justify-between gap-2 border-b border-amber-400/20 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200">
                  <span>
                    Add your <strong>{activeProviderMeta.label}</strong> API key (or switch to local
                    Ollama) to start getting instant answers.
                  </span>
                  <button
                    type="button"
                    onClick={() => void bridge.openDashboard('providers')}
                    className="shrink-0 rounded-lg bg-amber-400/20 px-2.5 py-1 font-medium text-amber-100 ring-1 ring-amber-400/40 hover:bg-amber-400/30"
                  >
                    Configure
                  </button>
                </div>
              )}

              {/* Error Banner */}
              {errorBanner && (
                <div className="flex items-center justify-between gap-2 border-b border-rose-500/25 bg-rose-500/12 px-3.5 py-2 text-xs text-rose-200">
                  <span className="break-words">{errorBanner}</span>
                  <button
                    type="button"
                    onClick={() => setErrorBanner(null)}
                    className="shrink-0 rounded p-0.5 text-rose-300 hover:bg-white/10"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Messages Stream (collapses cleanly when only viewing live transcript) */}
              {(messages.length > 0 || !showTranscript) && (
                <div
                  className="stealth-scroll min-h-[92px] overflow-y-auto px-3.5 py-3 space-y-3 transition-[max-height] duration-150"
                  style={{
                    maxHeight: tallMode
                      ? `${Math.max(620, (window.screen?.availHeight || 960) - 210)}px`
                      : `${Math.max(480, Math.round((window.screen?.availHeight || 960) * 0.56))}px`,
                  }}
                >
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-4 text-center">
                      <p className="text-xs font-medium text-[var(--ink-2)]">
                        {activePersona.name} ready · {activeProviderMeta.label}
                      </p>
                      <p className="mt-1 text-[11.5px] text-[var(--ink-3)]">
                        Press{' '}
                        <kbd className="rounded bg-[var(--field)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-2)]">
                          Ctrl+Enter
                        </kbd>{' '}
                        to snap your screen,{' '}
                        <kbd className="rounded bg-[var(--field)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-2)]">
                          Ctrl+Shift+Enter
                        </kbd>{' '}
                        for live assist, or ask below.
                      </p>
                    </div>
                  ) : (
                  messages.map((msg, msgIndex) => {
                    const isStreamingThis = msg.id === streamingMessageId;
                    if (msg.role === 'user') {
                      const isEditingThis = editingMsgId === msg.id;
                      return (
                        <div key={msg.id} className="group flex flex-col items-end gap-1">
                          {isEditingThis ? (
                            <div className="w-full max-w-[92%] space-y-1.5 rounded-[10px] border border-[var(--accent)] bg-[var(--surface)] p-2">
                              <textarea
                                rows={2}
                                autoFocus
                                value={editingDraft}
                                onChange={(e) => setEditingDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    setEditingMsgId(null);
                                  } else if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    if (editingDraft.trim()) {
                                      void sendPrompt({
                                        prompt: editingDraft.trim(),
                                        historyOverride: messages.slice(0, msgIndex),
                                      });
                                    }
                                  }
                                }}
                                className="w-full resize-none bg-transparent text-xs text-[var(--ink)] focus:outline-none"
                              />
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setEditingMsgId(null)}
                                  className="cursor-pointer rounded-[6px] bg-[var(--field)] px-2.5 py-1 text-[10.5px] font-medium text-[var(--ink-2)] hover:bg-[var(--hover)]"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={!editingDraft.trim() || Boolean(streamingRequestId)}
                                  onClick={() => {
                                    if (editingDraft.trim()) {
                                      void sendPrompt({
                                        prompt: editingDraft.trim(),
                                        historyOverride: messages.slice(0, msgIndex),
                                      });
                                    }
                                  }}
                                  className="cursor-pointer rounded-[6px] px-2.5 py-1 text-[10.5px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                                  style={{ background: 'var(--accent)' }}
                                >
                                  Save &amp; Resend
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex max-w-[92%] items-center gap-1.5">
                              <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => handleCopyMessage(msg)}
                                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] bg-[var(--field)] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                                  title="Copy message"
                                >
                                  {copiedMsgId === msg.id ? (
                                    <Check className="h-3 w-3" style={{ color: 'var(--green)' }} />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(streamingRequestId)}
                                  onClick={() => {
                                    setEditingMsgId(msg.id);
                                    setEditingDraft(msg.content);
                                  }}
                                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] bg-[var(--field)] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-40"
                                  title="Edit & resend"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                              <div
                                className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-xs font-medium"
                                style={{
                                  background: 'var(--accent-tint)',
                                  color: 'var(--accent-ink)',
                                }}
                              >
                                {msg.hasScreenshot && <Camera className="h-3 w-3 shrink-0" />}
                                <span className="break-words">{msg.content}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={msg.id}
                        className="animate-fade-up group relative rounded-[10px] border border-[var(--line-soft)] bg-[var(--surface)] px-3.5 py-2.5"
                      >
                        <ThinkingTrace
                          steps={msg.thinkingSteps ?? []}
                          isStreaming={isStreamingThis}
                          hasContent={Boolean(msg.content)}
                          durationMs={msg.durationMs}
                        />

                        {(msg.content || !isStreamingThis) && (
                          <MarkdownRenderer
                            content={msg.content || '…'}
                            streaming={isStreamingThis}
                          />
                        )}

                        {!isStreamingThis && msg.content && (
                          <div className="mt-2.5 flex items-center gap-1.5 border-t border-[var(--line-soft)] pt-2">
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg)}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] bg-[var(--field)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--ink-2)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <Check className="h-3 w-3" style={{ color: 'var(--green)' }} />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              disabled={Boolean(streamingRequestId)}
                              onClick={() =>
                                void sendPrompt({
                                  prompt:
                                    'Tighten your previous answer into 2-3 ultra-short spoken bullet points I can say out loud right now.',
                                  quickActionLabel: 'Shorter',
                                })
                              }
                              className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] bg-[var(--field)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--ink-2)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-40"
                            >
                              <Minimize2 className="h-3 w-3" />
                              <span>Shorter</span>
                            </button>

                            <button
                              type="button"
                              disabled={Boolean(streamingRequestId)}
                              onClick={() => {
                                const lastUser = [...messages]
                                  .reverse()
                                  .find((m) => m.role === 'user');
                                if (lastUser) {
                                  void sendPrompt({
                                    prompt: lastUser.content,
                                    quickActionLabel: 'Regenerate',
                                  });
                                }
                              }}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] bg-[var(--field)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--ink-2)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-40"
                            >
                              <RotateCw className="h-3 w-3" />
                              <span>Retry</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                  <div ref={messagesEndRef} />
                </div>
              )}

              {/* Live Transcript Drawer (appears below messages so existing chat never gets pushed down) */}
              {showTranscript && (
                <div
                  className={`${
                    messages.length > 0 ? 'border-t border-[var(--line-soft)]' : ''
                  } bg-[var(--inset)] px-3.5 py-2.5`}
                >
                  <div className="mb-1.5 flex items-center justify-between text-[10.5px] uppercase tracking-wider text-[var(--ink-3)]">
                    <span className="inline-flex items-center gap-1.5">
                      {isListening && (
                        <span
                          className="h-1.5 w-1.5 rounded-full animate-pulse"
                          style={{ background: 'var(--green)' }}
                        />
                      )}
                      {isListening
                        ? audioStatus || 'Live Listening'
                        : 'Saved Audio Transcript'}
                    </span>
                    <div className="flex items-center gap-2 normal-case">
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-[var(--ink-3)]">
                        <kbd className="rounded bg-[var(--field)] px-1.5 py-px font-mono text-[9.5px] text-[var(--ink-2)]">
                          Ctrl+⇧+↵
                        </kbd>
                        <span>What to say</span>
                      </span>
                      {transcript.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setTranscript([])}
                          className="inline-flex cursor-pointer items-center gap-1 text-[var(--ink-3)] hover:text-[var(--ink)]"
                        >
                          <Trash2 className="h-3 w-3" />
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  {liveTranscriptPreview.length === 0 ? (
                    <p className="text-xs text-[var(--ink-3)]">
                      Waiting for speech… Meeting audio (<strong>THEM</strong>) and your mic (<strong>ME</strong>) will appear here.
                    </p>
                  ) : (
                    <div
                      className="stealth-scroll space-y-2 overflow-y-auto pr-1 text-[12.5px] transition-[max-height] duration-150"
                      style={{
                        maxHeight:
                          messages.length === 0
                            ? tallMode
                              ? `${Math.max(620, (window.screen?.availHeight || 960) - 210)}px`
                              : `${Math.max(480, Math.round((window.screen?.availHeight || 960) * 0.56))}px`
                            : tallMode
                              ? '300px'
                              : '220px',
                      }}
                    >
                      {liveTranscriptPreview.map((seg) => {
                        const isMe = seg.speaker === 'you';
                        if (isMe) {
                          return (
                            <div
                              key={seg.id}
                              className="flex justify-end pl-10 leading-relaxed"
                            >
                              <div className="inline-flex max-w-full items-start gap-2 rounded-[10px] bg-[var(--field)] px-2.5 py-1.5">
                                <span
                                  className={
                                    seg.isFinal
                                      ? 'text-[var(--ink)] break-words'
                                      : 'italic text-[var(--ink-3)] break-words'
                                  }
                                >
                                  {seg.text}
                                </span>
                                <span
                                  className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase"
                                  style={{ background: 'var(--green-tint)', color: 'var(--green)' }}
                                >
                                  Me
                                </span>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div
                            key={seg.id}
                            className="flex items-start gap-2 pr-10 leading-relaxed"
                          >
                            <span
                              className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase"
                              style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}
                            >
                              Them
                            </span>
                            <span
                              className={
                                seg.isFinal
                                  ? 'text-[var(--ink)] break-words'
                                  : 'italic text-[var(--ink-3)] break-words'
                              }
                            >
                              {seg.text}
                            </span>
                          </div>
                        );
                      })}
                      <div ref={transcriptEndRef} />
                    </div>
                  )}
                </div>
              )}

              {/* Inline Persona Switcher & Live Context Chips */}
              <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line-soft)] bg-[var(--canvas)] px-3 py-1.5 text-[10.5px]">
                {personas.map((persona) => {
                  const isActive = persona.id === activePersona.id;
                  return (
                    <button
                      key={persona.id}
                      type="button"
                      onClick={() => {
                        void bridge
                          .updateSettings({ activePersonaId: persona.id })
                          .then(setSettings);
                      }}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2 py-0.5 font-medium transition"
                      style={
                        isActive
                          ? {
                              background: 'var(--accent-tint)',
                              color: 'var(--accent-ink)',
                              boxShadow: '0 0 0 1px var(--accent)',
                            }
                          : {
                              background: 'var(--surface)',
                              color: 'var(--ink-2)',
                              boxShadow: 'var(--shadow-btn)',
                            }
                      }
                      title={persona.tagline}
                    >
                      {isActive && <Sparkles className="h-2.5 w-2.5" />}
                      <span>{persona.name}</span>
                    </button>
                  );
                })}

                {settings.userContext.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextAttach = settings.attachUserContext === false;
                      void bridge
                        .updateSettings({ attachUserContext: nextAttach })
                        .then(setSettings);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2 py-0.5 font-medium transition"
                    style={
                      settings.attachUserContext !== false
                        ? { background: 'var(--accent-tint)', color: 'var(--accent-ink)' }
                        : {
                            background: 'var(--surface)',
                            color: 'var(--ink-3)',
                            boxShadow: 'var(--shadow-btn)',
                          }
                    }
                    title={
                      settings.attachUserContext !== false
                        ? 'Background context attached — click to disable for general questions'
                        : 'Background context off — click to re-attach'
                    }
                  >
                    <FileText className="h-2.5 w-2.5" />
                    <span className={settings.attachUserContext === false ? 'line-through' : ''}>
                      {settings.attachUserContext !== false ? 'Context On' : 'Context Off'}
                    </span>
                  </button>
                )}

                {transcript.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowTranscript((prev) => !prev)}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2 py-0.5 font-medium transition"
                    style={{ background: 'var(--green-tint)', color: 'var(--green)' }}
                    title="Toggle live transcript strip"
                  >
                    <Mic className="h-2.5 w-2.5" />
                    <span>{transcript.length} transcript lines</span>
                  </button>
                )}

                {attachedFiles.map((file) => (
                  <span
                    key={file.id}
                    className="inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 font-medium"
                    style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}
                  >
                    <Paperclip className="h-2.5 w-2.5" />
                    <span className="max-w-[130px] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachedFiles((prev) => prev.filter((f) => f.id !== file.id))
                      }
                      className="ml-0.5 cursor-pointer rounded hover:opacity-75"
                      title={`Remove ${file.name}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}

                {pendingScreenshot && (
                  <span
                    className="inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 font-medium"
                    style={{ background: 'var(--accent-tint)', color: 'var(--accent-ink)' }}
                  >
                    <Camera className="h-2.5 w-2.5" />
                    <span>Screen attached</span>
                    <button
                      type="button"
                      onClick={() => setPendingScreenshot(null)}
                      className="ml-0.5 cursor-pointer rounded hover:opacity-75"
                      title="Remove screenshot"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                )}
              </div>

              {/* Prompt Composer */}
              <div className="flex items-end gap-1.5 border-t border-[var(--line-soft)] bg-[var(--inset)] px-3 py-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,.json,.pdf,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cs,.sql,.yaml,.yml,.xml,.log,.html,.css,image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      void handleAttachFiles(e.target.files);
                    }
                    e.target.value = '';
                  }}
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] transition"
                  style={
                    attachedFiles.length > 0
                      ? { background: 'var(--accent-tint)', color: 'var(--accent-ink)' }
                      : { background: 'var(--field)', color: 'var(--ink-2)' }
                  }
                  title="Attach file or image (or drag & drop / Ctrl+V paste)"
                >
                  <Paperclip className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  disabled={isCapturing}
                  onClick={() => void handleCaptureScreen()}
                  className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] transition"
                  style={
                    pendingScreenshot
                      ? { background: 'var(--accent-tint)', color: 'var(--accent-ink)' }
                      : { background: 'var(--field)', color: 'var(--ink-2)' }
                  }
                  title="Attach active screen snapshot (zero temp files)"
                >
                  <Camera className="h-4 w-4" />
                </button>

                <textarea
                  ref={inputRef}
                  rows={1}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onPaste={(e) => {
                    const items = Array.from(e.clipboardData?.items ?? []);
                    const imageFiles = items
                      .filter((item) => item.type.startsWith('image/'))
                      .map((item) => item.getAsFile())
                      .filter((f): f is File => f !== null);
                    if (imageFiles.length > 0) {
                      e.preventDefault();
                      void handleAttachFiles(imageFiles);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (inputValue.trim() || pendingScreenshot || attachedFiles.length > 0) {
                        void sendPrompt({
                          prompt:
                            inputValue.trim() ||
                            (pendingScreenshot
                              ? getScreenPrompt()
                              : 'Analyze the attached file(s) and summarize the key points.'),
                          screenshotDataUrl: pendingScreenshot,
                        });
                      }
                    }
                  }}
                  placeholder="Ask anything, paste an image (Ctrl+V), or drop a file…"
                  className="max-h-24 flex-1 resize-none bg-transparent py-1.5 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:outline-none"
                />

                {streamingRequestId ? (
                  <button
                    type="button"
                    onClick={handleStopStreaming}
                    className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-[9px] px-3 text-xs font-medium transition"
                    style={{ background: 'var(--red-tint)', color: 'var(--red)' }}
                  >
                    <Square className="h-3 w-3 fill-current" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!inputValue.trim() && !pendingScreenshot && attachedFiles.length === 0}
                    onClick={() =>
                      void sendPrompt({
                        prompt:
                          inputValue.trim() ||
                          (pendingScreenshot
                            ? getScreenPrompt()
                            : 'Analyze the attached file(s) and summarize the key points.'),
                        screenshotDataUrl: pendingScreenshot,
                      })
                    }
                    className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-white transition hover:opacity-90 disabled:opacity-35"
                    style={{ background: 'var(--accent)' }}
                    title="Send prompt"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
