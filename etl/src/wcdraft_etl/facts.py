"""Event-level supporting fact tables: goals, appearances, awards.

These keep the granular events that the per-card aggregates (in cards.py) roll
up, so downstream work can recompute or drill in without re-reading upstream.
The appearances fact carries an explicit ``era_1970_plus`` flag — every row is
1970+ by construction (no match-level data exists earlier), made explicit so the
cliff is never mistaken for incomplete extraction.
"""

from __future__ import annotations

import pandas as pd

from . import source
from .util import int_or_none, s_or_none

APPEARANCES_FROM = 1970


def build_goals(goals: pd.DataFrame | None = None) -> list[dict]:
    df = goals if goals is not None else source.load("goals")
    rows = [
        {
            "goal_id": g.goal_id,
            "tournament_id": g.tournament_id,
            "match_id": g.match_id,
            "player_id": g.player_id,
            "nation_id": g.player_team_id,  # the scorer's team
            "minute_regulation": int_or_none(g.minute_regulation),
            "minute_stoppage": int_or_none(g.minute_stoppage),
            "own_goal": g.own_goal == "1",
            "penalty": g.penalty == "1",
        }
        for g in df.itertuples(index=False)
    ]
    rows.sort(key=lambda x: x["goal_id"])
    return rows


def build_appearances(
    appearances: pd.DataFrame | None = None, tournaments: pd.DataFrame | None = None
) -> list[dict]:
    df = appearances if appearances is not None else source.load("player_appearances")
    tdf = tournaments if tournaments is not None else source.load("tournaments")
    year_of = {t.tournament_id: int(t.year) for t in tdf.itertuples(index=False)}
    rows = [
        {
            "appearance_id": f"{a.player_id}:{a.match_id}",
            "tournament_id": a.tournament_id,
            "match_id": a.match_id,
            "player_id": a.player_id,
            "nation_id": a.team_id,
            "starter": a.starter == "1",
            "substitute": a.substitute == "1",
            "era_1970_plus": (year_of.get(a.tournament_id, 0) >= APPEARANCES_FROM),
        }
        for a in df.itertuples(index=False)
    ]
    rows.sort(key=lambda x: x["appearance_id"])
    return rows


def build_awards(award_winners: pd.DataFrame | None = None) -> list[dict]:
    df = award_winners if award_winners is not None else source.load("award_winners")
    rows = [
        {
            "award_winner_id": f"{w.award_id}:{w.tournament_id}:{w.player_id}",
            "tournament_id": w.tournament_id,
            "award_id": w.award_id,
            "award_name": s_or_none(w.award_name),
            "player_id": w.player_id,
            "nation_id": w.team_id,
            "shared": w.shared == "1",
        }
        for w in df.itertuples(index=False)
    ]
    rows.sort(key=lambda x: x["award_winner_id"])
    return rows
