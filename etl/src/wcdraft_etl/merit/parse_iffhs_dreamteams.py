"""Parser for the committed IFFHS all-time dream-teams snapshot:

    iffhs_dream_teams -> iffhs/iffhs-dreamteams.html  (retrospective_selection)

The IFFHS published its All-Time World / continental / national men's dream teams as
Word-pasted ``<p class="MsoNormal">`` paragraphs (no table): a team header line
(``... DREAM TEAM``) followed by one ``Name (Country)`` paragraph per selected
player, the goalkeeper listed first. This is the all-time, position-balanced
retrospective route that closes the pre-1956 / defender / goalkeeper / non-European
gaps simultaneously — Yashin, Cafu, Beckenbauer, Baresi, Maldini all appear here.

Pure function of the committed bytes. Each selected player is one retrospective
fact tagged with the team it belongs to (so a player in several distinct dream teams
keeps each selection). The goalkeeper — always listed first under a starting-XI
header — carries a first-class ``GK`` position; the outfield order is not a reliable
position signal, so those carry no position (the explicit defender/midfielder repair
comes from the positional / ESM / Ballon d'Or sources)."""

from __future__ import annotations

import re

from . import SOURCE_BY_ID, MeritRecord
from .paths import read_raw
from .text import collapse_ws, norm, strip_tags, unescape

_PARA_RE = re.compile(r'<p class="MsoNormal"[^>]*>(.*?)</p>', re.DOTALL | re.IGNORECASE)
# A selected-player line ends with a parenthesised country: "Lev YASHIN (Soviet
# Union)" (a stray trailing ")" appears on one row and is tolerated).
_PLAYER_RE = re.compile(r"^(.+?)\s*\(([^()]+)\)\)?\s*$")
# Guillemet-wrapped nickname/common name, e.g. « CAFU » — kept inline so the linker's
# uppercase-key picks it up, but the markers themselves are dropped.
_GUILLEMET_RE = re.compile(r"[«»]")


def _paragraphs(raw: str) -> list[str]:
    out = []
    for m in _PARA_RE.finditer(raw):
        out.append(collapse_ws(strip_tags(unescape(m.group(1)))))
    return out


def _team_slug(header: str) -> str:
    """Stable selection key for a dream-team header (its normalized words)."""
    return "_".join(norm(w) for w in header.split() if norm(w))


def parse(source_id: str = "iffhs_dream_teams") -> list[MeritRecord]:
    src = SOURCE_BY_ID[source_id]
    raw = read_raw(src.raw_file, src.charset)
    records: list[MeritRecord] = []

    current_team: str | None = None
    gk_pending = False
    for para in _paragraphs(raw):
        if not para:
            continue
        m = _PLAYER_RE.match(para)
        if m is None or "DREAM TEAM" in para.upper():
            # Header / divider line. A starting-XI header reads "... DREAM TEAM" and
            # resets the goalkeeper-first marker; a "SUBSTITUTES" / "B-TEAM" divider
            # keeps the team label but does not re-arm the GK slot.
            if "DREAM TEAM" in para.upper():
                current_team = _team_slug(para)
                gk_pending = True
            continue
        if current_team is None:
            continue  # a stray parenthesised line before any team header
        name = _GUILLEMET_RE.sub(" ", m.group(1))
        name = collapse_ws(name)
        nation_token = collapse_ws(m.group(2))
        if not name:
            continue
        position = "GK" if gk_pending else None
        gk_pending = False
        records.append(
            MeritRecord(
                source_id=source_id,
                family=src.family,
                name=name,
                nation_token=nation_token,
                year=None,
                position=position,
                detail=f"iffhs dream team: {current_team}",
                extra={"selection": current_team},
            )
        )
    return records
