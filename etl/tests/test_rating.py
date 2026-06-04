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
        # overall is DISPLAY-only: an int in [0,100] or honest null.
        assert r["overall"] is None or (isinstance(r["overall"], int) and 0 <= r["overall"] <= 100)
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


def test_null_overall_only_for_presignal_defenders_and_keepers(
    built: list[dict], cards: dict[str, dict]
):
    """The honest 'insufficient signal' null path may ONLY trigger where it is
    justified: a DF/GK with no individually measured performance signal (goals
    carry zero weight for DF/GK, and appearances are null pre-1970)."""
    nulls = [r for r in built if r["overall"] is None]
    assert nulls, "the null-overall honest path should be exercised by the dataset"
    expected = [
        r
        for r in built
        if cards[r["card_id"]]["position_listed"] in {"DF", "GK"}
        and cards[r["card_id"]]["appearances"] is None
    ]
    assert len(nulls) == len(expected)
    for r in nulls:
        src = cards[r["card_id"]]
        assert src["position_listed"] in {"DF", "GK"} and src["appearances"] is None, r["card_id"]


def test_no_overall_is_a_substituted_zero(built: list[dict]):
    for r in built:
        assert r["overall"] is None or r["overall"] >= 1


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

    # Decorated apex tournaments (Golden Ball / Golden Boot + deep run) -> the top.
    assert ov("Maradona", "WC-1986") == 100
    assert ov("Zidane", "WC-2006") == 100
    assert ov("Pelé", "WC-1958") == 100  # Best Young Player + Silver Boot, age 17
    # Champions without an award recorded that edition still rate clearly elite —
    # carried by box score + the team-finish anchor (the Golden Ball was only
    # introduced in 1982, so Pelé 1970 has no award signal to anchor on).
    assert ov("Zidane", "WC-1998") == 81
    assert ov("Pelé", "WC-1970") == 82


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


def test_pre1970_defenders_with_no_appearances_are_honest_nulls(players, cards, by_id):
    """Pre-1970 DFs have no appearance signal and are never backfilled from goals.

    Placed teams still lift sim channels through team finish; an undifferentiated
    non-semifinalist sits on the replacement floor with no display overall.
    """
    placed_id = _card_id(players, cards, "Moore", "WC-1966")  # champion DF
    placed = by_id[placed_id]
    placed_src = cards[placed_id]
    placed_comp = {c["signal"]: c for c in placed["components"]}
    assert placed_src["position_listed"] == "DF" and placed_src["appearances"] is None
    assert placed["overall"] is None
    assert placed_comp["goals_percentile"]["weight"] == 0.0
    assert placed_comp["appearances_percentile"]["weight"] == 0.0
    assert placed_comp["team_finish"]["value"] == 1.0
    assert placed["attack"] == 28
    assert placed["midfield"] == 34
    assert placed["defense"] == 44
    assert placed["goalkeeping"] == rating.FLOOR_CHANNEL

    floor_id = _card_id(players, cards, "Marzolini", "WC-1962")  # no semifinal finish
    floor = by_id[floor_id]
    floor_src = cards[floor_id]
    floor_comp = {c["signal"]: c for c in floor["components"]}
    assert floor_src["position_listed"] == "DF" and floor_src["appearances"] is None
    assert floor["overall"] is None
    assert floor_comp["goals_percentile"]["weight"] == 0.0
    assert floor_comp["appearances_percentile"]["weight"] == 0.0
    assert floor_comp["team_finish"]["value"] is None
    assert {floor[ch] for ch in ("attack", "midfield", "defense", "goalkeeping")} == {
        rating.FLOOR_CHANNEL
    }


def test_era_normalization_pre1990_great_not_dwarfed(players, cards, by_id):
    """A pre-1990 great must not be dwarfed by a modern average player — proving
    signals are normalized within-era, not on raw modern-inflated counts."""
    puskas = by_id[_card_id(players, cards, "Puskás", "WC-1954")]["overall"]
    fontaine = by_id[_card_id(players, cards, "Fontaine", "WC-1958")]["overall"]
    journeyman = by_id[_card_id(players, cards, "Rodrigo", "WC-2018")]["overall"]  # 0g/3app, no run
    assert puskas == 78
    assert fontaine == 95  # 13 goals + Golden Boot, normalized within 1958
    assert puskas > journeyman + 20
    assert fontaine > journeyman + 20
