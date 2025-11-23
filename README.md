# StealthIt

**StealthIt** is a powerful Vibe coding Challenge, AI-integrated desktop utility designed for stealth and efficiency. It provides instant access to AI capabilities, screen analysis, and voice interaction while remaining completely hidden from the taskbar and screen capture software.

> **Developed by Antigravity and Gemini-3-pro**

---

## ⚠️ Disclaimer
**The Ollama integration feature is currently experimental and has yet to be fully tested.** Please use the Gemini provider for the most stable experience.

---

## ✨ Features

*   **👻 True Stealth Mode**: The application is hidden from the Windows Taskbar and is invisible to screen capture tools (OBS, Discord, Teams, etc.) thanks to advanced window affinity settings.
*   **🧠 AI Integration**: Powered by **Google Gemini** (default) with experimental support for **Ollama**.
*   **📸 Instant Vision**: Press `Ctrl+Enter` to instantly capture a screenshot and analyze it with AI.
*   **🎤 Voice Interaction**: Press `Ctrl+R` to record audio and get instant transcriptions and AI responses.
*   **⌨️ Global Hotkeys**: Control the application from anywhere without losing focus.
*   **🎨 Modern UI**: A sleek, dark, semi-transparent interface that floats unobtrusively on your desktop.
*   **📝 Markdown Support**: Rich text formatting for AI responses (bold, italics, lists, etc.).

## 🛠️ Installation

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/Thairu-dev/StealthIt.git
    cd StealthIt
    ```

2.  **Install Dependencies**:
    Ensure you have Python 3.10+ installed.
    ```bash
    pip install -r requirements.txt
    ```

3.  **Run the Application**:
    ```bash
    python main.py
    ```

## ⚙️ Configuration

1.  Open the **Settings** menu by clicking the ⚙️ icon or pressing `Ctrl+,`.
2.  **Gemini (Recommended)**: Enter your Google Gemini API Key.
3.  **Ollama (Experimental)**: Configure your Ollama host URL (default: `http://localhost:11434`).

## 🎮 Usage & Hotkeys

| Hotkey | Action |
| :--- | :--- |
| **Ctrl + Enter** | **Capture & Analyze**: Takes a screenshot and sends it to the AI with your prompt. |
| **Ctrl + R** | **Record Audio**: Toggles microphone recording for voice queries. |
| **Ctrl + T** | **Toggle Chat**: Expands or collapses the chat window. |
| **Ctrl + W** | **Close App**: Completely terminates the application. |
| **Ctrl + \** | **Hide/Show**: Instantly hides or shows the entire application window. |
| **Ctrl + ,** | **Settings**: Opens the configuration dialog. |

## 🤝 Contributing

Feel free to submit issues and enhancement requests.

---
*Built with ❤️ by Antigravity & Gemini-3-pro*
