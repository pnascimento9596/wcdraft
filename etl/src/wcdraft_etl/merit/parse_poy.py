"""Parser for the two RSSSF Player-of-the-Year winner lists (same row shape):

    european_poy        -> rsssf/europa-poy.html  (Ballon d'Or annual winners)
    south_american_poy  -> rsssf/sam-poy.html     (South American POY winners)

Both pages render the annual winners as a fixed-width line:

    <a href="...">1979</a> Diego MARADONA (Arg)            Argentinos Juniors (Arg)

So after HTML-unescaping and tag-stripping, a winner line is::

    1979 Diego MARADONA (Arg)            Argentinos Juniors (Arg)

We read ONLY the annual-winners region of each page — bounded by explicit section
markers — so the later runner-up rankings and the separate goalkeeper election
(which reuse year-prefixed rows with vote counts) can never be mistaken for a
winner. Pure function of the committed bytes."""

from __future__ import annotations

import re

from . import SOURCE_BY_ID, MeritRecord
from .paths import read_raw
from .text import collapse_ws, strip_tags, unescape

# Per-source winners region: parse only between ``start`` (or page top) and ``end``.
# Markers are visible text (matched AFTER tag-stripping) at section-header
# boundaries, so the later runner-up rankings and the separate goalkeeper election
# are excluded.
_SCOPE: dict[str, tuple[str | None, str]] = {
    "european_poy": (None, "Rankings by Wins"),
    "south_american_poy": ('By "El Mundo"', "Top-3 by Year"),
}

# Footnote markers like "[*]" / "[1]" that RSSSF appends to a name or nation
# (e.g. Di Stéfano "(Spa [*])") — removed before field extraction.
_FOOTNOTE_RE = re.compile(r"\s*\[[^\]]*\]")

# A winner line: YEAR, then the name, then the FIRST parenthesised nation token.
# The name is non-greedy so it stops at the player's nationality, never the club's.
_ROW_RE = re.compile(r"^\s*(\d{4})\s+(\S.*?)\s+\(([A-Za-z][A-Za-z. ]{1,4})\)", re.MULTILINE)


def _first_row_pos(text: str, start: int) -> int:
    """Index of the first winner-shaped line at/after ``start`` (-1 if none)."""
    for m in _ROW_RE.finditer(text, start):
        return m.start()
    return -1


def parse(source_id: str) -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = read_raw(src.raw_file, src.charset)
    text = strip_tags(unescape(raw))

    start_marker, end_marker = _SCOPE[source_id]
    start = text.find(start_marker) if start_marker else 0
    if start < 0:
        start = 0
    # The first winner row anchors the data region. The end marker's section header
    # is searched only AFTER that row, so an identical string in the page's table-
    # of-contents menu (which precedes the data) cannot truncate the region early.
    first_row = _first_row_pos(text, start)
    end = text.find(end_marker, first_row) if first_row >= 0 else -1
    if end < 0:
        end = len(text)
    region = _FOOTNOTE_RE.sub("", text[start:end])

    records: list[MeritRecord] = []
    for line in region.split("\n"):
        m = _ROW_RE.match(line)
        if not m:
            continue
        year = int(m.group(1))
        name = collapse_ws(m.group(2))
        nation_token = collapse_ws(m.group(3))
        if not name:
            continue
        records.append(
            MeritRecord(
                source_id=source_id,
                family=src.family,
                name=name,
                nation_token=nation_token,
                year=year,
                detail=f"{src.source_id} winner {year}",
            )
        )
    return records
