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




def test_projected_rating_version_is_stature_reconciled(ratings):
    # proj-career-3.0.0 = the merit-v2 MV2-5 stature reconciliation of 2026.
    assert rating_2026.RATING_VERSION == "proj-career-3.0.0"
    for r in ratings:
        assert r["rating_version"] == "proj-career-3.0.0"


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


def test_projected_basis_is_stature_or_measured_never_baseline(ratings):
    """MV2-5: 2026 rows now carry overall_basis (the shared RatingSchema vocabulary)
    so MV2-7's compact builder reads one join. Caps are always present, so a 2026
    card NEVER takes the baseline_anchor_estimate path: it is either stature-driven
    (linked-material) or projected-raw-driven (measured_performance)."""
    seen = set()
    for r in ratings:
        assert r["overall_basis"] in ("career_stature_estimate", "measured_performance")
        seen.add(r["overall_basis"])
    # Both paths are exercised by the real 2026 squads.
    assert seen == {"career_stature_estimate", "measured_performance"}

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


# ─── MV2-5: 2026 linked-player stature reconciliation ─────────────────────────
# These assert INTERNAL-score behavior (the assertable MV2-5 quantity). The display
# `overall` is provisional until the unified curve (MV2-6), so display-band anchors
# (Messi >= 91 OVR, etc.) are NOT asserted here.

# Canonical player_ids surfaced explicitly for the eyeball anchors (mirrors the
# historical named-anchor test). Messi/Modrić = gold legends; the four *_SPURIOUS
# were OVR-99 projected MF cards on the old proj-career-2.0.0 raw formula.
_MESSI = "P-14758"
_VINICIUS = "P-92812"  # linked but BELOW material (low career index)
_SPURIOUS_99 = ("P-34205", "P-39584", "P-58692", "P-W26-0177")
_DF_LEGEND = "P-56029"  # van Dijk
_GK_LEGEND = "P-19408"  # Neuer


@pytest.fixture(scope="session")
def career_2026() -> dict[str, dict]:
    return rating._load_career_stature(OUT)


@pytest.fixture(scope="session")
def internal_2026(cards, career_2026) -> dict[str, dict]:
    """player_id -> INTERNAL projected row (pre-display, on the stature scale)."""
    rows = rating_2026.build_internal_view(cards, career_2026)
    return {r["player_id"]: r for r in rows}


def _comp(row: dict, signal: str):
    return next(c["value"] for c in row["components"] if c["signal"] == signal)


@pytest.fixture(scope="session")
def historical_raw_only_sorted() -> list[float]:
    """Sorted historical PURE raw-only (stature_model_weight==0) INTERNAL scores in
    [0,1], read read-only from committed ratings.json — the quantile-map target and
    the population MV2-6's single monotonic curve pools."""
    return rating_2026._historical_raw_only_internal(OUT)


@pytest.fixture(scope="session")
def projected_raw_only_sorted(internal_2026) -> list[float]:
    """Sorted 2026 PURE raw-only (weight==0) INTERNAL scores in [0,1]."""
    return sorted(
        r["score_0_100"] / 100.0
        for r in internal_2026.values()
        if _comp(r, "stature_model_weight") == 0.0
    )


def test_new_stature_components_emitted(ratings):
    """Every 2026 row carries the MV2-5 stature-reconciliation components (numeric;
    RatingComponentSchema stays numeric-only)."""
    required = {
        "projected_raw_score",
        "projected_reference_score",
        "projected_modulation",
        "career_stature_score",
        "career_stature_index",
        "career_stature_coverage",
        "stature_target_score",
        "stature_model_weight",
    }
    for r in ratings:
        signals = {c["signal"] for c in r["components"]}
        assert required <= signals, r["card_id"]
        for c in r["components"]:
            assert c["value"] is None or isinstance(c["value"], (int, float))


def test_minted_never_consume_career_stature(internal_2026, cards):
    """Minted / unlinked / ambiguous (any status != 'linked') never query career
    stature: career_* components are null, the stature weight is 0, and they can
    never carry a factual legend. The score is purely the projected raw path."""
    link_of = {c["player_id"]: c["link_status"] for c in cards}
    checked = 0
    for pid, row in internal_2026.items():
        if link_of[pid] == "linked":
            continue
        assert _comp(row, "career_stature_score") is None, pid
        assert _comp(row, "career_stature_index") is None, pid
        assert _comp(row, "stature_target_score") is None, pid
        assert _comp(row, "stature_model_weight") == 0.0, pid
        assert row["legend"] is False, pid
        assert row["overall_basis"] == "measured_performance", pid
        checked += 1
    assert checked > 0


def test_linked_material_reconciled_onto_stature_scale(internal_2026, cards):
    """Linked players whose career row clears the material gate ride the stature
    path: a populated career index, stature-dominant weight, the career_stature
    basis, and an internal score driven by the stature target (well above the
    raw-only band)."""
    link_of = {c["player_id"]: c["link_status"] for c in cards}
    material = [
        row
        for pid, row in internal_2026.items()
        if link_of[pid] == "linked"
        and _comp(row, "stature_model_weight") >= rating.STATURE_DOMINANT_WEIGHT
    ]
    assert len(material) >= 10  # the recognized 2026 greats
    for row in material:
        assert _comp(row, "career_stature_index") is not None, row["player_id"]
        assert _comp(row, "stature_target_score") is not None, row["player_id"]
        assert row["overall_basis"] == "career_stature_estimate", row["player_id"]
        # Stature-path internal score clears the marginal-material floor — it is NOT
        # confined to the raw-only band that caps non-material cards.
        assert row["score_0_100"] / 100.0 > rating.RAW_ONLY_GLOBAL_CEILING, row["player_id"]


def test_messi_no_longer_age_dominated(internal_2026):
    """The headline gap: linked Messi-2026 was age-suppressed on the old projected
    formula (raw-only). He now reads on the stature scale — stature-dominant weight,
    a near-peak target, the career_stature basis, and a factual legend."""
    row = internal_2026[_MESSI]
    assert _comp(row, "stature_model_weight") == 1.0
    assert row["overall_basis"] == "career_stature_estimate"
    assert row["legend"] is True
    # His internal final is the stature target (+ bounded modulation), an order above
    # the raw-only band — not the age-tempered projected raw he was pinned to before.
    assert row["score_0_100"] / 100.0 >= 0.95
    assert _comp(row, "stature_target_score") >= 0.90


def test_spurious_high_raw_cards_capped_below_material(internal_2026):
    """The four previously-OVR-99 projected MF cards (strong caps + top league, no
    material career stature) are now confined to the raw-only band: stature weight 0,
    measured_performance basis, no legend, internal score at/below the raw-only
    ceiling — strictly below the recognized-greats band. The Souček-class fix."""
    for pid in _SPURIOUS_99:
        row = internal_2026[pid]
        assert _comp(row, "stature_model_weight") == 0.0, pid
        assert row["overall_basis"] == "measured_performance", pid
        assert row["legend"] is False, pid
        # raw-only ceiling band, never the stature/legend band.
        assert row["score_0_100"] / 100.0 <= rating.RAW_ONLY_GLOBAL_CEILING + 1e-9, pid


def test_nonmaterial_quantiles_match_historical_raw_only(
    historical_raw_only_sorted, projected_raw_only_sorted
):
    """MV2-5 cross-era DENSITY neutralization (the headline fix). The 2026 pure
    raw-only (weight==0) INTERNAL distribution is empirically quantile-mapped onto the
    historical raw-only internal distribution, so a 2026 reserve at percentile p lands
    at the SAME internal score as a historical raw-only card at p — the population
    MV2-6's single monotonic curve pools. The replaced affine map matched only the
    bounds and left the 2026 floor ~0.14 and the median ~0.055 above historical (a
    2026 journeyman systematically out-rating a comparable historical one, which a
    monotonic curve cannot undo). Quantile mapping closes the whole distribution: the
    per-quantile cross-era gap must be ~0, not merely the bounds."""
    assert historical_raw_only_sorted and projected_raw_only_sorted
    for q in (0.01, 0.10, 0.25, 0.50, 0.75, 0.90, 0.99):
        h = rating._quantile(historical_raw_only_sorted, q)
        n = rating._quantile(projected_raw_only_sorted, q)
        assert abs(h - n) <= 0.01, (q, h, n)
    # Floors coincide exactly — the affine map's lifted 2026 floor is the regression
    # this guards: a 2026 reserve can sink to the historical replacement floor.
    assert min(projected_raw_only_sorted) <= min(historical_raw_only_sorted) + 1e-9


def test_2026_reserve_df_not_above_comparable_historical_reserve(
    internal_2026, historical_raw_only_sorted
):
    """Cross-era FLOOR parity, the concrete Mangala-2014 case from the review block:
    a 2026 pure-raw-only reserve defender must NOT out-internal a comparable modern
    historical reserve defender. Mangala (Man City, WC-2014) is a raw-only DF at
    internal ≈0.239; under the replaced affine map a 2026 bench DF floored ~0.10
    above him for no merit reason. The spurious-cap test guards the upper bound; this
    guards the FLOOR."""
    # Mangala-2014 internal, reconstructed from committed ratings.json (stable anchor).
    rj = {r["card_id"]: r for r in json.loads((OUT / "ratings.json").read_text())}
    mangala = rj["P-08834:WC-2014"]
    assert _comp(mangala, "stature_model_weight") == 0.0
    mangala_internal = min(
        _comp(mangala, "raw_tournament_score"), rating.RAW_ONLY_GLOBAL_CEILING
    )
    df_raw_only = sorted(
        r["score_0_100"] / 100.0
        for r in internal_2026.values()
        if r["pos"] == "DF" and _comp(r, "stature_model_weight") == 0.0
    )
    # 2026 reserve defenders reach AT/BELOW the Mangala-class internal — they are no
    # longer floored above comparable historical reserves.
    assert min(df_raw_only) <= mangala_internal + 1e-9, (min(df_raw_only), mangala_internal)
    # And the 2026 DF raw-only floor is the historical replacement floor, not lifted.
    assert min(df_raw_only) <= rating._quantile(historical_raw_only_sorted, 0.10) + 1e-9


def test_top_internal_scores_are_material_not_raw_artifacts(internal_2026):
    """The top of the 2026 INTERNAL distribution is dominated by linked global-
    stature players, not by projected-raw artifacts (the old failure: minnow/role-
    player MF cards pinning the top on caps+league alone)."""
    top = sorted(internal_2026.values(), key=lambda r: -r["score_0_100"])[:15]
    for row in top:
        assert _comp(row, "stature_model_weight") >= rating.STATURE_DOMINANT_WEIGHT, (
            row["player_id"],
            row["score_0_100"],
        )


def test_linked_below_material_stays_on_raw_path(internal_2026):
    """A LINKED player whose career index is below the material gate (e.g. a young
    star without an accumulated honours record) stays on the honest projected raw
    path — no stature target, no legend — exactly like a minted card."""
    row = internal_2026[_VINICIUS]
    assert _comp(row, "stature_model_weight") == 0.0
    assert _comp(row, "stature_target_score") is None
    assert row["overall_basis"] == "measured_performance"
    assert row["legend"] is False


def test_legend_join_is_linked_material_only(internal_2026, cards, career_2026):
    """legend is the factual career flag joined for linked players (missing row →
    False); minted cards never carry it. Every 2026 legend is a linked, material,
    legend-flagged career row."""
    link_of = {c["player_id"]: c["link_status"] for c in cards}
    legends = [pid for pid, row in internal_2026.items() if row["legend"]]
    assert len(legends) > 0
    for pid in legends:
        assert link_of[pid] == "linked", pid
        assert career_2026[pid]["legend"] is True, pid
        assert _comp(internal_2026[pid], "stature_model_weight") >= rating.STATURE_DOMINANT_WEIGHT


def test_defender_keeper_legends_are_position_shaped(internal_2026):
    """A 2026 DF/GK legend reads elite on its position channel, not uniformly elite
    across all four (the channel-shape invariant carries over from wc-perf-4.x): a
    centre-back must not become a top-tier attacker, a keeper must not be elite
    outfield."""
    df = internal_2026[_DF_LEGEND]
    df_ch = {
        ch: rating._channel(df["score_0_100"], rating.CHANNEL_SPREAD[df["pos"]][ch])
        for ch in rating.CHANNELS
    }
    assert df_ch["defense"] > df_ch["attack"]
    assert df_ch["defense"] > df_ch["goalkeeping"]

    gk = internal_2026[_GK_LEGEND]
    gk_ch = {
        ch: rating._channel(gk["score_0_100"], rating.CHANNEL_SPREAD[gk["pos"]][ch])
        for ch in rating.CHANNELS
    }
    assert gk_ch["goalkeeping"] > gk_ch["attack"]
    assert gk_ch["goalkeeping"] > gk_ch["defense"]


def test_missing_link_status_fails_loudly():
    """link_status is never defaulted: a 2026 card without it is a contract break."""
    bad = {
        "card_id": "P-00000:WC-2026",
        "player_id": "P-00000",
        "tournament_id": "WC-2026",
        "position_listed": "FW",
        "caps": 10,
        "intl_goals": 3,
        "birth_date": "1998-01-01",
        "club_nation_code": "ENG",
        "coverage": 0.7143,
        # link_status deliberately omitted
    }
    with pytest.raises(ValueError, match="link_status"):
        rating_2026.build_ratings([bad], {})


def test_two_builds_are_byte_identical():
    """Determinism: no per-player override, no nondeterministic ordering."""
    a = rating_2026.build_all()
    b = rating_2026.build_all()
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
