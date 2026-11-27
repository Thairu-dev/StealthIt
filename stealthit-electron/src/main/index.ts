import { app, desktopCapturer, ipcMain, session, shell } from 'electron';
import { randomUUID } from 'crypto';
import { assemblePromptContext } from '@shared/context';
import type {
  AIProviderId,
  AppSettings,
  AskAIRequest,
  PersonaPreset,
  SecretKeyName,
  SessionRecord,
  TranscribeChunkRequest,
} from '@shared/types';
import { captureActiveScreen, grabFrozenFrame, pickCaptureRegion } from './capture';
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './hotkeys';
import {
  fetchOllamaModels,
  fetchProviderModels,
  streamAIResponse,
  testProviderConnection,
} from './providers';
import { LocalStore } from './storage';
import { logger } from './logger';
import { transcribeAudioChunk } from './stt';
import { WindowManager } from './windows';

// Enforce single instance so StealthIt never spawns duplicate overlays
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let store: LocalStore;
let windows: WindowManager;
const activeStreams = new Map<string, AbortController>();

function setupSystemAudioLoopbackHandler(): void {
  // Grants Chromium getDisplayMedia() native Windows WASAPI system audio loopback
  // without triggering an OS screen-sharing picker popup.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      if (sources.length > 0) {
        callback({ video: sources[0], audio: 'loopback' });
      } else {
        callback({});
      }
    } catch {
      callback({});
    }
  });
}

function registerIpcHandlers(): void {
  // Window & Stealth
  ipcMain.handle('stealth:get-status', () => windows.getStealthStatus());
  ipcMain.handle('window:set-hud-height', (_e, height: number) => {
    windows.setHudHeight(height);
  });
  ipcMain.handle('window:set-hud-size', (_e, width: number, height: number) => {
    windows.setHudSize(width, height);
  });
  ipcMain.handle('window:set-ignore-mouse', (_e, ignore: boolean) => {
    windows.setIgnoreMouseEvents(ignore);
  });
  ipcMain.handle('window:toggle-click-through', () => windows.toggleClickThrough());
  ipcMain.handle('window:toggle-visibility', () => windows.toggleVisibility());
  ipcMain.handle('window:open-dashboard', (_e, tab?: string) => {
    windows.openDashboard(tab);
  });
  ipcMain.handle('window:close-dashboard', () => {
    windows.closeDashboard();
  });
  ipcMain.handle('window:minimize-dashboard', () => {
    windows.minimizeDashboard();
  });
  ipcMain.handle('window:toggle-maximize-dashboard', () => windows.toggleMaximizeDashboard());
  ipcMain.handle('window:move-hud', (_e, dx: number, dy: number) => {
    windows.moveHud(dx, dy);
  });
  ipcMain.handle('shell:open-external', async (_e, rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
        await shell.openExternal(parsed.toString());
      }
    } catch {
      // ignore invalid URLs
    }
  });
  ipcMain.handle('app:quit', () => {
    windows.quit();
  });

  // Screen Capture (always excludes StealthIt's own windows even if Stealth Mode is off)
  ipcMain.handle('capture:screen', async () => {
    const settings = store.getSettings();
    const savedRegion = settings.captureRegion ? settings.captureRegionBounds : null;
    const t0 = Date.now();
    const res = await windows.withSelfExcludedFromCapture(() => captureActiveScreen(savedRegion));
    logger.info('capture', 'Captured screen', {
      width: res.width,
      height: res.height,
      region: Boolean(savedRegion),
      ms: Date.now() - t0,
    });
    return res;
  });

  ipcMain.handle('capture:select-region', async () =>
    pickCaptureRegion(() => windows.withSelfExcludedFromCapture(() => grabFrozenFrame()))
  );

  // Settings & Encrypted Secrets
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:update', (_e, partial: Partial<AppSettings>) => {
    const updated = store.updateSettings(partial);
    if (partial.stealth) {
      windows.syncStealthSettings(updated.stealth);
    }
    if (partial.shareBetaLogs !== undefined) {
      logger.setAutoSend(Boolean(updated.shareBetaLogs));
    }
    windows.broadcastSettings();
    return updated;
  });

  ipcMain.handle('secrets:status', () => store.getSecretStatus());
  ipcMain.handle('secrets:set', (_e, key: SecretKeyName, value: string) => {
    const status = store.setSecret(key, value);
    // Auto-carry-over OpenAI or Gemini keys to Audio STT when Deepgram isn't configured yet
    if ((key === 'openai' || key === 'gemini') && status[key]) {
      const current = store.getSettings();
      if (current.stt.provider === 'deepgram' && !status.deepgram) {
        store.updateSettings({
          stt: {
            ...current.stt,
            provider: key === 'openai' ? 'openai-whisper' : 'gemini-audio',
            model: key === 'openai' ? 'whisper-1' : 'gemini-2.5-flash',
          },
        });
      }
    }
    windows.broadcastSettings();
    return status;
  });
  ipcMain.handle('secrets:clear', (_e, key: SecretKeyName) => {
    const status = store.clearSecret(key);
    if (key === 'openai' || key === 'anthropic' || key === 'gemini' || key === 'openrouter') {
      const current = store.getSettings();
      store.updateSettings({
        providers: {
          ...current.providers,
          [key]: { ...current.providers[key], cachedModels: [] },
        },
      });
      windows.broadcastSettings();
    }
    return status;
  });
  ipcMain.handle('secrets:deepgram-token', () => store.getSecret('deepgram'));

  // Personas & Sessions
  ipcMain.handle('personas:get', () => store.getPersonas());
  ipcMain.handle('personas:save', (_e, persona: PersonaPreset) => store.savePersona(persona));
  ipcMain.handle('personas:delete', (_e, id: string) => store.deletePersona(id));
  ipcMain.handle('sessions:get', () => store.getSessions());
  ipcMain.handle('sessions:save', (_e, sessionRecord: SessionRecord) => {
    store.saveSession(sessionRecord);
  });
  ipcMain.handle('sessions:delete', (_e, id: string) => store.deleteSession(id));
  ipcMain.handle('sessions:clear-all', () => {
    store.clearAllSessions();
  });

  // AI Streaming (with structured logging + optional automatic fallback on error/timeout)
  ipcMain.handle('ai:ask', (event, req: AskAIRequest) => {
    const requestId = randomUUID();
    const controller = new AbortController();
    activeStreams.set(requestId, controller);

    const settings = store.getSettings();
    const persona = store.getActivePersona();
    const assembled = assemblePromptContext({
      persona,
      settings,
      prompt: req.prompt,
      transcript: req.transcript,
      history: req.history,
      screenshotDataUrl: req.screenshotDataUrl,
    });

    const sender = event.sender;
    const primaryProvider = settings.activeProvider;
    const primaryModel = settings.providers[primaryProvider].model;
    const fb = settings.fallback;
    const canFallback =
      Boolean(fb?.enabled) &&
      Boolean(fb.model?.trim()) &&
      (fb.provider !== primaryProvider || fb.model.trim() !== primaryModel);

    const startedAt = Date.now();
    logger.info('ai', 'AI request started', {
      provider: primaryProvider,
      model: primaryModel,
      hasScreenshot: Boolean(req.screenshotDataUrl),
      history: req.history.length,
      transcriptLines: req.transcript.length,
      fallbackEnabled: canFallback,
    });

    const runAttempt = async (
      providerId: AIProviderId,
      modelName: string,
      timeoutMs: number | null
    ): Promise<string> => {
      const attemptController = new AbortController();
      const onOuterAbort = (): void => attemptController.abort();
      controller.signal.addEventListener('abort', onOuterAbort, { once: true });

      let firstTokenAt: number | null = null;
      let timedOut = false;
      const attemptStart = Date.now();
      let watchdog: ReturnType<typeof setTimeout> | null = null;

      if (timeoutMs && timeoutMs > 0) {
        watchdog = setTimeout(() => {
          if (firstTokenAt === null && !controller.signal.aborted) {
            timedOut = true;
            attemptController.abort();
          }
        }, timeoutMs);
      }

      try {
        const fullText = await streamAIResponse({
          settings,
          store,
          assembled,
          signal: attemptController.signal,
          providerOverride: providerId,
          modelOverride: modelName,
          onChunk: (delta) => {
            if (firstTokenAt === null) {
              firstTokenAt = Date.now();
              if (watchdog) {
                clearTimeout(watchdog);
                watchdog = null;
              }
            }
            if (!sender.isDestroyed()) {
              sender.send('ai:chunk', { requestId, delta });
            }
          },
        });
        logger.info('ai', 'AI request completed', {
          provider: providerId,
          model: modelName,
          ttftMs: firstTokenAt ? firstTokenAt - attemptStart : Date.now() - attemptStart,
          totalMs: Date.now() - attemptStart,
          chars: fullText.length,
        });
        return fullText;
      } catch (err) {
        if (timedOut) {
          throw new Error(
            `${providerId.toUpperCase()} (${modelName}) timed out waiting ${Math.round((timeoutMs ?? 0) / 1000)}s for first token.`
          );
        }
        throw err;
      } finally {
        if (watchdog) clearTimeout(watchdog);
        controller.signal.removeEventListener('abort', onOuterAbort);
      }
    };

    void (async () => {
      try {
        const timeoutMs = canFallback
          ? Math.max(5, Math.min(180, fb.timeoutSec || 20)) * 1000
          : null;
        let fullText: string;
        try {
          fullText = await runAttempt(primaryProvider, primaryModel, timeoutMs);
        } catch (primaryErr) {
          if (controller.signal.aborted) {
            throw primaryErr;
          }
          const primaryMsg =
            primaryErr instanceof Error ? primaryErr.message : 'Primary provider failed.';
          if (!canFallback) {
            throw primaryErr;
          }
          logger.warn('ai', `Primary failed — switching to fallback`, {
            primary: `${primaryProvider}/${primaryModel}`,
            fallback: `${fb.provider}/${fb.model.trim()}`,
            elapsedMs: Date.now() - startedAt,
            reason: primaryMsg.slice(0, 180),
          });
          fullText = await runAttempt(fb.provider, fb.model.trim(), null);
        }

        activeStreams.delete(requestId);
        if (!sender.isDestroyed()) {
          sender.send('ai:done', { requestId, fullText });
        }
      } catch (err: unknown) {
        activeStreams.delete(requestId);
        if (controller.signal.aborted) {
          logger.info('ai', 'AI request aborted by user', {
            provider: primaryProvider,
            elapsedMs: Date.now() - startedAt,
          });
          if (!sender.isDestroyed()) {
            sender.send('ai:done', { requestId, fullText: '' });
          }
          return;
        }
        const message = err instanceof Error ? err.message : 'AI request failed.';
        logger.error('ai', 'AI request failed', {
          provider: primaryProvider,
          model: primaryModel,
          elapsedMs: Date.now() - startedAt,
          error: message.slice(0, 220),
        });
        if (!sender.isDestroyed()) {
          sender.send('ai:error', { requestId, error: message });
        }
      }
    })();

    return { requestId };
  });

  ipcMain.handle('ai:abort', (_e, requestId: string) => {
    const controller = activeStreams.get(requestId);
    if (controller) {
      controller.abort();
      activeStreams.delete(requestId);
    }
  });

  ipcMain.handle('ai:test-provider', async (_e, provider: AIProviderId) =>
    testProviderConnection(store, provider)
  );
  ipcMain.handle('ai:fetch-models', async (_e, provider: AIProviderId) => {
    const result = await fetchProviderModels(store, provider);
    if (result.ok && result.models.length > 0) {
      const current = store.getSettings();
      store.updateSettings({
        providers: {
          ...current.providers,
          [provider]: {
            ...current.providers[provider],
            cachedModels: result.models,
          },
        },
      });
      windows.broadcastSettings();
    }
    return result;
  });
  ipcMain.handle('ai:ollama-models', async (_e, baseUrl: string) => fetchOllamaModels(baseUrl));

  // STT Chunk Transcription
  ipcMain.handle('stt:transcribe', async (_e, req: TranscribeChunkRequest) => {
    const t0 = Date.now();
    const result = await transcribeAudioChunk(store, req);
    const ms = Date.now() - t0;
    if (result.error) {
      logger.error('stt', 'STT transcription error', {
        provider: store.getSettings().stt.provider,
        speaker: req.speaker,
        ms,
        error: result.error.slice(0, 180),
      });
    } else if (ms > 3000) {
      logger.warn('stt', 'Slow STT transcription', {
        provider: store.getSettings().stt.provider,
        speaker: req.speaker,
        ms,
        chars: result.text.length,
      });
    }
    return result;
  });

  // Logs
  logger.setAutoSend(Boolean(store.getSettings().shareBetaLogs));
  ipcMain.handle('logs:get', () => logger.getEntries());
  ipcMain.handle('logs:clear', () => {
    logger.clear();
  });
  ipcMain.handle('logs:open-folder', async () => {
    const dir = logger.getLogDir();
    if (dir) {
      await shell.openPath(dir);
    }
  });
  ipcMain.handle('logs:send-report', async (_e, note?: string) =>
    logger.sendDiagnosticReport(note)
  );
}

app.on('second-instance', () => {
  windows?.showHud(true);
});

void app.whenReady().then(() => {
  store = new LocalStore();
  windows = new WindowManager(store);

  setupSystemAudioLoopbackHandler();
  registerIpcHandlers();
  windows.createWindows();
  registerGlobalHotkeys(windows);
});

app.on('will-quit', () => {
  unregisterGlobalHotkeys();
  for (const ctrl of activeStreams.values()) {
    ctrl.abort();
  }
  activeStreams.clear();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
