## 🚀 StealthIt v3.0.0-beta.1

Welcome to the first public **v3 Beta** of **StealthIt** — rebuilt from the ground up with Electron, React, TypeScript, and native Windows stealth APIs.

### ✨ Highlights
- **True Stealth Mode (`WDA_EXCLUDEFROMCAPTURE`):** Floating glass HUD and Dashboard stay hidden from the taskbar and screen sharing (Zoom, Teams, Google Meet, Discord, OBS), plus **Ghost Click-Through Mode** (`Ctrl+Shift+T`).
- **In-Memory Vision & Saved Region Capture:** Press `Ctrl+Enter` for instant screen analysis, or enable **Capture Selected Area Only** in Settings to drag-select a region once and auto-crop every future capture. StealthIt's own windows are always excluded from screenshots.
- **Dual-Channel Live Audio (`THEM` + `ME`):** Captures both computer/meeting audio and your microphone simultaneously with **Deepgram Live**, **Groq Whisper** (free tier), **OpenAI Whisper**, **Google Gemini Audio** (shared key carry-over), or **Local Offline Whisper** — plus adaptive VAD, echo deduplication, and hallucination filtering.
- **Hands-Free Meeting Assist (`Ctrl+Shift+Enter`):** Instantly triggers **"What should I say?"** from the live transcript without moving your mouse or stealing window focus.
- **Multi-Provider AI + Automatic Fallback:** Supports **OpenAI**, **Anthropic Claude**, **Google Gemini**, **OpenRouter / Custom keyless endpoints** (Colab/Tailscale, vLLM, LM Studio), and **Ollama**, with an inline HUD model switcher and **Automatic Fallback Model** failover on errors or first-token timeouts.
- **Redesigned Dashboard & Smart History:** Collapsible sidebar, date-grouped Chat History with multi-word full-text search, toggleable Background Context (`Context On / Off`), Light/Dark themes, stealth-safe `Ctrl+Click` links, and a live **Activity Logs** tab.
- **New Brand Identity:** Custom StealthIt icon across the installer, portable `.exe`, system tray, and Dashboard.

### 📦 Downloads (Windows x64)
- **`StealthIt-3.0.0-beta.1-Setup-x64.exe`** — Standard Windows installer
- **`StealthIt-3.0.0-beta.1-Portable-x64.exe`** — Standalone portable app (no installation required)

> **Windows SmartScreen Note:** Because Beta builds are currently unsigned, Windows may show a SmartScreen warning on first launch. Click **More info → Run anyway** to start StealthIt.

### 💬 Beta Feedback
Found a bug, timeout, or have a suggestion?
- Open **Dashboard (`Ctrl+Shift+D`) → Logs** and click **Report Bug** or **Send Logs** (only sanitized diagnostics are shared — never API keys, prompts, transcripts, or screenshots).
- Or open an issue on **[GitHub Issues](https://github.com/Thairu-dev/StealthIt/issues)**.
