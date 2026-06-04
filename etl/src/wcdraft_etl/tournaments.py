"""Build the canonical ``tournaments`` table from tournaments.csv.

Carries an explicit ``womens`` flag derived from the tournament name so the
foundation stays complete (all 30 tournaments, men's + women's) and downstream
stages can filter rather than silently losing the women's data here.
"""

from __future__ import annotations

import pandas as pd

from . import source
from .util import int_or_none, s_or_none


def build(tournaments: pd.DataFrame | None = None) -> list[dict]:
    df = tournaments if tournaments is not None else source.load("tournaments")
    rows: list[dict] = []
    for r in df.itertuples(index=False):
        name = s_or_none(r.tournament_name) or ""
        rows.append(
            {
                "tournament_id": r.tournament_id,
                "name": s_or_none(r.tournament_name),
                "year": int_or_none(r.year),
                "host_country": s_or_none(r.host_country),
                "champion": s_or_none(r.winner),
                "count_teams": int_or_none(r.count_teams),
                "start_date": s_or_none(r.start_date),
                "end_date": s_or_none(r.end_date),
                "womens": "Women" in name,
            }
        )
    rows.sort(key=lambda x: (x["year"] or 0, x["tournament_id"]))
    return rows
