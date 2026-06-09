"""Parsers for the v2 Wikipedia annual-award snapshots (winner recognition):

    concacaf_poy    -> wiki/concacaf-awards.html   (regional_annual_recognition)
    uefa_mens_poy   -> wiki/uefa-mens-poy.html     (global_annual_recognition)

Pure functions of the committed snapshot bytes. Each emits the annual WINNER as a
recognition ``MeritRecord`` (the linker resolves the name; these parsers never
assign a player_id). CONCACAF surfaces modern North-American / Caribbean stars
invisible to the global ballots; UEFA Men's POY is the European-confederation
winner."""

from __future__ import annotations

from . import SOURCE_BY_ID, MeritRecord
from . import wikihtml as W
from .paths import read_raw


def _raw(source_id: str) -> str:
    src = SOURCE_BY_ID[source_id]
    return read_raw(src.raw_file, src.charset)


def _section_table(raw: str, after_label: str, section_label: str) -> str:
    """The table under the first ``section_label`` header that occurs after the
    ``after_label`` header — used to pick the MALE 'Player of the Year' table on a
    page that also carries a female one."""
    hs = W.headers(raw)
    anchor = next((o for o, t in hs if t == after_label), 0)
    offset = next((o for o, t in hs if t == section_label and o >= anchor), -1)
    return W.table_after(raw, offset) if offset >= 0 else ""


# ─── CONCACAF Player of the Year (male winners) ──
# Table [Year, Rank, Player, Club]; the Year cell row-spans the year's 1st/2nd/3rd
# rows, so the winner row is the one whose rank cell reads "1st" (and it always
# carries the year). Only the winner is emitted.


def parse_concacaf_poy(source_id: str = "concacaf_poy") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = _raw(source_id)
    table = _section_table(raw, "Male award winners", "Player of the Year")
    records: list[MeritRecord] = []
    for row in W.rows(table):
        cells = W.cells(row)
        if len(cells) < 4 or W.cell_text(cells[1]) != "1st":
            continue  # only the winner row (carries year + rank "1st")
        year = W.first_year(W.cell_text(cells[0]))
        players = W.player_anchors(cells[2])
        if year is None or not players:
            continue
        _slug, name = players[0]
        records.append(
            MeritRecord(
                source_id=source_id,
                family=src.family,
                name=name,
                nation_token=None,
                year=year,
                detail=f"{source_id} winner {year}",
            )
        )
    return records


# ─── UEFA Men's Player of the Year (winners) ──
# "Winners" section table [Season, Player, Club]; sub-header rows ("UEFA Best Player
# in Europe Award" / "UEFA Men's Player of the Year Award") carry one cell and are
# skipped. The season winner is emitted.


def parse_uefa_mens_poy(source_id: str = "uefa_mens_poy") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = _raw(source_id)
    hs = W.headers(raw)
    offset = next((o for o, t in hs if t == "Winners"), -1)
    table = W.table_after(raw, offset) if offset >= 0 else ""
    records: list[MeritRecord] = []
    for row in W.rows(table):
        cells = W.cells(row)
        if len(cells) < 3:
            continue  # era sub-header
        year = W.first_year(W.cell_text(cells[0]))
        players = W.player_anchors(cells[1])
        if year is None or not players:
            continue
        _slug, name = players[0]
        records.append(
            MeritRecord(
                source_id=source_id,
                family=src.family,
                name=name,
                nation_token=None,
                year=year,
                detail=f"{source_id} winner {year}",
            )
        )
    return records
