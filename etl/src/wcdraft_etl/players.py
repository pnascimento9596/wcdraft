"""Build the canonical ``players`` person-dimension from players.csv.

The upstream ``player_id`` is a stable, dataset-wide person key (one row per
human, with cross-tournament aggregation columns). We treat it as authoritative
and verify — not re-derive — identity. See identity-QA tests for the regression
guards (nation-switchers resolving to one id).

eligible_positions: the coarse GK/DF/MF/FW set a player can fill, taken directly
from the four boolean flags (a player may be several).
primary_position: chosen *within* the eligible set by how often the player was
actually listed at each position across their squad rows; ties broken by the
canonical GK<DF<MF<FW order. This keeps primary_position both real (it reflects
actual listings) and consistent (always a member of eligible_positions).
"""

from __future__ import annotations

import pandas as pd

from . import source
from .util import POSITIONS, name_part_or_none, s_or_none, sort_positions

_FLAG_COL = {"GK": "goal_keeper", "DF": "defender", "MF": "midfielder", "FW": "forward"}


def _primary(eligible: list[str], squad_counts: dict[str, int]) -> str | None:
    if not eligible:
        return None
    if len(eligible) == 1:
        return eligible[0]
    # Most-listed eligible position wins; tiebreak by canonical order (index).
    return max(eligible, key=lambda p: (squad_counts.get(p, 0), -POSITIONS.index(p)))


def build(
    players: pd.DataFrame | None = None, squads: pd.DataFrame | None = None
) -> list[dict]:
    """Return canonical player records, sorted by player_id."""
    pdf = players if players is not None else source.load("players")
    sdf = squads if squads is not None else source.load("squads")

    # Per-player tally of listed coarse positions across squad rows.
    listed: dict[str, dict[str, int]] = {}
    for pid, code in zip(sdf["player_id"], sdf["position_code"], strict=True):
        if code in POSITIONS:
            counts = listed.setdefault(pid, {})
            counts[code] = counts.get(code, 0) + 1

    rows: list[dict] = []
    for r in pdf.itertuples(index=False):
        eligible = sort_positions(
            [pos for pos, col in _FLAG_COL.items() if getattr(r, col) == "1"]
        )
        given, family = name_part_or_none(r.given_name), s_or_none(r.family_name)
        full = " ".join(p for p in (given, family) if p) or None
        rows.append(
            {
                "player_id": r.player_id,
                "full_name": full,
                # upstream has no separate common-name; family name is the display form
                "common_name": family,
                "given_name": given,
                "family_name": family,
                "birth_date": s_or_none(r.birth_date),  # null preserved (1 unknown upstream)
                "female": r.female == "1",
                "eligible_positions": eligible,
                "primary_position": _primary(eligible, listed.get(r.player_id, {})),
            }
        )
    rows.sort(key=lambda x: x["player_id"])
    return rows
