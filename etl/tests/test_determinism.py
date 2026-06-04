"""Determinism guard: same input commit -> identical output bytes."""

from __future__ import annotations

import json

from wcdraft_etl import pipeline


def _serialize(tables: dict) -> dict[str, str]:
    return {
        name: json.dumps(rows, ensure_ascii=False, indent=2, sort_keys=True)
        for name, rows in tables.items()
    }


def test_build_is_deterministic():
    a = _serialize(pipeline.build_all())
    b = _serialize(pipeline.build_all())
    assert a.keys() == b.keys()
    for name in a:
        assert a[name] == b[name], f"table {name} differs between builds"


def test_rows_sorted_by_primary_key(tables):
    pk = {
        "nations": "nation_id",
        "players": "player_id",
        "player_tournaments": "card_id",
        "managers": "manager_id",
        "manager_tournaments": "manager_tournament_id",
        "goals": "goal_id",
        "appearances": "appearance_id",
        "awards": "award_winner_id",
    }
    for name, key in pk.items():
        ids = [r[key] for r in tables[name]]
        assert ids == sorted(ids), f"{name} not sorted by {key}"
