"""Build the canonical ``nations`` table from teams.csv.

Keyed on ``team_id`` (NOT ``team_code`` — DEU collides: Germany T-31 vs West
Germany T-86). Every historical entity is its own nation_id; there is NO
successor-merging. West Germany != Germany, USSR != Russia, etc. The source
keeps them separate and so do we; we only *flag* them as historical and record
the successor as a note for downstream display.
"""

from __future__ import annotations

import pandas as pd

from . import source
from .util import s_or_none

# Curated reference (wcdraft-added, disclosed as a modification in ATTRIBUTION).
# Each historical entity stays its OWN nation_id — this map only annotates.
# Successor is a human-readable note, never used to merge identities.
# Sources: FIFA / national-team histories; common official abbreviations.
HISTORICAL: dict[str, dict] = {
    "T-86": {"successor": "Germany (T-31)", "aliases": ["FRG", "BRD", "W. Germany"]},
    "T-24": {"successor": "Germany (T-31)", "aliases": ["GDR", "DDR", "E. Germany"]},
    "T-72": {"successor": "Russia (T-62)", "aliases": ["USSR", "CCCP"]},
    "T-21": {"successor": "Czech Republic (T-20) / Slovakia", "aliases": ["CSSR"]},
    "T-87": {"successor": "Serbia (T-66) and successor states", "aliases": ["SFR Yugoslavia"]},
    "T-67": {"successor": "Serbia (T-66)", "aliases": ["Serbia & Montenegro", "FR Yugoslavia"]},
    # DR Congo and Indonesia never appear as their own team_id in this dataset,
    # so the successor note is textual only (no fabricated id reference).
    "T-88": {"successor": "DR Congo (not a separate team_id here)", "aliases": []},
    "T-23": {"successor": "Indonesia (not a separate team_id here)", "aliases": []},
}


def build(teams: pd.DataFrame | None = None) -> list[dict]:
    """Return canonical nation records, sorted by nation_id."""
    df = teams if teams is not None else source.load("teams")
    rows: list[dict] = []
    for r in df.itertuples(index=False):
        tid = r.team_id
        hist = HISTORICAL.get(tid)
        # aliases: curated alternates only; default empty list (known-empty, not null).
        aliases = sorted(set(hist["aliases"])) if hist else []
        rows.append(
            {
                "nation_id": tid,
                "canonical_name": s_or_none(r.team_name),
                "code": s_or_none(r.team_code),
                "aliases": aliases,
                "confederation": s_or_none(r.confederation_code),
                "mens_team": r.mens_team == "1",
                "womens_team": r.womens_team == "1",
                "historical": hist is not None,
                "successor": hist["successor"] if hist else None,
            }
        )
    rows.sort(key=lambda x: x["nation_id"])
    return rows
