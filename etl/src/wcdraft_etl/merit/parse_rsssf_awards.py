"""Parsers for the v2 RSSSF recognition snapshots (MV2-1 source-set expansion):

    african_poy                    -> rsssf/afr-poy.html      (regional_annual)
    asian_poy                      -> rsssf/as-poy.html       (regional_annual)
    south_american_poy_placements  -> rsssf/sam-poy.html      (regional_annual)
    world_soccer_poy               -> rsssf/wsoc-awards.html  (global_annual)
    onze_awards                    -> rsssf/onze-awards.html  (global_annual)

Every parser is a PURE function of the committed snapshot bytes — no network, clock,
randomness, fuzzy lookup, or LLM call. Each RSSSF page renders fixed-width columns
after tag-stripping, so the rows are read column-wise (splitting on runs of two or
more spaces) and bounded to the relevant section by visible section markers, exactly
as the v1 ``parse_poy`` reads the European/South-American winner lists.

These are recognition FACTS (a player named in a public award list); each parser
emits a ``MeritRecord`` with the raw name + nation token as written. Linking to a
canonical ``player_id`` (and all conservative withholding) happens later in
``link.py`` — these parsers never assign an id and never invent a player.
"""

from __future__ import annotations

import re

from . import SOURCE_BY_ID, MeritRecord
from .paths import read_raw
from .text import collapse_ws, strip_tags, unescape

# Footnote markers like "[*]" / "[1]" RSSSF appends to a name/nation — removed
# before field extraction (mirrors parse_poy._FOOTNOTE_RE).
_FOOTNOTE_RE = re.compile(r"\s*\[[^\]]*\]")
# A run of two or more spaces delimits the fixed-width columns.
_COLS_RE = re.compile(r"\s{2,}")


def _plain(source_id: str) -> str:
    src = SOURCE_BY_ID[source_id]
    text = strip_tags(unescape(read_raw(src.raw_file, src.charset)))
    return _FOOTNOTE_RE.sub("", text)


def _region(text: str, start_marker: str | None, end_marker: str | None) -> str:
    """Slice ``text`` between the first ``start_marker`` and the next ``end_marker``
    after it. A missing marker falls back to the page edge."""
    start = text.find(start_marker) + len(start_marker) if start_marker else 0
    if start_marker and start < len(start_marker):  # marker not found -> page top
        start = 0
    end = text.find(end_marker, start) if end_marker else -1
    if end < 0:
        end = len(text)
    return text[start:end]


def _year_at_start(line: str) -> int | None:
    """Leading 4-digit year (also matches season ranges like ``2010-11`` — the first
    year is taken). None when the line does not start with a year."""
    m = re.match(r"\s*(\d{4})(?:-\d{2,4})?\b", line)
    return int(m.group(1)) if m else None


# ─── African Player of the Year (winners across the FF / Afrique / CAF series) ──
# Row shape: ``YEAR  Player  Country  Club``. The page carries three overlapping
# award series (France Football, Afrique-Football, CAF); a player named in more than
# one series for the same year collapses to one fact at link time (year-keyed), so
# all winner tables are read and the dedup handles the overlap.


def parse_african_poy(source_id: str = "african_poy") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    records: list[MeritRecord] = []
    for line in _plain(source_id).split("\n"):
        year = _year_at_start(line)
        if year is None or not (1970 <= year <= 2100):
            continue
        cols = _COLS_RE.split(line.strip())
        # [year, player, country, club...] — need at least player + country.
        if len(cols) < 3:
            continue
        name = collapse_ws(cols[1])
        nation_token = collapse_ws(cols[2])
        if not name or not nation_token or any(c.isdigit() for c in name):
            continue
        records.append(
            MeritRecord(
                source_id=source_id,
                family=src.family,
                name=name,
                nation_token=nation_token,
                year=year,
                detail=f"{source_id} winner {year}",
            )
        )
    return records


# ─── Asian Player of the Year (winners) ──
# Row shape: ``YEAR    Player (Country)`` in the "List of winners" region. The later
# "Yearwise Data" placement tables are intentionally NOT read (winners only).
_ASIAN_ROW_RE = re.compile(r"^\s*(\d{4})\s+(\S.*?)\s+\(([^)\n]+)\)\s*$")


def parse_asian_poy(source_id: str = "asian_poy") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    region = _region(_plain(source_id), "List of winners", "Wins by player")
    records: list[MeritRecord] = []
    for line in region.split("\n"):
        m = _ASIAN_ROW_RE.match(line)
        if not m:
            continue  # e.g. "1992    [No award]" has no (country) -> skipped
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
                detail=f"{source_id} winner {year}",
            )
        )
    return records


# ─── World Soccer Player of the Year (winners) ──
# Row shape: ``YEAR    Player (Club & Country)  [votes]`` in the "Player of the Year"
# region (the Manager / Team sections are excluded). Nation = the token after "&"
# inside the first parenthesis.
_WSOC_ROW_RE = re.compile(r"^\s*(\d{4})\s+(\S.*?)\s+\(([^)\n]*&[^)\n]*)\)")


def parse_world_soccer_poy(source_id: str = "world_soccer_poy") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    region = _region(_plain(source_id), "Player of the Year", "Manager of the Year")
    records: list[MeritRecord] = []
    for line in region.split("\n"):
        m = _WSOC_ROW_RE.match(line)
        if not m:
            continue
        year = int(m.group(1))
        name = collapse_ws(m.group(2))
        nation_token = collapse_ws(m.group(3).rsplit("&", 1)[1])  # text after last &
        if not name or not nation_token:
            continue
        records.append(
            MeritRecord(
                source_id=source_id,
                family=src.family,
                name=name,
                nation_token=nation_token,
                year=year,
                detail=f"{source_id} winner {year}",
            )
        )
    return records


# ─── Onze d'Or / d'Argent / de Bronze (annual top-three) ──
# Row shape: ``YEAR  ONZE D'OR  ONZE D'ARGENT  ONZE DE BRONZE`` — three surname-first
# columns, no nation token. A "/" splits a shared placement; a "not awarded" cell or
# a missing column simply yields fewer facts. Each placement is one global-annual
# fact tagged with its tier (gold/silver/bronze) so the three are distinct.
_ONZE_TIERS = ("onze_dor", "onze_dargent", "onze_de_bronze")


def parse_onze_awards(source_id: str = "onze_awards") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    # "ONZE DE BRONZE" is the column header (unique); the intro prose mentions the
    # award names + "Coach of the Year", so bound on the uppercase header and the
    # Coach section that follows the table.
    region = _region(_plain(source_id), "ONZE DE BRONZE", "Coach of the Year")
    records: list[MeritRecord] = []
    for line in region.split("\n"):
        year = _year_at_start(line)
        if year is None or not (1976 <= year <= 2100):
            continue
        cols = _COLS_RE.split(line.strip())
        names = cols[1:4]  # the three placement columns (some may be absent)
        for tier, cell in zip(_ONZE_TIERS, names, strict=False):
            cell = collapse_ws(cell)
            if not cell or "not awarded" in cell.lower():
                continue
            for name in (n.strip() for n in cell.split("/")):
                if not name or any(c.isdigit() for c in name):
                    continue
                records.append(
                    MeritRecord(
                        source_id=source_id,
                        family=src.family,
                        name=name,
                        nation_token=None,
                        year=year,
                        detail=f"{tier} {year}",
                        extra={"selection": tier},
                    )
                )
    return records


# ─── South American Player of the Year — placements (2nd / 3rd only) ──
# The committed SAM snapshot's "Top-3 by Year" region. The 1st-place column is the
# winner already sourced by ``south_american_poy``; this parser adds DEPTH (the 2nd
# and 3rd placements) without double-counting the winner. Row shape:
# ``YEAR  1st  2nd  3rd`` (surname-first; a "/" splits a shared placement).
_SAM_PLACES = ((2, "sam_2nd_place"), (3, "sam_3rd_place"))


def parse_sam_placements(
    source_id: str = "south_american_poy_placements",
) -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    region = _region(_plain(source_id), "Top-3 by Year", None)
    records: list[MeritRecord] = []
    for line in region.split("\n"):
        year = _year_at_start(line)
        if year is None or not (1971 <= year <= 2100):
            continue
        cols = _COLS_RE.split(line.strip())
        for col_idx, tier in _SAM_PLACES:
            if col_idx >= len(cols):
                continue
            cell = collapse_ws(cols[col_idx])
            for name in (n.strip() for n in cell.split("/")):
                if not name or any(c.isdigit() for c in name):
                    continue
                records.append(
                    MeritRecord(
                        source_id=source_id,
                        family=src.family,
                        name=name,
                        nation_token=None,
                        year=year,
                        detail=f"{tier} {year}",
                        extra={"selection": tier},
                    )
                )
    return records
