"""Parser for the RSSSF century records page (``rsssf/century.html``):

    international_century_caps -> international_record family

Two ranked sections are read, each bounded by its section headers so neighbouring
"95-to-99 caps" and per-country record-holder tables are excluded:

  * "Players with a Century of Caps" — 100+ international appearances
  * "Players with 30 or More Goals"  — 30+ international goals

A row (after tag-stripping) looks like::

      1.Cristiano Ronaldo     [Portugal]          226  (2003-2025)
      1.Cristiano Ronaldo     [Portugal]          143 (226)  (2003-2025)   # goals

i.e. ``rank.Name [Nation] value [(caps)] (career-span)`` — rank and the
trailing career span are both optional (tie rows drop the rank; a few rows omit
the span). The career span, when present, is a strong year disambiguator at link
time. Pure function of the committed bytes."""

from __future__ import annotations

import re

from . import SOURCE_BY_ID, MeritRecord
from .paths import read_raw
from .text import collapse_ws, strip_tags, unescape

_SOURCE_ID = "international_century_caps"

# (list label, start marker, end marker) — markers are visible section text.
_SECTIONS: tuple[tuple[str, str, str], ...] = (
    ("caps", "Players with a Century of Caps", "Players with 95 to 99 Caps"),
    ("goals", "Players with 30 or More Goals", "Record Holders for Remaining Countries"),
)

# rank(optional) . Name [Nation] value [(caps)] [(YYYY-YYYY)]
_ROW_RE = re.compile(
    r"^\s*\d*\.?\s*"
    r"([^\[\]\n]+?)\s*"  # name (single line, no brackets)
    r"\[([^\]]+)\]\s*"  # [Nation]
    r"(\d+)"  # primary value (caps or goals)
    r"(?:\s*\(\d+\))?"  # optional secondary count, e.g. goals row's (caps)
    r"(?:\s*\((\d{4})-(\d{4})\))?",  # optional career span
    re.MULTILINE,
)


def _parse_section(text: str, label: str, start_marker: str, end_marker: str) -> list[MeritRecord]:
    start = text.find(start_marker)
    if start < 0:
        return []
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        end = len(text)
    region = text[start + len(start_marker) : end]

    records: list[MeritRecord] = []
    for m in _ROW_RE.finditer(region):
        name = collapse_ws(m.group(1))
        nation_token = collapse_ws(m.group(2))
        value = int(m.group(3))
        cs = int(m.group(4)) if m.group(4) else None
        ce = int(m.group(5)) if m.group(5) else None
        if not name:
            continue
        records.append(
            MeritRecord(
                source_id=_SOURCE_ID,
                family=SOURCE_BY_ID[_SOURCE_ID].family,
                name=name,
                nation_token=nation_token,
                year=None,
                career_start=cs,
                career_end=ce,
                detail=f"{label}={value}" + (f" ({cs}-{ce})" if cs else ""),
                extra={"list": label, "value": value},
            )
        )
    return records


def parse(source_id: str = _SOURCE_ID) -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    text = strip_tags(unescape(read_raw(src.raw_file, src.charset)))
    records: list[MeritRecord] = []
    for label, start_marker, end_marker in _SECTIONS:
        records.extend(_parse_section(text, label, start_marker, end_marker))
    return records
