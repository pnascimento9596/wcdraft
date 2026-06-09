"""WS-A Rating: golden determinism, schema bounds, honest-state, and the
``wc-perf-2.0.0`` recalibration acceptance suite.

SELF-CONTAINED: the rating stage reads the committed canonical JSON in
``etl/output/``, so the suite runs without the upstream Fjelstul CSV clone
(unlike the ingestion tests). The fixed input dataset is the committed canonical
tables; the locked output is the committed ratings.json.

PHASE 1 RECALIBRATION (wc-perf-2.0.0):
  * Display floor 66, p50 ~ 73, p95 ~ 88, max 99 (no 100s).
  * baseline_anchor_estimate cards banded into [66, 73] on OVERALL only.
  * Decoupled path (plan section 3.2 fallback) LANDED: the calibration curve
    drives ``overall`` ONLY. The four sim channels stay on the pre-recal
    ``[FLOOR_CHANNEL, 100]`` band; ``calibration.ts`` is UNCHANGED from
    ``origin/main`` (lambda, channels, engine_version all unchanged). The sim
    is byte-identical to ``origin/main`` (sim-golden.json: 0 diff).
  * OVR is the believability view of the pre-display COMPOSITE merit score;
    it is NOT a per-channel proxy and not a sim-strength predictor (sim uses
    channels). OVR<->channel divergence is by design.
  * No new data ingestion. Only the existing committed signals are re-shaped.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from wcdraft_etl import rating

REPO_ROOT = Path(__file__).resolve().parents[2]

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


@pytest.fixture(scope="session")
def tournaments() -> dict[str, dict]:
    return {t["tournament_id"]: t for t in rating._load(rating.OUTPUT_DIR, "tournaments")}


@pytest.fixture(scope="session")
def awards() -> list[dict]:
    return rating._load(rating.OUTPUT_DIR, "awards")


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


def _quantile(xs: list[int | float], q: float) -> float:
    xs = sorted(xs)
    n = len(xs)
    if n == 0:
        raise AssertionError("empty quantile input")
    if n == 1:
        return float(xs[0])
    pos = (n - 1) * q
    lo = int(pos)
    hi = min(lo + 1, n - 1)
    return float(xs[lo]) * (1.0 - (pos - lo)) + float(xs[hi]) * (pos - lo)


# ─── determinism + golden ─────────────────────────────────────────────────────


def test_build_is_deterministic():
    a = json.dumps(rating.build_all(), ensure_ascii=False, indent=2, sort_keys=True)
    b = json.dumps(rating.build_all(), ensure_ascii=False, indent=2, sort_keys=True)
    assert a == b


def test_matches_committed_golden(built: list[dict]):
    """Committed ratings.json must equal a fresh build, byte for byte. The CI
    git-diff guard enforces the same after a clean rebuild."""
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
        # Phase 1.1 (decoupled): sim channels stay on the pre-recalibration
        # [FLOOR_CHANNEL, 100] band so the engine's λ stays calibrated to
        # modern-era (1998-2022) WC norms. Only `overall` is on the display band.
        for ch in ("attack", "midfield", "defense", "goalkeeping"):
            assert isinstance(r[ch], int) and rating.FLOOR_CHANNEL <= r[ch] <= 100, (
                r["card_id"],
                ch,
                r[ch],
            )
        # overall is ALWAYS a real int in [DISPLAY_FLOOR, DISPLAY_MAX].
        assert (
            isinstance(r["overall"], int)
            and rating.DISPLAY_FLOOR <= r["overall"] <= rating.DISPLAY_MAX
        ), r["card_id"]
        assert r["overall_basis"] in (
            "measured_performance",
            "career_stature_estimate",
            "baseline_anchor_estimate",
        )
        assert r["appearances_source"] in (None, "fjelstul_match_events", "rsssf_starting_xi")
        assert r["coverage"] in (0.6667, 0.8333, 1.0)
        assert r["coverage_basis"] == "wc_signals"
        assert r["provenance"] == "wc_performance"
        assert r["rating_version"] == rating.RATING_VERSION
        for comp in r["components"]:
            assert comp["signal"]
            assert comp["value"] is None or isinstance(comp["value"], (int, float))
            assert isinstance(comp["weight"], (int, float)) and comp["weight"] >= 0


def test_rating_version_is_stature_dominant(built: list[dict]):
    # wc-perf-4.0.0 = the merit-v2 stature-dominant rebase (MV2-4).
    assert rating.RATING_VERSION == "wc-perf-4.1.0"
    for r in built:
        assert r["rating_version"] == "wc-perf-4.1.0"


def test_every_row_carries_a_boolean_legend(built: list[dict]):
    """Each rating row joins career_stature.json.legend (missing row → False). This
    is the rating-layer join MV2-7's compact builder reads; it never re-derives the
    badge from overall."""
    for r in built:
        assert isinstance(r["legend"], bool), r["card_id"]
    assert any(r["legend"] for r in built)  # legends exist
    assert any(not r["legend"] for r in built)  # most cards are not legends


def test_scope_is_mens_only(built: list[dict], tournaments: dict[str, dict]):
    for r in built:
        assert "Men's" in tournaments[r["tournament_id"]]["name"], r["card_id"]


# ─── §4 acceptance: distribution shape (the recalibration headline) ───────────


def test_overall_distribution_shape(built: list[dict]):
    """Reshaped onto [66, 99] with the documented anchors. The exact target
    quantiles are slightly elastic (±1) because the curve is fit on measured
    internal anchors, but the floor and max are HARD."""
    overalls = [r["overall"] for r in built]
    assert min(overalls) == rating.DISPLAY_FLOOR
    assert max(overalls) <= rating.DISPLAY_MAX
    assert max(overalls) >= rating.DISPLAY_MAX - 1  # the elite tail must reach the top
    assert 0 not in {ov for ov in overalls}  # no zero-filled holes
    assert all(rating.DISPLAY_FLOOR <= ov <= rating.DISPLAY_MAX for ov in overalls)
    # No 100s — the old pinned-at-ceiling failure mode.
    assert 100 not in set(overalls), "wc-perf-2.0.0 caps the display max at 99 — no overall == 100"

    median = _quantile(overalls, 0.50)
    p95 = _quantile(overalls, 0.95)
    assert rating.DISPLAY_MEDIAN - 1 <= median <= rating.DISPLAY_MEDIAN + 1, median
    assert rating.DISPLAY_P95 - 1 <= p95 <= rating.DISPLAY_P95 + 1, p95


def test_elite_tail_is_thin(built: list[dict]):
    """The elite tail must be a true tail, not a clump — guards against the
    old ‘pin at 100’ failure mode."""
    overalls = [r["overall"] for r in built]
    n = len(overalls)
    share_95 = sum(1 for ov in overalls if ov >= 95) / n
    share_98 = sum(1 for ov in overalls if ov >= 98) / n
    assert share_95 <= 0.02, f"share >=95 was {share_95:.4f} (target <=0.020)"
    assert share_98 <= 0.006, f"share >=98 was {share_98:.4f} (target <=0.006)"


def test_floor_is_not_a_clump(built: list[dict]):
    """The display floor must hold a real population (the estimate band is
    banded onto it) but the channel/overall distribution must not collapse to
    a single mode at the floor."""
    overalls = [r["overall"] for r in built]
    n = len(overalls)
    share_at_floor = sum(1 for ov in overalls if ov == rating.DISPLAY_FLOOR) / n
    # 388/10973 ≈ 0.035; allow a wide window so it’s tolerant to small
    # data refreshes but still flags a regression that pins everything to 66.
    assert share_at_floor < 0.15, f"too many overalls clumped at floor: {share_at_floor:.4f}"


# ─── §4 acceptance: low-DOF curve guard ───────────────────────────────────────


def test_display_curve_is_low_dof():
    """The recalibration is a global low-DOF curve, not a per-player override
    table. The contract: one shared curve kind name + three global exponents +
    four data anchors fit on the emitted dataset. No additional knobs."""
    assert rating.DISPLAY_CURVE_KIND == "global_piecewise_power_v1"
    free_exponents = {
        "low": rating.DISPLAY_LOW_EXPONENT,
        "mid": rating.DISPLAY_MID_EXPONENT,
        "high": rating.DISPLAY_HIGH_EXPONENT,
    }
    assert len(free_exponents) == 3
    for k, v in free_exponents.items():
        assert isinstance(v, (int, float)) and v > 0.0, (k, v)
    # No per-player override MAPPING in the module (a stray word "override" in
    # a comment is fine — what we forbid is a runtime data structure that lets
    # individual players be hand-tuned). Strip comments before checking, then
    # look for both runtime mappings and the obvious markers.
    raw_module_text = Path(rating.__file__).read_text(encoding="utf-8")
    code_only_lines = []
    for line in raw_module_text.splitlines():
        stripped = line.split("#", 1)[0]
        code_only_lines.append(stripped)
    code_text = "\n".join(code_only_lines)
    assert not re.search(r"PLAYER[_-]?OVERRIDES?\s*[:=]", code_text)
    assert not re.search(r"per[_-]?player[_-]?override", code_text, flags=re.IGNORECASE)
    # Mapping keyed by a player_id literal (P-#### -> number) is the smoking gun.
    assert not re.search(r"\bP-\d{3,}\b\s*:", code_text)


# ─── §4 acceptance: ordering / monotonicity ───────────────────────────────────


def test_display_curve_replay_is_byte_stable(built: list[dict], cards: dict[str, dict]):
    """Determinism check: a fresh build from the committed canonical tables
    produces the same ``overall`` for every card as the committed build. This
    is the BYTE-STABLE REPLAY invariant — separate from the curve-monotonicity
    invariant asserted by ``test_display_overall_is_monotonic_vs_composite_*``.
    """
    players_rows = rating._load(rating.OUTPUT_DIR, "players")
    mt_rows = rating._load(rating.OUTPUT_DIR, "manager_tournaments")
    tournaments_rows = rating._load(rating.OUTPUT_DIR, "tournaments")
    pt_rows = list(cards.values())
    rebuilt = rating.build_ratings(
        players=players_rows,
        cards=pt_rows,
        tournaments=tournaments_rows,
        manager_tournaments=mt_rows,
        career_stature_by_player=rating._load_career_stature(rating.OUTPUT_DIR),
    )
    assert {r["card_id"] for r in rebuilt} == {r["card_id"] for r in built}
    rebuilt_by_id = {r["card_id"]: r for r in rebuilt}
    for r in built:
        assert rebuilt_by_id[r["card_id"]]["overall"] == r["overall"], (
            r["card_id"],
            rebuilt_by_id[r["card_id"]]["overall"],
            r["overall"],
        )


# ─── §4 acceptance: curve monotonicity — the RIGHT invariant ──────────────────
#
# `overall` is the believability view of the PRE-DISPLAY COMPOSITE merit score
# (`score_0_100` = era-normalized goals/apps blend + award lift + finish lift,
# clamped to [0,1], scaled to [0, 100]). The display curve is monotonic
# non-decreasing BY CONSTRUCTION (piecewise-power on `score_0_100`), so for
# two MEASURED (non-estimate) cards A and B, composite(A) > composite(B) MUST
# imply overall(A) >= overall(B).
#
# OVR is NOT a per-channel proxy and is NOT a sim-strength predictor. Channels
# are decoupled (Phase 1.1) and live on the pre-recal [FLOOR_CHANNEL, 100] sim
# band; the sim consumes the four channels via `simulateMatchCore`, never OVR.
# OVR-vs-channel divergence is by design — see
# `packages/core/SIM_CALIBRATION.md`. Tightening the OVR<->channel correlation
# is a model-design item flagged for engine-v2, NOT this PR.


def _build_internal_view():
    players_rows = rating._load(rating.OUTPUT_DIR, "players")
    cards_rows = rating._load(rating.OUTPUT_DIR, "player_tournaments")
    tournaments_rows = rating._load(rating.OUTPUT_DIR, "tournaments")
    mt_rows = rating._load(rating.OUTPUT_DIR, "manager_tournaments")
    return rating.build_internal_view(
        players=players_rows,
        cards=cards_rows,
        tournaments=tournaments_rows,
        manager_tournaments=mt_rows,
        career_stature_by_player=rating._load_career_stature(rating.OUTPUT_DIR),
    )


def test_display_overall_is_monotonic_vs_composite_for_measured_cards():
    """The curve's right monotonicity invariant: for MEASURED (non-estimate)
    cards, composite(A) > composite(B) implies overall(A) >= overall(B).

    Pure measured-vs-measured composite breaks are forbidden — they would
    indicate a real curve bug. Estimate-band inversions are handled by the
    next test and by the existing estimate-banding tests; they are EXPECTED
    and intentional (honest-state cap, see test_estimates_are_banded_and_honest).
    """
    internal, curve = _build_internal_view()
    measured = [r for r in internal if r["overall_basis"] == "measured_performance"]
    enriched = [
        (
            r["card_id"],
            r["score_0_100"],
            rating._display_score(r["score_0_100"], curve, estimate=False),
        )
        for r in measured
    ]
    enriched.sort(key=lambda x: (x[1], x[0]))
    last_overall = -1
    inversions = []
    for cid, comp, ov in enriched:
        if ov < last_overall:
            inversions.append({
                "card": cid,
                "composite": comp,
                "overall": ov,
                "prior_max_overall": last_overall,
            })
        if ov > last_overall:
            last_overall = ov
    assert not inversions, (
        f"composite -> overall monotonicity broken for {len(inversions)} "
        f"measured cards (first 5): {inversions[:5]}"
    )


def test_overall_inversions_vs_composite_are_confined_to_estimate_pairs():
    """Frame the OVR-vs-composite ordering directly: every pair (A, B) where
    overall(A) > overall(B) but composite(A) < composite(B) must include at
    least one estimate-flagged card. The estimate band cap (display in
    [ESTIMATE_FLOOR, ESTIMATE_CEILING]) is the ONLY mechanism that can
    produce such an inversion — honest-state forbids an unlinked card from
    displaying above the band regardless of its raw composite.

    Reviewer's classification: every "inversion" against a single channel is
    either (a) composite-vs-single-channel divergence (channels are NOT OVR;
    enforced by the decoupling contract in rating.py + SIM_CALIBRATION.md), or
    (b) intentional estimate-band cap (this test confines those). Pure
    measured-vs-measured composite breaks — case (c) — would be a real curve
    bug; this test fails if any are found.
    """
    internal, curve = _build_internal_view()
    enriched = []
    for r in internal:
        is_est = r["overall_basis"] == "baseline_anchor_estimate"
        ov = rating._display_score(r["score_0_100"], curve, estimate=is_est)
        enriched.append({
            "card_id": r["card_id"],
            "composite": r["score_0_100"],
            "overall": ov,
            "is_estimate": is_est,
        })
    enriched.sort(key=lambda x: (x["composite"], x["card_id"]))
    max_overall = -1
    max_overall_is_estimate = False
    max_overall_card = None
    breaks = []
    for c in enriched:
        if max_overall_card is not None and c["overall"] < max_overall:
            both_measured = (not c["is_estimate"]) and (not max_overall_is_estimate)
            if both_measured:
                breaks.append({
                    "lower_composite_higher_overall": max_overall_card,
                    "higher_composite_lower_overall": c["card_id"],
                    "delta_overall": max_overall - c["overall"],
                })
        if c["overall"] > max_overall:
            max_overall = c["overall"]
            max_overall_is_estimate = c["is_estimate"]
            max_overall_card = c["card_id"]
    assert not breaks, (
        f"pure measured-vs-measured composite inversions: {len(breaks)} "
        f"(first 5: {breaks[:5]})"
    )


# ─── §4 acceptance: public anchor TRAIN / HELD-OUT ────────────────────────────


_TRAIN_AWARDS = {"Golden Ball", "Golden Boot", "Golden Glove"}
_HELDOUT_AWARDS = {"Silver Ball", "Bronze Ball", "Silver Boot", "Bronze Boot", "Best Young Player"}


def test_public_award_anchor_train_holdout(
    built: list[dict], awards: list[dict], tournaments: dict[str, dict]
):
    """Distinguished cards (named-anchor bands) come from PUBLIC sources only:
    Golden Ball / Boot / Glove etc. The curve was NOT fit to specific players —
    only to the four global quantiles. The named anchors must therefore land
    in plausible bands on BOTH a training subset (used by the recalibration
    designer as expected lift) AND a held-out subset never used to tune.

    ANTI-OVERFIT CONTRACT: TRAIN and HELD-OUT must be CARD-DISJOINT. A card
    that won both a TRAIN award (e.g. Golden Boot) and a HELD-OUT award
    (e.g. Silver Ball) at the same tournament is assigned to TRAIN — the
    HELD-OUT bucket cannot reference any card the designer could have seen
    as a TRAIN signal. The assertion `train_card_ids.isdisjoint(held_card_ids)`
    locks this in.
    """
    by_card = {r["card_id"]: r for r in built}
    mens_ids = {t["tournament_id"] for t in tournaments.values() if "Men's" in t["name"]}

    # Pass 1: group all awards by card_id so we know each card's full award set.
    awards_per_card: dict[str, set[str]] = {}
    for a in awards:
        if a["tournament_id"] not in mens_ids:
            continue
        cid = f"{a['player_id']}:{a['tournament_id']}"
        if cid not in by_card:
            continue
        awards_per_card.setdefault(cid, set()).add(a["award_name"])

    # Pass 2: card-disjoint partition. A card with ANY train award goes TRAIN.
    train_cards: set[str] = set()
    held_cards: set[str] = set()
    for cid, names in awards_per_card.items():
        if names & _TRAIN_AWARDS:
            train_cards.add(cid)
        elif names & _HELDOUT_AWARDS:
            held_cards.add(cid)

    # Lock the anti-overfit invariant.
    assert train_cards.isdisjoint(held_cards), (
        "TRAIN and HELD-OUT must be card-disjoint; overlap="
        f"{sorted(train_cards & held_cards)}"
    )
    anchored = train_cards | held_cards

    train_overalls = [by_card[cid]["overall"] for cid in train_cards]
    held_overalls = [by_card[cid]["overall"] for cid in held_cards]
    assert train_overalls, "TRAIN anchors empty — public awards source missing"
    assert held_overalls, "HELDOUT anchors empty — public awards source missing"

    train_median = _quantile(train_overalls, 0.50)
    train_p10 = _quantile(train_overalls, 0.10)
    held_median = _quantile(held_overalls, 0.50)
    held_p10 = _quantile(held_overalls, 0.10)
    non_anchor = [r["overall"] for cid, r in by_card.items() if cid not in anchored]
    non_anchor_median = _quantile(non_anchor, 0.50)

    # TRAIN must be visibly elite.
    assert train_median >= 88, train_median
    assert train_p10 >= 80, train_p10
    # HELD-OUT must also be elite — proves the curve isn’t overfit to TRAIN.
    # The held-out median is the anti-overfit lower bound on the curve’s
    # generalization quality. After the disjoint split (Phase 1.1), the held-out
    # cohort is smaller and lacks the cards whose double-award lifted them into
    # TRAIN, so the median floor is recomputed against the disjoint cohort.
    assert held_median >= 80, held_median
    assert held_p10 >= 74, held_p10
    # Ordering: TRAIN above HELD above non-anchor by a real margin.
    assert train_median >= held_median, (train_median, held_median)
    assert held_median >= non_anchor_median + 5, (held_median, non_anchor_median)


# ─── §4 acceptance: pre-1982 era sanity ───────────────────────────────────────


def test_pre1978_golden_boot_winners_not_systematically_depressed(
    built: list[dict], awards: list[dict]
):
    """Golden Ball was first awarded at WC-1978; Golden Boot exists from WC-1930.
    Pre-1978 greats lack the Golden-Ball cross-era lift, so an over-fit curve
    could systematically under-rate them. This test guards that pre-1978
    Golden-Boot winners land in a plausible elite band."""
    by_card = {r["card_id"]: r for r in built}
    pre_1978 = [
        a
        for a in awards
        if a["award_name"] == "Golden Boot" and int(a["tournament_id"][3:]) < 1978
    ]
    overalls = [by_card[f"{a['player_id']}:{a['tournament_id']}"]["overall"] for a in pre_1978]
    assert overalls, "expected pre-1978 Golden Boot data"
    median = _quantile(overalls, 0.50)
    p10 = _quantile(overalls, 0.10)
    assert median >= 85, median
    assert p10 >= 78, p10


def test_named_era_anchors_land_in_expected_bands(players, cards, by_id):
    """Spot-check named greats land in plausible bands. Values are bands, not
    exact equalities — the curve maps internal merit deterministically, but the
    final integer is allowed to drift one tick on minor data refreshes."""
    def ov(name, tid):
        return by_id[_card_id(players, cards, name, tid)]["overall"]

    # Maradona '86 and Zidane '06 — decorated apex performers (Golden Ball).
    assert 96 <= ov("Maradona", "WC-1986") <= 99
    assert 96 <= ov("Zidane", "WC-2006") <= 99
    # Pelé '58 — Best Young Player + Silver Boot + champion at 17.
    assert ov("Pelé", "WC-1958") >= 93
    # Pelé '70 — champion, no individual award in 1970.
    assert ov("Pelé", "WC-1970") >= 85
    # Fontaine '58 — 13 goals + Golden Boot + started every match.
    assert ov("Fontaine", "WC-1958") >= 90
    # Puskás '54 — runner-up, top striker of his era (one of his player_ids).
    puskas_cid = "P-12676:WC-1954"
    assert by_id[puskas_cid]["overall"] >= 80
    # Rodrigo '18 — modern journeyman, no run, 0 goals 3 apps.
    rodrigo = ov("Rodrigo", "WC-2018")
    assert rodrigo <= 80
    # Cross-era invariant: Puskás '54 clearly above modern journeyman.
    assert by_id[puskas_cid]["overall"] > rodrigo + 5


def test_great_pre1970_defender_lands_in_elite_band(players, cards, by_id):
    """Bobby Moore '66 — England champion captain DF with all-6 RSSSF
    appearances supplemented — must land near the top of the DF band."""
    cid = _card_id(players, cards, "Moore", "WC-1966")
    r = by_id[cid]
    src = cards[cid]
    assert src["position_listed"] == "DF"
    assert src["appearances"] == 6
    assert src["appearances_source"] == "rsssf_starting_xi"
    assert r["overall_basis"] == "measured_performance"
    assert r["coverage"] == 1.0
    assert r["overall"] >= 88


def test_strong_defender_not_punished_for_zero_goals(players, cards, by_id):
    """Mertesacker '14 — champion DF, 6 apps 0 goals — is never penalized for not
    scoring (goals carry zero weight), and DEFENSE is his strictly dominant sim
    channel. Under wc-perf-4.0.0 a solid-but-not-legendary champion DF lands
    mid-band (he is NOT an all-time-legend stature card), so the absolute elite
    magnitude is intentionally lower than the old capped-lift model; the final
    elite-defender display band is MV2-8's named-anchor surface."""
    cid = _card_id(players, cards, "Mertesacker", "WC-2014")
    r = by_id[cid]
    src = cards[cid]
    assert src["goals"] == 0 and src["position_listed"] == "DF"
    # Defender invariant: defense is the dominant channel by a real margin.
    assert r["defense"] > r["attack"]
    assert r["defense"] > r["midfield"]
    assert r["defense"] > r["goalkeeping"]
    assert r["defense"] >= rating.FLOOR_CHANNEL + 30  # well clear of the floor
    comp = {c["signal"]: c for c in r["components"]}
    assert comp["goals_percentile"]["weight"] == 0.0
    assert comp["appearances_percentile"]["weight"] == 1.0


# ─── §4 acceptance: estimate band ─────────────────────────────────────────────


def test_estimates_are_banded_and_honest(built: list[dict], cards: dict[str, dict]):
    """``baseline_anchor_estimate`` rows: count holds; overall in
    [ESTIMATE_FLOOR, ESTIMATE_CEILING] (display); channels on the unchanged sim
    band [FLOOR_CHANNEL, 100] — Phase 1.1 decoupled scheme. Honest-state
    preserved (no fabricated appearances, low coverage, goals weight zero
    for DF/GK)."""
    estimates = [r for r in built if r["overall_basis"] == "baseline_anchor_estimate"]
    assert estimates, "the honest-estimate path should be exercised by the residual cards"
    # 387 under wc-perf-4.0.0: one former baseline card now has material+elite career
    # stature and correctly routes to the (now live) career_stature_estimate basis.
    assert len(estimates) == 387
    for r in estimates:
        assert rating.ESTIMATE_FLOOR <= r["overall"] <= rating.ESTIMATE_CEILING, r["card_id"]
        for ch in ("attack", "midfield", "defense", "goalkeeping"):
            assert rating.FLOOR_CHANNEL <= r[ch] <= 100, (r["card_id"], ch)
        assert r["coverage"] < 1.0
        src = cards[r["card_id"]]
        assert src["position_listed"] in {"DF", "GK"}
        assert src["appearances"] is None and src["appearances_source"] is None
        comp = {c["signal"]: c for c in r["components"]}
        assert comp["goals_percentile"]["weight"] == 0.0
        assert comp["appearances_percentile"]["weight"] == 0.0
        assert comp["appearances"]["value"] is None  # never a fabricated 0


def test_estimates_cannot_outrate_linked_greats(built: list[dict]):
    """An estimate-band card may never exceed a measured great's overall —
    the headline ordering invariant of the estimate tier."""
    estimates = [r for r in built if r["overall_basis"] == "baseline_anchor_estimate"]
    measured = [r for r in built if r["overall_basis"] == "measured_performance"]
    max_estimate = max(r["overall"] for r in estimates)
    measured_top = max(r["overall"] for r in measured)
    assert max_estimate <= rating.ESTIMATE_CEILING
    assert max_estimate < measured_top


# ─── §4 acceptance: honest-state nulls ────────────────────────────────────────


def test_missing_appearances_stay_null_never_zero(built: list[dict], cards: dict[str, dict]):
    """A card whose source appearances are null (pre-1970) surfaces that as a
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
    assert checked > 0  # the pre-1970 era exercises this path


def test_non_semifinalist_team_finish_is_null(built: list[dict]):
    """team_finish exists for semifinalists only; otherwise null, dropped from
    weighting — not read as a 0-placement."""
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
    """Every men's card carries a real overall on the new display band."""
    nulls = [r["card_id"] for r in built if r["overall"] is None]
    assert nulls == []
    for r in built:
        assert isinstance(r["overall"], int) and r["overall"] >= rating.DISPLAY_FLOOR, r["card_id"]


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


# ─── MV2-4 acceptance: stature-dominant INTERNAL-score invariants ─────────────
#
# These assert INTERNAL-score / channel behavior, NOT final display. The unified
# display curve (MV2-6) and the final display-band named anchors (MV2-8) land later;
# `overall` here is provisional (the existing curve refit to the new distribution).


def _career_comp(rating_row: dict, signal: str):
    return next(c["value"] for c in rating_row["components"] if c["signal"] == signal)


def _internal_by_card():
    internal, _ = _build_internal_view()
    return {r["card_id"]: r for r in internal}


def _final(internal_row: dict) -> float:
    return internal_row["score_0_100"] / 100.0


def test_legend_weak_tournament_stays_elite_and_apex_can_exceed_target(players, cards):
    """A recognized great's WEAK World Cup still reads elite (bounded down-mod off a
    high stature target), while an APEX tournament can EXCEED the stature target via
    positive modulation. Pelé-1966 / Messi-2010 (stature path) rise far above the v3
    underweighted raw floor; Pelé-1958 / Maradona-1986 exceed their career target."""
    internal = _internal_by_card()

    def card(name, tid):
        return internal[_card_id(players, cards, name, tid)]

    pele66 = card("Pelé", "WC-1966")
    # Stature-path card: full stature weight, final far above the raw floor.
    assert _career_comp(pele66, "stature_model_weight") == 1.0
    assert _final(pele66) >= 0.80, _final(pele66)
    # Modulation is bounded (a weak tournament cannot collapse a legend).
    assert _career_comp(pele66, "tournament_modulation") >= -0.12

    messi10 = card("Messi", "WC-2010")
    assert _career_comp(messi10, "stature_model_weight") == 1.0
    assert _final(messi10) >= 0.85, _final(messi10)

    # Apex cards EXCEED the career target via positive modulation.
    for name, tid in (("Pelé", "WC-1958"), ("Maradona", "WC-1986")):
        r = card(name, tid)
        target = _career_comp(r, "stature_target_score")
        assert _final(r) > target, (name, _final(r), target)


def test_career_aggregates_constant_per_player_modulation_varies(players, by_id):
    internal = _internal_by_card()
    pele_ids = {p["player_id"] for p in players if p["common_name"] == "Pelé"}
    pele_cards = [r for r in internal.values() if r["player_id"] in pele_ids]
    assert len(pele_cards) >= 3
    # career_stature_score / index / coverage are CAREER aggregates — identical.
    for sig in ("career_stature_score", "career_stature_index", "career_stature_coverage"):
        vals = {_career_comp(r, sig) for r in pele_cards}
        assert len(vals) == 1 and None not in vals, (sig, vals)
    # The per-card tournament modulation is NOT constant (depends on each card's raw).
    mods = {_career_comp(r, "tournament_modulation") for r in pele_cards}
    assert len(mods) > 1, mods


def test_formerly_zeroed_defender_gk_legends_are_now_material():
    """The v2 repair: Cruyff / Baresi / Maldini / Yashin were zeroed (no lift) under
    the v1 thin-coverage gate. Under stature-dominant they are material-stature
    cards (full stature weight) and read elite — no longer the raw floor. Keyed by
    canonical player_id (NOT common_name — 'Baresi' is also Franco's brother
    Giuseppe P-55733, who is correctly NOT a material-stature legend)."""
    internal = _internal_by_card()
    # Franco Baresi, Paolo Maldini, Lev Yashin, Johan Cruyff.
    for name, pid in (("Cruyff", "P-50564"), ("Baresi", "P-42920"),
                      ("Maldini", "P-43222"), ("Yashin", "P-09317")):
        rows = [r for r in internal.values() if r["player_id"] == pid]
        assert rows, name
        for r in rows:
            assert _career_comp(r, "stature_model_weight") == 1.0, (name, r["card_id"])
            assert _final(r) >= 0.66, (name, r["card_id"], _final(r))


def test_channel_shape_non_attacker_legends_are_position_dominant(players, cards, by_id):
    """A DF/GK/MF legend reads elite on its POSITION channel, NOT uniformly elite
    (the inverse of 'not suppressed'): Maldini DEF ≫ ATT; Yashin GK ≫ outfield; a
    defender/keeper legend must NOT become a top-tier attacker."""
    def card(name, tid):
        return by_id[_card_id(players, cards, name, tid)]

    maldini = card("Maldini", "WC-2002")
    assert maldini["defense"] >= 80
    assert maldini["defense"] > maldini["attack"] + 20
    assert maldini["attack"] <= 60  # not a top-tier attacker

    yashin = card("Yashin", "WC-1966")
    assert yashin["goalkeeping"] >= 80
    assert yashin["goalkeeping"] > yashin["attack"]
    assert yashin["goalkeeping"] > yashin["midfield"]
    assert yashin["goalkeeping"] > yashin["defense"]
    assert yashin["attack"] <= 50  # a keeper is not an outfield threat


def test_raw_only_journeyman_is_not_in_the_high_stature_or_legend_band(players, cards, by_id):
    """A raw-only control (no material stature) stays primarily tournament-derived,
    bounded below the high-stature band, and is never a factual legend."""
    internal = _internal_by_card()

    def both(name, tid):
        cid = _card_id(players, cards, name, tid)
        return internal[cid], by_id[cid]

    ir, rr = both("Rodrigo", "WC-2018")
    assert _career_comp(ir, "stature_model_weight") == 0.0  # raw-only
    assert _final(ir) <= rating.RAW_ONLY_GLOBAL_CEILING + 1e-6
    assert rr["legend"] is False


def test_mid_band_control_lands_below_the_greats(players, cards, by_id):
    """Anti-inflation directional check (internal-score level): a solid international
    with modest recognition does not land in the recognized-greats internal band."""
    internal = _internal_by_card()
    # Rodrigo (modern journeyman) and any non-material card sit well below the greats.
    greats_floor = min(
        internal[_card_id(players, cards, n, t)]["score_0_100"]
        for n, t in (("Pelé", "WC-1966"), ("Messi", "WC-2010"), ("Maldini", "WC-2002"))
    )
    mid = internal[_card_id(players, cards, "Rodrigo", "WC-2018")]["score_0_100"]
    assert mid + 20 < greats_floor, (mid, greats_floor)


def test_continuity_no_cliff_across_the_material_threshold():
    """The stature_model_weight ramp is continuous: two crafted cards whose career
    index straddles MATERIAL_STATURE_MIN_INDEX by ε differ by < N internal points
    (no cliff). Asserts MV2-4's continuity-ramp, not a hard gate."""
    eps = 0.01
    lo_idx = rating.MATERIAL_STATURE_MIN_INDEX - eps
    hi_idx = rating.MATERIAL_STATURE_MIN_INDEX + eps
    tournaments = [{"tournament_id": "WC-1998", "name": "1998 Men's World Cup"}]

    def fw_card(pid, goals):
        return {
            "card_id": f"{pid}:WC-1998", "player_id": pid, "tournament_id": "WC-1998",
            "nation_id": "N-T", "position_listed": "FW", "goals": goals, "appearances": 5,
            "appearances_source": "fjelstul_match_events", "awards": None, "coverage": 1.0,
        }

    # Two near-identical FW cards with the SAME raw tournament profile; only the
    # career index differs by 2ε across the threshold.
    players = [
        {"player_id": "P-LO", "common_name": "LO", "primary_position": "FW"},
        {"player_id": "P-HI", "common_name": "HI", "primary_position": "FW"},
    ]
    cards = [fw_card("P-LO", 3), fw_card("P-HI", 3)]
    # Pad the cohort so the curve is non-degenerate.
    for i, g in enumerate((0, 1, 2, 4, 6)):
        players.append({"player_id": f"P-Q{i}", "common_name": f"Q{i}", "primary_position": "FW"})
        cards.append(fw_card(f"P-Q{i}", g))

    def career_row(pid, idx):
        return {
            "player_id": pid, "career_stature_score": 0.30, "career_stature_index": idx,
            "coverage": 1.0, "stature_tier": "bronze", "legend": False,
        }

    career = {"P-LO": career_row("P-LO", lo_idx), "P-HI": career_row("P-HI", hi_idx)}
    internal = {
        r["card_id"]: r
        for r in rating._build_internal_rows(players, cards, tournaments, [], career)
    }
    lo = internal["P-LO:WC-1998"]["score_0_100"]
    hi = internal["P-HI:WC-1998"]["score_0_100"]
    # Weights straddle 0.5 ± a small ramp step; internal scores stay within a few pts.
    assert abs(hi - lo) < 6.0, (lo, hi)


def test_no_card_overall_reaches_100(built: list[dict]):
    """No card pins at the display ceiling (provisional curve still caps at 99)."""
    assert 100 not in {r["overall"] for r in built}
    assert max(r["overall"] for r in built) == rating.DISPLAY_MAX


# ─── §4 acceptance: provenance / legal grep ───────────────────────────────────


# Proprietary game-rating terms that must never appear in our ETL source pins.
# We deliberately do NOT include the three-letter token "pes" alone because it
# collides with non-proprietary content (e.g. surnames such as "Lópes-Herranz"
# in pre-1970 RSSSF starting XIs). The longer, unambiguous tokens below are
# what catches a proprietary rating-source contamination.
_PROPRIETARY_PATTERN = re.compile(
    r"sofifa|futbin|fifa[-_ ]?ratings|easports|ea\s*sports\s*fc|pro\s*evolution\s*soccer|"
    r"\befootball\b|\bpes\s*\d|konami\s*pes",
    re.IGNORECASE,
)


def test_etl_source_pins_have_no_proprietary_rating_references():
    """ETL source pins + supplement & merit raw inputs must NOT mention any
    proprietary rating source. The recalibration is clean-room: every signal comes
    from public, factually-grounded sources (Fjelstul + RSSSF + Wikipedia + the
    IFFHS + the merit-source-set-2.0.0 recognition archives).

    The merit raw tree is scanned RECURSIVELY, so the v2 source-set subtrees
    (``rsssf/``, ``wiki/``, ``iffhs/``) are covered automatically. Public football
    facts — award names, all-time / dream teams, tournament names, FIFA tri-codes,
    and ``FIFA 100`` as a public factual source — are NOT proprietary rating IP and
    do not match the pattern; only the Sofifa / Futbin / EA Sports FC / PES /
    eFootball / Konami product family does."""
    scan_dirs = [
        REPO_ROOT / "etl" / "sources",
        REPO_ROOT / "etl" / "supplement" / "raw",
        REPO_ROOT / "etl" / "merit" / "raw",  # merit-source raw snapshots (recursive)
        # MV2 recon cross-check reference (REVIEW-ONLY; never a rating source).
        # Reference data + provenance only — it must carry zero proprietary
        # rating tokens, same as every other source tree.
        REPO_ROOT / "etl" / "merit" / "external_review" / "recon",
    ]
    hits: list[str] = []
    for d in scan_dirs:
        if not d.exists():
            continue
        for path in d.rglob("*"):
            if not path.is_file():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except (OSError, UnicodeDecodeError):
                continue
            for m in _PROPRIETARY_PATTERN.finditer(text):
                hits.append(f"{path.relative_to(REPO_ROOT)}: {m.group(0)!r}")
    assert hits == [], "proprietary rating references in ETL source pins:\n" + "\n".join(hits)


def test_merit_parser_and_linker_code_has_no_proprietary_rating_references():
    """The merit parser / linker / registry CODE must not reference a proprietary
    rating source either. Every module is scanned EXCEPT ``__init__.py``, which is
    the documented home of the ``PROPRIETARY_SOURCE_TOKENS`` block list (those tokens
    are forbidden STRINGS, never sources) — that file's brand-neutrality is enforced
    separately by ``test_merit.test_outputs_and_code_carry_no_governing_body_brand``.
    """
    merit_src = REPO_ROOT / "etl" / "src" / "wcdraft_etl" / "merit"
    hits: list[str] = []
    for path in sorted(merit_src.glob("*.py")):
        if path.name == "__init__.py":
            continue  # block-list / proprietary-wall declaration home
        text = path.read_text(encoding="utf-8")
        for m in _PROPRIETARY_PATTERN.finditer(text):
            hits.append(f"{path.relative_to(REPO_ROOT)}: {m.group(0)!r}")
    assert hits == [], "proprietary rating references in merit code:\n" + "\n".join(hits)
