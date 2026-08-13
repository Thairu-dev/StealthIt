# AI Development Instructions for StealthIt

Welcome to the **StealthIt** project! This document serves as the core context for any AI model or agent working on this codebase. Please read these instructions carefully before making any code modifications.

## 1. Project Overview
**StealthIt** is an AI-integrated desktop utility designed for stealth and efficiency (a Cluely Alternative). It provides instant access to AI capabilities, screen analysis, and voice interaction. 
**Key Feature:** The app remains completely hidden from the taskbar and screen capture software (like OBS, Discord, or Teams) using native Windows APIs (Window Affinity).

## 2. Repository Structure & Where to Work
This repository is a "Models Competition." It contains two distinct applications:
- `/antigravity-original`: The original baseline version. **Do not modify this unless explicitly asked by the user.**
- `/claude-opus-5`: The **active, stable, and feature-rich** v2 architecture built using `PySide6`. **All development, bug fixes, and feature additions should occur in this directory.**

## 3. Core Architecture & Tech Stack (claude-opus-5)
- **UI Framework:** `PySide6` (Qt for Python).
- **Audio:** `pyaudiowpatch` for loopback capture, `webrtcvad` for voice activity detection, and `faster-whisper` for local transcription.
- **Image Capture:** Native Windows `BitBlt` and `Pillow`.
- **Secrets Management:** We use Windows DPAPI (`crypt32.CryptProtectData`) to encrypt API keys and save them to the global user profile (`%LOCALAPPDATA%\StealthIt\credentials.json`). **Never hardcode keys or create plaintext `.env` files in the repo for secrets.**

## 4. Development Guidelines
- **Stealth First:** Any new windows or overlays created must inherit the stealth properties (e.g., hidden from taskbar, `WS_EX_TOOLWINDOW`, and `WDA_EXCLUDEFROMCAPTURE`). Refer to `stealthit/native/window.py` for existing implementations.
- **Provider System:** The app supports multiple providers (OpenAI, Anthropic, Gemini, Ollama, OpenRouter). When adding new model routing or provider logic, adhere to the established `Provider` interface in `stealthit/providers/`.
- **UI Responsiveness:** Heavy tasks (network requests, Whisper transcription) must run on background threads (`QThread` / `QRunnable`) and communicate with the main thread via Qt Signals to prevent UI freezing.
- **Clean Architecture:** Keep UI logic (`ui/`) separate from core data models (`core/`) and native OS calls (`native/`).

## 5. Testing
- We use `pytest`. The test suite is located in `/claude-opus-5/tests/`.
- When adding new core logic (like context building, history truncation, or config parsing), ensure you write or update corresponding unit tests and run them to verify no regressions were introduced.

If you are an AI agent reading this, acknowledge these rules and proceed directly to addressing the user's specific request within the `/claude-opus-5` directory!
