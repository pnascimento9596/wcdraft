"""Parsers for the v2 position-balanced Wikipedia snapshots (the defender / GK repair):

    uefa_club_positional    -> wiki/uefa-club-awards.html   (GK/DF/MF/FW best awards)
    esm_team_of_the_season  -> wiki/esm-tots.html           (GK/DF/MF/FW formation XI)
    uefa_team_of_the_year   -> wiki/uefa-toty.html          (annual XI, recognition)
    fifpro_world11          -> wiki/fifpro-world11.html     (player-voted World 11)
    ballondor_dream_team    -> wiki/ballondor-dreamteam.html (all-time 1st/2nd/3rd XIs)

Every parser is a PURE function of the committed snapshot bytes. The position-aware
sources emit a first-class ``position`` (GK/DF/MF/FW) so MV2-3 can finally score
defenders, goalkeepers and midfielders — not just the striker-biased annual ballots.
Position is read from the SOURCE's own structure (a positional section header or a
formation column), never inferred from a player's identity.

Names are the article title (a link-friendly "Paolo Maldini", not a short "Maldini"),
so the conservative linker in ``link.py`` resolves them; these parsers never assign a
``player_id`` and never invent a player."""

from __future__ import annotations

from . import SOURCE_BY_ID, MeritRecord
from . import wikihtml as W
from .paths import read_raw


def _raw(source_id: str) -> str:
    src = SOURCE_BY_ID[source_id]
    return read_raw(src.raw_file, src.charset)


def _position_from_label(label: str) -> str | None:
    """Map a positional section/column label to a GK/DF/MF/FW code. Order matters:
    'goalkeeper' first, then any 'midfield' (so 'Attacking midfielders/Inside
    Forwards' is MF), then 'back'/'defender' (DF), then 'winger'/'forward' (FW)."""
    low = label.lower()
    if "goalkeeper" in low:
        return "GK"
    if "midfield" in low:
        return "MF"
    if "back" in low or "defender" in low:
        return "DF"
    if "winger" in low or "forward" in low or "striker" in low:
        return "FW"
    return None


# ─── UEFA Club positional awards (Best Goalkeeper / Defender / Midfielder / Forward) ──
# Four position sections, each a [Season, Player, Club] table. Position = the section.
_UEFA_POS_SECTIONS = {
    "Best Goalkeeper": "GK",
    "Best Defender": "DF",
    "Best Midfielder": "MF",
    "Best Forward": "FW",
}


def parse_uefa_club_positional(
    source_id: str = "uefa_club_positional",
) -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = _raw(source_id)
    records: list[MeritRecord] = []
    for offset, label in W.headers(raw):
        pos = _UEFA_POS_SECTIONS.get(label)
        if pos is None:
            continue
        for row in W.rows(W.table_after(raw, offset)):
            cells = W.cells(row)
            if len(cells) < 2:
                continue  # sub-header row ("UEFA Club Goalkeeper of the Year")
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
                    position=pos,
                    detail=f"uefa_best_{pos.lower()} {year}",
                    extra={"selection": f"uefa_best_{pos.lower()}"},
                )
            )
    return records


# ─── ESM Team of the Season (formation columns: GK | Defenders | Midfielders | Forwards) ──
_ESM_COL_POS = {1: "GK", 2: "DF", 3: "MF", 4: "FW"}


def parse_esm_team_of_the_season(
    source_id: str = "esm_team_of_the_season",
) -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = _raw(source_id)
    records: list[MeritRecord] = []
    offset = 0
    while True:
        table = W.table_after(raw, offset)
        if not table:
            break
        offset = raw.find(table, offset) + len(table)
        rws = W.rows(table)
        header = " ".join(W.cell_text(c) for c in W.cells(rws[0])) if rws else ""
        if "Goalkeeper" not in header or "Forwards" not in header:
            continue  # not a season XI table
        for row in rws[1:]:
            cells = W.cells(row)
            if len(cells) < 5:
                continue
            year = W.first_year(W.cell_text(cells[0]))
            if year is None:
                continue
            for col, pos in _ESM_COL_POS.items():
                for _slug, name in W.player_anchors(cells[col]):
                    records.append(
                        MeritRecord(
                            source_id=source_id,
                            family=src.family,
                            name=name,
                            nation_token=None,
                            year=year,
                            position=pos,
                            detail=f"esm_tots {pos} {year}",
                            extra={"selection": f"esm_{pos.lower()}"},
                        )
                    )
    return records


# ─── UEFA Team of the Year (annual XI — recognition breadth; positions vary, so None) ──
# One "Team of the Year YYYY" table per year. The XI is a recognition fact per player
# per year; the formation order is not position-labelled, so position is left None
# (the explicit positional repair comes from the positional / ESM / dream-team
# sources). A player selected across several years yields several year-keyed facts.
import re as _re  # noqa: E402  (local: only the TOTY year header needs a pattern)

_TOTY_HEADER_RE = _re.compile(r"^Team of the Year (\d{4})$")


def parse_uefa_team_of_the_year(
    source_id: str = "uefa_team_of_the_year",
) -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = _raw(source_id)
    records: list[MeritRecord] = []
    for offset, label in W.headers(raw):
        m = _TOTY_HEADER_RE.match(label)
        if not m:
            continue
        year = int(m.group(1))
        for _slug, name in W.player_anchors(W.table_after(raw, offset)):
            records.append(
                MeritRecord(
                    source_id=source_id,
                    family=src.family,
                    name=name,
                    nation_token=None,
                    year=year,
                    detail=f"uefa_team_of_the_year {year}",
                )
            )
    return records


# ─── FIFPro World 11 (player-voted XI — recognition; per-selection-year facts) ──
# The appearances table lists each selected player and the years they made the XI.
# One fact per (player, year) preserves the multiplicity (a 10-time selection is ten
# facts) without claiming a position the summary table does not state.


def parse_fifpro_world11(source_id: str = "fifpro_world11") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = _raw(source_id)
    table = W.table_after(raw, raw.find("wikitable"))
    records: list[MeritRecord] = []
    for row in W.rows(table):
        cells = W.cells(row)
        players = W.player_anchors(row)
        if not players:
            continue
        _slug, name = players[0]
        # The years cell is the one carrying the most plausible selection years.
        years: set[int] = set()
        for c in cells:
            ys = [int(y) for y in _re.findall(r"\b(\d{4})\b", W.cell_text(c))]
            ys = [y for y in ys if 1990 <= y <= 2030]
            if len(ys) > len(years):
                years = set(ys)
        for year in sorted(years):
            records.append(
                MeritRecord(
                    source_id=source_id,
                    family=src.family,
                    name=name,
                    nation_token=None,
                    year=year,
                    detail=f"fifpro_world11 {year}",
                )
            )
    return records


# ─── Ballon d'Or Dream Team (all-time 1st / 2nd / 3rd position XIs) ──
# Position is joined from the per-position nomination sections (Goalkeepers,
# {Right,Centre,Left}-backs, the two midfield sections, wingers, centre-forward) via
# the article slug, then attached to each selected First/Second/Third-team player.
_BALLONDOR_TEAMS = {
    "First Team": "ballondor_first_team",
    "Second Team": "ballondor_second_team",
    "Third Team": "ballondor_third_team",
}


def _ballondor_slug_positions(raw: str) -> dict[str, str]:
    """slug -> GK/DF/MF/FW from the per-position nomination tables."""
    out: dict[str, str] = {}
    for offset, label in W.headers(raw):
        if label in _BALLONDOR_TEAMS or label == "Selected teams":
            break  # nomination sections all precede the selected teams
        pos = _position_from_label(label)
        if pos is None:
            continue
        for row in W.rows(W.table_after(raw, offset)):
            for slug, _name in W.player_anchors(row):
                out.setdefault(slug, pos)
    return out


def parse_ballondor_dream_team(
    source_id: str = "ballondor_dream_team",
) -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = _raw(source_id)
    slug_pos = _ballondor_slug_positions(raw)
    records: list[MeritRecord] = []
    for offset, label in W.headers(raw):
        selection = _BALLONDOR_TEAMS.get(label)
        if selection is None:
            continue
        for slug, name in W.player_anchors(W.table_after(raw, offset)):
            records.append(
                MeritRecord(
                    source_id=source_id,
                    family=src.family,
                    name=name,
                    nation_token=None,
                    year=None,
                    position=slug_pos.get(slug),
                    detail=f"{selection}",
                    extra={"selection": selection},
                )
            )
    return records
