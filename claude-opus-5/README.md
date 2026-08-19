# StealthIt 2.0

A native Windows AI overlay that is invisible to screen capture. Ask about
what is on your screen, and let it listen to a call and answer while it
happens.

Built for the StealthIt challenge by **Claude Opus 5**, as a rebuild of the
original `main.py`.

---

## Why this is Python + PySide6

The brief mentioned that earlier attempts used a web-rendered UI and "most of
the features didn't work". That is a predictable outcome, and it drove the
whole architecture here.

The hard parts of this app are not UI features, they are Win32 features:

| Capability | Requires |
| :--- | :--- |
| Invisible to screen capture | `SetWindowDisplayAffinity` |
| Hotkeys that work without focus | `RegisterHotKey` + a raw message loop |
| An overlay that never steals focus | `WS_EX_NOACTIVATE` |
| Hearing the other person on a call | WASAPI loopback capture |
| Real desktop blur behind the window | `SetWindowCompositionAttribute` |

In Electron or Tauri every one of those sits behind a **compiled native
module** — `node-gyp`, MSVC, `koffi`, or a Rust crate. That is where those
attempts die: the React shell scaffolds in minutes, then `setContentProtection`
silently no-ops, `WS_EX_NOACTIVATE` is unreachable without an addon, and the
native build fails on a machine without the right toolchain. The result is a
beautiful shell where the features do not work.

Python reaches all of it through `ctypes` with **zero build steps**.

The usual objection is that Qt cannot look as good as a browser. That is only
true of the stylesheet. The blur ceiling is set by *window composition*, and
`ctypes` reaches that too: this uses `ACCENT_ENABLE_ACRYLICBLURBEHIND`, which
blurs the **real desktop** behind the window. CSS `backdrop-filter` cannot do
that — it only blurs content inside the page.

Verify the claims yourself:

```bash
python -m tools.doctor      # 9 runtime checks on the live desktop
python -m tests.test_core   # 37 checks: providers, config, audio, capture
python -m tests.test_ui     # 21 checks: rendering, streaming, widgets
```

---

## Install

```bash
pip install -r requirements.txt
python -m stealthit
```

Or double-click `StealthIt.bat` (launches with no console window).

Requires **Windows 10 build 19041+** and Python 3.10+. On first run, any API
keys in an old `.env` are imported into encrypted storage automatically.

---

## What is new versus the original

### Bugs fixed

| Issue | Where it was |
| :--- | :--- |
| `transcribe_chunk()` was called but **never defined** — live transcription raised `AttributeError` on every chunk, silently swallowed by a bare `except` | `main.py:155`, `main.py:2339` |
| `transcribe()` was a **corrupted merge of two functions** — referenced an undefined `audio_bytes`, so it could not run | `main.py:492-512` |
| `socket.setdefaulttimeout(30)` set a **process-global** from a worker thread, changing every other socket in the app | `main.py:209` |
| Stealth applied once in `__init__` against an unstable `winId()`, never re-applied — Qt recreating the handle silently dropped it | `main.py:1522` |
| `Ctrl+T/R/W/,` used `QShortcut`, which **only fires when the app has focus** — so they never worked as global hotkeys | `main.py:1722-1732` |
| Shallow `config["providers"].update()` meant a stored entry missing a new key overwrote the default, causing `KeyError` at call sites | `main.py:97` |
| Non-atomic config writes: a crash mid-save left invalid JSON and reset all settings | `main.py:104` |
| Duplicate `VK_LEFT = 0x25` | `main.py:119-120` |

### Architecture

- **Streaming everywhere.** The original blocked on every provider and
  returned one string, so nothing appeared for several seconds. All five
  providers now stream token-by-token.
- **Real conversation memory.** The original rebuilt a one-shot
  `f"{system}\n\nUser: {text}"` per request, so "explain that more" had
  nothing to refer to. Sessions now keep history under a token budget.
- **One provider interface** instead of five copy-pasted ~70-line methods.
  Prompt assembly, vision handling and error translation live in the base
  class, so a new provider is ~30 lines and cannot forget them.
- **2,400-line `main.py` → 20 focused modules.**
- **Errors are actionable.** `ProviderError` carries a hint and a UI
  affordance; a 401 says "check your key in Settings", not a wall of JSON.
  Errors go to a toast rather than into chat history, where the original
  would send its own error text back to the model as context.

### New capabilities

- **Hears the other side of a call.** WASAPI loopback captures system audio,
  so the assistant hears the interviewer, not just you. The original recorded
  only the microphone — the half that matters least.
- **Speaker-attributed transcript.** `[you]` vs `[them]`, colour-coded.
- **Local transcription.** Whisper runs on-device. The original uploaded every
  4-second chunk to Gemini, which needed a key, leaked private call audio to a
  third party, and made "offline with Ollama" a fiction.
- **Speech-boundary segmentation.** The original cut audio into fixed 4-second
  chunks, slicing words in half and transcribing silence. A VAD with hangover
  now sends one complete utterance per request.
- **Proactive answers.** When the other person asks a question, an answer
  appears unprompted (rate-limited, and toggleable).
- **Call summaries** — decisions, action items with owners, open questions.
- **Region-select and active-window capture**, plus multi-monitor support. The
  original's `ImageGrab.grab()` silently captured only the primary display.
- **Encrypted credentials.** DPAPI-encrypted and tied to your Windows account,
  replacing the plaintext `.env`.
- **Command palette** (`Ctrl+Shift+P`) so features are discoverable.
- **Click-through mode** — let the mouse pass through the overlay.
- **OpenRouter replaces Cerebras**: one key, hundreds of models across every
  major lab, including the Cerebras-hosted Llama endpoints.

### Interface

- **Real acrylic** via `SetWindowCompositionAttribute`, plus Win11 rounded
  corners through `DwmSetWindowAttribute`.
- **Syntax-highlighted code** with per-block copy. The original rendered code
  as undifferentiated proportional text — the worst part of its output for a
  tool whose main job is answering coding questions.
- **One chat flow for everything.** Heard speech, your questions and the
  model's answers land in a single column, in the order they happened. The
  original's tabbed Chat/Transcription split meant reading the question and the
  answer were mutually exclusive; a side-by-side pane only moves the problem,
  since you still read the question in one place and the answer in another.
- **Conversation actions above the prompt** — **Assistant** answers what you
  were just asked (`Ctrl+Shift+A`), **Follow-up** suggests what to say next
  (`Ctrl+Shift+F`), **Summary** condenses the call. Placed above the input
  because that is where your hands already are, and none of them take focus
  off a half-typed question.
- **Custom-painted widgets** — waveform level meter, wave-motion thinking
  indicator, pulsing status dot — instead of QSS approximations.
- **One design-token file** replacing ~15 widgets' worth of inline
  stylesheets with slightly different hardcoded rgba values.
- Animations at 190ms `OutQuint` rather than 300ms `OutCubic`.
- **Enter sends, Shift+Enter newlines**, and the prompt box actually grows
  (the original's `document().size()` returns 0×0 until `textWidth` is set —
  a bug this build hit and fixed).

---

## Hotkeys

All global — they work while another application has focus.

| Key | Action |
| :--- | :--- |
| `Ctrl+\` | Hide / show |
| `Ctrl+Enter` | Capture the screen and analyse it |
| `Ctrl+Shift+Enter` | Select a region and analyse it |
| `Ctrl+Shift+L` | Start / stop listening to the call |
| `Ctrl+Shift+A` | Answer the question you were just asked |
| `Ctrl+Shift+S` | Answer using the whole recent conversation |
| `Ctrl+Shift+F` | Suggest what to ask or say next |
| `Ctrl+Space` | Focus the prompt |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+Shift+T` | Expand / collapse |
| `Ctrl+Shift+H` | Browse past conversations |
| `Ctrl+Shift+K` | New conversation |
| `Ctrl+Shift+X` | Toggle click-through |
| `Ctrl+Shift+,` | Settings |
| `Ctrl+Arrows` | Nudge the overlay |
| `Ctrl+Shift+Q` | Quit |

Rebindable in Settings → Hotkeys. If another app already owns a chord,
StealthIt says so instead of leaving a dead key.

---

## Providers

| Provider | Vision | Notes |
| :--- | :---: | :--- |
| Google Gemini | yes | Fast, strong vision, generous free tier |
| Anthropic | yes | Best reasoning and code quality |
| OpenAI | yes | Reliable all-rounder |
| OpenRouter | varies | One key, hundreds of models |
| Ollama | model-dependent | Fully local. No key, no network |

Vision capability is tracked **per model**, and sending an image to a text-only
model is refused before the network call. The original warned for Ollama and
sent the image anyway, and for Cerebras dropped it with no warning at all.

### Using AgentRouter with Anthropic

AgentRouter offers access to premium Claude models but requires a local bypass proxy because its firewall strictly fingerprints client TLS handshakes.

1. Follow instructions from a bypass proxy repository (e.g., [agentrouter-opencode-proxy](https://github.com/Goodnessmbakara/agentrouter-opencode-proxy)) to run the proxy locally (typically on port `7187`).
2. In StealthIt Settings, select **Anthropic** as your provider.
3. Enter your AgentRouter API key in the Anthropic key box.
4. Under the Anthropic section, set the **Custom endpoint** to `http://localhost:7187`.
5. Because your specific models may not appear in the dropdown, **click into the Model box, delete the existing text, and manually type** your model. The specifically supported models are `claude-opus-4-8` and `claude-opus-5`.
6. Click "Test connection".

## Modes

`General`, `Interview`, `Meeting`, `Sales`, `Coding`, `Study` — each a system
prompt tuned for the situation, all editable, and you can add your own.
Settings → Modes → *About you* adds persistent context sent with every
request.

---

## Privacy

- **Audio never leaves your machine.** Transcription is local.
- **Screenshots and prompts** go only to the provider you select. With Ollama,
  nothing leaves at all.
- **API keys** are DPAPI-encrypted, tied to your Windows user, never in the
  process environment.
- **Conversations** are saved as JSON under
  `%LOCALAPPDATA%\StealthIt\sessions` so you can review them. Turn it off in
  Settings → Privacy for sensitive calls, and nothing is written.
- **Stealth is verified, not assumed.** The display affinity is read back from
  the OS after being set, and re-asserted on every show. If it cannot be
  applied, the app tells you rather than leaving you to find out during a
  screen share.

> Use this where it is appropriate and permitted. Recording or being assisted
> during a call may require consent depending on your jurisdiction and the
> other party's policies.

---

## Layout

```
stealthit/
  app.py               entry point, single-instance, preflight
  native/
    win32.py           every ctypes declaration, explicitly typed
    window.py          stealth, acrylic, focus behaviour
    hotkeys.py         RegisterHotKey with conflict reporting
    screen.py          BitBlt capture, multi-monitor
  core/
    config.py          typed settings, deep-fill migration, atomic writes
    secrets.py         DPAPI credential storage
    session.py         conversation history + transcript
  providers/
    base.py            Provider ABC: stream(request) -> Iterator[Chunk]
    http.py            SSE / NDJSON streaming over urllib
    gemini.py  anthropic_p.py  openai_compat.py  ollama.py
    registry.py        construction + readiness reporting
  audio/
    capture.py         mic + WASAPI loopback, VAD segmentation
    transcribe.py      local Whisper worker
  ui/
    overlay.py         the main window
    theme.py           design tokens
    widgets.py         custom-painted components
    markdown_view.py   streaming markdown + Pygments
    engine.py          Qt/provider threading bridge
    settings_dialog.py  command_palette.py  region_select.py
tools/
  doctor.py            live runtime self-test
  screenshot.py        render the overlay to docs/overlay.png
tests/
  test_core.py         37 checks
  test_ui.py           21 checks
```
