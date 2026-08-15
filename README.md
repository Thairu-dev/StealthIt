# StealthIt: Invisible AI Desktop Assistant & Models Competition

**StealthIt** is a high-performance **AI Desktop Assistant** designed for high-stakes productivity and stealth efficiency. It floats unobtrusively over your workspace—providing sub-second vision analysis, local Whisper voice transcription, and live AI intelligence while remaining **100% invisible to anyone viewing your screen share or recording** (OBS, Discord, Zoom, Teams).

This repository also hosts the **AI Models Competition**, showcasing how different state-of-the-art models approach building and enhancing the StealthIt application.

---

## 💼 Core High-Stakes Use Cases

StealthIt functions as a versatile AI Desktop Assistant across multiple professional scenarios:

| Use Case | Description | Primary Hotkeys |
| :--- | :--- | :--- |
| **🎙️ Live Meeting Assistant & AI Summarizer** | Silently transcribes Zoom, Teams, Google Meet, or in-person audio locally via Whisper. Instantly summarizes discussions, captures action items, and generates structured executive meeting minutes. | `Ctrl+R` |
| **💻 Technical Interviews & Live Coding** | Floats invisibly over LeetCode, HackerRank, or IDEs. Snaps problem statements with OCR and provides algorithm breakdowns, time/space complexities, and edge-case warnings. | `Ctrl+Enter` |
| **📈 Live Sales & Client Objection Handling** | Real-time audio transcription detects client hesitation or competitor mentions and feeds you instant battlecards, pricing rebuttals, and SLA benchmarks. | `Ctrl+R` / `Ctrl+Enter` |
| **📊 Executive Deep Work & Document Research** | Instant OCR analysis of dense spreadsheets, architecture diagrams, academic papers, and terminal logs without window switching or copying plaintext. | `Ctrl+Enter` |
| **🎤 Invisible Presentation & Webinar Prompter** | Keeps speech cues, keynote outlines, and audience Q&A answers floating next to your webcam without being visible to viewers. | `Ctrl+\` / `Ctrl+T` |

---

### 🏆 Competitors / Structure
- **`/antigravity-original`**: The baseline, original project developed by Antigravity and Gemini-3-pro.
- **`/claude-opus-5`**: A complete rebuild and enhancement of the app, built by Claude Opus 5 (featuring native desktop architecture, custom OpenAI-compatible endpoints, local Whisper transcription, and encrypted local key storage).

> [!TIP]
> **Recommended Version:** The `/claude-opus-5` (Claude v2) version is the most stable and feature-rich version of the application. It includes numerous bug fixes, UI improvements, and new capabilities (like encrypted local key storage and copy/edit tools) that are not present in the original baseline. We recommend using this version!

*Feel free to explore each folder to see their respective READMEs and run the different versions!*

---

## ✨ Key Capabilities & Features

*   **👻 True Stealth Invisibility**: Excluded from the Windows Taskbar and 100% invisible to screen recording tools and video calls (OBS, Discord, Zoom, Teams).
*   **🎙️ Local Whisper Voice & Meeting Transcription**: Press `Ctrl+R` to record system audio or microphone with local Whisper transcription for instant meeting summaries and verbal Q&A.
*   **📸 Sub-Second Multimodal Vision**: Press `Ctrl+Enter` to silently capture an in-memory screenshot and send it to the AI for instant code or document OCR.
*   **🔒 Encrypted Local Security**: API keys and transcripts are securely encrypted locally on your machine rather than stored in plaintext files.
*   **🧠 Multi-Provider AI**: Native support for **Google Gemini**, **OpenAI**, **Anthropic Claude**, **OpenRouter/AgentRouter**, or local **Ollama** models.
*   **⌨️ Global Hotkeys**: Operate the assistant from anywhere without losing focus or breaking active screen workflows.

## 🛠️ Installation

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/Thairu-dev/StealthIt.git
    cd StealthIt
    ```

2.  **Choose your competitor**:
    ```bash
    cd claude-opus-5
    # OR
    cd antigravity-original
    ```

3.  **Install Dependencies**:
    Ensure you have Python 3.10+ installed.
    ```bash
    pip install -r requirements.txt
    ```

4.  **Run the Application**:
    If you are running the `antigravity-original` version:
    ```bash
    python main.py
    ```
    If you are running the `claude-opus-5` version:
    ```bash
    python -m stealthit
    ```

## 🔑 API Keys

Get API keys from your preferred providers:

| Provider | Get API Key |
| :--- | :--- |
| **Google Gemini** | [Google AI Studio](https://aistudio.google.com/app/apikey) |
| **OpenAI** | [OpenAI Platform](https://platform.openai.com/api-keys) |
| **Anthropic** | [Anthropic Console](https://console.anthropic.com/) |
| **Ollama** | No API key needed (runs locally) |

## ⚙️ Configuration

1.  Open the **Settings** menu by clicking the ⚙️ icon or pressing `Ctrl+,`.
2.  Select your **Active Provider** from the dropdown.
3.  Configure provider-specific settings:
    *   **Gemini**: Enter your Google Gemini API Key.
    *   **OpenAI**: Enter your OpenAI API Key, select model (GPT-4o, GPT-4 Turbo, etc.).
    *   **Anthropic**: Enter your Anthropic API Key, select model (Claude 4, Claude 3.5, etc.).
    *   **Ollama**: Configure your Ollama host URL (default: `http://localhost:11434`).

> **Tip**: You can also quickly switch models by clicking the model chip in the main UI!

## 🎮 Usage & Hotkeys

| Hotkey | Action |
| :--- | :--- |
| **Ctrl + Enter** | **Capture & Analyze**: Takes a screenshot and sends it to the AI with your prompt. |
| **Ctrl + R** | **Record Audio**: Toggles microphone recording for voice queries. |
| **Ctrl + T** | **Toggle Chat**: Expands or collapses the chat window. |
| **Ctrl + W** | **Close App**: Completely terminates the application. |
| **Ctrl + \\** | **Hide/Show**: Instantly hides or shows the entire application window. |
| **Ctrl + ,** | **Settings**: Opens the configuration dialog. |

## ⚔️ How to Participate in the AI Models Competition

The **StealthIt Models Competition** is an open vibe-coding challenge! Developers and AI systems can architect, enhance, and submit their own competitor implementations to see which model designs the best stealth desktop AI utility.

The winning codebase will be crowned by the community and compiled into the official **1-click standalone Windows installer (`.exe`)** with auto-updates!

### 🥊 Arena Rules for Competitor Submissions:
1. **True Stealth Compliance**: Your version MUST remain 100% invisible on OBS, Zoom, Teams, Discord, and the Windows Taskbar.
2. **Instant Vision Trigger (`Ctrl+Enter`)**: Must support in-memory screen snapping and multimodal analysis with zero temporary files left on disk.
3. **Local Encryption**: API keys must not be stored in plaintext configuration files.
4. **Clean Folder Isolation**: Place your implementation in a new root subfolder (e.g., `/"your_model"`) with its own `requirements.txt`, `README.md`, and test instructions.

### 🚀 Submission Steps:
```bash
# 1. Fork and clone the repository
git clone https://github.com/Thairu-dev/StealthIt.git
cd StealthIt

# 2. Create your model's competitor directory
mkdir "your_model"
cd "your_model"

# 3. Build your implementation adhering to the Arena Rules
# 4. Push and open a Pull Request with your benchmark results!
```

---

## 🗳️ Community Voting & Standalone App Roadmap

We are hosting a live community voting hub to decide which model's architecture should power the standalone release:
- **Phase 1 (Active)**: Models Competition benchmarking, community testing, and voting.
- **Phase 2 (Upcoming)**: Crown the champion codebase and compile into a standalone `.exe` / `.msi` Windows installer with auto-updates.

---

## 🤝 Contributing & Community

Feel free to submit issues, bug fixes, feature requests, and new model competitor PRs!

## 🎁 Bonus: Free Premium AI Tokens

Want to test cutting-edge models like `claude-opus-4-8`, `claude-opus-5`, and `gpt-5.6-sol`? 

AgentRouter is currently giving away **$175 worth of free tokens** to new users! You can use these tokens directly in the Claude version of StealthIt (using the custom endpoints feature we built).

**To claim:**
1. Go to this referral link: **[https://agentrouter.org/register?aff=Plwl](https://agentrouter.org/register?aff=Plwl)**
2. Sign up using your **GitHub account**. *(Note: The GitHub signup button is only visible if you are on a desktop browser).*

## 💖 Support this Project

If you find this project helpful, consider supporting the development!
[![Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/joethairu)

---
*Built with ❤️ by Antigravity & Gemini-3-pro*
