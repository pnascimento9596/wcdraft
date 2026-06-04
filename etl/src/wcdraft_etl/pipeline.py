"""Pipeline orchestration + deterministic emit.

Loads each upstream CSV once, builds every canonical table, and writes one JSON
artifact per table to ``etl/output/``. Output is byte-stable across runs: rows
are sorted by primary key, object keys are sorted, no timestamps are written.
Same input commit -> identical bytes (the determinism guarantee).
"""

from __future__ import annotations

import json
from pathlib import Path

from . import cards, coverage, facts, managers, nations, players, source, tournaments

# Anchored to the package location (etl/src/wcdraft_etl/ -> etl/output) so the
# pipeline writes to the same place regardless of the caller's cwd.
OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"


def build_all() -> dict[str, list[dict]]:
    """Build every canonical + fact table and return them keyed by table name."""
    # Load shared frames once.
    teams = source.load("teams")
    players_df = source.load("players")
    squads = source.load("squads")
    tours = source.load("tournaments")
    goals_df = source.load("goals")
    appearances_df = source.load("player_appearances")
    award_winners = source.load("award_winners")
    managers_df = source.load("managers")
    appointments = source.load("manager_appointments")
    manager_appearances = source.load("manager_appearances")
    standings = source.load("tournament_standings")

    return {
        "nations": nations.build(teams),
        "players": players.build(players_df, squads),
        "player_tournaments": cards.build(
            squads, tours, goals_df, appearances_df, award_winners
        ),
        "managers": managers.build_managers(managers_df, teams),
        "manager_tournaments": managers.build_manager_tournaments(
            appointments, manager_appearances, standings
        ),
        "tournaments": tournaments.build(tours),
        "goals": facts.build_goals(goals_df),
        "appearances": facts.build_appearances(appearances_df, tours),
        "awards": facts.build_awards(award_winners),
    }


def _write_json(path: Path, obj) -> None:
    # Deterministic: sorted keys, stable indent, no trailing whitespace drift.
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _manifest(tables: dict[str, list[dict]]) -> dict:
    # No timestamp — keeping the manifest deterministic. Provenance is the pinned
    # source commit; row counts let consumers sanity-check what they loaded.
    return {
        "source": {
            "name": source.SOURCE_NAME,
            "version": source.SOURCE_VERSION,
            "repo": source.SOURCE_REPO,
            "commit": source.SOURCE_COMMIT,
            "license": source.SOURCE_LICENSE,
            "license_url": source.SOURCE_LICENSE_URL,
            "author": source.SOURCE_AUTHOR,
        },
        "attribution": source.ATTRIBUTION,
        "coverage_signals": list(cards.COVERAGE_SIGNALS),
        "honest_state": {
            "never_fabricated": [
                "assists (no source)",
                "minutes (no source)",
                "club_at_tournament (no source column)",
                "manager birth_date (no source column)",
            ],
            "null_sentinels": ["shirt_number 0 -> null (pre-1954)"],
            "appearances_from": cards.APPEARANCES_FROM,
        },
        "tables": {name: len(rows) for name, rows in sorted(tables.items())},
    }


def run(output_dir: Path = OUTPUT_DIR) -> dict[str, list[dict]]:
    """Build all tables and emit JSON artifacts + manifest + COVERAGE.md."""
    output_dir.mkdir(parents=True, exist_ok=True)
    tables = build_all()
    for name, rows in tables.items():
        _write_json(output_dir / f"{name}.json", rows)
    _write_json(output_dir / "manifest.json", _manifest(tables))
    (output_dir / "COVERAGE.md").write_text(coverage.render(tables), encoding="utf-8")
    return tables


if __name__ == "__main__":
    t = run()
    total = sum(len(r) for r in t.values())
    print(f"wcdraft ETL: wrote {len(t)} tables, {total:,} rows -> {OUTPUT_DIR}/")
    for name in sorted(t):
        print(f"  {name:24s} {len(t[name]):>7,}")
