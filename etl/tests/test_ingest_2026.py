"""WS-A-2026 ingest: determinism/golden, structure, identity links, projected
rating sanity, Team2026 + Bracket2026 integrity, and honest-state guards.

SELF-CONTAINED: the 2026 ingest reads the committed Wikipedia snapshots
(etl/sources/wikipedia_2026/) + the committed canonical 1930-2022 tables
(etl/output/), so the suite runs without any network. The fixed input is those
committed bytes; the locked output is the committed ``*_2026.json``.
"""

from __future__ import annotations

import json

import pytest

from wcdraft_etl import identity_2026 as idn
from wcdraft_etl import ingest_2026, rating, rating_2026

OUT = ingest_2026.OUTPUT_DIR

# Baskets for the projection-sanity invariant. Traditional powers vs debutants /
# minnows — chosen by football reputation, NOT by their computed score.
POWERS = {"Brazil", "Argentina", "France", "Spain", "Germany", "England", "Portugal", "Netherlands"}
MINNOWS = {"Curaçao", "Cape Verde", "Haiti", "Uzbekistan", "Jordan", "New Zealand", "South Africa"}


# ─── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def built() -> dict:
    return ingest_2026.build_all()


@pytest.fixture(scope="session")
def cards(built) -> list[dict]:
    return built["player_tournaments_2026"]


@pytest.fixture(scope="session")
def ratings(built) -> list[dict]:
    return built["ratings_2026"]


@pytest.fixture(scope="session")
def teams(built) -> list[dict]:
    return built["teams_2026"]


@pytest.fixture(scope="session")
def bracket(built) -> dict:
    return built["bracket_2026"]


@pytest.fixture(scope="session")
def nation_name() -> dict[str, str]:
    canon = json.loads((OUT / "nations.json").read_text())
    names = {n["nation_id"]: n["canonical_name"] for n in canon}
    names.update({n["nation_id"]: n["canonical_name"] for n in idn.NEW_NATIONS})
    return names


def _team_score(t: dict) -> float:
    a = t["aggregate_rating"]
    return (a["attack"] + a["midfield"] + a["defense"] + a["goalkeeping"]) / 4


# ─── determinism + golden ─────────────────────────────────────────────────────


def test_build_is_deterministic():
    a = ingest_2026.build_all()
    b = ingest_2026.build_all()
    for k in a:
        sa = json.dumps(a[k], ensure_ascii=False, indent=2, sort_keys=True)
        sb = json.dumps(b[k], ensure_ascii=False, indent=2, sort_keys=True)
        assert sa == sb, f"{k} differs between builds"


def test_matches_committed_golden(built):
    """Every committed *_2026.json must equal a fresh build, byte for byte (the CI
    git-diff guard enforces the same thing after a clean rebuild)."""
    for name, rows in built.items():
        committed = (OUT / f"{name}.json").read_text(encoding="utf-8")
        fresh = json.dumps(rows, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        assert committed == fresh, f"etl/output/{name}.json is stale — re-run the 2026 ingest."


# ─── structure: 48 teams, groups, squad sizes ─────────────────────────────────


def test_forty_eight_teams_twelve_groups(teams):
    assert len(teams) == 48
    from collections import Counter

    per_group = Counter(t["group"] for t in teams)
    assert sorted(per_group) == list("ABCDEFGHIJKL")
    assert set(per_group.values()) == {4}


def test_group_slots_unique_1_to_4(teams):
    from collections import defaultdict

    slots = defaultdict(set)
    for t in teams:
        assert 1 <= t["group_slot"] <= 4
        slots[t["group"]].add(t["group_slot"])
    for g, s in slots.items():
        assert s == {1, 2, 3, 4}, (g, s)


def test_squad_sizes_and_three_goalkeepers(teams, cards):
    by_nation: dict[str, list[dict]] = {}
    for c in cards:
        by_nation.setdefault(c["nation_id"], []).append(c)
    for t in teams:
        squad = by_nation[t["nation_id"]]
        assert 23 <= len(squad) <= 26, (t["team_id"], len(squad))
        gks = sum(1 for c in squad if c["position_listed"] == "GK")
        assert gks >= 3, (t["team_id"], gks)
        assert len(t["squad_card_ids"]) == len(squad)


# ─── identity: nations + cross-tournament player links ────────────────────────


def test_distinct_nations_and_five_mints(teams):
    assert len({t["nation_id"] for t in teams}) == 48
    assert len(idn.NEW_NATIONS) == 5
    minted = {t["nation_id"] for t in teams if t["nation_id"].startswith("T-W26-")}
    assert len(minted) == 5


def test_player_ids_unique(cards):
    pids = [c["player_id"] for c in cards]
    assert len(pids) == len(set(pids))


def test_cross_tournament_links_share_one_player_id(cards):
    """A 2026 player who also played a 1930-2022 edition LINKS to that canonical
    player_id (shares one id across tournaments)."""
    canonical_cards = json.loads((OUT / "player_tournaments.json").read_text())
    tours_of: dict[str, set[str]] = {}
    for c in canonical_cards:
        tours_of.setdefault(c["player_id"], set()).add(c["tournament_id"])

    linked = [c for c in cards if c["link_status"] == "linked"]
    assert len(linked) >= 200  # the 2022 cohort overlap is substantial
    # Every linked id resolves to a REAL prior canonical card (no phantom links).
    for c in linked:
        assert c["player_id"] in tours_of, c["player_id"]
    # A concrete marquee link: someone who played WC-2022 AND 2026 on one id.
    players = {p["player_id"]: p for p in json.loads((OUT / "players.json").read_text())}
    messi = [
        c for c in linked if players.get(c["player_id"], {}).get("full_name") == "Lionel Messi"
    ]
    assert len(messi) == 1
    assert "WC-2022" in tours_of[messi[0]["player_id"]]


def test_no_canonical_id_linked_to_two_players(cards):
    """A wrong-merge guard: no canonical player_id is reused for two different 2026
    players (the Timber-twins failure mode)."""
    from collections import Counter

    linked_ids = [c["player_id"] for c in cards if c["link_status"] == "linked"]
    dups = {k: v for k, v in Counter(linked_ids).items() if v > 1}
    assert dups == {}


def test_same_dob_namesakes_are_not_merged(cards):
    """Both Timber twins (same nation, DOB, surname) must resolve to DISTINCT ids."""
    timbers = [c for c in cards if c["nation_id"] == "T-48" and c["birth_date"] == "2001-06-17"]
    # Both Jurriën and Quinten are in the Dutch squad; if present, ids must differ.
    if len(timbers) == 2:
        assert timbers[0]["player_id"] != timbers[1]["player_id"]


# ─── projected ratings: shape, honest-state, sanity ───────────────────────────


def test_ratings_join_and_bounds(ratings, cards):
    by_card = {c["card_id"]: c for c in cards}
    assert len(ratings) == len(cards)
    for r in ratings:
        assert r["card_id"] in by_card
        assert r["card_id"] == f"{r['player_id']}:{r['tournament_id']}"
        # Phase 1.1 decoupled: sim channels on [FLOOR_CHANNEL, 100] band;
        # only `overall` lives on the recalibrated display band [66, 99].
        for ch in ("attack", "midfield", "defense", "goalkeeping"):
            assert isinstance(r[ch], int) and rating.FLOOR_CHANNEL <= r[ch] <= 100
        assert (
            isinstance(r["overall"], int)
            and rating.DISPLAY_FLOOR <= r["overall"] <= rating.DISPLAY_MAX
        )
        assert r["provenance"] == "projected_career"
        assert r["coverage_basis"] == "career_signals"
        assert r["rating_version"] == rating_2026.RATING_VERSION


def test_no_null_overall_for_2026_cards(ratings):
    """Career signals exist for every current player, so no 2026 card takes the
    insufficient-signal null path (contrast wc-perf's pre-1970 keepers)."""
    assert all(r["overall"] is not None for r in ratings)


def test_defenders_and_keepers_never_rated_on_goals(ratings, cards):
    pos = {c["card_id"]: c["position_listed"] for c in cards}
    checked = 0
    for r in ratings:
        if pos[r["card_id"]] in ("DF", "GK"):
            gp = next(c for c in r["components"] if c["signal"] == "goals_percentile")
            assert gp["weight"] == 0.0, r["card_id"]
            checked += 1
    assert checked > 0


def test_tournament_anchors_dropped_not_zeroed(ratings):
    """Awards / team finish are UNEARNED pre-tournament: shown null, weight 0 —
    honestly dropped, never substituted with a fabricated 0."""
    for r in ratings:
        comp = {c["signal"]: c for c in r["components"]}
        for sig in ("award_score", "team_finish"):
            assert comp[sig]["value"] is None and comp[sig]["weight"] == 0.0




def test_projected_rating_version_is_phase1(ratings):
    assert rating_2026.RATING_VERSION == "proj-career-2.0.0"
    for r in ratings:
        assert r["rating_version"] == "proj-career-2.0.0"


def test_projected_distribution_shape(ratings):
    """Projected pool reshaped onto [66, 99] by the shared display curve.
    Slightly looser than historical because n=1,246 vs n=10,973, but same
    contract: floor exact, max <= 99, no 100s, thin elite tail."""
    overalls = sorted(r["overall"] for r in ratings)
    n = len(overalls)
    assert overalls[0] == rating.DISPLAY_FLOOR
    assert overalls[-1] <= rating.DISPLAY_MAX
    assert overalls[-1] >= rating.DISPLAY_MAX - 1
    assert 100 not in set(overalls)
    median = overalls[n // 2]
    p95 = overalls[int(0.95 * (n - 1))]
    assert rating.DISPLAY_MEDIAN - 2 <= median <= rating.DISPLAY_MEDIAN + 2, median
    assert rating.DISPLAY_P95 - 2 <= p95 <= rating.DISPLAY_P95 + 2, p95
    share_95 = sum(1 for ov in overalls if ov >= 95) / n
    share_98 = sum(1 for ov in overalls if ov >= 98) / n
    assert share_95 <= 0.030, share_95
    assert share_98 <= 0.010, share_98


def test_projected_no_estimate_path(ratings):
    """2026 cards never take the estimate path (caps are always present), so
    no `overall_basis` field is emitted — distinct from the historical schema."""
    for r in ratings:
        assert "overall_basis" not in r

def test_strong_nations_aggregate_higher(teams, nation_name):
    """Every traditional power outranks every debutant/minnow — a robust ordering
    invariant that does not hinge on the exact elite ranking."""
    power_scores = [_team_score(t) for t in teams if nation_name[t["nation_id"]] in POWERS]
    minnow_scores = [_team_score(t) for t in teams if nation_name[t["nation_id"]] in MINNOWS]
    assert len(power_scores) == len(POWERS)
    assert len(minnow_scores) == len(MINNOWS)
    # The weakest power outranks the strongest minnow (no inversion).
    assert min(power_scores) > max(minnow_scores), (min(power_scores), max(minnow_scores))
    # ...and the basket means are clearly separated (not a knife-edge).
    assert sum(power_scores) / len(power_scores) - sum(minnow_scores) / len(minnow_scores) >= 2.5


# ─── Team2026 ─────────────────────────────────────────────────────────────────


def test_team2026_shape(teams, ratings):
    rating_cards = {r["card_id"] for r in ratings}
    for t in teams:
        # Rosters are published (2026-06-02) but the tournament has not started
        # (opening match 2026-06-11): the contract's 'locked', not 'final'.
        assert t["squad_status"] == "locked"
        assert t["rating_version"] == rating_2026.RATING_VERSION
        assert t["team_id"] == f"WC2026-{t['group']}{t['group_slot']}"
        assert t["squad_card_ids"] == sorted(t["squad_card_ids"])
        assert all(cid in rating_cards for cid in t["squad_card_ids"])
        agg = t["aggregate_rating"]
        for ch in ("attack", "midfield", "defense", "goalkeeping"):
            # Phase 1.1 decoupled: aggregates on sim band [FLOOR_CHANNEL, 100].
            assert rating.FLOOR_CHANNEL <= agg[ch] <= 100
        assert 0.0 <= agg["coverage"] <= 1.0
        # Cited to BOTH the squads snapshot and the draw (group_slot provenance).
        assert {s["source_type"] for s in t["sources"]} == {"wikipedia"}
        assert any(s["field"] == "group_slot" for s in t["sources"])


# ─── Bracket2026 ──────────────────────────────────────────────────────────────


def test_bracket_groups(bracket):
    assert len(bracket["groups"]) == 12
    for g in bracket["groups"]:
        assert len(g["team_ids"]) == 4
        assert g["team_ids"] == sorted(g["team_ids"])


def test_bracket_knockout_tree(bracket):
    from collections import Counter

    slots = bracket["knockout_slots"]
    # Single-elimination seat counts: 32+16+8+4+2.
    assert Counter(s["round"] for s in slots) == {"R32": 32, "R16": 16, "QF": 8, "SF": 4, "F": 2}
    # No dangling match_winner reference.
    match_ids = {s["match_id"] for s in slots}
    for s in slots:
        if s["source"]["kind"] == "match_winner":
            assert s["source"]["match_slot_id"] in match_ids


def test_bracket_r32_feeders(bracket):
    """R32 is fed by exactly the 12 group winners + 12 runners-up (each group once)
    + 8 best-third seats — the real top-2-plus-8-thirds structure."""
    r32 = [s for s in bracket["knockout_slots"] if s["round"] == "R32"]
    assert len(r32) == 32
    winners = sorted(s["source"]["group_id"] for s in r32 if s["source"].get("position") == 1)
    runners = sorted(s["source"]["group_id"] for s in r32 if s["source"].get("position") == 2)
    thirds = [s for s in r32 if s["source"]["kind"] == "best_third"]
    assert winners == list("ABCDEFGHIJKL")
    assert runners == list("ABCDEFGHIJKL")
    assert len(thirds) == 8
    for s in thirds:
        assert 2 <= len(s["source"]["candidate_groups"]) <= 6
        assert all(g in "ABCDEFGHIJKL" for g in s["source"]["candidate_groups"])


# ─── honest-state / legal ─────────────────────────────────────────────────────


def test_manifest_and_attribution(built):
    manifest = json.loads((OUT / "manifest_2026.json").read_text())
    assert "CC-BY-SA" in manifest["license"]
    assert "Wikipedia" in manifest["attribution"]
    assert manifest["counts"]["cards"] == len(built["player_tournaments_2026"])
    assert manifest["honest_state"]["overall_null_2026_cards"] == 0
