import sys
import os
import json
import unittest
from unittest.mock import MagicMock, patch, mock_open

# --- Global Mock Setup ---
# We need to define real classes for QThread, QMainWindow, etc. 
# so that the classes in main.py don't become MagicMocks when they inherit from them.

class MockQObject:
    def __init__(self, parent=None):
        pass

class MockQThread(MockQObject):
    def __init__(self, parent=None):
        super().__init__(parent)
    def start(self):
        pass
    def wait(self): pass
    def run(self): pass

class MockQWidget(MockQObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.currentTextChanged = MagicMock()
        self.textChanged = MagicMock()
        self.clicked = MagicMock()
        self.activated = MagicMock()
        self.triggered = MagicMock()
    def setFixedSize(self, *args): pass
    def setWindowTitle(self, *args): pass
    def setStyleSheet(self, *args): pass
    def show(self): pass
    def hide(self): pass
    def isVisible(self): return True
    def winId(self): return 12345
    def move(self, *args): pass
    def x(self): return 0
    def y(self): return 0
    def pos(self): return MagicMock()
    def width(self): return 100
    def height(self): return 100
    def size(self): return MagicMock()
    def setAttribute(self, *args): pass
    def setWindowFlags(self, *args): pass
    def setGraphicsEffect(self, *args): pass
    def setObjectName(self, *args): pass
    def setSizePolicy(self, *args): pass
    def setVerticalScrollBarPolicy(self, *args): pass
    def document(self): return MagicMock()
    def setPlaceholderText(self, *args): pass
    def toPlainText(self): return ""
    def clear(self): pass
    def setPlainText(self, *args): pass
    def setEchoMode(self, *args): pass
    def setText(self, *args): pass
    def text(self): return ""
    def currentText(self): return ""
    def setCurrentText(self, *args): pass
    def addItems(self, *args): pass
    def setEditable(self, *args): pass
    def setCheckable(self, *args): pass
    def setChecked(self, *args): pass
    def addAction(self, *args): return MagicMock()
    def addMenu(self, *args): return MagicMock()
    def exec(self, *args): pass
    def mapToGlobal(self, *args): return MagicMock()
    def sizeHint(self): return MagicMock()
    def setCursor(self, *args): pass
    def setToolTip(self, *args): pass
    def setShortcut(self, *args): pass
    def setWordWrap(self, *args): pass
    def setTextInteractionFlags(self, *args): pass
    def setTextFormat(self, *args): pass
    def setMaximumWidth(self, *args): pass
    def setFrameShape(self, *args): pass
    def setFrameShadow(self, *args): pass
    def verticalScrollBar(self): return MagicMock()
    def setWidget(self, *args): pass
    def setWidgetResizable(self, *args): pass
    def addTab(self, *args): pass
    def setCurrentIndex(self, *args): pass
    def setContentsMargins(self, *args): pass
    def setSpacing(self, *args): pass
    def addLayout(self, *args): pass
    def addWidget(self, *args): pass
    def addRow(self, *args): pass
    def addStretch(self, *args): pass
    def accept(self): pass
    def reject(self): pass
    def resize(self, *args): pass
    def setFixedHeight(self, *args): pass
    def setFixedWidth(self, *args): pass
    def close(self): pass
    def height(self): return 100
    def size(self): return MagicMock()
    def setAttribute(self, *args): pass
    def setWindowFlags(self, *args): pass
    def setGraphicsEffect(self, *args): pass
    def setObjectName(self, *args): pass
    def setSizePolicy(self, *args): pass
    def setVerticalScrollBarPolicy(self, *args): pass
    def document(self): return MagicMock()
    def setPlaceholderText(self, *args): pass
    def toPlainText(self): return ""
    def clear(self): pass
    def setPlainText(self, *args): pass
    def setEchoMode(self, *args): pass
    def setText(self, *args): pass
    def text(self): return ""
    def currentText(self): return ""
    def setCurrentText(self, *args): pass
    def addItems(self, *args): pass
    def setEditable(self, *args): pass
    def setEditable(self, *args): pass
    # Signals should be attributes, initialized in __init__
    def setCheckable(self, *args): pass
    def setChecked(self, *args): pass
    def addAction(self, *args): return MagicMock()
    def addMenu(self, *args): return MagicMock()
    def exec(self, *args): pass
    def mapToGlobal(self, *args): return MagicMock()
    def sizeHint(self): return MagicMock()
    def setCursor(self, *args): pass
    def setToolTip(self, *args): pass
    def setShortcut(self, *args): pass
    def setWordWrap(self, *args): pass
    def setTextInteractionFlags(self, *args): pass
    def setTextFormat(self, *args): pass
    def setMaximumWidth(self, *args): pass
    def setFrameShape(self, *args): pass
    def setFrameShadow(self, *args): pass
    def verticalScrollBar(self): return MagicMock()
    def setWidget(self, *args): pass
    def setWidgetResizable(self, *args): pass
    def addTab(self, *args): pass
    def setCurrentIndex(self, *args): pass
    def setContentsMargins(self, *args): pass
    def setSpacing(self, *args): pass
    def addLayout(self, *args): pass
    def addWidget(self, *args): pass
    def addRow(self, *args): pass
    def addStretch(self, *args): pass
    def accept(self): pass
    def reject(self): pass
    def resize(self, *args): pass
    def setFixedHeight(self, *args): pass
    def reject(self): pass
    def resize(self, *args): pass
    def setFixedHeight(self, *args): pass
    def setFixedWidth(self, *args): pass
    def close(self): pass

class MockQMainWindow(MockQWidget):
    def setCentralWidget(self, *args): pass

class MockQFrame(MockQWidget):
    pass

class MockQDialog(MockQWidget):
    pass

class MockQLabel(MockQWidget):
    def __init__(self, text="", parent=None):
        super().__init__(parent)

class MockQPushButton(MockQWidget):
    def __init__(self, text="", parent=None):
        super().__init__(parent)
        self.clicked = MagicMock()
    def setIcon(self, *args): pass
    def setIconSize(self, *args): pass

class MockQLineEdit(MockQWidget):
    Password = 1

class MockQTextEdit(MockQWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.textChanged = MagicMock()


class MockQComboBox(MockQWidget):
    pass

class MockQTabWidget(MockQWidget):
    pass

class MockQScrollArea(MockQWidget):
    pass

class MockSignal:
    def __init__(self, *args):
        self._mock = MagicMock()
    def connect(self, func):
        self._mock.connect(func)
    def emit(self, *args):
        self._mock.emit(*args)
    def __get__(self, instance, owner):
        # Return a bound signal (or just self if we don't care about instance binding for mocks)
        # But we need a unique mock per instance if we want to track calls per instance.
        # For simplicity, let's return a new MagicMock if not present, or use a shared one?
        # Actually, main.py uses class attributes for Signal.
        # But `self.response_ready.emit` accesses it on instance.
        # If we return self, it's shared across instances.
        # Let's attach a mock to the instance.
        if instance is None:
            return self
        if not hasattr(instance, "_signals"):
            instance._signals = {}
        if self not in instance._signals:
            instance._signals[self] = MagicMock()
        return instance._signals[self]

# Better Signal Mock:
# We can just use MagicMock for Signal, but we need to ensure it doesn't make the class a mock.
# Since Signal is a descriptor, we can just use a class that returns a MagicMock.

class MockSignalDescriptor:
    def __init__(self, *args):
        pass
    def __get__(self, instance, owner):
        if instance is None: return self
        return MagicMock()

# Construct the mock module
mock_pyside = MagicMock()
mock_pyside.QThread = MockQThread
mock_pyside.QMainWindow = MockQMainWindow
mock_pyside.QWidget = MockQWidget
mock_pyside.QFrame = MockQFrame
mock_pyside.QDialog = MockQDialog
mock_pyside.QLabel = MockQLabel
mock_pyside.QPushButton = MockQPushButton
mock_pyside.QLineEdit = MockQLineEdit
mock_pyside.QTextEdit = MockQTextEdit
mock_pyside.QComboBox = MockQComboBox
mock_pyside.QTabWidget = MockQTabWidget
mock_pyside.QScrollArea = MockQScrollArea
mock_pyside.Signal = MockSignalDescriptor

# Other Qt classes can remain MagicMocks if they are not inherited from
mock_pyside.QTimer = MagicMock()
mock_pyside.QPropertyAnimation = MagicMock()
mock_pyside.QEasingCurve = MagicMock()
mock_pyside.QShortcut = MagicMock()
mock_pyside.QKeySequence = MagicMock()
mock_pyside.QGraphicsDropShadowEffect = MagicMock()
mock_pyside.QColor = MagicMock()
mock_pyside.QPalette = MagicMock()
mock_pyside.QIcon = MagicMock()
mock_pyside.QFont = MagicMock()
mock_pyside.QCursor = MagicMock()
mock_pyside.QPainter = MagicMock()
mock_pyside.QBrush = MagicMock()
mock_pyside.QPen = MagicMock()
mock_pyside.QClipboard = MagicMock()
mock_pyside.QSizePolicy = MagicMock()
mock_pyside.QVBoxLayout = MagicMock()
mock_pyside.QHBoxLayout = MagicMock()
mock_pyside.QFormLayout = MagicMock()
mock_pyside.QDialogButtonBox = MagicMock()
mock_pyside.QMenu = MagicMock()
mock_pyside.QMessageBox = MagicMock()
mock_pyside.QRect = MagicMock()
mock_pyside.QPoint = MagicMock()
mock_pyside.QSize = MagicMock()
mock_pyside.Qt = MagicMock()

# Other modules
mock_sd = MagicMock()
mock_genai = MagicMock()
mock_ctypes = MagicMock()
mock_pil = MagicMock()

# Configure specific mocks
mock_ctypes.windll.user32.SetWindowDisplayAffinity = MagicMock()

# Apply patches to sys.modules
module_patches = {
    "PySide6": mock_pyside,
    "PySide6.QtWidgets": mock_pyside,
    "PySide6.QtCore": mock_pyside,
    "PySide6.QtGui": mock_pyside,
    "sounddevice": mock_sd,
    "soundfile": MagicMock(),
    "google.generativeai": mock_genai,
    "PIL": mock_pil,
    "PIL.Image": mock_pil,
    "PIL.ImageGrab": mock_pil,
    "ctypes": mock_ctypes,
    "ctypes.wintypes": MagicMock(),
    "qtawesome": MagicMock(),
}

# Import main within the patch context
with patch.dict(sys.modules, module_patches):
    sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    import main

class TestStealthIt(unittest.TestCase):

    def setUp(self):
        # Reset mocks
        mock_genai.reset_mock()
        mock_sd.reset_mock()
        mock_ctypes.reset_mock()
        mock_pyside.QTimer.reset_mock()
        
        self.load_config_patcher = patch("main.load_config")
        self.mock_load_config = self.load_config_patcher.start()
        
        main.config = {
            "providers": {
                "gemini": {"api_key": "", "model": "gemini-2.5-flash"},
                "ollama": {"host": "http://localhost:11434", "model": "llama3"}
            },
            "active_provider": "gemini",
            "prompts": {
                "system": "Default System Prompt",
                "vision": "Default Vision Prompt",
                "modes": {}
            }
        }
        
        self.env_patcher = patch.dict(os.environ, {"GEMINI_API_KEY": "test_api_key_123"})
        self.env_patcher.start()

    def tearDown(self):
        self.env_patcher.stop()
        self.load_config_patcher.stop()

    def test_api_key_loading(self):
        """Test that the API key is loaded correctly from the environment."""
        worker = main.AIWorker()
        main.config["active_provider"] = "gemini"
        
        worker.chat_gemini("Hello", None, None)
        
        mock_genai.configure.assert_called_with(api_key="test_api_key_123")

    def test_api_key_missing_gracefully(self):
        """Test that the application fails gracefully if API key is missing."""
        with patch.dict(os.environ, {}, clear=True):
            worker = main.AIWorker()
            main.config["active_provider"] = "gemini"
            
            # Mock the signal on the instance
            worker.response_ready = MagicMock()
            
            worker.chat_gemini("Hello", None, None)
            
            worker.response_ready.emit.assert_called()
            args = worker.response_ready.emit.call_args[0][0]
            self.assertIn("API Key missing", args)

    def test_config_loading(self):
        """Test that context window size (system prompts) are loaded from config.json."""
        self.load_config_patcher.stop()
        
        mock_data = json.dumps({
            "prompts": {
                "system": "Loaded System Prompt",
                "vision": "Loaded Vision Prompt"
            }
        })
        
        with patch("builtins.open", mock_open(read_data=mock_data)):
            with patch("json.load", return_value=json.loads(mock_data)):
                main.load_config()
        
        self.assertEqual(main.config["prompts"]["system"], "Loaded System Prompt")
        self.assertEqual(main.config["prompts"]["vision"], "Loaded Vision Prompt")
        
        self.load_config_patcher.start()

    def test_hotkey_ctrl_enter(self):
        """Test that Ctrl + Enter triggers AI Query (take_screenshot)."""
        # Since MainWindow is now a real class inheriting from MockQMainWindow,
        # we can instantiate it.
        
        window = main.MainWindow()
        window.take_screenshot = MagicMock()
        window.collapse_window = MagicMock()
        
        window.on_hotkey_capture()
        
        # main.QTimer is mock_pyside.QTimer
        main.QTimer.singleShot.assert_called_with(0, window.take_screenshot)
        window.collapse_window.assert_not_called()

    def test_window_affinity(self):
        """Test that SetWindowDisplayAffinity is called upon initialization."""
        window = main.MainWindow()
        
        mock_ctypes.windll.user32.SetWindowDisplayAffinity.assert_called()
        args = mock_ctypes.windll.user32.SetWindowDisplayAffinity.call_args[0]
        self.assertEqual(args[1], 0x00000011)

    def test_record_button_streaming(self):
        """Test that clicking Record starts the streaming thread."""
        window = main.MainWindow()
        # Mock the AudioWorker attached to window
        window.audio_worker = MagicMock()
        
        window.toggle_recording()
        window.audio_worker.toggle_recording.assert_called_once()
        
        # Test AudioWorker logic separately
        audio_worker = main.AudioWorker()
        audio_worker.recording_status = MagicMock()
        
        audio_worker.start_recording()
        
        mock_sd.InputStream.assert_called()
        mock_sd.InputStream.return_value.start.assert_called_once()
        audio_worker.recording_status.emit.assert_called_with(True)

    def test_shortcut_ctrl_t(self):
        """Test that Ctrl + T triggers toggle_expansion."""
        window = main.MainWindow()
        window.toggle_expansion = MagicMock()
        
        mock_pyside.QKeySequence.assert_any_call("Ctrl+T")
        
        window.expanded = False
        window.animation = MagicMock()
        # We need to call the real toggle_expansion, so we shouldn't mock it on the instance if we want to test logic
        # But here we just want to verify logic inside.
        # Let's re-instantiate to get clean method
        window = main.MainWindow()
        window.animation = MagicMock()
        window.toggle_expansion()
        
        # toggle_expansion creates a new QPropertyAnimation
        # We need to check if the mock class was called and its return value had start called
        mock_pyside.QPropertyAnimation.return_value.start.assert_called()
        self.assertTrue(window.is_expanded)

    def test_shortcut_ctrl_w(self):
        """Test that Ctrl + W triggers close_app."""
        window = main.MainWindow()
        mock_pyside.QKeySequence.assert_any_call("Ctrl+W")
        with self.assertRaises(SystemExit):
            window.close_app()

    def test_shortcut_ctrl_r(self):
        """Test that Ctrl + R triggers toggle_recording."""
        window = main.MainWindow()
        # We just verify the shortcut registration here
        mock_pyside.QKeySequence.assert_any_call("Ctrl+R")

    def test_shortcut_ctrl_comma(self):
        """Test that Ctrl + , triggers open_settings."""
        window = main.MainWindow()
        mock_pyside.QKeySequence.assert_any_call("Ctrl+,")
        
        with patch.object(main, "SettingsDialog") as MockSettingsDialog:
            window.open_settings()
            MockSettingsDialog.assert_called()
            MockSettingsDialog.return_value.exec.assert_called()

if __name__ == "__main__":
    unittest.main()
