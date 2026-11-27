# StealthIt (Beta) — Invisible AI Meeting & Desktop Assistant (Free Cluely Alternative)

[![GitHub stars](https://img.shields.io/github/stars/Thairu-dev/StealthIt?style=social)](https://github.com/Thairu-dev/StealthIt/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Beta](https://img.shields.io/badge/Status-v3%20Beta-00f0ff)](https://github.com/Thairu-dev/StealthIt/releases)
[![Node.js 20+](https://img.shields.io/badge/node-20+-339933)](https://nodejs.org/)
[![Website](https://img.shields.io/badge/Website-stealthit--web.vercel.app-00f0ff)](https://stealthit-web.vercel.app)

**StealthIt** is a free, open-source **Cluely alternative** and invisible AI desktop assistant currently in **public Beta (v3)**. Built with Electron, React, TypeScript, and native Windows stealth APIs, it floats cleanly over your workspace for **live meeting notes**, **technical interviews & coding**, **instant screen analysis**, and **dual-channel voice transcription** — while staying **completely hidden from the taskbar and invisible to screen sharing & recording** (Zoom, Microsoft Teams, Google Meet, Discord, OBS).

---

## 💼 Core Use Cases

| Use Case | Description | Primary Hotkeys |
| :--- | :--- | :--- |
| **🎙️ Live Meeting Assistant & AI Summarizer** | Dual-channel audio captures both computer/meeting audio (`THEM`) and your microphone (`ME`). Trigger instant spoken responses without clicking or stealing window focus. | `Ctrl+Shift+Space` / `Ctrl+Shift+Enter` |
| **💻 Technical Interviews & Live Coding** | Floats invisibly over LeetCode, HackerRank, or IDEs. Captures full screen or a saved screen region in memory for instant algorithm breakdowns, complexity, and code. | `Ctrl+Enter` |
| **📈 Sales & Client Objection Handling** | Real-time transcription paired with your saved product/pricing context feeds instant rebuttals and follow-up questions. | `Ctrl+Shift+Enter` |
| **📊 Document & Screen Analysis** | Instant vision OCR on dense spreadsheets, slides, architecture diagrams, and terminal logs with zero files written to disk. | `Ctrl+Enter` |

---

## ✨ Key Features (v3 Beta)

- **👻 True Stealth Mode:** Hidden from the Windows taskbar and excluded from screen capture (`WDA_EXCLUDEFROMCAPTURE`) across Zoom, Teams, Meet, Discord, and OBS — plus **Ghost Click-Through Mode** (`Ctrl+Shift+T`) so clicks pass straight through the HUD.
- **📸 In-Memory Vision & Saved Region Capture:** Press `Ctrl+Enter` for instant full-screen capture, or enable **Capture Selected Area Only** in Settings to drag-select a region once and auto-crop every future capture. StealthIt's own windows are always excluded from screenshots.
- **🎙️ Dual-Channel Live Audio (`THEM` + `ME`):** Supports **Deepgram Live**, **Groq Whisper** (free tier), **OpenAI Whisper** (reuses OpenAI key), **Google Gemini Audio** (reuses Gemini key), and **Local Offline Whisper** — with adaptive VAD, speaker-bleed echo deduplication, and hallucination filtering.
- **🧠 Multi-Provider AI + Automatic Fallback:** Native support for **OpenAI**, **Anthropic Claude**, **Google Gemini**, **OpenRouter / Custom keyless endpoints** (vLLM, Colab/Tailscale, LM Studio), and **Ollama** — with an inline HUD model switcher and **Automatic Fallback Model** failover on errors or first-token timeouts.
- **🔒 100% Local & Device-Encrypted:** API keys are encrypted locally via OS key storage (`safeStorage` / Windows DPAPI). Sessions, transcripts, and rotating diagnostic logs never leave your device unless you explicitly opt in.
- **🗂️ Full Dashboard:** Collapsible sidebar, date-grouped Chat History with smart multi-word full-text search, customizable Personas & toggleable Background Context (`Context On / Off`), Light/Dark themes, and live **Activity Logs**.

---

## 🛠️ Download or Run from Source (Beta)

### Option 1 — Download Windows `.exe` (Easiest)
Download the latest Beta installer or portable `.exe` from **[GitHub Releases](https://github.com/Thairu-dev/StealthIt/releases)**.

*(Note: Since beta builds are unsigned, Windows SmartScreen may show a prompt — click **More info → Run anyway**.)*

### Option 2 — Run from Source
Ensure you have **Node.js 20+** installed:

```bash
git clone https://github.com/Thairu-dev/StealthIt.git
cd StealthIt/stealthit-electron
npm install
npm run dev
```

### Build a Standalone Windows `.exe` Installer
```bash
cd stealthit-electron
npm run dist:win
```
After the build completes, the packaged executables are saved in **`stealthit-electron/dist/`**:
- **`stealthit-electron/dist/StealthIt-<version>-Setup-x64.exe`** — Windows NSIS installer
- **`stealthit-electron/dist/StealthIt-<version>-Portable-x64.exe`** — Standalone portable `.exe` (no installation needed)
- **`stealthit-electron/dist/win-unpacked/StealthIt.exe`** — Unpacked app folder for quick local testing

### Run Tests & Typecheck
```bash
cd stealthit-electron
npm run typecheck
npm test
```

### Optional: Local Offline Whisper Server
*(Skip this if you use **Groq Whisper (Free Tier)**, **OpenAI Whisper**, **Google Gemini Audio**, or **Deepgram** — those work in the standalone `.exe` with zero extra setup.)*

If you want 100% offline transcription with **Local Offline Server** in **Dashboard → Audio & Voice**, start a local Whisper HTTP server on port `8000` using **either** method below:

#### Method A — Standalone `.exe` Users (1 command with Docker)
```bash
# CPU (works on any PC)
docker run --rm -p 8000:8000 fedirz/faster-whisper-server:latest-cpu

# Or NVIDIA GPU (much faster)
docker run --rm --gpus all -p 8000:8000 fedirz/faster-whisper-server:latest-cuda
```
Then in **Dashboard → Audio & Voice**, select **Local Offline Server** and leave the default URL:
`http://localhost:8000/v1/audio/transcriptions`

#### Method B — Running from Source (Python 3.10+, no Docker)
```bash
pip install faster-whisper fastapi uvicorn python-multipart
cd stealthit-electron
npm run whisper:local
```
Leave the URL as `http://localhost:8000/v1/audio/transcriptions` and press **`Ctrl + Shift + Space`** to start listening.

---

## 🔑 Supported Providers

| Provider | Notes |
| :--- | :--- |
| **OpenAI** | Chat, Vision, and Whisper STT (1 key covers both) |
| **Google Gemini** | Chat, Vision, and Gemini Audio STT (1 key covers both) |
| **Anthropic Claude** | Chat & Vision |
| **OpenRouter / Custom** | Supports OpenRouter or any custom/self-hosted OpenAI-compatible URL (API key optional for custom URLs) |
| **Ollama** | Local or Tailscale/Colab remote models, no API key needed |
| **Groq / Deepgram** | Optional fast/free-tier Whisper (`Groq`) or real-time WebSocket captions (`Deepgram`) |

---

## ⌨️ Global Hotkeys

| Hotkey | Action |
| :--- | :--- |
| **`Ctrl + \`** | Instantly hide or reveal the floating HUD |
| **`Ctrl + Enter`** | Capture active screen (or saved region) & analyze with AI |
| **`Ctrl + Shift + Enter`** | Instant **"What should I say?"** from live transcript (no focus steal) |
| **`Ctrl + Shift + Space`** | Start / stop live dual-channel audio listening |
| **`Ctrl + Shift + E`** | Expand or collapse the HUD response panel |
| **`Ctrl + Shift + T`** | Toggle Ghost Click-Through mode |
| **`Ctrl + Shift + D`** | Open / hide the Dashboard |
| **`Ctrl + ← ↑ → ↓`** | Move the HUD (active only while HUD is visible) |
| **`Ctrl + Shift + Backspace`** | Panic clear — wipes current view & hides HUD immediately |
| **`Ctrl + Shift + Q`** | Quit StealthIt completely |

---

## 💬 We Need Your Beta Feedback!

StealthIt v3 is in **public Beta**, and your feedback directly shapes the stable release. If you hit a bug, provider timeout, audio quirk, or have a feature request:

- **In-App 1-Click Reporting:** Open **Dashboard (`Ctrl + Shift + D`) → Logs** and click **Report Bug** (opens a pre-filled GitHub Issue with sanitized diagnostic logs) or **Send Logs** (uploads sanitized error/latency metadata — never keys, prompts, transcripts, or screenshots).
- **Bug Reports & Feature Ideas:** Open an issue on **[GitHub Issues](https://github.com/Thairu-dev/StealthIt/issues)**.
- **Pull Requests:** Contributions are very welcome — run `npm run typecheck && npm test` inside `stealthit-electron/` before opening a PR.

## 💖 Support this Project

If you find StealthIt helpful, consider supporting its development:
[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/joethairu)
