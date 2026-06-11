"""MV2-6 unified display curve — cross-era acceptance guards.

ONE monotonic low-DOF display curve, fit over the POOLED historical (wc-perf) +
2026 (proj-career) INTERNAL distribution, applied identically to BOTH eras. These
guards assert:

  * the SAME curve maps both eras (no per-era table);
  * the curve reshapes display `overall` ONLY — the four sim channels are a pure
    function of the internal score and stay decoupled (byte-identical to a fresh
    `_channel` materialization);
  * the anti-inflation invariant: the broad middle does NOT inflate into the high
    80s (median ≤ ~74, the 90+ band ≤ ~3%, 84+ a clear minority);
  * named greats land in-band by internal score (ordering preserved, no hard-pin);
  * the four previously-spurious OVR-99 2026 cards display mid-80s, not 99;
  * no card displays 100.

SELF-CONTAINED: builds from the committed canonical + 2026 tables in etl/output/.
"""

from __future__ import annotations

import json

import pytest

from wcdraft_etl import display_curve, rating, rating_2026

OUT = rating.OUTPUT_DIR


# ─── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def curve():
    return display_curve.fit_unified_curve(OUT)


@pytest.fixture(scope="session")
def hist() -> list[dict]:
    return rating.build_all(OUT)


@pytest.fixture(scope="session")
def proj() -> list[dict]:
    return rating_2026.build_all(OUT)


@pytest.fixture(scope="session")
def hist_internal() -> dict[str, dict]:
    internal, _curve = rating.build_internal_view(
        rating._load(OUT, "players"),
        rating._load(OUT, "player_tournaments"),
        rating._load(OUT, "tournaments"),
        rating._load(OUT, "manager_tournaments"),
        rating._load_career_stature(OUT),
    )
    return {r["card_id"]: r for r in internal}


@pytest.fixture(scope="session")
def proj_internal() -> dict[str, dict]:
    cards = json.loads((OUT / "player_tournaments_2026.json").read_text())
    rows = rating_2026.build_internal_view(cards, rating._load_career_stature(OUT))
    return {r["card_id"]: r for r in rows}


# ─── the curve is ONE pooled curve, shared across both eras ───────────────────


def test_curve_is_fit_on_the_pooled_distribution(curve, hist_internal, proj_internal):
    """The unified curve's four anchors are the min/p50/p95/max of the POOLED
    historical + 2026 internal scores — not either era alone."""
    pooled = sorted(
        [r["score_0_100"] for r in hist_internal.values()]
        + [r["score_0_100"] for r in proj_internal.values()]
    )
    assert curve.raw_floor == pooled[0]
    assert curve.raw_max == pooled[-1]
    assert curve.raw_floor < curve.raw_median < curve.raw_p95 < curve.raw_max


def test_same_curve_maps_both_eras(curve, hist, proj, hist_internal, proj_internal):
    """Every emitted `overall` (historical AND 2026) equals the unified curve
    applied to that card's internal score — proof the ONE curve maps both eras."""
    for r in hist:
        ir = hist_internal[r["card_id"]]
        est = r["overall_basis"] == "baseline_anchor_estimate"
        assert r["overall"] == rating._display_score(
            ir["score_0_100"], curve, estimate=est
        ), r["card_id"]
    for r in proj:
        ir = proj_internal[r["card_id"]]
        # 2026 never carries baseline_anchor_estimate (caps always present).
        assert r["overall"] == rating._display_score(ir["score_0_100"], curve), r[
            "card_id"
        ]


def test_version_anchors(hist, proj):
    """Historical bumps to the unified display-curve version; 2026 keeps its
    internal-algorithm anchor (only the display moved onto the shared curve)."""
    assert rating.RATING_VERSION == "wc-perf-4.2.1"
    assert rating_2026.RATING_VERSION == "proj-career-3.0.0"
    assert all(r["rating_version"] == "wc-perf-4.2.1" for r in hist)
    assert all(r["rating_version"] == "proj-career-3.0.0" for r in proj)


# ─── decoupling: the curve reshapes `overall` ONLY ────────────────────────────


def test_channels_are_decoupled_from_the_curve(hist, proj, hist_internal, proj_internal):
    """The four sim channels are a pure function of the internal score (via
    `_channel`), never routed through the display curve. Every emitted channel must
    equal a fresh materialization from the internal score — so any display-curve
    change provably cannot perturb the sim inputs."""
    for r in hist:
        ir = hist_internal[r["card_id"]]
        for ch in rating.CHANNELS:
            assert r[ch] == rating._channel(
                ir["score_0_100"], rating.CHANNEL_SPREAD[ir["pos"]][ch]
            ), (r["card_id"], ch)
    for r in proj:
        ir = proj_internal[r["card_id"]]
        for ch in rating.CHANNELS:
            assert r[ch] == rating._channel(
                ir["score_0_100"], rating_2026.CHANNEL_SPREAD[ir["pos"]][ch]
            ), (r["card_id"], ch)


# ─── anti-inflation invariant (the failure mode to prevent) ───────────────────


def test_no_card_displays_100(hist, proj):
    assert max(r["overall"] for r in hist) <= 99
    assert max(r["overall"] for r in proj) <= 99
    assert 100 not in {r["overall"] for r in hist + proj}


def test_middle_does_not_inflate(hist, proj):
    """The broad middle must hold: pooled median ≤ ~74, the 91-99 band ≤ ~3% of all
    cards, and 84+ a clear minority (not the bulk)."""
    pooled = [r["overall"] for r in hist + proj]
    n = len(pooled)
    s = sorted(pooled)
    median = s[n // 2]
    share_90 = sum(1 for o in pooled if o >= 90) / n
    share_84 = sum(1 for o in pooled if o >= 84) / n
    assert median <= 74, median
    assert share_90 <= 0.03, share_90
    assert share_84 <= 0.30, share_84  # a clear minority


def test_floor_holds_at_66(hist, proj):
    assert min(r["overall"] for r in hist) == rating.DISPLAY_FLOOR
    assert min(r["overall"] for r in proj) == rating.DISPLAY_FLOOR


# ─── named greats land in-band (ordering preserved, no hard-pin) ──────────────


def _by_card(rows: list[dict]) -> dict[str, dict]:
    return {r["card_id"]: r for r in rows}


def test_historical_anchors_land_in_band(hist):
    by = _by_card(hist)
    # (card_id, lo, hi) — the plan's approximate target bands.
    bands = [
        ("P-14758:WC-2022", 98, 99),  # Messi 2022
        ("P-38906:WC-1958", 95, 97),  # Pelé 1958
        ("P-80404:WC-1986", 98, 99),  # Maradona 1986
        ("P-09317:WC-1958", 90, 92),  # Yashin
    ]
    for cid, lo, hi in bands:
        assert lo <= by[cid]["overall"] <= hi, (cid, by[cid]["overall"])


def test_2026_anchors_land_elite(proj):
    by = {r["player_id"]: r for r in proj}
    # Messi / Modrić ride the stature scale → top of the band.
    assert by["P-14758"]["overall"] >= 97
    assert by["P-29491"]["overall"] >= 97
    assert by["P-64077"]["overall"] >= 96  # Mbappé


def test_spurious_99_cards_display_mid_80s(proj):
    """The four previously-OVR-99 projected MF cards (strong caps + top league, no
    material career stature) now display in the mid-80s on the raw-only path — a
    clear notch below the recognized-greats band, never 99."""
    by = {r["player_id"]: r for r in proj}
    for pid in ("P-34205", "P-39584", "P-58692", "P-W26-0166"):  # 0177->0166: merit-v3 U0 renumber
        ov = by[pid]["overall"]
        assert 84 <= ov <= 90, (pid, ov)
        assert by[pid]["legend"] is False, pid


def test_journeyman_floor_both_eras(hist, proj):
    """A journeyman floor card sits in the low band (66-70) in both eras."""
    assert min(r["overall"] for r in hist) <= 70
    assert min(r["overall"] for r in proj) <= 70
