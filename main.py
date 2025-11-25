import sys
import os
import json
import time
import threading
import queue
import ctypes
from ctypes import wintypes
import io
import numpy as np
import sounddevice as sd
import soundfile as sf
import google.generativeai as genai
from PIL import Image, ImageGrab
import urllib.request
import urllib.error
from dotenv import load_dotenv, set_key
import qtawesome as qta

# Load environment variables
load_dotenv()

from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, 
                               QHBoxLayout, QTextEdit, QLineEdit, QPushButton, 
                               QLabel, QFrame, QSizePolicy, QScrollArea, QGraphicsDropShadowEffect,
                               QDialog, QFormLayout, QDialogButtonBox, QTabWidget, QComboBox, QMenu, QMessageBox)
from PySide6.QtCore import Qt, QThread, Signal, QPoint, QSize, QTimer, QPropertyAnimation, QEasingCurve, QRect
from PySide6.QtGui import QColor, QPalette, QIcon, QFont, QCursor, QPainter, QBrush, QPen, QClipboard, QShortcut, QKeySequence

# --- Configuration ---
CONFIG_FILE = "config.json"
ENV_FILE = ".env"
config = {
    "providers": {
        "gemini": {
            "api_key": "",
            "model": "gemini-2.5-flash"
        },
        "ollama": {
            "host": "http://localhost:11434",
            "model": "llama3"
        }
    },
    "active_provider": "gemini",
    "prompts": {
        "system": "You are a helpful AI assistant. Be concise.",
        "vision": "Analyze this screenshot, identify the key UI elements, and explain how to achieve the user's goal.",
        "modes": {
            "General": "You are a helpful AI assistant. Be concise.",
            "Meeting": "You are a professional meeting summarizer and action item generator.",
            "Coding": "You are an expert software engineer. Provide code solutions and debugging tips."
        }
    }
}

def load_config():
    global config
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                loaded = json.load(f)
                # Migration Logic
                if "api_key" in loaded:
                    config["providers"]["gemini"]["api_key"] = loaded.get("api_key", "")
                    config["providers"]["gemini"]["model"] = loaded.get("model_name", "gemini-2.5-flash")
                    config["prompts"]["system"] = loaded.get("prompt", config["prompts"]["system"])
                else:
                    # Deep merge or overwrite
                    # Simple overwrite for now, assuming structure matches if "api_key" is missing
                    # But better to be safe and merge keys
                    if "providers" in loaded: config["providers"].update(loaded["providers"])
                    if "active_provider" in loaded: config["active_provider"] = loaded["active_provider"]
                    if "prompts" in loaded: config["prompts"].update(loaded["prompts"])
                    
        except Exception as e:
            print(f"Error loading config: {e}")

def save_config():
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=4)
    except Exception as e:
        print(f"Error saving config: {e}")

# --- Native Windows API Constants ---
user32 = ctypes.windll.user32
WM_HOTKEY = 0x0312
MOD_CONTROL = 0x0002
VK_RETURN = 0x0D
VK_OEM_5 = 0xDC  # Backslash
VK_UP = 0x26
VK_DOWN = 0x28
VK_LEFT = 0x25
VK_RIGHT = 0x27

# --- AI & Audio Logic (Background Threads) ---

class AIWorker(QThread):
    response_ready = Signal(str)
    transcription_ready = Signal(str)
    
    def __init__(self):
        super().__init__()
        self.queue = queue.Queue()
        self.running = True

    def run(self):
        while self.running:
            try:
                task = self.queue.get(timeout=1)
                if task is None: break
                self.process_task(task)
            except queue.Empty:
                continue
            except Exception as e:
                print(f"AI Worker Error: {e}")

    def process_task(self, task):
        action = task.get('action')
        if action == 'chat':
            self.chat(task.get('text'), task.get('context'), task.get('image'))
        elif action == 'transcribe':
            self.transcribe(task.get('audio_path'))
        elif action == 'transcribe_chunk':
            self.transcribe_chunk(task.get('audio_bytes'))

    def chat(self, user_input, audio_context=None, image_input=None):
        provider = config.get("active_provider", "gemini")
        
        if provider == "gemini":
            self.chat_gemini(user_input, audio_context, image_input)
        elif provider == "ollama":
            self.chat_ollama(user_input, audio_context, image_input)
        else:
            self.response_ready.emit(f"Error: Unknown provider {provider}")

    def chat_gemini(self, user_input, audio_context, image_input):
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            self.response_ready.emit("Error: Gemini API Key missing. Check settings.")
            return

        try:
            genai.configure(api_key=api_key)
            model_name = config["providers"]["gemini"].get("model", "gemini-2.5-flash")
            model = genai.GenerativeModel(model_name)
            
            # Select Prompt
            system_prompt = config["prompts"]["system"]
            if image_input:
                vision_prompt = config["prompts"].get("vision", "")
                full_prompt = f"{vision_prompt}\n\nUser: {user_input}"
            else:
                full_prompt = f"{system_prompt}\n\nUser: {user_input}"

            if audio_context:
                full_prompt += f"\n\nContext from Audio:\n{audio_context}"

            content = [full_prompt]
            if image_input:
                try:
                    if isinstance(image_input, str):
                        img = Image.open(image_input)
                        content.append(img)
                    else:
                        # Assume it's a PIL Image object
                        content.append(image_input)
                except Exception as e:
                    print(f"Error loading image: {e}")

            response = model.generate_content(content)
            self.response_ready.emit(response.text)
        except Exception as e:
            self.response_ready.emit(f"Gemini Error: {str(e)}")

    def chat_ollama(self, user_input, audio_context, image_input):
        host = config["providers"]["ollama"].get("host", "http://localhost:11434")
        model_name = config["providers"]["ollama"].get("model", "llama3")
        
        # Select Prompt
        system_prompt = config["prompts"]["system"]
        if image_input:
            # Ollama vision support varies (llava etc), but for now we'll append text
            vision_prompt = config["prompts"].get("vision", "")
            full_prompt = f"{vision_prompt}\n\nUser: {user_input}"
            # Note: Image handling for Ollama requires base64 encoding and specific models (llava)
            # For this step, we will just handle text or warn about images if model isn't multimodal
        else:
            full_prompt = f"{system_prompt}\n\nUser: {user_input}"

        if audio_context:
            full_prompt += f"\n\nContext from Audio:\n{audio_context}"

        try:
            url = f"{host}/api/generate"
            data = {
                "model": model_name,
                "prompt": full_prompt,
                "stream": False
            }
            
            # If image, we need to encode it (TODO for later if requested, sticking to text for now or basic)
            # if image_input: ...
            
            req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode('utf-8'))
                self.response_ready.emit(result.get("response", ""))
        except Exception as e:
            self.response_ready.emit(f"Ollama Error: {str(e)}. Is Ollama running?")

    def transcribe(self, audio_path):
        # Legacy file-based transcription (still useful for full recording save)
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            self.transcription_ready.emit("Error: API Key missing.")
            return
            
        try:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-2.5-flash") # Transcription usually fixed to efficient model
            
            audio_file = genai.upload_file(path=audio_path)
            response = model.generate_content([
                "Transcribe this audio file accurately.",
                audio_file
            ])
            model = genai.GenerativeModel("gemini-2.5-flash")
            
            response = model.generate_content([
                "Transcribe the following audio fragment. Return only the text, no preamble.",
                {'mime_type': 'audio/wav', 'data': audio_bytes}
            ])
            
            # Safely check for text
            if response.parts:
                text = response.text.strip()
                if text:
                    self.transcription_ready.emit(text)
            else:
                # print("Empty response from AI (Silence?)")
                pass
                
        except Exception as e:
            print(f"Chunk Transcription Error: {e}")

    def stop(self):
        self.running = False
        self.queue.put(None) # Unblock queue
        self.wait()

class AudioWorker(QThread):
    recording_status = Signal(bool)
    audio_saved = Signal(str)
    audio_chunk_ready = Signal(bytes)

    def __init__(self):
        super().__init__()
        self.recording = False
        self.audio_queue = queue.Queue()
        self.audio_data = []
        self.chunk_buffer = []
        self.samplerate = 16000
        self.stream = None
        self.chunk_duration = 4 # Seconds

    def toggle_recording(self):
        if self.recording:
            self.stop_recording()
        else:
            self.start_recording()

    def start_recording(self):
        if self.recording: return
        self.recording = True
        self.audio_data = []
        self.chunk_buffer = []
        self.recording_status.emit(True)
        
        def callback(indata, frames, time, status):
            self.audio_queue.put(indata.copy())

        try:
            self.stream = sd.InputStream(samplerate=self.samplerate, channels=1, callback=callback)
            self.stream.start()
            self.start() # Start the run loop
        except Exception as e:
            print(f"Audio Start Error: {e}")
            self.recording = False
            self.recording_status.emit(False)

    def stop_recording(self):
        self.recording = False
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None
        self.recording_status.emit(False)

    def run(self):
        chunk_samples = self.samplerate * self.chunk_duration
        current_chunk_size = 0
        
        while self.recording:
            try:
                data = self.audio_queue.get(timeout=1)
                self.audio_data.append(data)
                self.chunk_buffer.append(data)
                current_chunk_size += len(data)
                
                # Check if we have enough for a chunk
                if current_chunk_size >= chunk_samples:
                    self.process_chunk()
                    current_chunk_size = 0
                    self.chunk_buffer = []
                    
            except queue.Empty:
                pass
        
        # Process remaining chunk if any
        if self.chunk_buffer:
            self.process_chunk()
            self.chunk_buffer = []

        if self.audio_data:
            self.save_full_recording()

    def process_chunk(self):
        try:
            audio_concatenated = np.concatenate(self.chunk_buffer, axis=0)
            # Convert to WAV bytes
            wav_buffer = io.BytesIO()
            sf.write(wav_buffer, audio_concatenated, self.samplerate, format='WAV')
            wav_bytes = wav_buffer.getvalue()
            self.audio_chunk_ready.emit(wav_bytes)
        except Exception as e:
            print(f"Chunk Processing Error: {e}")

    def save_full_recording(self):
        filename = "temp_recording.wav"
        try:
            audio_concatenated = np.concatenate(self.audio_data, axis=0)
            sf.write(filename, audio_concatenated, self.samplerate)
            print(f"Full Audio saved to {filename}")
            # self.audio_saved.emit(filename) # Optional: Don't re-transcribe full file if streaming
        except Exception as e:
            print(f"Audio Save Error: {e}")
    
    def stop(self):
        self.recording = False
        self.stop_recording()
        self.wait()


# --- UI Components ---

class StealthComboBox(QComboBox):
    def __init__(self, parent=None):
        super().__init__(parent)
        # Delay applying stealth to ensure view is ready
        QTimer.singleShot(0, self.apply_stealth)

    def apply_stealth(self):
        try:
            view = self.view()
            if view:
                popup = view.window()
                if popup:
                    hwnd = int(popup.winId())
                    WDA_EXCLUDEFROMCAPTURE = 0x00000011
                    user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
        except Exception as e:
            print(f"StealthComboBox Init Error: {e}")

    def showPopup(self):
        # Re-apply just in case
        self.apply_stealth()
        super().showPopup()

class StealthMenu(QMenu):
    def __init__(self, parent=None):
        super().__init__(parent)
        # Apply stealth immediately to the menu window itself
        try:
            hwnd = int(self.winId())
            WDA_EXCLUDEFROMCAPTURE = 0x00000011
            user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
        except Exception as e:
            print(f"StealthMenu Init Error: {e}")

    def showEvent(self, event):
        # Re-apply ensure
        try:
            hwnd = int(self.winId())
            WDA_EXCLUDEFROMCAPTURE = 0x00000011
            user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
        except Exception:
            pass
        super().showEvent(event)

class SettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Settings")
        self.setFixedSize(500, 450)
        
        # --- Stealth Mode for Settings Window ---
        try:
            hwnd = int(self.winId())
            WDA_EXCLUDEFROMCAPTURE = 0x00000011
            user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
        except Exception as e:
            print(f"Settings Stealth Error: {e}")

        # Dark Theme matching the main app
        # Reverted to standard window to ensure opacity
        
        self.setStyleSheet("""
            QDialog {
                background-color: #1a1a1a;
                color: #e5e7eb;
            }
            QLabel {
                color: #d1d5db;
                font-size: 14px;
                background: transparent;
            }
            QLineEdit, QTextEdit, QComboBox {
                background-color: rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: #e5e7eb;
                padding: 8px;
            }
            QComboBox::drop-down {
                subcontrol-origin: padding;
                subcontrol-position: top right;
                width: 25px;
                border-left-width: 1px;
                border-left-color: rgba(255, 255, 255, 0.1);
                border-left-style: solid;
                border-top-right-radius: 6px;
                border-bottom-right-radius: 6px;
            }
            QComboBox::down-arrow {
                image: url(resources/chevron-down.png);
                width: 12px;
                height: 12px;
                margin-right: 8px;
            }
            QTabWidget::pane {
                border: 1px solid rgba(255, 255, 255, 0.1);
                background-color: rgba(0, 0, 0, 0.2);
                border-radius: 6px;
            }
            QTabBar::tab {
                background: transparent;
                color: #9ca3af;
                padding: 8px 12px;
                border-bottom: 2px solid transparent;
            }
            QTabBar::tab:selected {
                color: white;
                border-bottom: 2px solid #2563eb;
            }
            QPushButton {
                background-color: rgba(255, 255, 255, 0.1);
                color: #e5e7eb;
                border-radius: 6px;
                padding: 8px 16px;
                font-weight: bold;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.2);
                color: white;
            }
            /* Save Button Highlight */
            QPushButton[text="Save"] {
                background-color: #2563eb;
                border: none;
                color: white;
            }
            QPushButton[text="Save"]:hover {
                background-color: #1d4ed8;
            }
            QScrollBar:vertical {
                border: none;
                background: transparent;
                width: 8px;
                margin: 0px;
            }
            QScrollBar::handle:vertical {
                background: rgba(255, 255, 255, 0.2);
                min-height: 20px;
                border-radius: 4px;
            }
        """)
        
        layout = QVBoxLayout(self)
        
        self.tabs = QTabWidget()
        layout.addWidget(self.tabs)
        
        # --- Tab 1: General (Providers) ---
        self.tab_general = QWidget()
        self.tabs.addTab(self.tab_general, "General")
        gen_layout = QFormLayout(self.tab_general)
        
        # Active Provider
        self.combo_provider = StealthComboBox()
        self.combo_provider.addItems(["gemini", "ollama"])
        self.combo_provider.setCurrentText(config.get("active_provider", "gemini"))
        self.combo_provider.currentTextChanged.connect(self.toggle_provider_settings)
        gen_layout.addRow("Active Provider:", self.combo_provider)
        # Gemini Settings
        self.gemini_group = QWidget()
        gemini_layout = QFormLayout(self.gemini_group)
        self.api_key_input = QLineEdit()
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_input.setText(os.environ.get("GEMINI_API_KEY", ""))
        gemini_layout.addRow("Gemini API Key:", self.api_key_input)
        
        self.gemini_model_combo = StealthComboBox()
        self.gemini_model_combo.setEditable(True)
        self.gemini_model_combo.addItems(["gemini-2.5-flash", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-pro"])
        self.gemini_model_combo.setCurrentText(config["providers"]["gemini"].get("model", "gemini-2.5-flash"))
        gemini_layout.addRow("Gemini Model:", self.gemini_model_combo)
        gen_layout.addRow(self.gemini_group)
        
        # Ollama Settings
        self.ollama_group = QWidget()
        ollama_layout = QFormLayout(self.ollama_group)
        self.ollama_host_input = QLineEdit()
        self.ollama_host_input.setText(config["providers"]["ollama"].get("host", "http://localhost:11434"))
        ollama_layout.addRow("Ollama Host:", self.ollama_host_input)
        
        self.ollama_model_combo = StealthComboBox()
        self.ollama_model_combo.setEditable(True)
        # Load cached models or default
        cached_models = config["providers"]["ollama"].get("cached_models", ["llama3"])
        self.ollama_model_combo.addItems(cached_models)
        self.ollama_model_combo.setCurrentText(config["providers"]["ollama"].get("model", "llama3"))
        
        btn_refresh_ollama = QPushButton()
        btn_refresh_ollama.setIcon(qta.icon('fa5s.sync-alt', color='#d1d5db'))
        btn_refresh_ollama.setFixedSize(30, 30)
        btn_refresh_ollama.setToolTip("Fetch Ollama Models")
        btn_refresh_ollama.clicked.connect(self.fetch_ollama_models)
        
        ollama_model_layout = QHBoxLayout()
        ollama_model_layout.addWidget(self.ollama_model_combo)
        ollama_model_layout.addWidget(btn_refresh_ollama)
        
        ollama_layout.addRow("Ollama Model:", ollama_model_layout)
        gen_layout.addRow(self.ollama_group)
        
        # --- Tab 2: Prompts ---
        self.tab_prompts = QWidget()
        self.tabs.addTab(self.tab_prompts, "Prompts")
        prompt_layout = QVBoxLayout(self.tab_prompts)
        
        # Mode Selector
        mode_layout = QHBoxLayout()
        mode_layout.addWidget(QLabel("Prompt Mode:"))
        self.combo_mode = StealthComboBox()
        self.combo_mode.addItems(config["prompts"]["modes"].keys())
        
        # Select active mode
        active_mode = config.get("active_mode", "General")
        self.combo_mode.setCurrentText(active_mode)
        
        self.combo_mode.currentTextChanged.connect(self.load_mode_prompt)
        mode_layout.addWidget(self.combo_mode)
        
        # Delete Button
        self.btn_delete_mode = QPushButton()
        self.btn_delete_mode.setIcon(qta.icon('fa5s.trash', color='#ef4444'))
        self.btn_delete_mode.setFixedSize(30, 30)
        self.btn_delete_mode.setToolTip("Delete Custom Prompt")
        self.btn_delete_mode.clicked.connect(self.delete_current_mode)
        mode_layout.addWidget(self.btn_delete_mode)
        
        prompt_layout.addLayout(mode_layout)
        
        prompt_layout.addWidget(QLabel("System Prompt (Conversation):"))
        self.system_prompt_input = QTextEdit()
        self.system_prompt_input.setPlainText(config["prompts"].get("system", ""))
        self.system_prompt_input.setFixedHeight(80)
        prompt_layout.addWidget(self.system_prompt_input)
        
        prompt_layout.addWidget(QLabel("Vision Prompt (Screenshots):"))
        self.vision_prompt_input = QTextEdit()
        self.vision_prompt_input.setPlainText(config["prompts"].get("vision", ""))
        self.vision_prompt_input.setFixedHeight(60)
        prompt_layout.addWidget(self.vision_prompt_input)
        
        # Buttons
        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.save_settings)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)
        
        self.toggle_provider_settings(self.combo_provider.currentText())

    def toggle_provider_settings(self, provider):
        if provider == "gemini":
            self.gemini_group.show()
            self.ollama_group.hide()
        else:
            self.gemini_group.hide()
            self.ollama_group.show()

    def load_mode_prompt(self, mode_name):
        prompt_text = config["prompts"]["modes"].get(mode_name, "")
        self.system_prompt_input.setPlainText(prompt_text)
        
        # Disable delete for default modes
        defaults = ["General", "Meeting", "Coding"]
        self.btn_delete_mode.setEnabled(mode_name not in defaults)
        if mode_name not in defaults:
             self.btn_delete_mode.setIcon(qta.icon('fa5s.trash', color='#ef4444'))
        else:
             self.btn_delete_mode.setIcon(qta.icon('fa5s.trash', color='#4b5563'))

    def delete_current_mode(self):
        mode_name = self.combo_mode.currentText()
        defaults = ["General", "Meeting", "Coding"]
        if mode_name in defaults:
            QMessageBox.warning(self, "Cannot Delete", f"Cannot delete default mode '{mode_name}'.")
            return
            
        confirm = QMessageBox.question(self, "Confirm Delete", f"Delete prompt '{mode_name}'?", QMessageBox.Yes | QMessageBox.No)
        if confirm == QMessageBox.Yes:
            del config["prompts"]["modes"][mode_name]
            # Reset to General
            config["active_mode"] = "General"
            config["prompts"]["system"] = config["prompts"]["modes"]["General"]
            
            # Refresh combo
            self.combo_mode.removeItem(self.combo_mode.currentIndex())
            self.combo_mode.setCurrentText("General")
            save_config()

    def fetch_ollama_models(self):
        host = self.ollama_host_input.text().strip()
        try:
            url = f"{host}/api/tags"
            with urllib.request.urlopen(url, timeout=2) as response:
                data = json.loads(response.read().decode('utf-8'))
                models = [m['name'] for m in data.get('models', [])]
                self.ollama_model_combo.clear()
                self.ollama_model_combo.addItems(models)
                if models:
                    self.ollama_model_combo.setCurrentIndex(0)
                # Cache them
                config["providers"]["ollama"]["cached_models"] = models
        except Exception as e:
            print(f"Error fetching Ollama models: {e}")
            self.ollama_model_combo.addItem("Error fetching models")

    def save_settings(self):
        # Providers
        config["active_provider"] = self.combo_provider.currentText()
        
        # Save API Key to .env
        api_key = self.api_key_input.text().strip()
        set_key(ENV_FILE, "GEMINI_API_KEY", api_key)
        os.environ["GEMINI_API_KEY"] = api_key # Update runtime env
        
        config["providers"]["gemini"]["model"] = self.gemini_model_combo.currentText().strip()
        config["providers"]["ollama"]["host"] = self.ollama_host_input.text().strip()
        config["providers"]["ollama"]["model"] = self.ollama_model_combo.currentText().strip()
        
        # Prompts
        # Only update the CURRENTLY SELECTED mode with the text in the box
        current_mode = self.combo_mode.currentText()
        new_prompt_text = self.system_prompt_input.toPlainText().strip()
        
        if current_mode:
            config["prompts"]["modes"][current_mode] = new_prompt_text
            # Also update active system prompt if this is the active mode
            config["prompts"]["system"] = new_prompt_text
            config["active_mode"] = current_mode
            
        config["prompts"]["vision"] = self.vision_prompt_input.toPlainText().strip()
            
        save_config()
        self.accept()

# ... (ControlBar, ChatBubble, TranscriptionItem, AutoResizingTextEdit classes remain unchanged) ...



class LoadingDots(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedHeight(40)
        self.dots = [0, 0, 0]
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.update_dots)
        self.step = 0
        self.running = False
        self.hide()

    def start(self):
        self.running = True
        self.show()
        self.timer.start(200)

    def stop(self):
        self.running = False
        self.hide()
        self.timer.stop()

    def update_dots(self):
        self.step = (self.step + 1) % 4
        self.update()

    def paintEvent(self, event):
        if not self.running: return
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        # Draw Bubble Background
        painter.setBrush(QColor(30, 30, 30, 180)) # Semi-transparent dark
        painter.setPen(QPen(QColor(255, 255, 255, 20), 1))
        rect = QRect(0, 0, 60, 36)
        painter.drawRoundedRect(rect, 18, 18)
        
        # Draw Dots
        painter.setBrush(QColor(200, 200, 200))
        painter.setPen(Qt.NoPen)

        for i in range(3):
            y_offset = -2 if ((self.step + i) % 4) == 0 else 0
            # Center the dots in the bubble
            x = 18 + i * 12
            y = 18 + y_offset
            painter.drawEllipse(x, y, 4, 4)

class ControlBar(QFrame):
    def __init__(self, parent):
        super().__init__(parent)
        self.parent = parent
        self.setFixedHeight(50)
        self.setObjectName("ControlBar")
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(15, 5, 15, 5)
        layout.setSpacing(10)

        # Drag Handle Removed
        # self.drag_handle = QLabel("⋮⋮")
        # ...

        # Record Button
        self.btn_record = QPushButton()
        self.btn_record.setIcon(qta.icon('fa5s.microphone', color='#d1d5db'))
        self.btn_record.setIconSize(QSize(20, 20))
        self.btn_record.setFixedSize(36, 36)
        self.btn_record.setToolTip("Toggle Recording (Ctrl+R)")
        self.btn_record.setShortcut("Ctrl+R")
        self.btn_record.clicked.connect(self.parent.toggle_recording)
        layout.addWidget(self.btn_record)

        # Screenshot Button
        self.btn_screenshot = QPushButton()
        self.btn_screenshot.setIcon(qta.icon('fa5s.camera', color='#d1d5db'))
        self.btn_screenshot.setIconSize(QSize(20, 20))
        self.btn_screenshot.setFixedSize(36, 36)
        self.btn_screenshot.setToolTip("Take Screenshot (Ctrl+Enter)")
        # Global hotkey handled in MainWindow
        self.btn_screenshot.clicked.connect(self.parent.take_screenshot)
        layout.addWidget(self.btn_screenshot)

        # Hide Button
        self.btn_hide = QPushButton()
        self.btn_hide.setIcon(qta.icon('fa5s.eye', color='#d1d5db'))
        self.btn_hide.setIconSize(QSize(20, 20))
        self.btn_hide.setFixedSize(36, 36)
        self.btn_hide.setToolTip("Hide Window (Ctrl+\\)")
        # Global hotkey handled in MainWindow
        self.btn_hide.clicked.connect(self.parent.toggle_visibility)
        layout.addWidget(self.btn_hide)

        # Settings Button
        self.btn_settings = QPushButton()
        self.btn_settings.setIcon(qta.icon('fa5s.cog', color='#d1d5db'))
        self.btn_settings.setIconSize(QSize(20, 20))
        self.btn_settings.setFixedSize(36, 36)
        self.btn_settings.setToolTip("Settings (Ctrl+,)")
        self.btn_settings.setShortcut("Ctrl+,")
        self.btn_settings.clicked.connect(self.parent.open_settings)
        layout.addWidget(self.btn_settings)

        # Collapse/Expand Button (Toggle)
        self.btn_toggle = QPushButton()
        self.btn_toggle.setIcon(qta.icon('fa5s.chevron-down', color='#d1d5db'))
        self.btn_toggle.setIconSize(QSize(20, 20))
        self.btn_toggle.setFixedSize(36, 36)
        self.btn_toggle.setToolTip("Expand/Collapse Chat (Ctrl+T)")
        self.btn_toggle.setShortcut("Ctrl+T")
        self.btn_toggle.clicked.connect(self.parent.toggle_expansion)
        layout.addWidget(self.btn_toggle)

        # Close Button
        self.btn_close = QPushButton()
        self.btn_close.setIcon(qta.icon('fa5s.times', color='#d1d5db'))
        self.btn_close.setIconSize(QSize(20, 20))
        self.btn_close.setFixedSize(36, 36)
        self.btn_close.setToolTip("Close App (Ctrl+W)")
        self.btn_close.setShortcut("Ctrl+W")
        self.btn_close.clicked.connect(self.parent.close_app)
        self.btn_close.setObjectName("BtnClose")
        layout.addWidget(self.btn_close)

        # Shadow
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(15)
        shadow.setColor(QColor(0, 0, 0, 80))
        shadow.setOffset(0, 4)
        self.setGraphicsEffect(shadow)

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.parent.old_pos = event.globalPosition().toPoint()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.LeftButton and self.parent.old_pos:
            delta = event.globalPosition().toPoint() - self.parent.old_pos
            self.parent.move(self.parent.pos() + delta)
            self.parent.old_pos = event.globalPosition().toPoint()

class ChatBubble(QWidget):
    def __init__(self, text, is_user=False):
        super().__init__()
        self.text = text
        self.is_user = is_user
        
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 5, 0, 5)
        layout.setSpacing(5)
        
        # Text Label
        self.label = QLabel(text)
        self.label.setWordWrap(True)
        self.label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        if not is_user:
            self.label.setTextFormat(Qt.MarkdownText) # Enable Markdown for AI responses
        
        # Modern Styling
        if is_user:
            # Gradient for User
            style = """
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #3b82f6, stop:1 #2563eb);
                color: white;
                padding: 10px 14px;
                border-radius: 18px;
                border-bottom-right-radius: 4px;
                font-family: 'Segoe UI', sans-serif;
                font-size: 14px;
                font-weight: 400;
            """
        else:
            # Glassmorphism for AI
            style = """
                background-color: rgba(30, 30, 30, 0.7);
                color: #f3f4f6;
                padding: 10px 14px;
                border-radius: 18px;
                border-bottom-left-radius: 4px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                font-family: 'Segoe UI', sans-serif;
                font-size: 14px;
                font-weight: 400;
            """
        
        self.label.setStyleSheet(f"""
            QLabel {{
                {style}
            }}
        """)
        
        self.label.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Preferred)
        if is_user:
            self.label.setMaximumWidth(350)
            self.label.setMinimumWidth(50) 
        else:
            self.label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
            self.label.setWordWrap(True)
        
        # Copy Button (Only for AI)
        self.btn_copy = QPushButton()
        self.btn_copy.setIcon(qta.icon('fa5s.copy', color='#9ca3af'))
        self.btn_copy.setIconSize(QSize(14, 14))
        self.btn_copy.setFixedSize(24, 24)
        self.btn_copy.setToolTip("Copy to Clipboard")
        self.btn_copy.clicked.connect(self.copy_to_clipboard)
        self.btn_copy.setStyleSheet("""
            QPushButton {
                background-color: transparent;
                border: none;
                color: #9ca3af;
            }
            QPushButton:hover {
                color: white;
            }
        """)
        
        if is_user:
            layout.addStretch()
            layout.addWidget(self.label)
        else:
            layout.addWidget(self.label)
            layout.addWidget(self.btn_copy, 0, Qt.AlignTop)
            # layout.addStretch()

    def copy_to_clipboard(self):
        clipboard = QApplication.clipboard()
        clipboard.setText(self.text)
        self.btn_copy.setIcon(qta.icon('fa5s.check', color='#10b981'))
        QTimer.singleShot(2000, lambda: self.btn_copy.setIcon(qta.icon('fa5s.copy', color='#9ca3af')))

class TranscriptionItem(QWidget):
    def __init__(self, text):
        super().__init__()
        self.text = text
        
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 5, 0, 5)
        layout.setSpacing(5)
        
        # Header (Copy Button)
        header_layout = QHBoxLayout()
        header_label = QLabel("Transcription:")
        header_label.setStyleSheet("color: #9ca3af; font-weight: bold; font-size: 12px;")
        
        self.btn_copy = QPushButton()
        self.btn_copy.setIcon(qta.icon('fa5s.copy', color='#9ca3af'))
        self.btn_copy.setIconSize(QSize(14, 14))
        self.btn_copy.setFixedSize(24, 24)
        self.btn_copy.setToolTip("Copy to Clipboard")
        self.btn_copy.clicked.connect(self.copy_to_clipboard)
        self.btn_copy.setStyleSheet("""
            QPushButton:hover {
                color: white;
            }
        """)
        
        header_layout.addWidget(header_label)
        header_layout.addStretch()
        header_layout.addWidget(self.btn_copy)
        layout.addLayout(header_layout)
        
        # Text
        self.label = QLabel(text)
        self.label.setWordWrap(True)
        self.label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.label.setStyleSheet("color: #e5e7eb; font-size: 13px; padding-left: 10px; border-left: 2px solid #4b5563;")
        layout.addWidget(self.label)
        
        # Divider
        line = QFrame()
        line.setFrameShape(QFrame.HLine)
        line.setFrameShadow(QFrame.Sunken)
        line.setStyleSheet("background-color: rgba(255, 255, 255, 0.1);")
        layout.addWidget(line)

    def copy_to_clipboard(self):
        clipboard = QApplication.clipboard()
        clipboard.setText(self.text)
        self.btn_copy.setIcon(qta.icon('fa5s.check', color='#10b981'))
        QTimer.singleShot(2000, lambda: self.btn_copy.setIcon(qta.icon('fa5s.copy', color='#9ca3af')))

    def append_text(self, new_text):
        self.text += " " + new_text
        self.label.setText(self.text)
        
class AutoResizingTextEdit(QTextEdit):
    submit_pressed = Signal()
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setPlaceholderText("Ask about your screen or conversation, (Ctrl+Enter to Capture)")
        self.setStyleSheet("""
            QTextEdit {
                background-color: transparent;
                border: none;
                color: white;
                font-size: 14px;
                padding: 5px;
            }
        """)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.textChanged.connect(self.adjust_height)
        self.setFixedHeight(40)
        
    def adjust_height(self):
        doc_height = self.document().size().height()
        new_height = min(max(40, int(doc_height + 10)), 150) # Min 40, Max 150
        self.setFixedHeight(new_height)
        
    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Return and not event.modifiers():
            self.submit_pressed.emit()
        else:
            super().keyPressEvent(event)

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        
        # Ensure resources dir exists
        if not os.path.exists("resources"):
            os.makedirs("resources")
        
        # Generate Icons for CSS
        qta.icon('fa5s.chevron-down', color='#d1d5db').pixmap(16, 16).save("resources/chevron-down.png")
        
        load_config()
        
        # Window Flags
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_AlwaysShowToolTips, True) # Ensure tooltips show even if inactive
        
        # Initial Compact Size
        self.compact_height = 130 # Reverted to 130px
        self.expanded_height = 500 # Changed to 500px
        self.resize(550, self.compact_height)
        self.is_expanded = False
        
        # Stealth
        self.setup_stealth()

        # Layout
        self.central_widget = QWidget()
        self.central_widget.setObjectName("CentralWidget")
        self.setCentralWidget(self.central_widget)
        
        self.main_layout = QVBoxLayout(self.central_widget)
        self.main_layout.setContentsMargins(10, 10, 10, 10) # Reverted margins
        self.main_layout.setSpacing(10)
        
        # Detached Control Bar (Centered)
        self.control_bar = ControlBar(self)
        self.control_bar.setSizePolicy(QSizePolicy.Fixed, QSizePolicy.Fixed)
        self.main_layout.addWidget(self.control_bar, 0, Qt.AlignHCenter)

        # Main Panel (Tabs)
        self.main_panel = QFrame()
        self.main_panel.setObjectName("MainPanel")
        self.panel_layout = QVBoxLayout(self.main_panel)
        self.panel_layout.setContentsMargins(0, 0, 0, 0)
        self.panel_layout.setSpacing(0)
        
        # Tabs
        self.tabs = QTabWidget()
        self.tabs.setObjectName("MainTabs")
        
        # Tab 1: Chat
        self.tab_chat = QWidget()
        self.chat_layout = QVBoxLayout(self.tab_chat)
        self.chat_layout.setContentsMargins(0, 0, 0, 0)
        self.chat_layout.setSpacing(0)
        
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setStyleSheet("background: transparent; border: none;")
        self.scroll_content = QWidget()
        self.scroll_layout = QVBoxLayout(self.scroll_content)
        self.scroll_layout.addStretch()
        self.scroll_area.setWidget(self.scroll_content)
        self.chat_layout.addWidget(self.scroll_area)
        
        # Loading Animation (Dynamic, not added initially)
        self.loading_dots = None
        
        self.tabs.addTab(self.tab_chat, "Chat")

        # Tab 2: Transcription
        self.tab_transcription = QWidget()
        self.trans_layout = QVBoxLayout(self.tab_transcription)
        self.trans_layout.setContentsMargins(0, 0, 0, 0)
        
        # Use ScrollArea for Transcription too
        self.trans_scroll_area = QScrollArea()
        self.trans_scroll_area.setWidgetResizable(True)
        self.trans_scroll_area.setStyleSheet("background: transparent; border: none;")
        self.trans_scroll_content = QWidget()
        self.trans_scroll_layout = QVBoxLayout(self.trans_scroll_content)
        self.trans_scroll_layout.addStretch()
        self.trans_scroll_area.setWidget(self.trans_scroll_content)
        self.trans_layout.addWidget(self.trans_scroll_area)
        
        self.tabs.addTab(self.tab_transcription, "Transcription")
        
        # Hide tabs initially (Compact Mode)
        self.tabs.hide()
        self.panel_layout.addWidget(self.tabs, 1) # Stretch factor 1

        # Input Area (Always Visible, below Tabs)
        self.input_container = QFrame()
        self.input_container.setObjectName("InputContainer")
        self.panel_layout.addWidget(self.input_container, 0) # Stretch factor 0
        self.input_layout = QVBoxLayout(self.input_container) # Vertical layout for text + toolbar
        self.input_layout.setContentsMargins(10, 10, 10, 10)
        self.input_layout.setSpacing(5)
        
        # Text Edit
        self.input_field = AutoResizingTextEdit()
        self.input_field.submit_pressed.connect(self.handle_input)
        self.input_layout.addWidget(self.input_field)
        
        # Toolbar (Model Chip + Send)
        self.toolbar_layout = QHBoxLayout()
        self.toolbar_layout.setContentsMargins(0, 0, 0, 0)
        
        # Model Chip
        provider = config.get('active_provider', 'gemini')
        model = config['providers'][provider].get('model', 'Unknown')
        # Shorten model name for display if needed
        display_model = model.replace("gemini-", "").replace("llama", "Llama ")
        
        self.model_chip_widget = QWidget()
        self.model_chip_widget.setStyleSheet("""
            QWidget {
                background-color: rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }
            QWidget:hover {
                background-color: rgba(255, 255, 255, 0.15);
            }
        """)
        self.model_chip_layout = QHBoxLayout(self.model_chip_widget)
        self.model_chip_layout.setContentsMargins(10, 4, 10, 4)
        self.model_chip_layout.setSpacing(8)
        
        self.lbl_model_icon = QLabel()
        self.lbl_model_icon.setPixmap(qta.icon('fa5s.robot', color='#d1d5db').pixmap(14, 14))
        self.lbl_model_icon.setStyleSheet("background: transparent; border: none;")
        
        self.lbl_model_name = QLabel(display_model)
        self.lbl_model_name.setStyleSheet("color: #d1d5db; font-size: 12px; font-weight: bold; background: transparent; border: none;")
        
        self.lbl_model_arrow = QLabel()
        self.lbl_model_arrow.setPixmap(QIcon("resources/chevron-down.png").pixmap(10, 10))
        self.lbl_model_arrow.setStyleSheet("background: transparent; border: none;")
        
        self.model_chip_layout.addWidget(self.lbl_model_icon)
        self.model_chip_layout.addWidget(self.lbl_model_name)
        self.model_chip_layout.addWidget(self.lbl_model_arrow)
        
        # Make it clickable
        self.model_chip_widget.setCursor(Qt.PointingHandCursor)
        self.model_chip_widget.mousePressEvent = lambda e: self.show_model_selector()
        
        self.toolbar_layout.addWidget(self.model_chip_widget)
        # Prompt Mode Buttons
        self.prompt_buttons_layout = QHBoxLayout()
        self.prompt_buttons_layout.setSpacing(5)
        self.toolbar_layout.addLayout(self.prompt_buttons_layout)
        
        self.refresh_prompt_buttons()
        
        self.toolbar_layout.addStretch()
        
        # Send Button
        self.btn_send = QPushButton()
        self.btn_send.setIcon(qta.icon('fa5s.paper-plane', color='#d1d5db'))
        self.btn_send.setIconSize(QSize(16, 16))
        self.btn_send.setFixedSize(32, 32)
        self.btn_send.setToolTip("Send")
        self.btn_send.clicked.connect(self.handle_input)
        self.btn_send.setStyleSheet("""
            QPushButton {
                background-color: rgba(255, 255, 255, 0.05);
                border-radius: 16px;
                color: #d1d5db;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            QPushButton:hover {
                background-color: rgba(37, 99, 235, 0.5); /* Blue tint on hover */
                color: white;
                border: 1px solid rgba(37, 99, 235, 0.8);
            }
        """)
        self.toolbar_layout.addWidget(self.btn_send)
        
        self.input_layout.addLayout(self.toolbar_layout)
        
        self.panel_layout.addWidget(self.input_container)
        
        # Add Main Panel to Layout
        self.main_layout.addWidget(self.main_panel)

        # Shadow for Main Panel
        panel_shadow = QGraphicsDropShadowEffect(self)
        panel_shadow.setBlurRadius(20)
        panel_shadow.setColor(QColor(0, 0, 0, 100))
        panel_shadow.setOffset(0, 8)
        self.main_panel.setGraphicsEffect(panel_shadow)

        # Styling
        self.apply_styles()

        # Workers
        self.ai_worker = AIWorker()
        self.ai_worker.response_ready.connect(self.add_ai_message)
        self.ai_worker.transcription_ready.connect(self.add_transcription)
        self.ai_worker.start()

        self.audio_worker = AudioWorker()
        self.audio_worker.recording_status.connect(self.update_record_btn)
        self.audio_worker.audio_saved.connect(self.handle_audio_saved)
        self.audio_worker.audio_chunk_ready.connect(self.handle_audio_chunk)

        # Native Hotkeys
        self.hotkey_ids = {}
        self.register_native_hotkeys()
        
        # Global Shortcuts (Qt)
        self.shortcut_toggle = QShortcut(QKeySequence("Ctrl+T"), self)
        self.shortcut_toggle.activated.connect(self.toggle_expansion)
        
        self.shortcut_close = QShortcut(QKeySequence("Ctrl+W"), self)
        self.shortcut_close.activated.connect(self.close_app)
        
        self.shortcut_record = QShortcut(QKeySequence("Ctrl+R"), self)
        self.shortcut_record.activated.connect(self.toggle_recording)
        
        self.shortcut_settings = QShortcut(QKeySequence("Ctrl+,"), self)
        self.shortcut_settings.activated.connect(self.open_settings)
        
        self.old_pos = None
        self.is_visible = True
        self.current_transcript_item = None
        self.last_menu_close_time = 0

    def show_model_selector(self):
        # Debounce
        if time.time() - self.last_menu_close_time < 0.2:
            return

        # Create a menu with available models
        menu = StealthMenu(self)
        menu.aboutToHide.connect(self._update_menu_close_time)
        menu.setStyleSheet("""
            QMenu {
                background-color: rgba(20, 20, 20, 0.95);
                color: #e5e7eb;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 5px 0;
            }
            QMenu::item {
                padding: 6px 25px;
                border-radius: 4px;
                margin: 2px 5px;
            }
            QMenu::item:selected {
                background-color: rgba(255, 255, 255, 0.1);
            }
            QMenu::separator {
                height: 1px;
                background: rgba(255, 255, 255, 0.1);
                margin: 5px 0;
            }
        """)
        
        # --- Gemini Models ---
        gemini_menu = StealthMenu(menu)
        gemini_menu.setTitle("Gemini")
        menu.addMenu(gemini_menu)
        
        gemini_menu.setIcon(qta.icon('fa5b.google', color='#d1d5db'))
        # Apply same style to submenu
        gemini_menu.setStyleSheet(menu.styleSheet())
        
        gemini_models = ["gemini-3-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
        current_gemini = config["providers"]["gemini"].get("model", "gemini-2.5-flash")
        
        for model in gemini_models:
            action = gemini_menu.addAction(model)
            if model == current_gemini and config.get("active_provider") == "gemini":
                action.setCheckable(True)
                action.setChecked(True)
            action.triggered.connect(lambda checked, m=model: self.switch_model("gemini", m))
            
        # --- Ollama Models ---
        ollama_menu = StealthMenu(menu)
        ollama_menu.setTitle("Ollama")
        menu.addMenu(ollama_menu)
        
        ollama_menu.setIcon(qta.icon('fa5s.server', color='#d1d5db'))
        ollama_menu.setStyleSheet(menu.styleSheet())
        
        # Use cached models from config, NO network call here
        ollama_models = config["providers"]["ollama"].get("cached_models", [])
        current_ollama = config["providers"]["ollama"].get("model", "llama3")
        
        if not ollama_models:
            ollama_models = [current_ollama] # Fallback
            
        for model in ollama_models:
            action = ollama_menu.addAction(model)
            if model == current_ollama and config.get("active_provider") == "ollama":
                action.setCheckable(True)
                action.setChecked(True)
            action.triggered.connect(lambda checked, m=model: self.switch_model("ollama", m))
            
        menu.addSeparator()
        action_settings = menu.addAction("Configure Providers...")
        action_settings.setIcon(qta.icon('fa5s.cog', color='#d1d5db'))
        action_settings.triggered.connect(self.open_settings)
        
        # Show relative to the button (chip widget now)
        # pos = self.btn_model.mapToGlobal(QPoint(0, 0))
        # menu.exec(QPoint(pos.x(), pos.y() - menu.sizeHint().height() - 5)) # Show above button
        
        # Use popup for better behavior? exec is fine if we debounce.
        # Align with chip
        pos = self.model_chip_widget.mapToGlobal(QPoint(0, 0))
        menu.exec(QPoint(pos.x(), pos.y() - menu.sizeHint().height() - 5))

    def _update_menu_close_time(self):
        self.last_menu_close_time = time.time()

    def refresh_prompt_buttons(self):
        # Clear existing buttons
        while self.prompt_buttons_layout.count():
            item = self.prompt_buttons_layout.takeAt(0)
            widget = item.widget()
            if widget:
                widget.deleteLater()
        
        # Add buttons for each mode
        modes = config["prompts"]["modes"]
        for mode_name in modes:
            btn = QPushButton(mode_name)
            btn.setCursor(Qt.PointingHandCursor)
            btn.setStyleSheet("""
                QPushButton {
                    background-color: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    color: #9ca3af;
                    padding: 4px 10px;
                    font-size: 11px;
                }
                QPushButton:hover {
                    background-color: rgba(255, 255, 255, 0.15);
                    color: white;
                }
            """)
            btn.clicked.connect(lambda checked, m=mode_name: self.activate_prompt_mode(m))
            self.prompt_buttons_layout.addWidget(btn)
            
        # Add Custom Prompt Button
        btn_add = QPushButton()
        btn_add.setIcon(qta.icon('fa5s.plus', color='#9ca3af'))
        btn_add.setIconSize(QSize(10, 10))
        btn_add.setFixedSize(24, 24)
        btn_add.setToolTip("Add Custom Prompt")
        btn_add.setCursor(Qt.PointingHandCursor)
        btn_add.setStyleSheet("""
            QPushButton {
                background-color: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.15);
            }
        """)
        btn_add.clicked.connect(self.add_custom_prompt)
        self.prompt_buttons_layout.addWidget(btn_add)

    def activate_prompt_mode(self, mode_name):
        prompt_text = config["prompts"]["modes"].get(mode_name)
        if prompt_text:
            config["prompts"]["system"] = prompt_text
            config["active_mode"] = mode_name # Track active mode
            # Visual feedback (optional, maybe toast?)
            print(f"Activated mode: {mode_name}")
            
            # Auto-send if there is input or just to confirm mode switch
            # User requested: "querry off what the prompt represents is sent out automatically"
            # We will trigger handle_input. If input is empty, handle_input usually does nothing.
            # We might want to force a send if the user wants "auto send". 
            # But sending empty input is useless. 
            # If input is empty, we'll just set the mode. 
            # If input has text, we send it.
            if self.input_field.toPlainText().strip():
                self.handle_input()
            else:
                # Maybe show a small overlay/toast saying "Mode: X Activated"
                self.add_ai_message(f"**System**: Switched to *{mode_name}* mode.")

    def add_custom_prompt(self):
        # Custom Dialog for adding prompt
        dialog = QDialog(self)
        dialog.setWindowTitle("Add Custom Prompt")
        dialog.setFixedSize(400, 300)
        
        # Stealth
        try:
            hwnd = int(dialog.winId())
            WDA_EXCLUDEFROMCAPTURE = 0x00000011
            user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
        except Exception:
            pass

        dialog.setStyleSheet("""
            QDialog {
                background-color: #1a1a1a;
                color: #e5e7eb;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
            }
            QLabel {
                color: #d1d5db;
                font-size: 14px;
                background: transparent;
            }
            QLineEdit, QTextEdit {
                background-color: rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: #e5e7eb;
                padding: 8px;
            }
            QPushButton {
                background-color: rgba(255, 255, 255, 0.1);
                color: #e5e7eb;
                border-radius: 6px;
                padding: 8px 16px;
                border: 1px solid rgba(255, 255, 255, 0.05);
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.2);
                color: white;
            }
        """)
        
        layout = QVBoxLayout(dialog)
        
        layout.addWidget(QLabel("Prompt Name (e.g., 'Creative'):"))
        name_input = QLineEdit()
        layout.addWidget(name_input)
        
        layout.addWidget(QLabel("System Prompt:"))
        prompt_input = QTextEdit()
        layout.addWidget(prompt_input)
        
        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)
        
        if dialog.exec() == QDialog.Accepted:
            name = name_input.text().strip()
            prompt = prompt_input.toPlainText().strip()
            
            if name and prompt:
                config["prompts"]["modes"][name] = prompt
                save_config()
                self.refresh_prompt_buttons()

    def switch_model(self, provider, model_name):
        # Validation
        if provider == "gemini":
            if not os.environ.get("GEMINI_API_KEY"):
                QMessageBox.warning(self, "Setup Required", "Gemini API Key is missing. Please configure it in Settings.")
                self.open_settings()
                return
            config["providers"]["gemini"]["model"] = model_name
            
        elif provider == "ollama":
            # Check if host is reachable? (Optional, maybe just check if host is set)
            if not config["providers"]["ollama"].get("host"):
                QMessageBox.warning(self, "Setup Required", "Ollama Host URL is missing. Please configure it in Settings.")
                self.open_settings()
                return
            config["providers"]["ollama"]["model"] = model_name

        self.set_active_provider(provider)
        
        # Update Button Text
        display_model = model_name.replace("gemini-", "").replace("llama", "Llama ")
        # self.btn_model.setText(f" {display_model} ▼")
        # self.btn_model.setIcon(qta.icon('fa5s.robot', color='#d1d5db'))
        self.lbl_model_name.setText(display_model)

    def set_active_provider(self, provider):
        config["active_provider"] = provider
        save_config()
        # Text update handled in switch_model or init, but if called directly:
        model = config['providers'][provider].get('model', 'Unknown')
        display_model = model.replace("gemini-", "").replace("llama", "Llama ")
        # self.btn_model.setText(f" {display_model} ▼")
        # self.btn_model.setIcon(qta.icon('fa5s.robot', color='#d1d5db'))
        self.lbl_model_name.setText(display_model)

    def setup_stealth(self):
        try:
            hwnd = int(self.winId())
            WDA_EXCLUDEFROMCAPTURE = 0x00000011
            user32.SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
        except Exception as e:
            print(f"Stealth Error: {e}")

    def apply_styles(self):
        self.setStyleSheet("""
            #CentralWidget {
                background: transparent;
            }
            #ControlBar {
                background-color: rgba(0, 0, 0, 0.6);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px; /* Rectangular */
            }
            #MainPanel {
                background-color: rgba(0, 0, 0, 0.75);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 8px; /* Rectangular */
            }
            #InputContainer {
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                background-color: rgba(0, 0, 0, 0.2);
                border-bottom-left-radius: 8px;
                border-bottom-right-radius: 8px;
            }
            QTabWidget::pane {
                border: none;
                background: transparent;
            }
            QTabBar::tab {
                background: transparent;
                color: #9ca3af;
                padding: 8px 16px;
                border-bottom: 2px solid transparent;
                font-weight: bold;
            }
            QTabBar::tab:selected {
                color: white;
                border-bottom: 2px solid #2563eb;
            }
            QTabBar::tab:hover {
                color: white;
                background: rgba(255, 255, 255, 0.05);
            }
            QPushButton {
                background-color: transparent;
                border-radius: 6px; /* Rectangular */
                color: #d1d5db;
                font-size: 16px;
            }
            QPushButton:hover {
                background-color: rgba(255, 255, 255, 0.1);
                color: white;
            }
            #BtnClose:hover {
                background-color: rgba(239, 68, 68, 0.2);
                color: #f87171;
            }
            QLineEdit {
                background-color: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 4px; /* Rectangular */
                color: white;
                padding: 0 10px;
            }
            QLineEdit:focus {
                border: 1px solid rgba(37, 99, 235, 0.5);
                background-color: rgba(255, 255, 255, 0.1);
            }
            QScrollBar:vertical {
                border: none;
                background: transparent;
                width: 6px;
                margin: 0px;
            }
            QScrollBar::handle:vertical {
                background: rgba(255, 255, 255, 0.2);
                min-height: 20px;
                border-radius: 3px;
            }
            QScrollBar::handle:vertical:hover {
                background: rgba(255, 255, 255, 0.3);
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
            }
            QToolTip {
                background-color: #1f2937;
                color: #f3f4f6;
                border: 1px solid #4b5563;
                border-radius: 4px;
                padding: 4px;
                font-size: 12px;
            }
        """)

    def register_native_hotkeys(self):
        self.hotkey_ids = {
            1: self.on_hotkey_capture,
            2: self.toggle_visibility_safe,
            3: lambda: self.move_window(0, -20),
            4: lambda: self.move_window(0, 20),
            5: lambda: self.move_window(-20, 0),
            6: lambda: self.move_window(20, 0)
        }
        
        hwnd = int(self.winId())
        
        # RegisterHotKey(hwnd, id, modifiers, vk)
        # Check return values
        if not user32.RegisterHotKey(hwnd, 1, MOD_CONTROL, VK_RETURN):
            print("Failed to register Ctrl+Enter")
        
        if not user32.RegisterHotKey(hwnd, 2, MOD_CONTROL, VK_OEM_5):
            print("Failed to register Ctrl+\\")
            # Try alternative for US keyboards if standard fails, though VK_OEM_5 is standard
            # 0xDC is standard.
        
        user32.RegisterHotKey(hwnd, 3, MOD_CONTROL, VK_UP)
        user32.RegisterHotKey(hwnd, 4, MOD_CONTROL, VK_DOWN)
        user32.RegisterHotKey(hwnd, 5, MOD_CONTROL, VK_LEFT)
        user32.RegisterHotKey(hwnd, 6, MOD_CONTROL, VK_RIGHT)

    def nativeEvent(self, eventType, message):
        if eventType == b'windows_generic_MSG':
            msg = ctypes.cast(int(message), ctypes.POINTER(wintypes.MSG)).contents
            if msg.message == WM_HOTKEY:
                hotkey_id = msg.wParam
                if hotkey_id in self.hotkey_ids:
                    self.hotkey_ids[hotkey_id]()
                    return True, 0
        return super().nativeEvent(eventType, message)

    def move_window(self, dx, dy):
        self.move(self.x() + dx, self.y() + dy)

    def on_hotkey_capture(self):
        QTimer.singleShot(0, self.take_screenshot)

    def toggle_visibility_safe(self):
        QTimer.singleShot(0, self.toggle_visibility)

    def toggle_visibility(self):
        if self.isVisible():
            self.hide()
            self.is_visible = False
        else:
            self.show()
            self.is_visible = True

    def toggle_expansion(self):
        if self.is_expanded:
            self.collapse_window()
        else:
            self.expand_window()

    def expand_window(self):
        if not self.is_expanded:
            self.is_expanded = True
            self.tabs.show()
            self.control_bar.btn_toggle.setIcon(qta.icon('fa5s.chevron-up', color='#d1d5db')) # Show Collapse icon
            
            # Animate Height
            self.anim = QPropertyAnimation(self, b"size")
            self.anim.setDuration(300)
            self.anim.setStartValue(self.size())
            self.anim.setEndValue(QSize(self.width(), self.expanded_height))
            self.anim.setEasingCurve(QEasingCurve.OutCubic)
            self.anim.start()

    def collapse_window(self):
        if self.is_expanded:
            self.is_expanded = False
            self.tabs.hide()
            self.control_bar.btn_toggle.setIcon(qta.icon('fa5s.chevron-down', color='#d1d5db')) # Show Expand icon
            
            # Animate Height
            self.anim = QPropertyAnimation(self, b"size")
            self.anim.setDuration(300)
            self.anim.setStartValue(self.size())
            self.anim.setEndValue(QSize(self.width(), self.compact_height))
            self.anim.setEasingCurve(QEasingCurve.OutCubic)
            self.anim.start()

    def handle_input(self):
        text = self.input_field.toPlainText().strip()
        if not text: return
        
        self.expand_window()
        self.add_user_message(text)
        self.input_field.clear()
        
        # Add loading dots to end (Create new instance)
        if self.loading_dots:
            self.loading_dots.stop()
            self.loading_dots.deleteLater()
            
        self.loading_dots = LoadingDots(self.scroll_content)
        self.scroll_layout.addWidget(self.loading_dots)
        self.loading_dots.start()
        
        # Scroll to bottom after layout update
        QTimer.singleShot(10, self.scroll_to_bottom)
        
        self.ai_worker.queue.put({
            'action': 'chat',
            'text': text
        })

    def add_user_message(self, text):
        bubble = ChatBubble(text, is_user=True)
        self.scroll_layout.addWidget(bubble)
        self.scroll_to_bottom()

    def add_ai_message(self, text):
        print(f"DEBUG: add_ai_message called with text len={len(text)}")
        self.expand_window()
        
        if self.loading_dots:
            print("DEBUG: Stopping loading dots")
            self.loading_dots.stop()
            self.loading_dots.deleteLater()
            self.loading_dots = None
        
        bubble = ChatBubble(text, is_user=False)
        self.scroll_layout.addWidget(bubble)
        
        # Scroll to the top of the new bubble
        # We use a slight delay to ensure layout has updated
        QTimer.singleShot(10, lambda: self.scroll_to_widget(bubble))

    def scroll_to_widget(self, widget):
        # Scroll such that the widget is at the top (or visible)
        # ensureWidgetVisible ensures it's visible. To force top, we might need manual calculation.
        # But ensureWidgetVisible is usually good enough if the widget is large.
        # If we want to strictly scroll to top:
        self.scroll_area.verticalScrollBar().setValue(widget.y())

    def add_user_message(self, text):
        bubble = ChatBubble(text, is_user=True)
        self.scroll_layout.addWidget(bubble)
        self.scroll_to_bottom()

    def handle_audio_saved(self, path):
        # Optional: Handle full recording save if needed
        pass

    def handle_audio_chunk(self, audio_bytes):
        self.expand_window()
        self.tabs.setCurrentIndex(1) # Switch to Transcription tab
        
        self.ai_worker.queue.put({
            'action': 'transcribe_chunk',
            'audio_bytes': audio_bytes
        })

    def add_transcription(self, text):
        if self.current_transcript_item:
            self.current_transcript_item.append_text(text)
        else:
            item = TranscriptionItem(text)
            self.current_transcript_item = item
            self.trans_scroll_layout.addWidget(item)
            
        # Scroll to bottom of transcription
        QTimer.singleShot(10, lambda: self.trans_scroll_area.verticalScrollBar().setValue(
            self.trans_scroll_area.verticalScrollBar().maximum()
        ))

    def scroll_to_bottom(self):
        # Increased delay to ensure layout has fully updated (especially with Markdown/Images)
        QTimer.singleShot(100, lambda: self.scroll_area.verticalScrollBar().setValue(
            self.scroll_area.verticalScrollBar().maximum()
        ))

    def toggle_recording(self):
        self.audio_worker.toggle_recording()

    def update_record_btn(self, is_recording):
        if is_recording:
            self.control_bar.btn_record.setStyleSheet("color: #ef4444; background-color: rgba(255,0,0,0.1);")
            self.control_bar.btn_record.setIcon(qta.icon('fa5s.microphone', color='#ef4444'))
            self.current_transcript_item = None # Start new transcription block
        else:
            self.control_bar.btn_record.setStyleSheet("")
            self.control_bar.btn_record.setIcon(qta.icon('fa5s.microphone', color='#d1d5db'))

    def take_screenshot(self):
        try:
            screenshot = ImageGrab.grab()
            # No longer saving to disk for stealth/cleanliness
            
            self.expand_window()
            self.tabs.setCurrentIndex(0) # Switch to Chat tab
            self.add_user_message("📸 Screenshot taken. Analyzing...")
            
            # Add loading dots (Fix for NoneType error)
            if self.loading_dots:
                self.loading_dots.stop()
                self.loading_dots.deleteLater()
                
            self.loading_dots = LoadingDots(self.scroll_content)
            self.scroll_layout.addWidget(self.loading_dots)
            self.loading_dots.start()
            QTimer.singleShot(10, self.scroll_to_bottom)
            
            self.ai_worker.queue.put({
                'action': 'chat',
                'text': "Analyze this screenshot.",
                'image': screenshot # Pass object directly
            })
        except Exception as e:
            print(f"Screenshot Error: {e}")
            if self.loading_dots:
                self.loading_dots.stop()

    def open_settings(self):
        dialog = SettingsDialog(self)
        dialog.exec()
        # Refresh prompt buttons in case of deletion/changes
        self.refresh_prompt_buttons()

    def close_app(self):
        print("Closing app...")
        self.ai_worker.stop()
        self.audio_worker.stop()
        
        # Unregister Hotkeys
        hwnd = int(self.winId())
        for hk_id in self.hotkey_ids:
            user32.UnregisterHotKey(hwnd, hk_id)
        self.close()
        sys.exit(0)

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
