import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { LogCategory, LogEntry, LogLevel } from '@shared/types';

const MAX_MEMORY_ENTRIES = 400;
const MAX_FILE_BYTES = 512 * 1024; // 512 KB rotation
const BETA_LOGS_ENDPOINT = 'https://stealthit-web.vercel.app/api/beta-logs';

class AppLogger {
  private entries: LogEntry[] = [];
  private logPath: string | null = null;
  private logDir: string | null = null;
  private autoSendEnabled = false;
  private pendingBatch: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  public setAutoSend(enabled: boolean): void {
    this.autoSendEnabled = enabled;
    if (!enabled) {
      this.pendingBatch = [];
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    }
  }

  private queueForAutoSend(entry: LogEntry): void {
    if (!this.autoSendEnabled) return;
    if (entry.level !== 'warn' && entry.level !== 'error') return;
    this.pendingBatch.push(entry);
    if (this.pendingBatch.length > 50) {
      this.pendingBatch.shift();
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const batch = this.pendingBatch.splice(0, this.pendingBatch.length);
        if (batch.length === 0) return;
        void this.postBatch(batch, 'auto');
      }, 8000);
    }
  }

  private async postBatch(
    entries: LogEntry[],
    source: 'auto' | 'manual',
    note?: string
  ): Promise<{ ok: boolean; status?: number; error?: string }> {
    try {
      const res = await fetch(BETA_LOGS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appVersion: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          source,
          ...(note?.trim() ? { note: note.trim().slice(0, 500) } : {}),
          entries: entries.slice(-80),
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }
      return { ok: true, status: res.status };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Network error',
      };
    }
  }

  public async sendDiagnosticReport(note?: string): Promise<{ ok: boolean; message: string }> {
    if (this.entries.length === 0) {
      return { ok: false, message: 'No log entries to send yet.' };
    }
    const result = await this.postBatch(this.entries, 'manual', note);
    if (result.ok) {
      return {
        ok: true,
        message: `Sent ${Math.min(this.entries.length, 80)} sanitized log entries. Thank you for helping test StealthIt Beta!`,
      };
    }
    return {
      ok: false,
      message: `Could not reach ${BETA_LOGS_ENDPOINT} (${result.error ?? 'offline'}). You can use "Report Bug" to open a GitHub issue instead.`,
    };
  }

  private ensurePath(): string | null {
    if (this.logPath) return this.logPath;
    try {
      const dir = join(app.getPath('userData'), 'stealthit-data');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      this.logDir = dir;
      this.logPath = join(dir, 'app.log');
      return this.logPath;
    } catch {
      return null;
    }
  }

  public getLogDir(): string | null {
    this.ensurePath();
    return this.logDir;
  }

  public log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    meta?: Record<string, string | number | boolean | undefined>
  ): void {
    const cleanMeta: Record<string, string | number | boolean> = {};
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        if (v !== undefined) cleanMeta[k] = v;
      }
    }

    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      level,
      category,
      message,
      ...(Object.keys(cleanMeta).length > 0 ? { meta: cleanMeta } : {}),
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_MEMORY_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_MEMORY_ENTRIES);
    }
    this.queueForAutoSend(entry);

    const filePath = this.ensurePath();
    if (!filePath) return;

    try {
      if (existsSync(filePath) && statSync(filePath).size > MAX_FILE_BYTES) {
        const backup = `${filePath}.old`;
        renameSync(filePath, backup);
      }
      const ts = new Date(entry.timestamp).toISOString();
      const metaStr =
        entry.meta && Object.keys(entry.meta).length > 0
          ? ` ${JSON.stringify(entry.meta)}`
          : '';
      appendFileSync(
        filePath,
        `[${ts}] [${level.toUpperCase()}] [${category}] ${message}${metaStr}\n`,
        'utf8'
      );
    } catch {
      // Never throw from logging
    }
  }

  public info(
    category: LogCategory,
    message: string,
    meta?: Record<string, string | number | boolean | undefined>
  ): void {
    this.log('info', category, message, meta);
  }

  public warn(
    category: LogCategory,
    message: string,
    meta?: Record<string, string | number | boolean | undefined>
  ): void {
    this.log('warn', category, message, meta);
  }

  public error(
    category: LogCategory,
    message: string,
    meta?: Record<string, string | number | boolean | undefined>
  ): void {
    this.log('error', category, message, meta);
  }

  public getEntries(): LogEntry[] {
    return [...this.entries].reverse();
  }

  public clear(): void {
    this.entries = [];
    const filePath = this.ensurePath();
    if (filePath) {
      try {
        writeFileSync(filePath, '', 'utf8');
      } catch {
        // ignore
      }
    }
  }
}

export const logger = new AppLogger();
