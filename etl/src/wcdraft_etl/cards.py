"""Build ``player_tournaments`` (the per-tournament player "cards") from squads.csv
plus joins, and the per-card coverage score.

card_id = ``${player_id}:${tournament_id}``. One row per (player, tournament);
nation_id is the team the player represented *that* tournament (so a nation
switcher has multiple cards with one stable player_id across different nation_ids).

Honest-state aggregates:
  - shirt              0 -> null (no squad numbers before 1954)
  - position_listed    coarse code the player was listed at that tournament
  - club_at_tournament ALWAYS null — the upstream database has no club column;
                       we surface the field but never fabricate a value
  - appearances        match-level data exists only 1970+ -> null before 1970,
                       else the count of matches the player appeared in (0 if
                       named in the squad but never dressed — a real measured 0)
  - goals              count of the player's goals that tournament, EXCLUDING own
                       goals (an own goal is credited to the scorer but is not one
                       of their goals); penalties are included (they are goals)
  - awards             list of awards won that tournament (empty list if none)

assists and minutes are intentionally omitted: they do not exist at any era in
this source and must not be fabricated.
"""

from __future__ import annotations

import pandas as pd

from . import source
from .util import s_or_none, shirt_or_none

# Era cliffs (see COVERAGE.md). Match-level appearance data starts in 1970.
APPEARANCES_FROM = 1970

# Per-card signal universe used for the coverage fraction. We exclude signals
# that are absent for EVERY card at EVERY era (club, assists, minutes): including
# them would deflate coverage uniformly and falsely imply they could be present.
# The two era-gated signals (appearances, shirt) are what make coverage vary,
# directly encoding the two era cliffs.
COVERAGE_SIGNALS = ("selection", "position_listed", "goals", "awards", "appearances", "shirt")


def _coverage(year: int | None, shirt: int | None) -> float:
    present = {
        "selection": True,  # the card existing means the player was selected
        "position_listed": True,  # 0 blanks upstream
        "goals": True,  # goal events cover all eras (1930+)
        "awards": True,  # award data covers all eras
        "appearances": year is not None and year >= APPEARANCES_FROM,
        "shirt": shirt is not None,
    }
    return round(sum(present[s] for s in COVERAGE_SIGNALS) / len(COVERAGE_SIGNALS), 4)


def build(
    squads: pd.DataFrame | None = None,
    tournaments: pd.DataFrame | None = None,
    goals: pd.DataFrame | None = None,
    appearances: pd.DataFrame | None = None,
    award_winners: pd.DataFrame | None = None,
) -> list[dict]:
    """Return canonical card records, sorted by card_id."""
    sdf = squads if squads is not None else source.load("squads")
    tdf = tournaments if tournaments is not None else source.load("tournaments")
    gdf = goals if goals is not None else source.load("goals")
    adf = appearances if appearances is not None else source.load("player_appearances")
    wdf = award_winners if award_winners is not None else source.load("award_winners")

    year_of = {t.tournament_id: int(t.year) for t in tdf.itertuples(index=False)}

    # --- aggregates keyed by (player_id, tournament_id) ---
    goal_ct: dict[tuple[str, str], int] = {}
    for g in gdf.itertuples(index=False):
        if g.own_goal == "1":
            continue  # own goal: credited to scorer, but not one of *their* goals
        k = (g.player_id, g.tournament_id)
        goal_ct[k] = goal_ct.get(k, 0) + 1

    appear_ct: dict[tuple[str, str], int] = {}
    for a in adf.itertuples(index=False):
        k = (a.player_id, a.tournament_id)
        appear_ct[k] = appear_ct.get(k, 0) + 1

    awards_by: dict[tuple[str, str], list[str]] = {}
    for w in wdf.itertuples(index=False):
        awards_by.setdefault((w.player_id, w.tournament_id), []).append(w.award_name)

    rows: list[dict] = []
    for r in sdf.itertuples(index=False):
        pid, tid = r.player_id, r.tournament_id
        k = (pid, tid)
        year = year_of.get(tid)
        shirt = shirt_or_none(r.shirt_number)
        # appearances: null before the 1970 match-event cliff, else count (default 0)
        has_appearances = year is not None and year >= APPEARANCES_FROM
        appearances_val = appear_ct.get(k, 0) if has_appearances else None
        rows.append(
            {
                "card_id": f"{pid}:{tid}",
                "player_id": pid,
                "tournament_id": tid,
                "nation_id": r.team_id,
                "shirt": shirt,
                "position_listed": s_or_none(r.position_code),
                "club_at_tournament": None,  # not in source — never fabricated
                "appearances": appearances_val,
                "goals": goal_ct.get(k, 0),
                "awards": sorted(awards_by.get(k, [])),
                "coverage": _coverage(year, shirt),
            }
        )
    rows.sort(key=lambda x: x["card_id"])
    return rows
