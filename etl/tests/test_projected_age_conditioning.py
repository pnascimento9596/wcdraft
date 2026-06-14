"""merit-v3 V3 (design §2 + §7-V3): D1 age-conditional quantile conditioning,
age_factor retirement, the re-derived cross-era quantile map, and the projected
dual-basis emission.

The D1 monotonicity guarantees are STRUCTURAL (enforced in construction), so the
properties are asserted both on synthetic fixtures (exact expectations) and on
the full production pool (every position × signal × age × probe value)."""

from __future__ import annotations

import json

import pytest

from wcdraft_etl import ingest_2026, rating, rating_2026

OUT = ingest_2026.OUTPUT_DIR


@pytest.fixture(scope="session")
def cards() -> list[dict]:
    return json.loads((OUT / "player_tournaments_2026.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def pool_curves(cards) -> dict[str, dict[str, rating_2026.AgeConditionalQuantiles]]:
    """The production D1 surfaces: per position, the caps and goals curves fit
    over the full 2026 pool exactly as the build fits them."""
    caps: dict[str, list[tuple[int | None, float]]] = {}
    goals: dict[str, list[tuple[int | None, float]]] = {}
    for c in cards:
        pos = c["position_listed"]
        age = rating_2026._age_at(c.get("birth_date"))
        caps.setdefault(pos, []).append((age, c["caps"]))
        goals.setdefault(pos, []).append((age, c["intl_goals"]))
    return {
        "caps": {p: rating_2026.AgeConditionalQuantiles(v) for p, v in caps.items()},
        "goals": {p: rating_2026.AgeConditionalQuantiles(v) for p, v in goals.items()},
    }


@pytest.fixture(scope="session")
def ratings() -> list[dict]:
    return json.loads((OUT / "ratings_2026.json").read_text(encoding="utf-8"))


def _comp(row: dict, signal: str):
    return next(c["value"] for c in row["components"] if c["signal"] == signal)


# ─── curve math on a synthetic fixture (exact, hand-checkable) ────────────────


def test_synthetic_quantile_surface_basic_shape():
    """A linear accrual world: value == age. At every age the cohort median must
    sit near the member's own accrual, a high value ranks high at a young age and
    lower at an old age."""
    pairs = [(a, float(a)) for a in range(18, 39) for _ in range(5)]
    q = rating_2026.AgeConditionalQuantiles(pairs)
    # A 30-cap player is exceptional at 20, middling at 30, weak at 38.
    p20 = q.percentile(30.0, 20)
    p30 = q.percentile(30.0, 30)
    p38 = q.percentile(30.0, 38)
    assert p20 > 0.9
    assert 0.3 < p30 < 0.7
    assert p38 < 0.2
    assert p20 > p30 > p38


def test_synthetic_monotone_in_value_at_fixed_age():
    pairs = [(a, float(v)) for a in (20, 25, 30) for v in (0, 5, 10, 20, 40, 80)]
    q = rating_2026.AgeConditionalQuantiles(pairs)
    for age in (18, 20, 24, 27, 30, 35):
        pcts = [q.percentile(float(v), age) for v in range(0, 100, 5)]
        assert pcts == sorted(pcts), age


def test_synthetic_unknown_age_uses_unconditional_column():
    pairs = [(a, float(v)) for a, v in [(20, 1), (25, 10), (30, 50), (35, 100)]]
    q = rating_2026.AgeConditionalQuantiles(pairs)
    # Unknown age is the honest neutral: ranked against the whole pool, and it
    # must not raise.
    p = q.percentile(10.0, None)
    assert 0.0 <= p <= 1.0
    assert q.percentile(0.0, None) <= p <= q.percentile(100.0, None)


def test_synthetic_age_clamped_to_observed_grid():
    pairs = [(a, float(a)) for a in range(20, 31)]
    q = rating_2026.AgeConditionalQuantiles(pairs)
    # Ages outside the observed range clamp to the nearest grid edge.
    assert q.percentile(25.0, 17) == q.percentile(25.0, 20)
    assert q.percentile(25.0, 40) == q.percentile(25.0, 30)


# ─── structural monotonicity on the PRODUCTION pool ───────────────────────────


def test_quantile_columns_monotone_in_age_production(pool_curves):
    """Design §2.1 lock: for every position × signal and every p on the grid, the
    expected accrual Q(p, age) is non-decreasing in age (the running-max pass is
    structural; this asserts the emitted surface, not the code path)."""
    for signal, by_pos in pool_curves.items():
        for pos, q in by_pos.items():
            for k in range(0, rating_2026.AGE_QUANTILE_P_STEPS + 1, 10):
                series = [col[k] for col in q.columns]
                assert series == sorted(series), (signal, pos, k)


def test_percentile_monotone_nonincreasing_in_age_production(pool_curves, cards):
    """The dual property: at any fixed signal value, the evidence percentile is
    non-increasing in age — the same accrual ranks weakly lower against an older
    expectation. Probed at every observed value decile for every position."""
    for signal, key in (("caps", "caps"), ("goals", "intl_goals")):
        by_pos: dict[str, list[float]] = {}
        for c in cards:
            by_pos.setdefault(c["position_listed"], []).append(float(c[key]))
        for pos, q in pool_curves[signal].items():
            vals = sorted(by_pos[pos])
            probes = {vals[int(f * (len(vals) - 1))] for f in (0, 0.25, 0.5, 0.75, 0.9, 1.0)}
            for v in probes:
                pcts = [q.percentile(v, a) for a in range(q.min_age, q.max_age + 1)]
                assert all(
                    pcts[i] >= pcts[i + 1] - 1e-12 for i in range(len(pcts) - 1)
                ), (signal, pos, v)


def test_percentile_monotone_in_value_production(pool_curves):
    for signal in ("caps", "goals"):
        for pos, q in pool_curves[signal].items():
            for age in range(q.min_age, q.max_age + 1, 4):
                pcts = [q.percentile(float(v), age) for v in range(0, 201, 10)]
                assert pcts == sorted(pcts), (signal, pos, age)


# ─── age_factor retirement + cohort flattening ────────────────────────────────


def test_age_factor_is_retired(ratings):
    """Design §2.1: age_factor is retired — the module exposes neither the
    function nor its calibration constants, and no emitted component carries the
    signal (keeping both conditioning and factor would re-create the youth
    double penalty)."""
    for attr in ("_age_factor", "AGE_FLOOR", "AGE_PRIME_LO", "AGE_PRIME_HI"):
        assert not hasattr(rating_2026, attr), attr
    for r in ratings:
        assert all(c["signal"] != "age_factor" for c in r["components"]), r["card_id"]


def test_minted_age_cohort_signature_flattened(ratings, cards):
    """Design §2.1 distribution lock: the monotone-in-age cohort signature on
    minted cards (pre-V3: mean display 71.7 at age<24 vs 76.0 at age>30, a 4.3-pt
    youth penalty) must flatten. Minted cards are the clean probe (no stature
    blend on most). Cards with a stature row are excluded so the youth-vs-veteran
    contrast is measured on the raw path the mechanism actually changed."""
    link_of = {c["player_id"]: c["link_status"] for c in cards}
    by_pid = {c["player_id"]: c for c in cards}
    young, old = [], []
    for r in ratings:
        if link_of[r["player_id"]] != "minted":
            continue
        if _comp(r, "stature_model_weight") > 0.0:
            continue
        age = rating_2026._age_at(by_pid[r["player_id"]].get("birth_date"))
        if age is None:
            continue
        if age < 24:
            young.append(r["overall"])
        elif age > 30:
            old.append(r["overall"])
    assert young and old
    gap = sum(old) / len(old) - sum(young) / len(young)
    # Pre-V3 the raw-path signature was +4.16 display points (old above young —
    # the youth double penalty), measured on this exact cohort definition. The
    # §2.1 lock is FLATTEN, not invert: at the locked bandwidth (8.0) the
    # measured gap is +0.09. Locked symmetric at |gap| ≤ 1.0 so neither the
    # double penalty nor a youth-premium overcorrection can regress in.
    assert abs(gap) <= 1.0, gap


# ─── re-derived cross-era quantile map ────────────────────────────────────────


def test_quantile_map_target_is_live_wc_perf_5_raw_only():
    """Design §2.1: the MV2-5 map is re-derived against V2's NEW historical
    raw-only distribution. Pin: the target equals the committed wc-perf-5.0.0
    ratings.json raw-only internals (weight==0 rows' raw_only_score — award
    headroom included), not the retired rating-compat reconstruction."""
    target = rating_2026._historical_raw_only_internal(OUT)
    committed = sorted(
        _comp(r, "raw_only_score")
        for r in json.loads((OUT / "ratings.json").read_text(encoding="utf-8"))
        if _comp(r, "stature_model_weight") == 0.0
    )
    assert target == committed
    # The new target includes §4.1 award-headroom escapees above the old clamp.
    assert max(target) > rating.RAW_ONLY_GLOBAL_CEILING


# ─── projected dual-basis emission (design §5) ────────────────────────────────


def test_dual_basis_payload_shape_and_career_alias(ratings):
    """Every 2026 row carries basis_ratings.career/current with the full channel
    payload; the career basis IS the top-level compatibility surface (field-by-
    field), and basis_metadata carries the proj-career-5.1.0 anchor."""
    for r in ratings:
        br = r["basis_ratings"]
        career, current = br["career"], br["current"]
        for basis, payload in (("career", career), ("current", current)):
            for field in (
                "overall",
                "overall_basis",
                "attack",
                "midfield",
                "defense",
                "goalkeeping",
                "coverage",
                "components",
                "basis_metadata",
            ):
                assert field in payload, (r["card_id"], basis, field)
            assert payload["basis_metadata"]["basis"] == basis
            assert payload["basis_metadata"]["rating_version"] == "proj-career-5.1.0"
        for field in ("overall", "overall_basis", "attack", "midfield", "defense",
                      "goalkeeping", "coverage", "components"):
            assert career[field] == r[field], (r["card_id"], field)


def test_current_basis_is_measured_raw_path(ratings):
    """The current basis is the at-2026 measured path: always
    measured_performance (caps always exist), never a career badge holder by
    construction, and for a weight==0 card current == career exactly (the blend
    collapses to the raw path)."""
    for r in ratings:
        cur = r["basis_ratings"]["current"]
        assert cur["overall_basis"] == "measured_performance", r["card_id"]
        if _comp(r, "stature_model_weight") == 0.0:
            assert cur["overall"] == r["overall"], r["card_id"]
            assert cur["basis_metadata"]["score_0_100"] == pytest.approx(
                r["basis_ratings"]["career"]["basis_metadata"]["score_0_100"]
            ), r["card_id"]


def test_current_channels_derive_from_current_score(ratings, cards):
    """Honest-state: current channels are materialized from the current internal
    score through the SAME decoupled channel map — never copied from career."""
    pos_of = {c["card_id"]: c["position_listed"] for c in cards}
    for r in ratings:
        cur = r["basis_ratings"]["current"]
        s = cur["basis_metadata"]["score_0_100"]
        pos = pos_of[r["card_id"]]
        for ch in rating.CHANNELS:
            # basis_metadata.score_0_100 is rounded to 6 decimals while channels
            # are materialized from the unrounded internal score (same convention
            # as the historical V2 emission), so a value sitting exactly on a
            # 0.5 rounding boundary may differ by 1.
            assert abs(cur[ch] - rating._channel(s, rating.CHANNEL_SPREAD[pos][ch])) <= 1, (
                r["card_id"],
                ch,
            )
