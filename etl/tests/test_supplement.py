"""WS-A supplement: RSSSF parser + linker correctness, completeness, integrity.

Self-contained — reads the committed canonical JSON in etl/output/ plus the
committed raw RSSSF snapshots, so it runs without the upstream Fjelstul CSV clone.
The committed snapshots are a fixed input, so these assertions are stable.
"""

from __future__ import annotations

import json

import pytest

from wcdraft_etl.rating import OUTPUT_DIR, _load
from wcdraft_etl.supplement import KNOWN_MATCH_COUNT, RSSSF_TOURNAMENTS
from wcdraft_etl.supplement import link as supplement
from wcdraft_etl.supplement.rsssf import load_lineups


@pytest.fixture(scope="session")
def tables() -> dict[str, list[dict]]:
    return {
        name: _load(OUTPUT_DIR, name)
        for name in ("players", "player_tournaments", "tournaments")
    }


@pytest.fixture(scope="session")
def supp(tables) -> dict:
    return supplement.build_supplement(
        tables["players"], tables["player_tournaments"], tables["tournaments"]
    )


@pytest.fixture(scope="session")
def sourced_by_card(supp) -> dict[str, dict]:
    return {s["card_id"]: s for s in supp["sourced"]}


def _card_id(tables, common_name: str, tournament_id: str) -> str:
    pids = {p["player_id"] for p in tables["players"] if p["common_name"] == common_name}
    matches = [
        c["card_id"]
        for c in tables["player_tournaments"]
        if c["player_id"] in pids and c["tournament_id"] == tournament_id
    ]
    assert len(matches) == 1, f"expected one {common_name} in {tournament_id}, got {matches}"
    return matches[0]


# ─── completeness gate ────────────────────────────────────────────────────────


def test_parser_recovers_exact_match_count_per_tournament():
    """The parser must recover exactly the known number of matches from each
    archive page (2 starting XIs per match). This is the completeness gate that
    lets per-player counts be trusted; a drift would withhold the tournament."""
    for tournament_id, raw_file in RSSSF_TOURNAMENTS.items():
        lineups = load_lineups(raw_file)
        assert len(lineups) == 2 * KNOWN_MATCH_COUNT[tournament_id], tournament_id


def test_every_sourced_tournament_is_complete(supp):
    for t in supp["report"]["tournaments"]:
        assert t["complete"] is True, t["tournament_id"]
        assert t["matches_parsed"] == t["matches_known"], t["tournament_id"]


# ─── documented appearance counts (assert, don't eyeball) ─────────────────────


def test_known_appearance_counts_match_history(tables, sourced_by_card):
    """Spot-check linked counts against well-documented World Cup facts."""
    expected = {
        ("Moore", "WC-1966"): 6,  # England champion, every match
        ("Banks", "WC-1966"): 6,  # England GK, every match
        ("Hurst", "WC-1966"): 3,  # came in at the quarter-final
        ("Pelé", "WC-1958"): 4,  # missed the first two group games injured
        ("Garrincha", "WC-1958"): 4,  # introduced from the third match
        ("Didi", "WC-1958"): 6,  # played every match
    }
    for (name, tid), apps in expected.items():
        cid = _card_id(tables, name, tid)
        assert cid in sourced_by_card, f"{name} {tid} should be sourced"
        assert sourced_by_card[cid]["appearances"] == apps, (name, tid)


# ─── integrity: link don't guess; source don't fabricate ──────────────────────


def test_surname_collision_is_reviewed_not_guessed(supp):
    """Bobby Charlton '66 is written "R.Charlton" by RSSSF (formal initial R vs
    canonical given "Bobby"), colliding with brother Jack — the initial cannot
    uniquely split them, so it must be WITHHELD to review, never guessed onto
    either Charlton. The candidate ids are recorded for a human to resolve."""
    charlton = [
        r
        for r in supp["review"]
        if r["reason"] == "ambiguous_collision"
        and r["rsssf_surname"].lower().endswith("charlton")
        and r["tournament_id"] == "WC-1966"
    ]
    assert charlton, "the Charlton '66 collision must be in the review list"
    for r in charlton:
        assert r["rsssf_initial"] == "R"
        assert len(r["candidates"]) == 2  # both Charltons, for human resolution


def test_no_sourced_appearance_is_a_fabricated_zero(supp):
    for s in supp["sourced"]:
        assert s["appearances"] >= 1, s["card_id"]
        assert s["appearances_source"] == "rsssf_starting_xi"
        assert s["method"] in ("surname", "surname+initial", "demerged")


def test_supplement_never_synthesises_minutes_or_assists(supp):
    for s in supp["sourced"]:
        for forbidden in ("minutes", "assists", "minutes_played"):
            assert forbidden not in s, (s["card_id"], forbidden)


def test_review_rows_are_auditable(supp):
    valid_reasons = {
        "no_canonical_match",
        "nation_unresolved",
        "ambiguous_collision",
        "ambiguous_no_initial",
    }
    for r in supp["review"]:
        assert r["reason"] in valid_reasons
        assert r["tournament_id"]
        assert r["rsssf_surname"]
        assert r["lineup_occurrences"] >= 1


# ─── determinism ──────────────────────────────────────────────────────────────


def test_build_supplement_is_deterministic(tables):
    a = supplement.build_supplement(
        tables["players"], tables["player_tournaments"], tables["tournaments"]
    )
    b = supplement.build_supplement(
        tables["players"], tables["player_tournaments"], tables["tournaments"]
    )
    dump = lambda o: json.dumps(o, ensure_ascii=False, sort_keys=True)  # noqa: E731
    assert dump(a["sourced"]) == dump(b["sourced"])
    assert dump(a["review"]) == dump(b["review"])
