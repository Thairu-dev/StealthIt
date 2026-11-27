import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Cpu,
  History,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Power,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  Sun,
  UserCircle,
  X,
} from 'lucide-react';
import { BUILT_IN_PERSONAS, DEFAULT_SETTINGS } from '@shared/defaults';
import type {
  AppSettings,
  PersonaPreset,
  SecretStatusMap,
  SessionRecord,
  StealthStatus,
} from '@shared/types';
import { getBridge } from '../lib/bridge';
import { AudioTab } from './AudioTab';
import { LogsTab } from './LogsTab';
import { PersonasTab } from './PersonasTab';
import { ProvidersTab } from './ProvidersTab';
import { SessionsTab } from './SessionsTab';
import { StealthTab } from './StealthTab';

type TabId = 'sessions' | 'providers' | 'audio' | 'personas' | 'stealth' | 'logs';

const NAV_ITEMS: Array<{
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'sessions', label: 'Sessions', icon: History },
  { id: 'providers', label: 'API Keys', icon: Cpu },
  { id: 'audio', label: 'Audio & Voice', icon: Mic },
  { id: 'personas', label: 'Personas & Context', icon: UserCircle },
  { id: 'stealth', label: 'Stealth Mode', icon: ShieldCheck },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export function DashboardApp(): React.JSX.Element {
  const bridge = useMemo(() => getBridge(), []);
  const [activeTab, setActiveTab] = useState<TabId>('providers');
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
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [stealthStatus, setStealthStatus] = useState<StealthStatus>({
    contentProtectionActive: true,
    clickThrough: false,
    visible: true,
    opacity: 0.96,
    platform: 'win32',
    encryptionAvailable: true,
  });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isMaximized, setIsMaximized] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('stealthit:sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const saveTimerRef = useRef<number | null>(null);

  const toggleSidebar = (): void => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('stealthit:sidebar-collapsed', next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme !== 'light');
  }, [settings.theme]);

  useEffect(() => {
    const loadAll = async (): Promise<void> => {
      const [s, sec, p, sess, st] = await Promise.all([
        bridge.getSettings(),
        bridge.getSecretStatus(),
        bridge.getPersonas(),
        bridge.getSessions(),
        bridge.getStealthStatus(),
      ]);
      setSettings(s);
      setSecrets(sec);
      setPersonas(p);
      setSessions(sess);
      setStealthStatus(st);
    };
    void loadAll();

    const unsubTab = bridge.onDashboardTab((tab) => {
      if (['sessions', 'providers', 'audio', 'personas', 'stealth', 'logs'].includes(tab)) {
        setActiveTab(tab as TabId);
        void bridge.getSessions().then(setSessions);
      }
    });

    const unsubSettings = bridge.onSettingsChanged((next) => {
      setSettings(next);
    });

    const unsubStealth = bridge.onStealthStatusChanged((st) => {
      setStealthStatus(st);
    });

    const unsubMaximized = bridge.onDashboardMaximized((maximized) => {
      setIsMaximized(maximized);
    });

    return () => {
      unsubTab();
      unsubSettings();
      unsubStealth();
      unsubMaximized();
    };
  }, [bridge]);

  const handleUpdateSettings = async (partial: Partial<AppSettings>): Promise<void> => {
    setSaveState('saving');
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    const updated = await bridge.updateSettings(partial);
    setSettings(updated);
    setSaveState('saved');
    saveTimerRef.current = window.setTimeout(() => {
      setSaveState('idle');
    }, 2000);
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--page)] text-[var(--ink)] select-none">
      {/* Custom Frameless Titlebar */}
      <header
        onDoubleClick={() => {
          void bridge.toggleMaximizeDashboard().then(setIsMaximized);
        }}
        className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-[var(--line)] bg-[var(--canvas)] px-4"
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleSidebar}
            onDoubleClick={(e) => e.stopPropagation()}
            className="no-drag inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
          <img
            src="./icon.png"
            alt="StealthIt"
            className="h-6 w-6 rounded-[6px] object-contain"
          />
          <span className="text-[13px] font-semibold tracking-[-0.015em] text-[var(--ink)]">
            StealthIt
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[10.5px] font-medium"
            style={
              stealthStatus.contentProtectionActive
                ? { background: 'var(--green-tint)', color: 'var(--green)' }
                : { background: 'var(--red-tint)', color: 'var(--red)' }
            }
          >
            {stealthStatus.contentProtectionActive ? (
              <>
                <ShieldCheck className="h-3 w-3" />
                Stealth Mode On
              </>
            ) : (
              <>
                <ShieldOff className="h-3 w-3" />
                Stealth Mode Off
              </>
            )}
          </span>
          {saveState !== 'idle' && (
            <span
              className="inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[10.5px] font-medium transition"
              style={
                saveState === 'saving'
                  ? { background: 'var(--accent-tint)', color: 'var(--accent-ink)' }
                  : { background: 'var(--green-tint)', color: 'var(--green)' }
              }
            >
              {saveState === 'saving' ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="h-3 w-3" />
                  Auto-saved
                </>
              )}
            </span>
          )}
        </div>

        <div className="no-drag flex items-center gap-2">
          {/* Light / Dark Segmented Toggle (syncs live to HUD too!) */}
          <div
            className="inline-flex items-center rounded-[8px] border border-[var(--line)] bg-[var(--field)] p-0.5"
            role="group"
            aria-label="Theme switcher"
          >
            <button
              type="button"
              onClick={() => void handleUpdateSettings({ theme: 'light' })}
              aria-label="Light mode"
              title="Light mode"
              className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] transition ${
                settings.theme === 'light'
                  ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-btn)]'
                  : 'text-[var(--ink-3)] hover:text-[var(--ink)]'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void handleUpdateSettings({ theme: 'dark' })}
              aria-label="Dark mode"
              title="Dark mode"
              className={`inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] transition ${
                settings.theme !== 'light'
                  ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-btn)]'
                  : 'text-[var(--ink-3)] hover:text-[var(--ink)]'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => void bridge.quitApp()}
            className="inline-flex cursor-pointer items-center gap-1 rounded-[7px] px-2.5 py-1 text-[11px] text-[var(--ink-2)] transition hover:bg-[var(--red-tint)] hover:text-[var(--red)]"
            title="Quit StealthIt completely"
          >
            <Power className="h-3.5 w-3.5" />
            <span>Quit</span>
          </button>

          <div className="mx-0.5 h-4 w-px bg-[var(--line)]" />

          <button
            type="button"
            onClick={() => void bridge.minimizeDashboard()}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            title="Minimize to background (Ctrl+Shift+D to reopen)"
            aria-label="Minimize Dashboard"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              void bridge.toggleMaximizeDashboard().then(setIsMaximized);
            }}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            title={isMaximized ? 'Restore window size' : 'Maximize / Fullscreen'}
            aria-label={isMaximized ? 'Restore window size' : 'Maximize Dashboard'}
          >
            {isMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void bridge.closeDashboard()}
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-[var(--ink-3)] transition hover:bg-[var(--hover)] hover:text-[var(--ink)]"
            title="Hide Dashboard (stays running in stealth)"
            aria-label="Hide Dashboard"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Split Layout */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside
          className={`flex shrink-0 flex-col justify-between overflow-hidden border-r border-[var(--line)] bg-[var(--canvas)] transition-[width] duration-200 ease-out ${
            sidebarCollapsed ? 'w-[56px] p-2' : 'w-52 p-3'
          }`}
        >
          <nav className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const isStealthNav = item.id === 'stealth';
              const Icon = isStealthNav
                ? stealthStatus.contentProtectionActive
                  ? ShieldCheck
                  : ShieldOff
                : item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => {
                    setActiveTab(item.id);
                    if (item.id === 'sessions') {
                      void bridge.getSessions().then(setSessions);
                    }
                  }}
                  className={`flex w-full cursor-pointer items-center rounded-[8px] py-2 text-xs font-medium transition ${
                    sidebarCollapsed ? 'justify-center px-0' : 'gap-2.5 px-3'
                  } ${
                    active
                      ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-btn)]'
                      : 'text-[var(--ink-2)] hover:bg-[var(--hover)] hover:text-[var(--ink)]'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isStealthNav
                        ? stealthStatus.contentProtectionActive
                          ? 'text-[var(--green)]'
                          : 'text-[var(--red)]'
                        : active
                          ? 'text-[var(--accent)]'
                          : 'text-[var(--ink-3)]'
                    }`}
                  />
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </nav>

          {!sidebarCollapsed && (
            <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 text-[11px] text-[var(--ink-2)]">
              <p className="font-semibold text-[var(--ink)]">Private by Default</p>
              <p className="mt-0.5 leading-relaxed">
                100% local storage. Your API keys stay encrypted on this device.
              </p>
            </div>
          )}
        </aside>

        {/* Active Tab Content */}
        <main
          className={`stealth-scroll min-w-0 flex-1 bg-[var(--page)] ${
            activeTab === 'sessions' ? 'overflow-hidden p-0' : 'overflow-y-auto p-6'
          }`}
        >
          {activeTab === 'sessions' && (
            <SessionsTab
              sessions={sessions}
              onDelete={(id) => void bridge.deleteSession(id).then(setSessions)}
              onClearAll={() => void bridge.clearAllSessions().then(() => setSessions([]))}
            />
          )}
          {activeTab === 'providers' && (
            <ProvidersTab
              settings={settings}
              secrets={secrets}
              onUpdateSettings={handleUpdateSettings}
              onSecretsChanged={setSecrets}
            />
          )}
          {activeTab === 'audio' && (
            <AudioTab
              settings={settings}
              secrets={secrets}
              onUpdateSettings={handleUpdateSettings}
              onSecretsChanged={setSecrets}
            />
          )}
          {activeTab === 'personas' && (
            <PersonasTab
              settings={settings}
              personas={personas}
              onUpdateSettings={handleUpdateSettings}
              onPersonasChanged={setPersonas}
            />
          )}
          {activeTab === 'stealth' && (
            <StealthTab
              settings={settings}
              stealthStatus={stealthStatus}
              onUpdateSettings={handleUpdateSettings}
            />
          )}
          {activeTab === 'logs' && (
            <LogsTab settings={settings} onUpdateSettings={handleUpdateSettings} />
          )}
        </main>
      </div>
    </div>
  );
}
