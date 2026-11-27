# StealthIt Electron — Invisible AI Meeting & Desktop Copilot

A clean-room, market-ready **Electron + React 19 + strict TypeScript + Tailwind CSS v4** architecture for StealthIt, designed around a Cluely-style translucent floating HUD and a separate stealth Dashboard.

## Key Capabilities

- **True OS Stealth Invariants**: Both the floating HUD and the Dashboard enforce `setContentProtection(true)` (`WDA_EXCLUDEFROMCAPTURE` on Windows / `NSWindowSharingNone` on macOS) and `skipTaskbar(true)`, re-asserted across show/focus/move/display events, plus a **Ghost Click-Through** toggle (`Ctrl+Shift+T`).
- **Cluely-Style Smoked Glass HUD**: Compact 50px top-center floating pill that expands smoothly on demand, dynamically hugging content height with quick-action chips (`What should I say?`, `Analyze screen`, `Follow-up questions`, `Recap meeting`).
- **Dual-Channel Live Audio & Streaming STT**: Captures Windows WASAPI system audio loopback (`THEM`) + Microphone (`YOU`) natively via Electron's `setDisplayMediaRequestHandler` with **zero C++ native addons**. Supports:
  - **Deepgram Nova-3 Live WebSocket** (~300ms streaming interim + final captions)
  - **Groq Whisper Turbo** & **OpenAI Whisper API** (VAD-chunked 16kHz WAV)
  - **Local Whisper Server** (`faster-whisper-server` / `whisper.cpp` HTTP) for 100% offline transcription
- **Multi-Provider Streaming AI**: OpenAI, Anthropic Claude, Google Gemini, OpenRouter / Custom OpenAI-compatible endpoints, and local **Ollama** (with model auto-detection) — all streamed in the main process so API keys never touch the renderer.
- **OS-Encrypted Secrets**: API keys are encrypted via Electron `safeStorage` (**Windows DPAPI** / macOS Keychain) and never written in plaintext.

## Global Hotkeys

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + \` | Hide / Show floating HUD |
| `Ctrl + Shift + E` | Expand / Collapse HUD panel |
| `Ctrl + Enter` | Capture active display (in-memory) & analyze |
| `Ctrl + Shift + Space` | Start / Stop live dual-channel listening |
| `Ctrl + ← ↑ → ↓` | Move HUD (registered only while the HUD is visible) |
| `Ctrl + Shift + T` | Toggle Ghost Click-Through mode |
| `Ctrl + Shift + D` | Open / Hide Stealth Dashboard |
| `Ctrl + Shift + Backspace` | Panic clear & hide HUD |
| `Ctrl + Shift + Q` | Quit StealthIt completely (global) |
| `Ctrl + Q` | Quit while the HUD or Dashboard is focused |

> **Why the move keys come and go:** `Ctrl + Arrows` is the system-wide "jump by word" shortcut in text fields and editors. StealthIt only grabs it while the HUD is on screen, and lets go the moment you hide it with `Ctrl + \`.
>
> **Why not `Ctrl + W` to quit:** a global `Ctrl + W` would stop you closing browser tabs and editor files everywhere, so quitting uses `Ctrl + Shift + Q` instead.

## Development & Packaging

```powershell
cd stealthit-electron
npm install

# Run in development with HMR
npm run dev

# Typecheck, run unit tests, and build production bundle
npm run typecheck
npm test
npm run build

# Build Windows NSIS installer + portable .exe
npm run dist:win
```
