# StealthIt

**StealthIt** is a powerful Vibe coding Challenge, AI-integrated desktop utility designed for stealth and efficiency(Cluely Alternative). It provides instant access to AI capabilities, screen analysis, and voice interaction while remaining completely hidden from the taskbar and screen capture software.

> **Developed by Antigravity and Gemini-3-pro**

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
*   **🧠 AI Integration**: Powered by **Google Gemini** or local **Ollama** models.
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

## 🔑 Getting a Gemini API Key

To use the AI features, you'll need a Google Gemini API key.

1.  Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
2.  Click on **Create API key**.
3.  Copy the generated key.
4.  Paste it into the **Settings** menu in StealthIt.

## ⚙️ Configuration

1.  Open the **Settings** menu by clicking the ⚙️ icon or pressing `Ctrl+,`.
2.  **Gemini**: Enter your Google Gemini API Key.
3.  **Ollama**: Configure your Ollama host URL (default: `http://localhost:11434`).
    *   **Note**: The app automatically handles URL formatting, so `http://localhost:11434` and `http://localhost:11434/api/generate` both work.

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
*Built with ❤️ by Antigravity & Gemini-3-pro*
