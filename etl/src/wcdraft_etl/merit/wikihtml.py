"""Shared, pure helpers for parsing the committed Wikipedia wikitable snapshots.

The v2 position-balanced sources (UEFA positional awards / Team of the Year, FIFPro
World 11, ESM Team of the Season, the Ballon d'Or Dream Team) are all ``wikitable``
pages whose cells carry ``<a href="/wiki/Slug" title="Title">Text</a>`` anchors. A
flag / country anchor wraps an ``<img>`` and has empty link text; a player anchor
has the displayed name as text. The article ``title`` is the most link-friendly
name (a full "Paolo Maldini" rather than a short "Maldini"), and the ``slug`` is a
stable identity key for joining a formation cell to a position-labelled section.

Everything here is a pure function of the committed bytes — no network, clock,
randomness, fuzzy lookup, or LLM call. Mirrors the helpers in ``parse_wiki`` but is
shared by the v2 parsers so each stays a thin, auditable transcription."""

from __future__ import annotations

import re

from .text import collapse_ws, strip_tags, unescape

_ANCHOR_RE = re.compile(
    r'<a href="/wiki/([^"#]+)"[^>]*?title="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL
)
_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
_CELL_RE = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.DOTALL | re.IGNORECASE)
_HEADER_RE = re.compile(r"<h[1-6][^>]*>(.*?)</h[1-6]>", re.DOTALL | re.IGNORECASE)
# Trailing Wikipedia disambiguator, e.g. "Xavi (footballer, born 1980)" -> "Xavi".
_DISAMBIG_RE = re.compile(r"\s*\([^)]*\)\s*$")


def headers(raw: str) -> list[tuple[int, str]]:
    """(offset, plain-text) for every section header, in document order."""
    out = []
    for m in _HEADER_RE.finditer(raw):
        out.append((m.start(), collapse_ws(strip_tags(unescape(m.group(1))))))
    return out


def table_after(raw: str, offset: int) -> str:
    """Inner HTML of the first ``<table>`` at/after ``offset`` (``""`` if none)."""
    start = raw.find("<table", offset)
    if start < 0:
        return ""
    end = raw.find("</table>", start)
    return raw[start : end if end >= 0 else len(raw)]


def rows(table_html: str) -> list[str]:
    return [m.group(1) for m in _ROW_RE.finditer(table_html)]


def cells(row_html: str) -> list[str]:
    """Inner HTML of each <td>/<th> in a row, in order."""
    return [m.group(1) for m in _CELL_RE.finditer(row_html)]


def cell_text(cell_html: str) -> str:
    return collapse_ws(strip_tags(unescape(cell_html)))


def anchors(fragment: str) -> list[tuple[str, str, str]]:
    """(slug, clean_title, visible_text) for each /wiki/ link in the fragment.
    ``clean_title`` strips the trailing Wikipedia disambiguator so the name links."""
    out = []
    for m in _ANCHOR_RE.finditer(fragment):
        text = collapse_ws(strip_tags(unescape(m.group(3))))
        title = _DISAMBIG_RE.sub("", unescape(m.group(2))).strip()
        out.append((m.group(1), title, text))
    return out


def player_anchors(fragment: str) -> list[tuple[str, str]]:
    """(slug, name) for each PLAYER anchor in a cell — a player anchor has visible
    text (a flag/country anchor is text-empty) and a title that is not a national
    team. ``name`` is the link-friendly clean title. Order preserved, de-duplicated
    by slug within the fragment."""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for slug, title, text in anchors(fragment):
        if not text:
            continue  # flag / country image anchor
        if "national football team" in title.lower():
            continue
        if slug in seen:
            continue
        seen.add(slug)
        out.append((slug, title))
    return out


def first_year(text: str) -> int | None:
    """First 4-digit year in ``text`` (handles season ranges like ``2010–11`` and
    the odd glued ``20202021``). None if none present."""
    m = re.search(r"\b(\d{4})\b", text)
    return int(m.group(1)) if m else None
