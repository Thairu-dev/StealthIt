"""
Markdown rendering with syntax highlighting.

The original piped markdown into a QTextBrowser with no code styling at all,
so every code block rendered as undifferentiated proportional text -- which
for a tool whose main job is answering coding questions is the single worst
part of the output.

Two things here that a naive renderer gets wrong while streaming:

  1. An unterminated ``` fence. Mid-stream the closing fence has not arrived,
     so a renderer that requires balanced fences flickers the block between
     "code" and "not code" on every token. The scanner below consumes to
     end-of-input instead, styling partial code from the first token.
  2. Escaping. Qt's rich text is HTML, so a stray "<" in the model's answer
     silently swallows the rest of the paragraph.
"""
from __future__ import annotations

import html
import re

from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_by_name, guess_lexer
from pygments.util import ClassNotFound

from .theme import PALETTE, TYPE

_FENCE = re.compile(r"^([ \t]*)(`{3,}|~{3,})[ \t]*([\w+.-]*)[ \t]*$", re.M)
_INLINE_CODE = re.compile(r"`([^`\n]+)`")
_BOLD = re.compile(r"\*\*([^*]+)\*\*")
_ITALIC = re.compile(r"(?<![*\w])\*([^*\n]+)\*(?!\*)")
_STRIKE = re.compile(r"~~([^~]+)~~")
_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^\s)]+)\)")
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_ULIST = re.compile(r"^[ \t]*[-*+]\s+(.*)$")
_OLIST = re.compile(r"^[ \t]*(\d+)[.)]\s+(.*)$")
_QUOTE = re.compile(r"^>\s?(.*)$")
_HR = re.compile(r"^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$")

# Monokai-ish, tuned to sit on the acrylic surface without vibrating.
_FORMATTER = HtmlFormatter(nowrap=True, style="monokai")


def _highlight_code(code: str, language: str) -> str:
    """Pygments -> inline-styled HTML. Falls back to escaped plain text."""
    lexer = None
    if language:
        try:
            lexer = get_lexer_by_name(language, stripnl=False)
        except ClassNotFound:
            lexer = None
    if lexer is None and len(code.strip()) > 24:
        # Guessing on very short fragments produces noise, so only try when
        # there is enough text for the guess to mean anything.
        try:
            lexer = guess_lexer(code)
        except ClassNotFound:
            lexer = None
    if lexer is None:
        return html.escape(code)
    try:
        return highlight(code, lexer, _FORMATTER)
    except Exception:
        return html.escape(code)


def _inline(text: str) -> str:
    """Inline markdown -> HTML. Escapes first so model output cannot inject."""
    out = html.escape(text)
    # Inline code is protected before other rules so `**` inside a code span
    # is not mistaken for bold.
    spans: list[str] = []

    def _stash(m: re.Match) -> str:
        spans.append(m.group(1))
        return f"\x00{len(spans) - 1}\x00"

    out = _INLINE_CODE.sub(_stash, out)
    out = _LINK.sub(
        rf'<a href="\2" style="color:{PALETTE.accent};'
        r'text-decoration:none">\1</a>', out)
    out = _BOLD.sub(r"<b>\1</b>", out)
    out = _STRIKE.sub(r"<s>\1</s>", out)
    out = _ITALIC.sub(r"<i>\1</i>", out)

    def _restore(m: re.Match) -> str:
        code = spans[int(m.group(1))]
        return (f'<code style="background:{PALETTE.code_bg};'
                f'font-family:{TYPE.mono};font-size:{TYPE.size_sm}px;'
                f'padding:1px 5px;border-radius:4px;'
                f'color:{PALETTE.accent_hover}">{code}</code>')

    return re.sub(r"\x00(\d+)\x00", _restore, out)


def render(md: str, streaming: bool = False) -> str:
    """
    Markdown -> HTML suitable for QTextBrowser.

    Partial input is handled natively: the fenced-block scanner consumes to
    end-of-input when the closing fence has not arrived yet, so a code block
    being streamed renders as highlighted code from its first token rather
    than flickering between styled and unstyled on every delta.

    `streaming` suppresses the per-block copy bars, which are only meaningful
    once the block is complete.
    """
    p, t = PALETTE, TYPE
    blocks: list[str] = []
    lines = md.split("\n")
    i = 0
    list_open: str | None = None

    def close_list() -> None:
        nonlocal list_open
        if list_open:
            blocks.append(f"</{list_open}>")
            list_open = None

    while i < len(lines):
        line = lines[i]

        fence = _FENCE.match(line)
        if fence:
            close_list()
            marker, lang = fence.group(2), fence.group(3)
            i += 1
            body: list[str] = []
            while i < len(lines):
                closing = _FENCE.match(lines[i])
                if closing and closing.group(2)[0] == marker[0]:
                    i += 1
                    break
                body.append(lines[i])
                i += 1
            code = "\n".join(body)
            label = ""
            if lang:
                label = (f'<div style="color:{p.text_faint};'
                         f'font-size:{t.size_xs}px;font-family:{t.mono};'
                         f'padding:0 0 4px 2px">{html.escape(lang)}</div>')
            blocks.append(
                f'{label}<div style="background:{p.code_bg};'
                f'border:1px solid {p.code_border};border-radius:8px;'
                f'padding:10px 12px;margin:6px 0">'
                f'<pre style="font-family:{t.mono};font-size:{t.size_sm}px;'
                f'margin:0;color:#F8F8F2">{_highlight_code(code, lang)}</pre>'
                f'</div>')
            continue

        if not line.strip():
            close_list()
            i += 1
            continue

        if _HR.match(line):
            close_list()
            blocks.append(
                f'<div style="border-top:1px solid {p.border};'
                f'margin:10px 0"></div>')
            i += 1
            continue

        heading = _HEADING.match(line)
        if heading:
            close_list()
            level = len(heading.group(1))
            size = max(t.size_md, t.size_xl - (level - 1) * 2)
            blocks.append(
                f'<div style="font-size:{size}px;font-weight:600;'
                f'color:{p.text};margin:10px 0 4px">'
                f'{_inline(heading.group(2))}</div>')
            i += 1
            continue

        quote = _QUOTE.match(line)
        if quote:
            close_list()
            body = [quote.group(1)]
            i += 1
            while i < len(lines) and _QUOTE.match(lines[i]):
                body.append(_QUOTE.match(lines[i]).group(1))
                i += 1
            blocks.append(
                f'<div style="border-left:3px solid {p.accent};'
                f'padding:2px 0 2px 12px;margin:6px 0;'
                f'color:{p.text_muted}">{_inline(" ".join(body))}</div>')
            continue

        ul = _ULIST.match(line)
        if ul:
            if list_open != "ul":
                close_list()
                blocks.append(
                    '<ul style="margin:4px 0 4px 18px;'
                    '-qt-list-indent:1">')
                list_open = "ul"
            blocks.append(
                f'<li style="margin:3px 0">{_inline(ul.group(1))}</li>')
            i += 1
            continue

        ol = _OLIST.match(line)
        if ol:
            if list_open != "ol":
                close_list()
                blocks.append(
                    '<ol style="margin:4px 0 4px 18px;'
                    '-qt-list-indent:1">')
                list_open = "ol"
            blocks.append(
                f'<li style="margin:3px 0">{_inline(ol.group(2))}</li>')
            i += 1
            continue

        # Paragraph: gather until a blank line or a block-level construct.
        close_list()
        para = [line]
        i += 1
        while i < len(lines) and lines[i].strip():
            nxt = lines[i]
            if (_FENCE.match(nxt) or _HEADING.match(nxt) or _ULIST.match(nxt)
                    or _OLIST.match(nxt) or _QUOTE.match(nxt)
                    or _HR.match(nxt)):
                break
            para.append(nxt)
            i += 1
        blocks.append(
            f'<div style="margin:4px 0;line-height:150%">'
            f'{_inline(" ".join(para))}</div>')

    close_list()
    return (f'<div style="font-family:{t.ui};font-size:{t.size_md}px;'
            f'color:{p.text}">' + "".join(blocks) + "</div>")


def extract_code_blocks(md: str) -> list[tuple[str, str]]:
    """(language, code) for each fenced block -- powers per-block copy."""
    out: list[tuple[str, str]] = []
    lines = md.split("\n")
    i = 0
    while i < len(lines):
        fence = _FENCE.match(lines[i])
        if not fence:
            i += 1
            continue
        marker, lang = fence.group(2), fence.group(3)
        i += 1
        body: list[str] = []
        while i < len(lines):
            closing = _FENCE.match(lines[i])
            if closing and closing.group(2)[0] == marker[0]:
                i += 1
                break
            body.append(lines[i])
            i += 1
        out.append((lang, "\n".join(body)))
    return out


def plain_text(md: str) -> str:
    """Markdown stripped to plain text, for clipboard copy."""
    text = _FENCE.sub("", md)
    text = _INLINE_CODE.sub(r"\1", text)
    text = _BOLD.sub(r"\1", text)
    text = _ITALIC.sub(r"\1", text)
    text = _STRIKE.sub(r"\1", text)
    text = _LINK.sub(r"\1 (\2)", text)
    text = _HEADING.sub(r"\2", text)
    return text.strip()
