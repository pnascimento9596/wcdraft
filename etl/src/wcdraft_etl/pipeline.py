"""Pipeline orchestration + deterministic emit.

Loads each upstream CSV once, builds every canonical table, and writes one JSON
artifact per table to ``etl/output/``. Output is byte-stable across runs: rows
are sorted by primary key, object keys are sorted, no timestamps are written.
Same input commit -> identical bytes (the determinism guarantee).
"""

from __future__ import annotations

import json
from pathlib import Path

from . import (
    cards,
    coverage,
    facts,
    historical_clubs,
    managers,
    nations,
    output_contracts,
    players,
    source,
    tournaments,
)
from . import supplement as supplement_pkg
from .supplement import link as supplement_link

# Anchored to the package location (etl/src/wcdraft_etl/ -> etl/output) so the
# pipeline writes to the same place regardless of the caller's cwd.
OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"
DATASET_REVISION_DATE = "2026-07-01"


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

    club_backfill = historical_clubs.build_club_lookup(squads, players_df, teams)

    tables = {
        "nations": nations.build(teams),
        "players": players.build(players_df, squads),
        "player_tournaments": cards.build(
            squads,
            tours,
            goals_df,
            appearances_df,
            award_winners,
            club_backfill.clubs,
            club_backfill.contexts,
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

    # WS-A supplement: overlay pre-1970 tournament appearances sourced & linked
    # from the committed RSSSF snapshots onto the cards (genuine gaps only; native
    # Fjelstul values are never overwritten). Deterministic + offline: a pure
    # function of the committed raw snapshots + these canonical tables. The
    # sourced/review/report artifacts themselves are emitted by run().
    supp = supplement_link.build_supplement(
        tables["players"], tables["player_tournaments"], tables["tournaments"]
    )
    supplement_link.apply_overlay(tables["player_tournaments"], supp["sourced"])
    return tables


def _write_json(path: Path, obj) -> None:
    # Deterministic: sorted keys, stable indent, no trailing whitespace drift.
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _manifest(tables: dict[str, list[dict]]) -> dict:
    club_rows = historical_clubs.coverage_by_tournament(tables["player_tournaments"])
    club_populated = sum(r["club_populated"] for r in club_rows)
    club_null = sum(r["club_null"] for r in club_rows)
    # No timestamp — keeping the manifest deterministic. Provenance is the pinned
    # source commit; row counts let consumers sanity-check what they loaded.
    return {
        "dataset_revision_date": DATASET_REVISION_DATE,
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
        "supplement": {
            "source_name": supplement_pkg.RSSSF_SOURCE_NAME,
            "license": supplement_pkg.RSSSF_LICENSE,
            "license_url": supplement_pkg.RSSSF_LICENSE_URL,
            "attribution": supplement_pkg.RSSSF_ATTRIBUTION,
            "sourced_field": "player_tournaments.appearances (pre-1970)",
            "fetch_manifest": "supplement/fetch_manifest.json",
            "artifacts": [
                "supplement/appearances_sourced.json",
                "supplement/link_review.json",
                "supplement/SUPPLEMENT.md",
            ],
        },
        "historical_club_backfill": {
            "source_name": historical_clubs.SOURCE_NAME,
            "license": historical_clubs.SOURCE_LICENSE,
            "license_url": historical_clubs.SOURCE_LICENSE_URL,
            "attribution": historical_clubs.ATTRIBUTION,
            "sourced_field": (
                "player_tournaments.club_at_tournament, caps, intl_goals, "
                "club_nation_code (men's 1930-2022 where present)"
            ),
            "fetch_manifest": "sources/wikipedia_historical_squads/fetch_manifest.json",
            "cards_populated": club_populated,
            "honest_null_cards": club_null,
        },
        "coverage_signals": list(cards.COVERAGE_SIGNALS),
        "honest_state": {
            "never_fabricated": [
                "assists (no source, never synthesised)",
                "minutes (no source, never synthesised — not derived as matches*90)",
                (
                    "historical Wikipedia squad facts (club_at_tournament, caps, "
                    "intl_goals, club_nation_code) stay null/absent where pinned "
                    "squad pages lack a row/value or no unambiguous canonical join exists"
                ),
                "manager birth_date (no source column)",
            ],
            "null_sentinels": [
                "shirt_number 0 -> null (pre-1954)",
                "given_name 'not applicable' -> null",
            ],
            "appearances_from": cards.APPEARANCES_FROM,
            "appearances_pre_1970": (
                "sourced from RSSSF starting XIs and linked to player_id where "
                "unambiguous (appearances_source='rsssf_starting_xi'); null where "
                "no lineup links (unlinkable names emitted to link_review.json)"
            ),
        },
        "tables": {name: len(rows) for name, rows in sorted(tables.items())},
    }


def run(output_dir: Path = OUTPUT_DIR) -> dict[str, list[dict]]:
    """Build all tables and emit JSON artifacts + manifest + COVERAGE.md, plus the
    WS-A supplement artifacts (sourced appearances, link review list, report)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    tables = build_all()
    output_contracts.validate_canonical_tables(tables)
    for name, rows in tables.items():
        _write_json(output_dir / f"{name}.json", rows)
    _write_json(output_dir / "manifest.json", _manifest(tables))
    (output_dir / "COVERAGE.md").write_text(coverage.render(tables), encoding="utf-8")

    # WS-A supplement artifacts. build_supplement is a pure function of the
    # (already-overlaid) canonical tables + committed RSSSF snapshots; re-running
    # it here for emission yields the identical sourced/review/report it produced
    # for the overlay in build_all (appearances values are not read by it).
    supp = supplement_link.build_supplement(
        tables["players"], tables["player_tournaments"], tables["tournaments"]
    )
    supp_dir = output_dir / "supplement"
    supp_dir.mkdir(parents=True, exist_ok=True)
    _write_json(supp_dir / "appearances_sourced.json", supp["sourced"])
    _write_json(supp_dir / "link_review.json", supp["review"])
    (supp_dir / "SUPPLEMENT.md").write_text(supplement_link.render_report(supp), encoding="utf-8")
    return tables


if __name__ == "__main__":
    t = run()
    total = sum(len(r) for r in t.values())
    print(f"wcdraft ETL: wrote {len(t)} tables, {total:,} rows -> {OUTPUT_DIR}/")
    for name in sorted(t):
        print(f"  {name:24s} {len(t[name]):>7,}")
