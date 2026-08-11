"""
UI verification.

Builds the real Overlay against a real QApplication offscreen, renders it to a
PNG, and asserts behaviour. A UI that imports cleanly but crashes on first
paint is the classic failure of a generated desktop app, so this exercises
construction, streaming render, markdown, and the widget tree.

Run:  python -m tests.test_ui
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Must be set before QApplication so the run needs no visible desktop session.
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import stealthit.native.screen

# Mock screen capture for headless CI environments (like GitHub Actions)
if os.environ.get("GITHUB_ACTIONS"):
    from PIL import Image
    def mock_grab(x=0, y=0, w=200, h=200, *args, **kwargs):
        return Image.new("RGB", (w, h), (0, 0, 0))
    stealthit.native.screen.grab = mock_grab
    def mock_grab_monitor(m=None):
        m = m or stealthit.native.screen.monitor_under_cursor()
        return mock_grab(m.x, m.y, m.width, m.height)
    stealthit.native.screen.grab_monitor = mock_grab_monitor

results: list[tuple[str, bool, str]] = []


def check(name):
    def deco(fn):
        try:
            detail = fn() or ""
            results.append((name, True, detail))
            print(f"  [ OK ] {name}" + (f" -- {detail}" if detail else ""))
        except Exception as e:
            import traceback
            results.append((name, False, f"{type(e).__name__}: {e}"))
            print(f"  [FAIL] {name} -- {type(e).__name__}: {e}")
            traceback.print_exc(limit=4)
        return fn
    return deco


from PySide6.QtCore import QSize, Qt  # noqa: E402
from PySide6.QtGui import QPixmap  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

app = QApplication.instance() or QApplication(sys.argv)

print("\n=== markdown rendering ===")


@check("Code blocks get syntax highlighting")
def _():
    from stealthit.ui import markdown_view
    md = ("Here is the fix:\n\n"
          "```python\n"
          "def solve(items):\n"
          "    return sorted(items, key=lambda x: -x.score)\n"
          "```\n\n"
          "That sorts descending.")
    html = markdown_view.render(md)
    assert "<pre" in html, "no pre block"
    # Pygments emits inline colour styles; without them there is no
    # highlighting, which was the original's core output weakness.
    assert "color: #" in html or "color:#" in html, "no pygments colours"
    assert "def" in html
    assert "border-radius" in html, "code block not styled"
    return f"{len(html)} chars of highlighted HTML"


@check("Unterminated fence renders as code while streaming")
def _():
    from stealthit.ui import markdown_view
    partial = "Try this:\n\n```python\ndef solve(x):\n    return x"
    streamed = markdown_view.render(partial, streaming=True)
    assert "<pre" in streamed, "partial code block not rendered as code"
    assert "solve" in streamed, "partial code body lost"
    # The style must not change once the closing fence arrives, or the block
    # visibly flickers on every token.
    complete = markdown_view.render(partial + "\n```", streaming=False)
    assert "<pre" in complete
    for marker in ("border-radius", "background:"):
        assert (marker in streamed) == (marker in complete), \
            f"styling of {marker!r} differs between partial and complete"
    return "partial and complete blocks style identically"


@check("HTML in model output is escaped, not executed")
def _():
    from stealthit.ui import markdown_view
    html = markdown_view.render(
        "Use <script>alert(1)</script> and a < b in your code")
    assert "<script>" not in html, "SCRIPT TAG NOT ESCAPED"
    assert "&lt;script&gt;" in html
    assert "a &lt; b" in html, "bare < swallowed the paragraph"
    return "script tags and stray angle brackets escaped"


@check("Inline markdown: bold, italic, code, links")
def _():
    from stealthit.ui import markdown_view
    html = markdown_view.render(
        "**bold** and *italic* and `code` and "
        "[a link](https://example.com)")
    assert "<b>bold</b>" in html
    assert "<i>italic</i>" in html
    assert "<code" in html
    assert 'href="https://example.com"' in html
    return "all four inline forms"


@check("Markdown inside inline code is not re-parsed")
def _():
    from stealthit.ui import markdown_view
    html = markdown_view.render("Use `**not bold**` here")
    assert "<b>" not in html, "bold applied inside a code span"
    return "code spans protected from inline rules"


@check("Lists, headings, quotes")
def _():
    from stealthit.ui import markdown_view
    html = markdown_view.render(
        "# Title\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted")
    assert "<ul" in html and "<ol" in html
    assert html.count("<li") == 4, html.count("<li")
    assert "Title" in html
    assert "border-left" in html, "blockquote not styled"
    return "ul, ol, heading and quote all rendered"


@check("Code block extraction for copy buttons")
def _():
    from stealthit.ui import markdown_view
    md = "```python\nprint(1)\n```\n\ntext\n\n```js\nconsole.log(2)\n```"
    blocks = markdown_view.extract_code_blocks(md)
    assert len(blocks) == 2, blocks
    assert blocks[0] == ("python", "print(1)"), blocks[0]
    assert blocks[1] == ("js", "console.log(2)"), blocks[1]
    return "2 blocks with languages and bodies"


print("\n=== widgets ===")


@check("MessageBubble renders and streams")
def _():
    from stealthit.ui.widgets import MessageBubble
    bubble = MessageBubble("", is_user=False)
    for token in ("Here", " is", " `code`", " and\n\n```py\nx=1\n```"):
        bubble.append_text(token)
    bubble.finalise()
    assert "```py" in bubble.raw_text
    assert bubble.height() > 0, "bubble collapsed to zero height"
    # Finalising must produce a copy affordance for the code block.
    assert len(bubble._code_bars) == 1, \
        f"expected 1 copy bar, got {len(bubble._code_bars)}"
    return f"streamed 4 deltas, height {bubble.height()}px, 1 copy bar"


@check("Prompt box grows and Enter submits")
def _():
    from PySide6.QtCore import QEvent
    from PySide6.QtGui import QKeyEvent
    from stealthit.ui.widgets import AutoGrowTextEdit
    box = AutoGrowTextEdit("placeholder")
    box.resize(400, 40)  # give it a viewport width to wrap against
    start = box.height()
    box.setPlainText("line\n" * 6)
    grown = box.height()
    assert grown > start, f"did not grow ({start} -> {grown})"
    assert grown <= 132, f"exceeded max height: {grown}"

    fired = []
    box.submitted.connect(lambda: fired.append(True))
    box.keyPressEvent(QKeyEvent(QEvent.KeyPress, Qt.Key_Return,
                                Qt.NoModifier))
    assert fired, "Enter did not submit"
    # Shift+Enter must insert a newline instead of sending.
    fired.clear()
    box.keyPressEvent(QKeyEvent(QEvent.KeyPress, Qt.Key_Return,
                                Qt.ShiftModifier))
    assert not fired, "Shift+Enter submitted instead of newlining"
    return f"{start}px -> {grown}px; Enter sends, Shift+Enter does not"


@check("Custom-painted widgets render without error")
def _():
    from stealthit.ui.widgets import (LevelMeter, StatusDot, ThinkingIndicator)
    painted = []
    for cls, size in ((ThinkingIndicator, QSize(46, 18)),
                      (LevelMeter, QSize(90, 20)),
                      (StatusDot, QSize(10, 10))):
        widget = cls()
        widget.resize(size)
        if isinstance(widget, LevelMeter):
            widget.set_level("you", 0.4)
            widget.set_level("them", 0.7)
        if isinstance(widget, StatusDot):
            widget.set_state("listening")
        pixmap = QPixmap(size)
        pixmap.fill(Qt.transparent)
        widget.render(pixmap)   # exercises paintEvent
        assert not pixmap.isNull()
        painted.append(cls.__name__)
    return ", ".join(painted)


@check("Fuzzy command search ranks sensibly")
def _():
    from stealthit.ui.command_palette import fuzzy_score
    assert fuzzy_score("", "anything") == 0
    assert fuzzy_score("csr", "Capture screen") > 0, "subsequence not matched"
    assert fuzzy_score("zzz", "Capture screen") == -1, "false positive"
    # An acronym-style query should prefer the command it abbreviates.
    listen = fuzzy_score("lis", "Start / stop listening")
    settings = fuzzy_score("lis", "Settings")
    assert listen > settings, f"listen {listen} !> settings {settings}"
    return "subsequence matching with word-boundary bonus"


print("\n=== overlay ===")


@check("Overlay constructs with real config")
def _():
    from stealthit.core.config import ConfigManager
    from stealthit.core.secrets import SecretStore
    from stealthit.ui.overlay import Overlay
    global _overlay, _tmpdir
    _tmpdir = tempfile.TemporaryDirectory()
    config = ConfigManager(Path(_tmpdir.name))
    secrets = SecretStore(Path(_tmpdir.name) / "credentials.json")
    _overlay = Overlay(config, secrets)
    # Check the requested geometry before showing: the offscreen platform
    # plugin does not honour size hints and resizes the window on show().
    assert _overlay.width() == config.settings.appearance.compact_width, \
        f"{_overlay.width()} != {config.settings.appearance.compact_width}"
    assert _overlay.centralWidget() is not None
    assert _overlay.windowFlags() & Qt.FramelessWindowHint, "not frameless"
    assert _overlay.windowFlags() & Qt.WindowStaysOnTopHint, "not always-on-top"
    requested = f"{_overlay.width()}x{_overlay.height()}"

    # Qt reports children of a hidden top-level as not visible, so the window
    # must actually be shown for later visibility assertions to mean anything.
    _overlay.show()
    app.processEvents()
    return (f"{requested} requested, "
            f"{len(_overlay.hotkeys.bindings)} hotkeys registered")


@check("Expand and collapse")
def _():
    from stealthit.ui.overlay import COMPACT_HEIGHT
    _overlay.settings.appearance.animations = False  # deterministic
    _overlay.toast.hide()  # a visible toast legitimately adds height
    _overlay.expand()
    assert _overlay.expanded and _overlay.panel.isVisible(), "did not expand"
    tall = _overlay.height()
    _overlay.collapse()
    app.processEvents()
    assert not _overlay.expanded, "did not collapse"
    short = _overlay.height()
    assert tall > short, f"height did not change ({tall} vs {short})"
    # The panel must be hidden, and the window must shrink to the toolbar.
    # Leaving the panel visible during the shrink kept the window at the
    # panel's minimum height, showing a dark slab under the toolbar.
    assert not _overlay.panel.isVisible(), "panel still visible when collapsed"
    assert short <= COMPACT_HEIGHT + 4, \
        f"collapsed to {short}px, expected ~{COMPACT_HEIGHT}px -- a taller " \
        f"window leaves an empty acrylic rectangle below the toolbar"

    # A visible toast should still be given room rather than being clipped.
    _overlay.toast.show_message("test notice", timeout=0)
    app.processEvents()
    with_toast = _overlay._collapsed_height()
    assert with_toast > short, "collapsed height ignores a visible toast"
    _overlay.toast.hide()
    return (f"expanded {tall}px, collapsed to {short}px "
            f"(bar {COMPACT_HEIGHT}px, {with_toast}px with a toast)")


@check("Toolbar holds actions; model switcher sits by the composer")
def _():
    from PySide6.QtWidgets import QPushButton
    bar_buttons = _overlay.command_bar.findChildren(QPushButton)
    # Every toolbar control is an icon, not a text label.
    for btn in bar_buttons:
        assert not btn.text(), f"toolbar button still has text {btn.text()!r}"
        assert not btn.icon().isNull(), "toolbar button has no icon"
    assert len(bar_buttons) >= 7, f"only {len(bar_buttons)} toolbar buttons"

    # Model and mode belong to the composer, not the window chrome.
    assert _overlay.btn_model not in bar_buttons, \
        "model switcher is still in the top toolbar"
    assert _overlay.btn_mode not in bar_buttons
    composer = _overlay.btn_model.parent()
    assert _overlay.input.parent() is composer, \
        "model switcher is not in the same container as the prompt box"
    return (f"{len(bar_buttons)} icon actions on top; "
            f"model + mode next to the prompt")


@check("Icon set renders every glyph")
def _():
    from stealthit.ui import icons
    names = icons.available()
    assert len(names) >= 18, f"only {len(names)} icons"
    for name in names:
        pm = icons.pixmap(name, 18, "#EDEFF5")
        assert not pm.isNull(), f"{name} rendered null"
        assert pm.width() == 18, f"{name} wrong size"
        # A blank pixmap means the path builder drew nothing.
        image = pm.toImage()
        opaque = sum(1 for y in range(image.height())
                     for x in range(image.width())
                     if image.pixelColor(x, y).alpha() > 24)
        assert opaque > 12, f"{name} looks blank ({opaque} visible pixels)"
    return f"{len(names)} vector icons, all non-blank"


@check("Streaming updates the answer pane")
def _():
    _overlay.expand()
    before = _overlay.answer_layout.count()
    _overlay._on_stream_started()
    for token in ("The ", "answer ", "is ", "**42**"):
        _overlay._on_delta(token)
    _overlay._on_completed("The answer is **42**", {"input": 10, "output": 5})
    after = _overlay.answer_layout.count()
    assert after > before, "no bubble added"
    assert len(_overlay.session.turns) == 1, _overlay.session.turns
    assert _overlay.session.turns[0].usage == {"input": 10, "output": 5}
    return f"{after - before} bubble added, turn recorded with usage"


@check("Errors go to a toast, not into conversation history")
def _():
    turns_before = len(_overlay.session.turns)
    _overlay._on_stream_started()
    _overlay._on_failed("Anthropic rejected the API key.",
                        "Check the key in Settings.", False)
    assert len(_overlay.session.turns) == turns_before, \
        "error was written into history and would be resent as context"
    assert _overlay.toast.isVisible(), "no toast shown"
    assert "rejected" in _overlay.toast.label.text()
    assert _overlay._stream_bubble is None, "empty bubble left behind"
    return "history clean, toast shown, empty bubble removed"


@check("Transcript renders speaker-tagged")
def _():
    from stealthit.ui.widgets import TranscriptLine
    _overlay._on_transcript("them", "So tell me about your background.")
    _overlay._on_transcript("you", "I have six years of backend work.")
    assert len(_overlay.session.transcript) == 2

    lines = [w for w in _overlay.transcript_body.findChildren(TranscriptLine)
             if not w.partial]
    assert len(lines) == 2, f"expected 2 transcript widgets, got {len(lines)}"
    # The tag and the words must describe the same speaker. An earlier version
    # tagged every line with the incoming speaker while showing the merged
    # entry's text, so a reply from "you" rendered under "Them".
    for line, entry in zip(lines, _overlay.session.transcript):
        assert line.speaker == entry["speaker"], \
            f"widget tagged {line.speaker!r}, entry is {entry['speaker']!r}"
        assert line.label.text() == entry["text"], \
            f"widget shows {line.label.text()!r}, entry is {entry['text']!r}"

    # A follow-on fragment from the same speaker must update the existing
    # widget rather than appending a duplicate.
    _overlay._on_transcript("you", "Mostly Python and Go.")
    lines = [w for w in _overlay.transcript_body.findChildren(TranscriptLine)
             if not w.partial]
    assert len(lines) == 2, f"fragment appended a new line ({len(lines)})"
    assert "Mostly Python and Go." in lines[-1].label.text()
    return "tags match text; same-speaker fragments merge in place"


@check("Live partials show, then are replaced by the final")
def _():
    from stealthit.ui.widgets import TranscriptLine
    _overlay.new_session()

    def partials():
        return [w for w in _overlay.transcript_body.findChildren(TranscriptLine)
                if w.partial]

    # Interim text appears while speech is still in progress.
    _overlay._on_transcript("them", "So what would you", partial=True)
    assert len(partials()) == 1, "no provisional line shown"
    assert not _overlay.session.transcript, \
        "a partial was committed to history -- half-sentences would be sent " \
        "to the model and could trigger the question detector"

    # A newer partial updates the same widget rather than stacking.
    _overlay._on_transcript("them", "So what would you do if", partial=True)
    assert len(partials()) == 1, f"partials stacked ({len(partials())})"
    assert partials()[0].label.text().endswith("do if")

    # The final replaces the provisional line and commits to history.
    _overlay._on_transcript("them", "So what would you do if it failed?")
    assert not partials(), "provisional line left behind after the final"
    assert len(_overlay.session.transcript) == 1
    assert _overlay.session.transcript[0]["text"].endswith("failed?")

    finals = [w for w in _overlay.transcript_body.findChildren(TranscriptLine)
              if not w.partial]
    assert len(finals) == 1, f"expected 1 committed line, got {len(finals)}"
    return "provisional line updated in place, then swapped for the final"


@check("Partials are visually distinct from committed text")
def _():
    from stealthit.ui.widgets import TranscriptLine
    provisional = TranscriptLine("them", "half a sen", partial=True)
    committed = TranscriptLine("them", "a whole sentence.", partial=False)
    prov_style = provisional.label.styleSheet()
    assert "italic" in prov_style, "provisional text is not distinguishable"
    assert "italic" not in committed.label.styleSheet()
    assert prov_style != committed.label.styleSheet()
    return "provisional rendered dimmed and italic"


@check("Question detection drives proactive answers")
def _():
    from stealthit.ui.engine import looks_like_question
    positives = ["What is your experience with Python?",
                 "Tell me about a hard bug you fixed",
                 "How would you design a rate limiter",
                 "Can you walk me through your approach"]
    negatives = ["Yeah.", "mm hmm", "OK sounds good",
                 "I was just saying that earlier today"]
    for text in positives:
        assert looks_like_question(text), f"missed: {text!r}"
    for text in negatives:
        assert not looks_like_question(text), f"false positive: {text!r}"
    return f"{len(positives)} questions, {len(negatives)} non-questions"


@check("New conversation clears panes and history")
def _():
    _overlay.new_session()
    assert not _overlay.session.turns
    assert not _overlay.session.transcript
    assert _overlay.answer_layout.count() == 2, \
        f"answer pane not cleared ({_overlay.answer_layout.count()})"
    return "history, transcript and widgets cleared"


@check("Capture sends immediately, not just attaches")
def _():
    _overlay.new_session()
    _overlay.input.clear()
    _overlay._clear_attachment()

    # The bug: Ctrl+Enter and the toolbar icon only attached a screenshot and
    # waited for the user to type and press Send, while the tooltip promised
    # analysis. It read as the button doing nothing at all.
    _overlay.capture_and_ask("screen")
    app.processEvents()

    assert len(_overlay.session.turns) == 1, \
        f"capture did not send ({len(_overlay.session.turns)} turns) -- it " \
        f"only attached, which looks like nothing happened"
    turn = _overlay.session.turns[0]
    assert turn.had_image, "sent without the screenshot attached"
    assert turn.text.strip(), "sent an empty prompt"
    # The attachment must be consumed, not left dangling on the next message.
    assert _overlay._pending_image is None, "attachment not cleared after send"
    assert not _overlay.attachment_chip.isVisible()
    return f"captured and sent in one action: {turn.text[:44]!r}..."


@check("Typed text becomes the question for a capture")
def _():
    _overlay.new_session()
    _overlay._clear_attachment()
    _overlay.input.setPlainText("why is this test failing?")

    _overlay.capture_and_ask("screen")
    app.processEvents()

    assert len(_overlay.session.turns) == 1, "capture did not send"
    turn = _overlay.session.turns[0]
    assert turn.text == "why is this test failing?", \
        f"typed question was discarded, sent {turn.text!r} instead"
    assert turn.had_image, "screenshot not attached to the typed question"
    return "typed question is used verbatim with the screenshot"


@check("Attach-without-sending still available")
def _():
    _overlay.new_session()
    _overlay.input.clear()
    _overlay._clear_attachment()

    _overlay.capture_and_ask("screen", analyse=False)
    app.processEvents()

    assert not _overlay.session.turns, "attach-only should not send"
    assert _overlay._pending_image is not None, "nothing was attached"
    assert _overlay.attachment_chip.isVisible(), "no attachment chip shown"

    # And sending afterwards must carry the image.
    _overlay.input.setPlainText("explain this")
    _overlay.submit_prompt()
    app.processEvents()
    assert len(_overlay.session.turns) == 1
    assert _overlay.session.turns[0].had_image, "image lost before send"
    return "attaches without sending, image survives until submitted"


@check("Capture hotkey is wired to the sending path")
def _():
    from stealthit.native import DEFAULT_KEYMAP
    assert DEFAULT_KEYMAP["capture_analyse"][0] == "ctrl+enter"

    # The hotkey must reach the same code path as the toolbar icon, so the
    # two can never drift apart again.
    _overlay.new_session()
    _overlay.input.clear()
    _overlay._clear_attachment()

    binding = next((b for b in _overlay.hotkeys.bindings
                    if b.action == "capture_analyse"), None)
    if binding is not None:
        binding.callback()          # exactly what dispatch() invokes
    else:
        # Offscreen registers no hotkeys; exercise the same callback directly.
        _overlay.capture_and_ask("screen")
    app.processEvents()

    assert len(_overlay.session.turns) == 1, \
        "the capture hotkey does not send"
    assert _overlay.session.turns[0].had_image
    return "hotkey and icon share one sending path"


@check("Model chip is a dropdown, not a hover-scrolling menu")
def _():
    from PySide6.QtWidgets import QComboBox, QListView
    from stealthit.ui.chips import ChipComboBox

    combo = _overlay.btn_model
    _overlay._refresh_chips()
    assert isinstance(combo, ChipComboBox), type(combo).__name__
    assert isinstance(combo, QComboBox), "not a real dropdown"
    # A QMenu scrolls when the pointer nears its edge, silently moving the
    # list under the cursor. A list-view popup has a real scrollbar instead.
    assert isinstance(combo.view(), QListView), "popup is not a list view"
    assert combo.maxVisibleItems() <= 20, \
        "too many visible items; the popup will run off screen"
    assert combo.count() > 0, "model dropdown is empty"

    # PySide6 stores tuples as lists, so accept either.
    kinds = {d[0] for d in (combo.itemData(i) for i in range(combo.count()))
             if isinstance(d, (list, tuple)) and d}
    assert "browse" in kinds, "no way to reach the full catalogue"
    assert "model" in kinds, "no selectable models"

    # Provider headers must not be selectable.
    for i in range(combo.count()):
        if combo.itemData(i) is None:
            assert not combo.model().item(i).isEnabled(), \
                f"header {combo.itemText(i)!r} is selectable"
    return f"{combo.count()} entries in a scrollbar-backed dropdown"


@check("Choosing from the dropdown switches model")
def _():
    combo = _overlay.btn_model
    _overlay._refresh_chips()
    current = (_overlay.settings.active_provider,
               _overlay.settings.active_model())

    target = None
    for i in range(combo.count()):
        data = combo.itemData(i)
        if (isinstance(data, (list, tuple)) and data and data[0] == "model"
                and combo.model().item(i).isEnabled()
                and (data[1], data[2]) != current):
            target = (i, list(data))
            break
    assert target is not None, "no alternative model to select"
    index, (_, provider, model_id) = target

    # This is what the activated signal delivers. The handler previously
    # checked isinstance(data, tuple), but Qt hands back a list -- so every
    # selection was silently discarded.
    _overlay._model_chosen(index)

    assert _overlay.settings.active_provider == provider, \
        f"provider not switched ({_overlay.settings.active_provider})"
    assert _overlay.settings.active_model() == model_id, \
        f"model not switched ({_overlay.settings.active_model()})"
    return f"selected {provider}/{model_id}"


@check("Mode dropdown lists modes and switches")
def _():
    combo = _overlay.btn_mode
    _overlay._refresh_chips()
    modes = [d[1] for d in (combo.itemData(i) for i in range(combo.count()))
             if isinstance(d, (list, tuple)) and d and d[0] == "mode"]
    assert set(modes) == set(_overlay.settings.modes), modes

    target = next(i for i in range(combo.count())
                  if isinstance(combo.itemData(i), (list, tuple))
                  and combo.itemData(i)[0] == "mode"
                  and combo.itemData(i)[1] != _overlay.settings.active_mode)
    chosen = combo.itemData(target)[1]
    _overlay._mode_chosen(target)
    assert _overlay.settings.active_mode == chosen, \
        _overlay.settings.active_mode
    return f"{len(modes)} modes; switched to {chosen}"


@check("Active model stays selected in the chip")
def _():
    _overlay.settings.active_provider = "anthropic"
    _overlay.settings.provider("anthropic").model = "claude-sonnet-4-5"
    _overlay._refresh_chips()
    combo = _overlay.btn_model
    data = combo.itemData(combo.currentIndex())
    assert isinstance(data, (list, tuple)) and data[0] == "model", \
        f"chip shows {data!r} instead of the active model"
    assert list(data)[1:] == ["anthropic", "claude-sonnet-4-5"], list(data)
    return "chip reflects the configured model, not the first entry"


@check("Backdrop is re-asserted on show (no launch flash)")
def _():
    calls = []
    original = _overlay.stealth.apply_backdrop

    def _spy(acrylic, tint, opacity):
        calls.append((acrylic, opacity))
        return original(acrylic, tint, opacity)

    # With stealth active, the DWM backdrop is intentionally skipped -- it
    # causes a black rectangle in screen captures. Temporarily disable
    # stealth so we can verify the backdrop is re-asserted when it should be.
    saved_stealth = _overlay.settings.behaviour.stealth
    _overlay.settings.behaviour.stealth = False
    _overlay.stealth.apply_backdrop = _spy
    try:
        _overlay.hide()
        _overlay.show()
        app.processEvents()
        # The treatment set up in __init__ does not stick on an unmapped
        # window, so it must be re-applied once the window is actually shown
        # -- otherwise the first frame is Qt's default light background.
        assert calls, \
            "backdrop not re-applied on show; the window will flash light " \
            "until something else happens to re-apply it"
        assert calls[0][1] == _overlay.settings.appearance.opacity
    finally:
        _overlay.stealth.apply_backdrop = original
        _overlay.settings.behaviour.stealth = saved_stealth
    return f"re-applied {len(calls)}x on show"


@check("Window paints no system background")
def _():
    # WA_NoSystemBackground stops Qt filling from the system palette before
    # our own painting runs, which is the other half of the launch flash.
    assert _overlay.testAttribute(Qt.WA_NoSystemBackground), \
        "Qt will fill the window with the default light colour first"
    assert _overlay.testAttribute(Qt.WA_TranslucentBackground)
    assert not _overlay.autoFillBackground()
    window_colour = _overlay.palette().color(_overlay.backgroundRole())
    assert window_colour.alpha() == 0, \
        f"window background is opaque (alpha {window_colour.alpha()})"
    return "no system fill, fully transparent window palette"


@check("Panel stays dark when acrylic is disabled")
def _():
    import re
    from stealthit.ui.theme import stylesheet

    def panel_alpha(css: str) -> float:
        match = re.search(r"#Panel\s*\{[^}]*background-color:\s*"
                          r"rgba\([^)]*,\s*([\d.]+)\)", css)
        assert match, "could not find the panel background rule"
        return float(match.group(1))

    # With acrylic on, the compositor blur darkens what is behind the window,
    # so a low-alpha panel reads as dark glass.
    blurred = panel_alpha(stylesheet(acrylic=True, opacity=132))

    # With acrylic off there is no blur doing that work: the raw desktop shows
    # straight through and averages out to a pale grey slab. The surfaces have
    # to carry the opacity themselves. This was the whitish background that
    # appeared on every launch with acrylic disabled.
    plain = panel_alpha(stylesheet(acrylic=False, opacity=158))

    assert plain > blurred, \
        f"panel alpha {plain} with no blur is not more opaque than {blurred} " \
        f"with blur -- the desktop will show through as a pale slab"
    assert plain >= 0.72, \
        f"panel alpha {plain} is too transparent without blur; text will " \
        f"wash out against a light desktop"
    assert plain <= 0.99, "panel is fully opaque; the overlay loses its glass"

    # The opacity setting must still move the result, not just clamp.
    low = panel_alpha(stylesheet(acrylic=False, opacity=60))
    high = panel_alpha(stylesheet(acrylic=False, opacity=245))
    assert high > low, "opacity has no effect on the panel without acrylic"
    return (f"blurred {blurred}, plain {plain} "
            f"(range {low}-{high} across the slider)")


@check("Appearance preview covers the no-blur path")
def _():
    # Toggling acrylic must rebuild the stylesheet, not only re-apply the
    # compositor backdrop -- otherwise the panel keeps its glass alpha and
    # the preview appears to do nothing.
    assert hasattr(_overlay, "_preview_appearance"), \
        "no stylesheet preview hook for the settings dialog"

    _overlay._preview_appearance(False, 158)
    plain_css = _overlay.styleSheet()
    _overlay._preview_appearance(True, 132)
    blurred_css = _overlay.styleSheet()
    assert plain_css != blurred_css, \
        "stylesheet identical with and without blur"

    # Restore whatever the settings actually say.
    _overlay._apply_stylesheet()
    return "acrylic toggle rebuilds the stylesheet"


@check("Command palette builds")
def _():
    from stealthit.ui.command_palette import CommandPalette
    commands = _overlay._commands()
    assert len(commands) >= 8, len(commands)
    palette = CommandPalette(commands, _overlay)
    assert palette.list.count() == len(commands)
    palette._filter("region")
    assert palette.list.count() >= 1, "search found nothing"
    assert "Region" in palette.list.item(0).text() or \
        "region" in palette.list.item(0).text()
    return f"{len(commands)} commands, search works"


@check("Model picker filters free, vision and audio")
def _():
    from stealthit.providers.base import ModelInfo, Provider

    catalogue = [
        ModelInfo("meta/llama-3.3-70b:free", "Llama 3.3 70B (free)",
                  vision=False, free=True, context=131072),
        ModelInfo("google/gemini-2.0-flash:free", "Gemini 2.0 Flash (free)",
                  vision=True, audio=True, free=True, context=1048576),
        ModelInfo("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5",
                  vision=True, free=False, context=200000,
                  prompt_cost=3.0, completion_cost=15.0),
    ]

    class _Stub(Provider):
        name, label = "openrouter", "OpenRouter"

        def _stream(self, req):
            raise NotImplementedError

        def list_model_info(self):
            return catalogue

    from stealthit.ui.model_picker import ModelPicker
    picker = ModelPicker(_Stub(api_key="x"), "OpenRouter", "", _overlay)
    picker._on_loaded(catalogue)
    assert picker.list.count() == 3, picker.list.count()

    # Free filter: the point is letting someone with no credit start now.
    picker.cb_free.setChecked(True)
    assert picker.list.count() == 2, f"free filter gave {picker.list.count()}"

    # Free + vision: only the model that can do both.
    picker.cb_vision.setChecked(True)
    assert picker.list.count() == 1, picker.list.count()
    assert picker.list.item(0).data(Qt.UserRole).startswith("google/")

    # Audio filter, for models that can transcribe directly.
    picker.cb_free.setChecked(False)
    picker.cb_vision.setChecked(False)
    picker.cb_audio.setChecked(True)
    assert picker.list.count() == 1, \
        f"audio filter gave {picker.list.count()}"
    assert picker.list.item(0).data(Qt.UserRole).startswith("google/")
    assert "audio" in picker.list.item(0).text(), "audio badge missing"
    picker.cb_audio.setChecked(False)

    # Text search narrows across id and label.
    picker.search.setText("claude")
    assert picker.list.count() == 1
    assert "claude" in picker.list.item(0).data(Qt.UserRole)

    # Multi-term search must AND, not OR.
    picker.search.setText("llama free")
    assert picker.list.count() == 1, "multi-term search did not narrow"
    picker.deleteLater()
    return "free, vision, audio and text filters all narrow correctly"


@check("Picking a model persists its capabilities")
def _():
    from stealthit.providers.base import ModelInfo
    from stealthit.ui.settings_dialog import SettingsDialog

    catalogue = [
        ModelInfo("google/gemini-2.5-flash", "Gemini 2.5 Flash",
                  vision=True, audio=True, free=True),
        ModelInfo("meta/llama-3.3-70b", "Llama 3.3 70B", vision=False),
    ]
    dialog = SettingsDialog(_overlay.config, _overlay.secrets, _overlay)
    dialog._select_model("openrouter", "google/gemini-2.5-flash", catalogue)

    cfg = _overlay.config.settings.provider("openrouter")
    assert cfg.capabilities.get("google/gemini-2.5-flash", {}).get("vision"), \
        "vision capability not stored -- the model would be refused at " \
        "send time by name matching"
    assert not cfg.capabilities["meta/llama-3.3-70b"]["vision"]

    # And the setting must actually take effect for the active provider.
    _overlay.config.settings.active_provider = "openrouter"
    cfg.model = "google/gemini-2.5-flash"
    assert _overlay.config.settings.supports_vision(), \
        "picked vision model still reports as text-only"
    assert _overlay.config.settings.supports_audio()
    dialog.deleteLater()
    return "vision and audio flags stored and honoured"


@check("Opacity works with acrylic switched off")
def _():
    from stealthit.native.window import StealthController
    from stealthit.native.win32 import user32

    hwnd = user32.CreateWindowExW(0, "STATIC", "t", 0, 0, 0, 10, 10,
                                  None, None, None, None)
    assert hwnd, "could not create probe window"
    try:
        sc = StealthController(hwnd)
        # Opacity used to be routed only through the acrylic accent policy,
        # so unticking acrylic left the slider inert.
        assert sc.apply_backdrop(True, (14, 16, 22), 200), \
            "backdrop failed with acrylic on"
        assert sc.apply_backdrop(False, (14, 16, 22), 90), \
            "opacity not applied when acrylic is off"
        assert sc.apply_backdrop(False, (14, 16, 22), 240), \
            "opacity not applied when acrylic is off"
        return "tint honoured with blur on and off"
    finally:
        user32.DestroyWindow(hwnd)


@check("Free models sort first and are labelled")
def _():
    from stealthit.providers.base import ModelInfo
    free = ModelInfo("x:free", "X", free=True)
    paid = ModelInfo("y", "Y", prompt_cost=3.0, completion_cost=15.0)
    assert free.price_summary() == "Free"
    assert "3" in paid.price_summary() and "15" in paid.price_summary()
    assert ModelInfo("z", "Z", context=131072).context_summary() == "131K context"
    # The ordering used by OpenRouter's list_model_info.
    models = [paid, free]
    models.sort(key=lambda m: (not m.free, m.prompt_cost, m.id))
    assert models[0] is free, "free models must sort to the top"
    return "free badged and sorted first"


@check("History dialog lists, previews and reopens")
def _():
    import tempfile as _tf
    from stealthit.core.session import Session, SessionStore
    from stealthit.ui.history_dialog import HistoryDialog

    with _tf.TemporaryDirectory() as d:
        store = SessionStore(Path(d))
        old = Session()
        old.add_user("how do I reverse a list")
        old.add_assistant("Use reversed() or [::-1].")
        old.add_transcript("them", "And what about tuples?")
        store.save(old)

        dialog = HistoryDialog(store, _overlay)
        assert dialog.list.count() == 1, dialog.list.count()
        assert "reverse a list" in dialog.list.item(0).text()
        # Preview must render the actual exchange, not just a title.
        dialog._preview(dialog.list.item(0))
        html = dialog.preview.toHtml()
        assert "reversed()" in html, "preview missing assistant turn"
        assert "tuples" in html, "preview missing transcript"

        resumed = []
        dialog.resumed.connect(resumed.append)
        dialog._resume_item(dialog.list.item(0))
        assert resumed, "resume emitted nothing"
        assert len(resumed[0].turns) == 2
        dialog.deleteLater()
    return "listed, previewed and reopened a saved conversation"


@check("Resuming a session repopulates the panes")
def _():
    from stealthit.core.session import Session
    from stealthit.ui.widgets import MessageBubble, TranscriptLine

    _overlay.new_session()
    session = Session()
    session.add_user("first question")
    session.add_assistant("first answer")
    session.add_transcript("them", "a thing they said")

    _overlay._resume_session(session)
    bubbles = _overlay.answer_body.findChildren(MessageBubble)
    lines = _overlay.transcript_body.findChildren(TranscriptLine)
    assert len(bubbles) == 2, f"expected 2 bubbles, got {len(bubbles)}"
    assert len(lines) == 1, f"expected 1 transcript line, got {len(lines)}"
    assert _overlay.session is session
    assert not _overlay.empty_hint.isVisible(), "empty hint still showing"

    # Resuming again must not stack the previous conversation's widgets.
    _overlay._resume_session(session)
    assert len(_overlay.answer_body.findChildren(MessageBubble)) == 2, \
        "widgets accumulated across resumes"
    return "2 messages and 1 transcript line restored, no duplication"


@check("Answer-from-transcript hotkeys")
def _():
    _overlay.new_session()
    # With no transcript it must warn rather than sending an empty prompt.
    _overlay.answer_last_question()
    assert _overlay.toast.isVisible()
    assert "transcribed" in _overlay.toast.label.text().lower()
    assert not _overlay.session.turns, "asked with nothing to ask about"

    # last_question skips trailing filler to find the real question.
    _overlay.session.add_transcript("them", "How would you scale this?")
    _overlay.session.add_transcript("you", "Good question.")
    _overlay.session.add_transcript("them", "mm hmm")
    assert _overlay.session.last_question() == "How would you scale this?", \
        _overlay.session.last_question()
    return "warns when empty; finds the question behind trailing filler"


@check("Settings apply live, without a restart")
def _():
    settings = _overlay.config.settings
    settings.appearance.animations = False
    _overlay.expand()

    before_w, before_h = _overlay.width(), _overlay.height()
    settings.appearance.compact_width = before_w + 90
    settings.appearance.expanded_height = before_h + 60
    settings.appearance.font_size = 15
    settings.appearance.opacity = 140

    _overlay._on_settings_applied()
    app.processEvents()

    # Geometry must change in place. Previously these values only took effect
    # on the next launch, so the settings dialog could not show its own effect.
    assert _overlay.width() == before_w + 90, \
        f"width did not apply live ({_overlay.width()} vs {before_w + 90})"
    assert _overlay.height() == before_h + 60, \
        f"height did not apply live ({_overlay.height()})"
    assert "15px" in _overlay.styleSheet(), "font size did not apply"

    # Hotkeys must be re-registered so a rebind takes effect immediately.
    assert _overlay.hotkeys is not None
    from stealthit.native import DEFAULT_KEYMAP
    actions = {b.action for b in _overlay.hotkeys.bindings}
    assert not actions or actions <= set(DEFAULT_KEYMAP), actions

    # Collapsing after a resize must still reach the bar height exactly.
    _overlay.toast.hide()  # a visible toast legitimately reserves height
    _overlay.collapse()
    app.processEvents()
    from stealthit.ui.overlay import COMPACT_HEIGHT
    assert _overlay.height() <= COMPACT_HEIGHT + 4, \
        f"collapsed to {_overlay.height()} after a live resize"
    return (f"width, height, font and opacity applied live; "
            f"collapse still exact")


@check("Transparency: panel is see-through")
def _():
    import re
    from stealthit.ui.theme import PALETTE
    # The answer panel sits over live acrylic; a high alpha here is what made
    # it read as an opaque slab rather than glass.
    alpha = float(re.search(r"rgba\([^)]*,\s*([\d.]+)\)",
                            PALETTE.surface).group(1))
    assert alpha < 0.6, f"panel alpha {alpha} is too opaque to see through"
    from stealthit.core.config import AppearanceConfig
    assert AppearanceConfig().opacity < 160, \
        f"acrylic tint {AppearanceConfig().opacity} is too heavy"
    return (f"panel alpha {alpha}, acrylic tint "
            f"{AppearanceConfig().opacity}/255")


@check("Clicking the prompt requests keyboard focus")
def _():
    _overlay.expand()
    _overlay.input.clear()
    _overlay._end_typing()
    app.processEvents()
    assert not _overlay._typing, "typing mode should start off"

    # The bug: WS_EX_NOACTIVATE stops the window ever taking keyboard focus,
    # so clicking the box left focus on whatever window had it -- for a
    # console-launched app the terminal, which then ran the typed text as a
    # shell command. The prompt must therefore ask for typing mode on click.
    #
    # Emitting the signal is the honest check here: synthetic mouse delivery
    # under the offscreen plugin is inconsistent (a QPoint event fires while
    # an equivalent QPointF one does not), so a click test would be measuring
    # the plugin, not the wiring. The real click path is covered by
    # tools/doctor.py against a real window.
    _overlay.input.focus_requested.emit()
    app.processEvents()
    assert _overlay._typing, \
        "prompt box does not request keyboard focus -- typed text would go " \
        "to whatever window is focused instead"

    _overlay.input.focus_released.emit()
    app.processEvents()
    assert not _overlay._typing, "typing mode not released on focus out"
    return "focus_requested/released wired to typing mode"


@check("Send works after typing into the box")
def _():
    _overlay.new_session()
    _overlay.expand()
    _overlay._begin_typing()
    _overlay.input.setPlainText("hello")
    assert _overlay.input.toPlainText() == "hello", "text not visible in box"

    _overlay.submit_prompt()
    app.processEvents()
    assert len(_overlay.session.turns) == 1, \
        f"Send did nothing ({len(_overlay.session.turns)} turns)"
    assert _overlay.session.turns[0].text == "hello"
    assert _overlay.input.toPlainText() == "", "box not cleared after send"

    # A second send must also work. The worker is deleted by Qt once it
    # finishes, leaving a dangling wrapper -- touching it raised RuntimeError,
    # so Send broke after the first message.
    _overlay.input.setPlainText("second message")
    _overlay.submit_prompt()
    app.processEvents()
    assert len(_overlay.session.turns) == 2, \
        "second Send failed -- stale worker reference"
    _overlay._end_typing()
    return "two consecutive sends recorded; no stale-worker crash"


@check("Engine survives a finished worker")
def _():
    from stealthit.ui.engine import AIEngine

    engine = AIEngine(_overlay.config.settings, _overlay.secrets, _overlay)
    assert not engine.busy, "fresh engine reports busy"

    class _Dead:
        def isRunning(self):
            raise RuntimeError("Internal C++ object already deleted.")

        def cancel(self):
            raise RuntimeError("Internal C++ object already deleted.")

    # Simulate Qt having destroyed the worker behind our reference.
    engine._worker = _Dead()
    assert not engine.busy, "dangling worker should read as not busy"
    assert engine._worker is None, "dangling reference not cleared"

    engine._worker = _Dead()
    engine.cancel()  # must not raise
    assert engine._worker is None
    return "dangling worker handled instead of raising RuntimeError"


@check("Default theme is neutral, not blue")
def _():
    import re
    from stealthit.core.config import AppearanceConfig
    from stealthit.ui.theme import PALETTE

    def _rgb(hex_colour: str) -> tuple[int, int, int]:
        h = hex_colour.lstrip("#")
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    for name, colour in (("accent", PALETTE.accent),
                         ("config accent", AppearanceConfig().accent)):
        r, g, b = _rgb(colour)
        # A blue-dominant accent is what made the UI read as tinted. Neutral
        # means blue does not overpower the other channels.
        assert b - min(r, g) < 30, f"{name} {colour} is still blue-dominant"

    # User bubbles must not be a blue slab either.
    assert "108, 140, 255" not in PALETTE.bubble_user, PALETTE.bubble_user
    assert "255, 255, 255" in PALETTE.bubble_user, PALETTE.bubble_user
    return f"accent {PALETTE.accent} is neutral; bubbles are grey"


@check("Opacity control has range and a live preview")
def _():
    from stealthit.ui.settings_dialog import SettingsDialog
    dialog = SettingsDialog(_overlay.config, _overlay.secrets, _overlay)

    assert dialog.opacity_slider.minimum() <= 60, \
        "cannot go transparent enough to be useful"
    assert hasattr(dialog, "_preview_opacity"), "no live preview"

    # Moving the slider must repaint the overlay, not just store a number --
    # an opacity control whose effect you cannot see is not usable.
    dialog.opacity_slider.setValue(90)
    assert "%" in dialog.opacity_label.text(), dialog.opacity_label.text()
    low = dialog.opacity_label.text()
    dialog.opacity_slider.setValue(240)
    assert dialog.opacity_label.text() != low, "label did not track the slider"

    # Saving must persist the chosen value.
    dialog.opacity_slider.setValue(150)
    dialog._save()
    assert _overlay.config.settings.appearance.opacity == 150, \
        _overlay.config.settings.appearance.opacity
    return "range 60-245, live preview, value persists on save"


@check("Settings dialog builds all tabs")
def _():
    from stealthit.ui.settings_dialog import SettingsDialog
    dialog = SettingsDialog(_overlay.config, _overlay.secrets, _overlay)
    assert dialog.tabs.count() == 6, dialog.tabs.count()
    labels = [dialog.tabs.tabText(i) for i in range(dialog.tabs.count())]
    assert labels == ["Providers", "Modes", "Audio", "Appearance",
                      "Hotkeys", "Privacy"], labels
    assert dialog.provider_combo.count() == 5, "not all providers listed"
    from stealthit.native import DEFAULT_KEYMAP
    assert len(dialog.hotkey_fields) == len(DEFAULT_KEYMAP), \
        f"{len(dialog.hotkey_fields)} fields for {len(DEFAULT_KEYMAP)} actions"
    # Every key field must be prefilled when a key is stored, so the user can
    # see at a glance that it saved.
    dialog.secrets.set("openrouter", "sk-or-test-key")
    from stealthit.ui.settings_dialog import SettingsDialog as SD
    fresh = SD(_overlay.config, _overlay.secrets, _overlay)
    assert fresh.key_fields["openrouter"].text() == "sk-or-test-key", \
        "stored key not shown in the field -- user cannot tell it saved"
    assert "saved" in fresh.key_status["openrouter"].text().lower()
    fresh.deleteLater()
    dialog.deleteLater()
    return ", ".join(labels)


@check("Renders to an image without crashing")
def _():
    _overlay.expand()
    _overlay._add_bubble("How do I reverse a linked list in Python?", True)
    bubble = _overlay._add_bubble("", False)
    bubble.set_text(
        "Iteratively, tracking the previous node:\n\n"
        "```python\n"
        "def reverse(head):\n"
        "    prev = None\n"
        "    while head:\n"
        "        head.next, prev, head = prev, head, head.next\n"
        "    return prev\n"
        "```\n\n"
        "That is **O(n)** time and `O(1)` space.")
    _overlay.resize(660, 560)
    app.processEvents()

    out = Path(__file__).resolve().parent.parent / "docs" / "overlay.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    pixmap = QPixmap(_overlay.size())
    pixmap.fill(Qt.transparent)
    _overlay.render(pixmap)
    assert not pixmap.isNull(), "render produced a null pixmap"
    assert pixmap.save(str(out)), "could not save render"
    size_kb = out.stat().st_size / 1024
    assert size_kb > 4, f"render suspiciously small ({size_kb:.1f} KB)"
    return f"{pixmap.width()}x{pixmap.height()} -> {out.name} ({size_kb:.0f} KB)"


print("\n" + "=" * 74)
passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f"{passed}/{total} checks passed")
if passed != total:
    print("\nFAILURES:")
    for name, ok, detail in results:
        if not ok:
            print(f"  - {name}: {detail}")
sys.exit(0 if passed == total else 1)
