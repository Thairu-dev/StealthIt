import React from 'react';
import { Ghost, Keyboard, Lock, ShieldCheck, ShieldOff } from 'lucide-react';
import type { AppSettings, StealthStatus } from '@shared/types';
import { InfoTooltip } from '../components/InfoTooltip';

interface StealthTabProps {
  settings: AppSettings;
  stealthStatus: StealthStatus;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
}

const HOTKEYS = [
  { keys: 'Ctrl + \\', desc: 'Instantly hide or reveal the floating HUD' },
  { keys: 'Ctrl + Shift + E', desc: 'Expand or collapse the HUD response panel' },
  { keys: 'Ctrl + Enter', desc: 'Capture active screen & analyze with AI' },
  { keys: 'Ctrl + Shift + Enter', desc: 'Instant "What should I say?" from live transcript (no focus steal)' },
  { keys: 'Ctrl + Shift + Space', desc: 'Start / stop live dual-channel audio listening' },
  { keys: 'Ctrl + ← ↑ → ↓', desc: 'Move the HUD around the screen (only while HUD is visible)' },
  { keys: 'Ctrl + Shift + T', desc: 'Toggle Ghost Click-Through mode (mouse passes through HUD)' },
  { keys: 'Ctrl + Shift + D', desc: 'Open / hide this invisible Stealth Dashboard' },
  { keys: 'Ctrl + Shift + Backspace', desc: 'Panic clear — wipes active view & hides HUD immediately' },
  { keys: 'Ctrl + Shift + Q', desc: 'Quit StealthIt completely (works from anywhere)' },
  { keys: 'Ctrl + Q', desc: 'Quit StealthIt while the HUD or Dashboard has focus' },
];

export function StealthTab({
  settings,
  stealthStatus,
  onUpdateSettings,
}: StealthTabProps): React.JSX.Element {
  const stealth = settings.stealth;

  const updateStealth = async (patch: Partial<typeof stealth>): Promise<void> => {
    await onUpdateSettings({ stealth: { ...stealth, ...patch } });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--ink)]">Stealth Mode &amp; Keyboard Shortcuts</h2>
        <p className="mt-0.5 text-xs text-[var(--ink-2)]">
          Control Stealth Mode visibility, click-through behavior, and global shortcuts.
        </p>
      </div>

      {/* Verification Status Banner */}
      <div className="grid grid-cols-3 gap-2.5">
        <div
          className={`rounded-2xl border p-3.5 ${
            stealthStatus.contentProtectionActive
              ? 'border-emerald-500/25 bg-emerald-500/[0.08]'
              : 'border-rose-500/30 bg-rose-500/[0.08]'
          }`}
        >
          <div
            className={`flex items-center gap-2 text-xs font-semibold ${
              stealthStatus.contentProtectionActive ? 'text-[var(--green)]' : 'text-rose-400'
            }`}
          >
            {stealthStatus.contentProtectionActive ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <ShieldOff className="h-4 w-4 text-rose-400" />
            )}
            <span>Stealth Mode</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--ink-2)]">
            {stealthStatus.contentProtectionActive
              ? 'On — hidden from Zoom, Teams, Meet, Discord & OBS'
              : 'Off — window is visible in screen captures'}
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--accent-ink)]">
            <Lock className="h-4 w-4" />
            <span>Key Encryption</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--ink-2)]">
            {stealthStatus.encryptionAvailable
              ? 'Device encryption active — your API keys are stored securely on this computer'
              : 'Device encryption unavailable in current session'}
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
            <Ghost className="h-4 w-4" />
            <span>Ghost Click-Through</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--ink-2)]">
            {stealthStatus.clickThrough
              ? 'Enabled — clicks pass through HUD (Ctrl+Shift+T to exit)'
              : 'Interactive — HUD accepts normal mouse clicks'}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--ink)]">HUD Opacity</span>
            <span className="font-mono text-[var(--ink-2)]">{Math.round(stealth.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0.35}
            max={1}
            step={0.05}
            value={stealth.opacity}
            onChange={(e) => void updateStealth({ opacity: Number(e.target.value) })}
            className="w-full accent-sky-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <label className="flex cursor-pointer items-center justify-between rounded-xl bg-[var(--inset)] px-3 py-2.5 ring-1 ring-[var(--line-soft)]">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
                Stealth Mode
                <InfoTooltip
                  align="left"
                  text="Keeps StealthIt invisible in Zoom, Teams, Meet, Discord, and screen recordings while staying fully visible on your own monitor."
                />
              </p>
              <p className="text-[10.5px] text-[var(--ink-3)]">Automatically stays active across windows &amp; displays</p>
            </div>
            <input
              type="checkbox"
              checked={stealth.contentProtection}
              onChange={(e) => void updateStealth({ contentProtection: e.target.checked })}
              className="accent-emerald-400"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-xl bg-[var(--inset)] px-3 py-2.5 ring-1 ring-[var(--line-soft)]">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
                Ghost Click-Through Mode
                <InfoTooltip
                  align="right"
                  text="Lets mouse clicks pass right through the HUD to your IDE or browser underneath while you keep reading. Press Ctrl+Shift+T to toggle back."
                />
              </p>
              <p className="text-[10.5px] text-[var(--ink-3)]">Read HUD while clicking apps underneath</p>
            </div>
            <input
              type="checkbox"
              checked={stealth.clickThrough}
              onChange={(e) => void updateStealth({ clickThrough: e.target.checked })}
              className="accent-amber-400"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-xl bg-[var(--inset)] px-3 py-2.5 ring-1 ring-[var(--line-soft)]">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
                Hide System Tray Icon
                <InfoTooltip
                  align="left"
                  text="Removes the icon next to your Windows clock for zero visual footprint. Use Ctrl+\ to toggle HUD and Ctrl+Shift+Q to quit."
                />
              </p>
              <p className="text-[10.5px] text-[var(--ink-3)]">Zero taskbar & tray presence (use hotkeys)</p>
            </div>
            <input
              type="checkbox"
              checked={stealth.hideTrayIcon}
              onChange={(e) => void updateStealth({ hideTrayIcon: e.target.checked })}
              className="accent-sky-400"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-xl bg-[var(--inset)] px-3 py-2.5 ring-1 ring-[var(--line-soft)]">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)]">
                Auto-Hide on Focus Loss
                <InfoTooltip
                  align="right"
                  text="Automatically hides the floating HUD the instant you click back into another app. Press Ctrl+\ anytime to bring it back."
                />
              </p>
              <p className="text-[10.5px] text-[var(--ink-3)]">Hide HUD automatically when clicking away</p>
            </div>
            <input
              type="checkbox"
              checked={stealth.autoHideOnBlur}
              onChange={(e) => void updateStealth({ autoHideOnBlur: e.target.checked })}
              className="accent-sky-400"
            />
          </label>
        </div>
      </div>

      {/* Hotkey Cheat Sheet */}
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[var(--ink)]">
          <Keyboard className="h-4 w-4 text-[var(--accent)]" />
          <span>Global Hotkeys</span>
        </div>
        <div className="divide-y divide-[var(--line-soft)]">
          {HOTKEYS.map((item) => (
            <div key={item.keys} className="flex items-center justify-between py-2 text-xs">
              <span className="text-[var(--ink-2)]">{item.desc}</span>
              <kbd className="rounded-lg bg-[var(--field)] px-2.5 py-1 font-mono text-[11px] text-[var(--accent-ink)] ring-1 ring-[var(--line)]">
                {item.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
