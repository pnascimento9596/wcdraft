"""Build canonical ``managers`` and ``manager_tournaments`` tables.

The upstream ``manager_id`` is stable dataset-wide (one row per human), exactly
like player_id — a multi-tournament manager keeps one id across teams and
nationalities (Parreira: 6 tournaments, 5 nations). We verify, not re-derive.

Honest-state notes:
  - managers.csv has NO birth_date column -> birth_date is always null
  - nation_id (manager's nationality) is mapped from the free-text country_name
    to a team_id via exact team_name match; if a country is not among the WC
    teams it maps to null rather than a fabricated id (all 77 match in v1.2.0)
  - a manager's nationality may differ from the team they managed (foreign
    managers): managers.nation_id is the person; manager_tournaments.nation_id
    is the team managed
"""

from __future__ import annotations

import pandas as pd

from . import source
from .util import int_or_none, name_part_or_none, s_or_none


def _name_to_team_id(teams: pd.DataFrame) -> dict[str, str]:
    m: dict[str, str] = {}
    for t in teams.itertuples(index=False):
        m[t.team_name] = t.team_id  # team_name is unique upstream
    return m


def build_managers(
    managers: pd.DataFrame | None = None, teams: pd.DataFrame | None = None
) -> list[dict]:
    mdf = managers if managers is not None else source.load("managers")
    tdf = teams if teams is not None else source.load("teams")
    name2id = _name_to_team_id(tdf)

    rows: list[dict] = []
    for r in mdf.itertuples(index=False):
        given, family = name_part_or_none(r.given_name), s_or_none(r.family_name)
        full = " ".join(p for p in (given, family) if p) or None
        country = s_or_none(r.country_name)
        rows.append(
            {
                "manager_id": r.manager_id,
                "full_name": full,
                "given_name": given,
                "family_name": family,
                "nation_id": name2id.get(country) if country else None,
                "nationality_name": country,
                "birth_date": None,  # not in source — never fabricated
                "female": r.female == "1",
            }
        )
    rows.sort(key=lambda x: x["manager_id"])
    return rows


def build_manager_tournaments(
    appointments: pd.DataFrame | None = None,
    manager_appearances: pd.DataFrame | None = None,
    standings: pd.DataFrame | None = None,
) -> list[dict]:
    apt = appointments if appointments is not None else source.load("manager_appointments")
    app = (
        manager_appearances
        if manager_appearances is not None
        else source.load("manager_appearances")
    )
    std = standings if standings is not None else source.load("tournament_standings")

    # matches managed: count of manager_appearances per (manager, tournament)
    match_ct: dict[tuple[str, str], int] = {}
    for a in app.itertuples(index=False):
        k = (a.manager_id, a.tournament_id)
        match_ct[k] = match_ct.get(k, 0) + 1

    # final placement: position per (tournament, team) — may be absent (null)
    placement: dict[tuple[str, str], int | None] = {}
    for s in std.itertuples(index=False):
        placement[(s.tournament_id, s.team_id)] = int_or_none(s.position)

    rows: list[dict] = []
    for r in apt.itertuples(index=False):
        mid, tid, team = r.manager_id, r.tournament_id, r.team_id
        rows.append(
            {
                "manager_tournament_id": f"{mid}:{tid}:{team}",
                "manager_id": mid,
                "tournament_id": tid,
                "nation_id": team,  # team managed (may differ from manager nationality)
                "matches": match_ct.get((mid, tid)),  # null if no appearance rows
                "final_placement": placement.get((tid, team)),  # null if unranked
            }
        )
    rows.sort(key=lambda x: x["manager_tournament_id"])
    return rows
