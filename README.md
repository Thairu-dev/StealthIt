# StealthIt: AI Models Competition

**StealthIt** is a powerful Vibe coding Challenge, AI-integrated desktop utility designed for stealth and efficiency(Cluely Alternative). It provides instant access to AI capabilities, screen analysis, and voice interaction while remaining completely hidden from the taskbar and screen capture software.

This repository serves as a **Models Competition**, showcasing how different state-of-the-art AI models approach building and enhancing the StealthIt application.

### 🏆 Competitors / Structure
- **`/antigravity-original`**: The baseline, original project developed by Antigravity and Gemini-3-pro.
- **`/claude-opus-5`**: A complete rebuild and enhancement of the app, built by Claude Opus 5 (featuring robust PySide6 Win32 integrations, custom OpenAI-compatible endpoints, and native OS APIs).

*Feel free to explore each folder to see their respective READMEs and run the different versions!*

---

## 🤖 Supported AI Providers

StealthIt supports **5 AI providers** for maximum flexibility:

| Provider | Vision Support | Notes |
| :--- | :---: | :--- |
| **Google Gemini** | ✅ | Cloud API, excellent vision capabilities |
| **Ollama** | ✅ | Local LLMs, requires vision models like `llava` |
| **OpenAI** | ✅ | GPT-4o, GPT-4 Turbo, o1 models |
| **Anthropic** | ✅ | Claude 4, Claude 3.5 Sonnet/Haiku/Opus |
| **OpenRouter** | ✅ | Dozens of open and proprietary models *(Claude version only)* |

---

## 🚀 Ollama Support
**StealthIt** now fully supports local LLMs via **Ollama**, including vision capabilities!

### Requirements for Vision (Screen Capture)
To use the **Capture & Analyze** feature (`Ctrl+Enter`) with Ollama, you **MUST** use a multimodal (vision-capable) model. Standard text models like `llama3` will not work with images.

**Recommended Models:**
*   `llava` (Lightweight, fast)
*   `llama3.2-vision` (Higher quality)

**Setup:**
1.  Install Ollama from [ollama.com](https://ollama.com).
2.  Pull a vision model:
    ```bash
    ollama pull llava
    ```
3.  In StealthIt Settings, select **Ollama** provider and choose `llava` as the model.

---

## ✨ Features

*   **👻 True Stealth Mode**: The application is hidden from the Windows Taskbar and is invisible to screen capture tools (OBS, Discord, Teams, etc.) thanks to advanced window affinity settings.
*   **🧠 Multi-Provider AI**: Powered by **Google Gemini**, **OpenAI**, **Anthropic Claude**, **Cerebras**, or local **Ollama** models.
*   **📸 Instant Vision**: Press `Ctrl+Enter` to instantly capture a screenshot and analyze it with AI.
*   **🎤 Voice Interaction**: Press `Ctrl+R` to record audio and get instant transcriptions and AI responses *(The Claude version features built-in **Whisper** support for high-accuracy local transcription)*.
*   **⌨️ Global Hotkeys**: Control the application from anywhere without losing focus.
*   **🎨 Modern UI**: A sleek, dark, semi-transparent interface that floats unobtrusively on your desktop.
*   **📝 Markdown Support**: Rich text formatting for AI responses (bold, italics, lists, etc.).
*   **⚡ Quick Model Switching**: Click the model chip to instantly switch between providers and models.

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

## 🤝 Contributing

Feel free to submit issues and enhancement requests.

---

## 🎁 Bonus: Free Premium AI Tokens

Want to test cutting-edge models like `claude-opus-4-8`, `claude-opus-5`, and `gpt-5.6-sol`? 

AgentRouter is currently giving away **$175 worth of free tokens** to new users! You can use these tokens directly in the Claude version of StealthIt (using the custom endpoints feature we built).

**To claim:**
1. Go to this referral link: **[https://agentrouter.org/register?aff=Plwl](https://agentrouter.org/register?aff=Plwl)**
2. Sign up using your **GitHub account**. *(Note: The GitHub signup button is only visible if you are on a desktop browser).*

## 💖 Support this Project

If you find this project helpful, consider supporting the development!
[![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://www.buymeacoffee.com/yourusername)

---
*Built with ❤️ by Antigravity & Gemini-3-pro*
