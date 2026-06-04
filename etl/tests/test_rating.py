"""WS-A Rating: golden determinism, schema bounds, honest-state, and sanity.

These tests are SELF-CONTAINED: the rating stage reads the committed canonical
JSON in etl/output/, so the suite runs without the upstream Fjelstul CSV clone
(unlike the ingestion tests). The fixed input dataset is the committed canonical
tables; the locked output is the committed ratings.json.
"""

from __future__ import annotations

import json

import pytest

from wcdraft_etl import rating

# ─── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def built() -> list[dict]:
    """Ratings rebuilt from the committed canonical tables."""
    return rating.build_all()


@pytest.fixture(scope="session")
def by_id(built: list[dict]) -> dict[str, dict]:
    return {r["card_id"]: r for r in built}


@pytest.fixture(scope="session")
def cards() -> dict[str, dict]:
    return {c["card_id"]: c for c in rating._load(rating.OUTPUT_DIR, "player_tournaments")}


@pytest.fixture(scope="session")
def players() -> list[dict]:
    return rating._load(rating.OUTPUT_DIR, "players")


def _card_id(
    players: list[dict], cards: dict[str, dict], common_name: str, tournament_id: str
) -> str:
    """Resolve a card_id by player common_name + tournament — name-based so the
    sanity assertions stay readable and survive any player_id renumbering."""
    pids = {p["player_id"] for p in players if p["common_name"] == common_name}
    matches = [
        c["card_id"]
        for c in cards.values()
        if c["player_id"] in pids and c["tournament_id"] == tournament_id
    ]
    assert len(matches) == 1, f"expected one {common_name} card in {tournament_id}, got {matches}"
    return matches[0]


# ─── determinism + golden ─────────────────────────────────────────────────────


def test_build_is_deterministic():
    a = json.dumps(rating.build_all(), ensure_ascii=False, indent=2, sort_keys=True)
    b = json.dumps(rating.build_all(), ensure_ascii=False, indent=2, sort_keys=True)
    assert a == b


def test_matches_committed_golden(built: list[dict]):
    """The committed ratings.json must equal a fresh build, byte for byte. The CI
    job additionally enforces this with `git diff --exit-code` after regenerating;
    this in-process check fails fast and locally with a readable diff hint."""
    committed_text = (rating.OUTPUT_DIR / "ratings.json").read_text(encoding="utf-8")
    fresh_text = json.dumps(built, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    assert committed_text == fresh_text, (
        "etl/output/ratings.json is stale — run `python -m wcdraft_etl.rating` and commit."
    )


def test_rows_sorted_by_card_id(built: list[dict]):
    ids = [r["card_id"] for r in built]
    assert ids == sorted(ids)


# ─── schema bounds (mirrors the core RatingSchema contract) ───────────────────


def test_schema_bounds(built: list[dict], cards: dict[str, dict]):
    for r in built:
        assert r["card_id"] == f"{r['player_id']}:{r['tournament_id']}"
        assert r["card_id"] in cards  # joins 1:1 with the canonical card table
        # The four sim channels are ALWAYS present integers in [0, 100].
        for ch in ("attack", "midfield", "defense", "goalkeeping"):
            assert isinstance(r[ch], int) and 0 <= r[ch] <= 100, (r["card_id"], ch, r[ch])
        # overall is ALWAYS a real int in [0,100] now (no null path, wc-perf-1.1.0).
        assert isinstance(r["overall"], int) and 0 <= r["overall"] <= 100, r["card_id"]
        assert r["overall_basis"] in ("measured_performance", "baseline_anchor_estimate")
        assert r["appearances_source"] in (None, "fjelstul_match_events", "rsssf_starting_xi")
        assert r["coverage"] in (0.6667, 0.8333, 1.0)
        assert r["coverage_basis"] == "wc_signals"
        assert r["provenance"] == "wc_performance"
        assert r["rating_version"] == rating.RATING_VERSION
        for comp in r["components"]:
            assert comp["signal"]
            assert comp["value"] is None or isinstance(comp["value"], (int, float))
            assert isinstance(comp["weight"], (int, float)) and comp["weight"] >= 0


def test_scope_is_mens_only(built: list[dict]):
    tours = {t["tournament_id"]: t for t in rating._load(rating.OUTPUT_DIR, "tournaments")}
    for r in built:
        assert "Men's" in tours[r["tournament_id"]]["name"], r["card_id"]


# ─── honest-state: NEVER substitute 0 for a missing signal ────────────────────


def test_missing_appearances_stay_null_never_zero(built: list[dict], cards: dict[str, dict]):
    """A card whose source appearances are null (pre-1970) must surface that as a
    null component value — never a fabricated 0."""
    checked = 0
    for r in built:
        src = cards[r["card_id"]]
        if src["appearances"] is None:
            comp = {c["signal"]: c for c in r["components"]}
            assert comp["appearances"]["value"] is None
            assert comp["appearances_percentile"]["value"] is None
            assert comp["appearances_percentile"]["weight"] == 0.0
            checked += 1
    assert checked > 0  # the pre-1970 era actually exercises this path


def test_non_semifinalist_team_finish_is_null(built: list[dict]):
    """team_finish exists for semifinalists only; otherwise it is null, dropped
    from the weighting — not read as a 0-placement."""
    saw_null = saw_value = False
    for r in built:
        tf = next(c for c in r["components"] if c["signal"] == "team_finish")
        if tf["value"] is None:
            saw_null = True
        else:
            assert tf["value"] in rating.FINISH_POINTS.values()
            saw_value = True
    assert saw_null and saw_value


def test_no_card_has_null_overall(built: list[dict]):
    """THE WS-A guarantee: every men's card carries a real overall in [1,100].
    The old ``overall = null`` path is gone."""
    nulls = [r["card_id"] for r in built if r["overall"] is None]
    assert nulls == []
    for r in built:
        assert isinstance(r["overall"], int) and r["overall"] >= 1, r["card_id"]


def test_estimate_basis_only_for_unlinked_presignal_defenders_and_keepers(
    built: list[dict], cards: dict[str, dict]
):
    """A baseline_anchor_estimate (overall computed from the replacement baseline
    + team-finish/award anchor, NOT measured performance) may ONLY appear where it
    is justified: a DF/GK whose appearances could not be sourced/linked (goals
    carry zero weight for DF/GK). It never invents a box score — the absent stat
    stays null in components — and it is always flagged + low-coverage."""
    estimates = [r for r in built if r["overall_basis"] == "baseline_anchor_estimate"]
    assert estimates, "the honest-estimate path should be exercised by the residual cards"
    for r in estimates:
        src = cards[r["card_id"]]
        assert src["position_listed"] in {"DF", "GK"}, r["card_id"]
        assert src["appearances"] is None and src["appearances_source"] is None, r["card_id"]
        comp = {c["signal"]: c for c in r["components"]}
        assert comp["goals_percentile"]["weight"] == 0.0
        assert comp["appearances_percentile"]["weight"] == 0.0
        assert comp["appearances"]["value"] is None  # never a fabricated 0
        assert r["overall"] >= rating.FLOOR_CHANNEL  # never below the replacement floor
        assert r["coverage"] < 1.0  # an estimate is always honestly low-coverage


def test_sourced_appearances_lift_formerly_null_defenders(players, cards, by_id):
    """The headline WS-A win: a pre-1970 champion defender (Bobby Moore '66) that
    was previously overall=null now carries a REAL, measured, coverage-1.0 rating
    from his RSSSF-sourced appearances + champion finish."""
    cid = _card_id(players, cards, "Moore", "WC-1966")
    r = by_id[cid]
    src = cards[cid]
    assert src["position_listed"] == "DF"
    assert src["appearances"] == 6  # all six England matches, sourced from RSSSF
    assert src["appearances_source"] == "rsssf_starting_xi"
    assert r["overall_basis"] == "measured_performance"
    assert r["coverage"] == 1.0
    assert r["overall"] >= 80  # champion DF who started every match -> elite tier
    comp = {c["signal"]: c for c in r["components"]}
    assert comp["goals_percentile"]["weight"] == 0.0  # still never rated on goals
    assert comp["appearances_percentile"]["weight"] == 1.0
    assert comp["team_finish"]["value"] == 1.0


def test_defenders_and_keepers_are_never_rated_on_goals(built: list[dict], cards: dict[str, dict]):
    checked = 0
    for r in built:
        src = cards[r["card_id"]]
        if src["position_listed"] not in {"DF", "GK"}:
            continue
        comp = {c["signal"]: c for c in r["components"]}
        assert comp["goals_percentile"]["weight"] == 0.0, r["card_id"]
        checked += 1
    assert checked > 0


# ─── sanity: assert, don't eyeball ────────────────────────────────────────────


def test_known_greats_rate_highly(players, cards, by_id):
    def ov(name, tid):
        return by_id[_card_id(players, cards, name, tid)]["overall"]

    # Post-1970 apex tournaments are UNCHANGED by the supplement (pre-1970 sourcing
    # only re-cohorts pre-1970 cards): decorated Golden-Ball winners pin at 100.
    assert ov("Maradona", "WC-1986") == 100
    assert ov("Zidane", "WC-2006") == 100
    assert ov("Zidane", "WC-1998") == 81  # undecorated champion
    assert ov("Pelé", "WC-1970") == 82  # champion, no award existed in 1970

    # Pelé 1958 (Best Young Player + Silver Boot, age 17) was a clamped 100 when
    # pre-1970 cards had NO appearance signal. With his real WS-A appearances
    # (4 of Brazil's 6 matches — he missed the first two injured) now feeding the
    # base, he lands at the very top of the elite band rather than pinned at the
    # ceiling. Signal-driven, documented (see RATING_METHODOLOGY.md "WS-A deltas").
    assert ov("Pelé", "WC-1958") >= 95


def test_high_appearance_low_goal_defender_not_tanked(players, cards, by_id):
    """A defender who started every match must NOT be punished for not scoring."""
    cid = _card_id(players, cards, "Mertesacker", "WC-2014")  # DF, champion, 6 apps, 0 goals
    r = by_id[cid]
    assert r["overall"] == 90
    assert r["defense"] == 90  # his own channel reflects the strong tournament
    comp = {c["signal"]: c for c in r["components"]}
    assert comp["goals_percentile"]["weight"] == 0.0
    assert comp["appearances_percentile"]["weight"] == 1.0
    src = cards[cid]
    assert src["goals"] == 0 and src["position_listed"] == "DF"  # guards the premise


def test_residual_unlinked_defender_is_honest_floor_estimate(players, cards, by_id):
    """A pre-1970 DF/GK whose appearances could NOT be sourced and whose team did
    not reach the semifinals has no individual signal and no finish anchor: it
    sits on the replacement floor — every sim channel == FLOOR_CHANNEL and a
    flagged baseline_anchor_estimate overall of exactly FLOOR_CHANNEL — rather
    than the old withheld null. Found structurally so it survives re-linking."""
    floors = [
        r
        for r in by_id.values()
        if r["overall_basis"] == "baseline_anchor_estimate"
        and next(c for c in r["components"] if c["signal"] == "team_finish")["value"] is None
        and rating._award_score(cards[r["card_id"]]["awards"]) == 0.0
    ]
    assert floors, "expected residual unlinked, unplaced pre-1970 defenders/keepers"
    for r in floors:
        assert r["overall"] == rating.FLOOR_CHANNEL, r["card_id"]
        assert {r[ch] for ch in ("attack", "midfield", "defense", "goalkeeping")} == {
            rating.FLOOR_CHANNEL
        }, r["card_id"]


def test_era_normalization_pre1990_great_not_dwarfed(players, cards, by_id):
    """A pre-1990 great must not be dwarfed by a modern average player — proving
    signals are normalized within-era. Values shifted from wc-perf-1.0.0 because
    pre-1970 appearances now feed the base (Puskás played only 3 of 1954's matches
    around injury; Fontaine started all 6 of 1958) — signal-driven, documented."""
    puskas = by_id[_card_id(players, cards, "Puskás", "WC-1954")]["overall"]
    fontaine = by_id[_card_id(players, cards, "Fontaine", "WC-1958")]["overall"]
    journeyman = by_id[_card_id(players, cards, "Rodrigo", "WC-2018")]["overall"]  # 0g/3app, no run
    assert fontaine >= 90  # 13 goals + Golden Boot + started every match, within 1958
    assert puskas >= 70  # runner-up, elite, still clearly above a modern journeyman
    assert puskas > journeyman + 20
    assert fontaine > journeyman + 20
