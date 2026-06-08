"""Parsers for the three committed Wikipedia snapshots.

    iffhs_worlds_best     -> annual_recognition       (winners by year)
    living_legends_2004   -> retrospective_selection  (125-player list)
    wc_awards_crosscheck  -> wc_legacy (cross-check)   (World Cup Golden Ball list)

Each is a ``wikitable`` whose rows carry ``<a href="/wiki/Slug" title="Title">``
anchors. A flag/country anchor wraps an ``<img>`` and has empty link text; a
player anchor has the displayed name as its text — that distinction is all we need
to pull (player, nation) out of a cell without a full table engine. Pure functions
of the committed bytes."""

from __future__ import annotations

import re

from . import SOURCE_BY_ID, MeritRecord
from .paths import read_raw
from .text import collapse_ws, norm, strip_tags, unescape

_ANCHOR_RE = re.compile(r'<a href="/wiki/([^"#]+)"[^>]*?title="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL)
_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
_CELL_RE = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.DOTALL | re.IGNORECASE)
_YEAR_B_RE = re.compile(r"<b>\s*(\d{4})\s*</b>")


def _cells(row_html: str) -> list[str]:
    """Inner HTML of each <td>/<th> in a row, in order."""
    return [m.group(1) for m in _CELL_RE.finditer(row_html)]


def _first_table(raw: str, after: str | None = None) -> str:
    start = raw.find("wikitable")
    if after is not None:
        anchor = raw.find(after)
        if anchor >= 0:
            start = raw.find("wikitable", anchor)
    if start < 0:
        return ""
    end = raw.find("</table>", start)
    return raw[start : end if end >= 0 else len(raw)]


def _anchors(cell_html: str) -> list[tuple[str, str, str]]:
    """(slug, title, visible_text) for each /wiki/ link in the fragment."""
    out = []
    for m in _ANCHOR_RE.finditer(cell_html):
        text = collapse_ws(strip_tags(unescape(m.group(3))))
        out.append((m.group(1), unescape(m.group(2)), text))
    return out


def _player_and_nation(fragment: str) -> tuple[str | None, str | None]:
    """A player anchor has visible text; a flag/country anchor is text-empty.
    Returns (player_name, nation_title)."""
    player = nation = None
    for _slug, title, text in _anchors(fragment):
        if text and player is None:
            player = text
        elif not text and nation is None:
            nation = title  # flag link's title is the country
    return player, nation


def parse_iffhs_best(source_id: str = "iffhs_worlds_best") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = read_raw(src.raw_file, src.charset)
    table = _first_table(raw)
    records: list[MeritRecord] = []
    for rm in _ROW_RE.finditer(table):
        row = rm.group(1)
        ym = _YEAR_B_RE.search(row)
        if not ym:  # only the winner (1st) row of each year carries the year cell
            continue
        year = int(ym.group(1))
        player, nation = _player_and_nation(row)
        if not player:
            continue
        records.append(
            MeritRecord(
                source_id=source_id,
                family=src.family,
                name=player,
                nation_token=nation,
                year=year,
                detail=f"{source_id} winner {year}",
            )
        )
    return records


def parse_living_legends(source_id: str = "living_legends_2004") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = read_raw(src.raw_file, src.charset)
    table = _first_table(raw)
    records: list[MeritRecord] = []
    for rm in _ROW_RE.finditer(table):
        anchors = _anchors(rm.group(1))
        player = next((t for _s, _ti, t in anchors if t), None)
        # Nationality cell links to "<Country> national football team".
        nation = None
        for _slug, title, _text in anchors:
            if "national football team" in title.lower():
                nation = title.rsplit(" national football team", 1)[0]
                break
        if not player:
            continue
        records.append(
            MeritRecord(
                source_id=source_id,
                family=src.family,
                name=player,
                nation_token=nation,
                year=2004,
                detail="2004 living-legends selection",
            )
        )
    return records


def parse_wc_awards_crosscheck(source_id: str = "wc_awards_crosscheck") -> list[dict]:
    """Cross-check rows only (NOT linked facts): the public Golden Ball winner per
    World Cup year. Returned as plain dicts (year, name, name_key) for the linker
    to compare against the native canonical awards table."""
    src = SOURCE_BY_ID[source_id]
    raw = read_raw(src.raw_file, src.charset)
    table = _first_table(raw, after="Golden Ball")
    rows: list[dict] = []
    for rm in _ROW_RE.finditer(table):
        cells = _cells(rm.group(1))
        if len(cells) < 2:
            continue
        # Column 0 = "<year> <host>" (links to "<year>_..._World_Cup"); column 1 =
        # the Golden Ball winner cell. Year from the tournament slug; winner = the
        # first player anchor (visible text, not a national-team link) in column 1.
        year = None
        for slug, _title, _text in _anchors(cells[0]):
            ym = re.match(r"(\d{4})_", slug)
            if ym:
                year = int(ym.group(1))
                break
        winner = None
        for _slug, title, text in _anchors(cells[1]):
            if text and "national football team" not in title.lower():
                winner = text
                break
        if year is None or not winner:
            continue
        rows.append({"year": year, "name": winner, "name_key": norm(winner)})
    return rows
