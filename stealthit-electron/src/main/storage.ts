import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BUILT_IN_PERSONAS, DEFAULT_SETTINGS } from '@shared/defaults';
import type {
  AppSettings,
  PersonaPreset,
  SecretKeyName,
  SecretStatusMap,
  SessionRecord,
} from '@shared/types';

interface StoredSecrets {
  encrypted: boolean;
  values: Partial<Record<SecretKeyName, string>>;
}

interface PersistedData {
  settings: AppSettings;
  personas: PersonaPreset[];
  sessions: SessionRecord[];
}

const SECRET_KEYS: SecretKeyName[] = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'deepgram',
  'groq',
];

function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

function mergeSettings(raw: Partial<AppSettings> | undefined): AppSettings {
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    providers: {
      openai: { ...DEFAULT_SETTINGS.providers.openai, ...raw.providers?.openai },
      anthropic: { ...DEFAULT_SETTINGS.providers.anthropic, ...raw.providers?.anthropic },
      gemini: { ...DEFAULT_SETTINGS.providers.gemini, ...raw.providers?.gemini },
      openrouter: { ...DEFAULT_SETTINGS.providers.openrouter, ...raw.providers?.openrouter },
      ollama: { ...DEFAULT_SETTINGS.providers.ollama, ...raw.providers?.ollama },
    },
    fallback: {
      ...DEFAULT_SETTINGS.fallback,
      ...raw.fallback,
    },
    stt: {
      ...DEFAULT_SETTINGS.stt,
      ...raw.stt,
    },
    stealth: {
      ...DEFAULT_SETTINGS.stealth,
      ...raw.stealth,
    },
  };
}

export class LocalStore {
  private readonly baseDir: string;
  private readonly dataPath: string;
  private readonly secretsPath: string;
  private data: PersistedData;
  private secretsCache: Partial<Record<SecretKeyName, string>> = {};

  constructor(customBaseDir?: string) {
    this.baseDir = customBaseDir ?? join(app.getPath('userData'), 'stealthit-data');
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
    this.dataPath = join(this.baseDir, 'state.json');
    this.secretsPath = join(this.baseDir, 'secrets.enc.json');
    this.data = this.loadData();
    this.secretsCache = this.loadSecrets();
  }

  public isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private loadData(): PersistedData {
    if (!existsSync(this.dataPath)) {
      return {
        settings: structuredClone(DEFAULT_SETTINGS),
        personas: structuredClone(BUILT_IN_PERSONAS),
        sessions: [],
      };
    }

    try {
      const parsed = JSON.parse(readFileSync(this.dataPath, 'utf8')) as Partial<PersistedData>;
      const customPersonas = (parsed.personas ?? []).filter((p) => !p.builtIn);
      const mergedBuiltIns = BUILT_IN_PERSONAS.map((bi) => {
        const override = (parsed.personas ?? []).find((p) => p.id === bi.id);
        return override ? { ...bi, ...override, builtIn: true } : structuredClone(bi);
      });

      return {
        settings: mergeSettings(parsed.settings),
        personas: [...mergedBuiltIns, ...customPersonas],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    } catch {
      return {
        settings: structuredClone(DEFAULT_SETTINGS),
        personas: structuredClone(BUILT_IN_PERSONAS),
        sessions: [],
      };
    }
  }

  private saveData(): void {
    atomicWriteJson(this.dataPath, this.data);
  }

  private loadSecrets(): Partial<Record<SecretKeyName, string>> {
    if (!existsSync(this.secretsPath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.secretsPath, 'utf8')) as StoredSecrets;
      const result: Partial<Record<SecretKeyName, string>> = {};
      const canDecrypt = this.isEncryptionAvailable();

      for (const key of SECRET_KEYS) {
        const rawVal = parsed.values?.[key];
        if (!rawVal) continue;
        if (parsed.encrypted && canDecrypt) {
          try {
            result[key] = safeStorage.decryptString(Buffer.from(rawVal, 'base64'));
          } catch {
            // Skip undecryptable key
          }
        } else if (!parsed.encrypted) {
          result[key] = rawVal;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private persistSecrets(): void {
    const canEncrypt = this.isEncryptionAvailable();
    const values: Partial<Record<SecretKeyName, string>> = {};

    for (const key of SECRET_KEYS) {
      const plain = this.secretsCache[key];
      if (!plain) continue;
      if (canEncrypt) {
        values[key] = safeStorage.encryptString(plain).toString('base64');
      } else {
        values[key] = plain;
      }
    }

    const payload: StoredSecrets = {
      encrypted: canEncrypt,
      values,
    };
    atomicWriteJson(this.secretsPath, payload);
  }

  public getSettings(): AppSettings {
    return structuredClone(this.data.settings);
  }

  public updateSettings(partial: Partial<AppSettings>): AppSettings {
    this.data.settings = mergeSettings({
      ...this.data.settings,
      ...partial,
      providers: partial.providers
        ? { ...this.data.settings.providers, ...partial.providers }
        : this.data.settings.providers,
      stt: partial.stt
        ? { ...this.data.settings.stt, ...partial.stt }
        : this.data.settings.stt,
      stealth: partial.stealth
        ? { ...this.data.settings.stealth, ...partial.stealth }
        : this.data.settings.stealth,
    });
    this.saveData();
    return this.getSettings();
  }

  public getSecret(key: SecretKeyName): string | null {
    return this.secretsCache[key] ?? null;
  }

  public setSecret(key: SecretKeyName, value: string): SecretStatusMap {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      delete this.secretsCache[key];
    } else {
      this.secretsCache[key] = trimmed;
    }
    this.persistSecrets();
    return this.getSecretStatus();
  }

  public clearSecret(key: SecretKeyName): SecretStatusMap {
    delete this.secretsCache[key];
    this.persistSecrets();
    return this.getSecretStatus();
  }

  public getSecretStatus(): SecretStatusMap {
    return {
      openai: Boolean(this.secretsCache.openai),
      anthropic: Boolean(this.secretsCache.anthropic),
      gemini: Boolean(this.secretsCache.gemini),
      openrouter: Boolean(this.secretsCache.openrouter),
      deepgram: Boolean(this.secretsCache.deepgram),
      groq: Boolean(this.secretsCache.groq),
    };
  }

  public getPersonas(): PersonaPreset[] {
    return structuredClone(this.data.personas);
  }

  public getActivePersona(): PersonaPreset {
    const found = this.data.personas.find((p) => p.id === this.data.settings.activePersonaId);
    return structuredClone(found ?? this.data.personas[0] ?? BUILT_IN_PERSONAS[0]);
  }

  public savePersona(persona: PersonaPreset): PersonaPreset[] {
    const idx = this.data.personas.findIndex((p) => p.id === persona.id);
    if (idx >= 0) {
      this.data.personas[idx] = { ...persona };
    } else {
      this.data.personas.push({ ...persona, builtIn: false });
    }
    this.saveData();
    return this.getPersonas();
  }

  public deletePersona(id: string): PersonaPreset[] {
    this.data.personas = this.data.personas.filter((p) => p.builtIn || p.id !== id);
    if (this.data.settings.activePersonaId === id) {
      this.data.settings.activePersonaId = BUILT_IN_PERSONAS[0].id;
    }
    this.saveData();
    return this.getPersonas();
  }

  public getSessions(): SessionRecord[] {
    return structuredClone(
      [...this.data.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
    );
  }

  public saveSession(session: SessionRecord): void {
    const idx = this.data.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.data.sessions[idx] = structuredClone(session);
    } else {
      this.data.sessions.unshift(structuredClone(session));
    }
    // Cap at 100 most recent sessions
    if (this.data.sessions.length > 100) {
      this.data.sessions = this.data.sessions
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 100);
    }
    this.saveData();
  }

  public deleteSession(id: string): SessionRecord[] {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    this.saveData();
    return this.getSessions();
  }

  public clearAllSessions(): void {
    this.data.sessions = [];
    this.saveData();
  }
}
