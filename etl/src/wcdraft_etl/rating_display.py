"""Historical rating display-curve helpers.

The internal merit score is mapped to the display ``overall`` through this low-DOF
curve; sim channels stay in ``rating_components``.
"""

from __future__ import annotations

# ─── DISPLAY CALIBRATION CURVE (wc-perf-2.0.0; unified pool MV2-6) ─────────────
# Phase 1 rating recalibration: the internal merit model above is UNCHANGED.
# Its output `score_0_100` is mapped through a deterministic monotonic
# piecewise-power curve onto the display band [DISPLAY_FLOOR, DISPLAY_MAX].
# The curve fits ONLY four global INTERNAL anchors of the emitted dataset
# (min, p50, p95, max) onto fixed display targets (60, 73, 88, 99). It is the
# SINGLE knob that reshapes the emitted distribution; the merit math is
# untouched. Low-DOF (three exponents, four data anchors, no per-player
# tuning) so it cannot fudge individuals and stays auditable.
#
# MV2-6 UNIFICATION: the four anchors are now fit on the POOLED historical + 2026
# internal distribution (see `display_curve.fit_unified_curve`) and the SAME curve
# maps BOTH eras — one honest cross-era mapping, no per-era table. The curve FORM
# (`_fit_display_curve` / `_display_value`) is identical; only the data the anchors
# are fit on changed. `build_ratings` takes the unified curve via `curve=`; passing
# `None` self-fits the unified pooled curve so a bare `build_ratings` call still
# emits the unified display.
#
# DESIGN INVARIANT: applied to `overall` ONLY. The four sim channels stay
# on the pre-recalibration `[FLOOR_CHANNEL, 100]` band — they are NOT routed
# through the display curve. OVR is the believability view of the pre-display
# COMPOSITE merit score; channels are the sim-strength inputs. They diverge by
# design, and any λ refit lives in `packages/core/src/engine/calibration.ts`
# rather than here — see `packages/core/SIM_CALIBRATION.md`.
#
# ESTIMATE BAND: `baseline_anchor_estimate` cards are capped into
# [ESTIMATE_FLOOR, ESTIMATE_CEILING] AFTER the curve. They never out-rate
# linked greats, never fabricate a box score (the absent stat stays null in
# components), and remain flagged via overall_basis + low coverage.
# merit-v4.2: re-fit on the UNION of both bases' (career + current) internal
# pools across both eras (design §4.4 + §5). The high-tail exponent is re-locked
# to keep the registered active-elite anchors inside the rare 90+ tail after
# factual-context declustering shifts the p95 anchor.
DISPLAY_CURVE_KIND = "unified_pooled_piecewise_power_v2"

DISPLAY_FLOOR = 60
DISPLAY_MEDIAN = 73
DISPLAY_P95 = 88
DISPLAY_MAX = 99

ESTIMATE_FLOOR = 66
ESTIMATE_CEILING = 73

# Three exponents — the only free parameters of the curve. Each shapes one
# of the three monotonic segments (floor→median, median→p95, p95→max).
# Fixed globally; no per-player or per-era override.
DISPLAY_LOW_EXPONENT = 0.65
DISPLAY_MID_EXPONENT = 1.00
DISPLAY_HIGH_EXPONENT = 2.00


class DisplayCurve:
    """Frozen fitted-anchor record for the display calibration curve."""

    __slots__ = ("raw_floor", "raw_median", "raw_p95", "raw_max")

    def __init__(self, raw_floor: float, raw_median: float, raw_p95: float, raw_max: float) -> None:
        self.raw_floor = float(raw_floor)
        self.raw_median = float(raw_median)
        self.raw_p95 = float(raw_p95)
        self.raw_max = float(raw_max)

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"DisplayCurve(raw_floor={self.raw_floor}, raw_median={self.raw_median}, "
            f"raw_p95={self.raw_p95}, raw_max={self.raw_max})"
        )


def _quantile(sorted_values: list[float], q: float) -> float:
    n = len(sorted_values)
    if n == 0:
        raise ValueError("_quantile called on empty list")
    if n == 1:
        return float(sorted_values[0])
    pos = (n - 1) * q
    lo = int(pos)
    hi = min(lo + 1, n - 1)
    frac = pos - lo
    return float(sorted_values[lo]) * (1.0 - frac) + float(sorted_values[hi]) * frac


def _fit_display_curve(scores: list[float]) -> DisplayCurve:
    """Fit four-anchor display curve on emitted internal scores."""
    if not scores:
        raise ValueError("_fit_display_curve called on empty score list")
    sv = sorted(float(s) for s in scores)
    for s in sv:
        if s != s or s in (float("inf"), float("-inf")):
            raise ValueError(f"non-finite internal score: {s}")
    curve = DisplayCurve(
        raw_floor=sv[0],
        raw_median=_quantile(sv, 0.50),
        raw_p95=_quantile(sv, 0.95),
        raw_max=sv[-1],
    )
    if not (curve.raw_floor < curve.raw_median < curve.raw_p95 < curve.raw_max):
        raise ValueError(
            "degenerate display curve anchors "
            f"(floor={curve.raw_floor}, median={curve.raw_median}, "
            f"p95={curve.raw_p95}, max={curve.raw_max}); refusing to emit."
        )
    return curve


def _display_value(score_0_100: float, curve: DisplayCurve, *, estimate: bool = False) -> float:
    x = score_0_100
    if x <= curve.raw_floor:
        y = float(DISPLAY_FLOOR)
    elif x >= curve.raw_max:
        y = float(DISPLAY_MAX)
    elif x <= curve.raw_median:
        span_raw = curve.raw_median - curve.raw_floor
        t = (x - curve.raw_floor) / span_raw if span_raw > 0.0 else 0.0
        y = DISPLAY_FLOOR + (DISPLAY_MEDIAN - DISPLAY_FLOOR) * (t**DISPLAY_LOW_EXPONENT)
    elif x <= curve.raw_p95:
        span_raw = curve.raw_p95 - curve.raw_median
        t = (x - curve.raw_median) / span_raw if span_raw > 0.0 else 0.0
        y = DISPLAY_MEDIAN + (DISPLAY_P95 - DISPLAY_MEDIAN) * (t**DISPLAY_MID_EXPONENT)
    else:
        span_raw = curve.raw_max - curve.raw_p95
        t = (x - curve.raw_p95) / span_raw if span_raw > 0.0 else 0.0
        y = DISPLAY_P95 + (DISPLAY_MAX - DISPLAY_P95) * (t**DISPLAY_HIGH_EXPONENT)
    if y < DISPLAY_FLOOR:
        y = float(DISPLAY_FLOOR)
    elif y > DISPLAY_MAX:
        y = float(DISPLAY_MAX)
    if estimate:
        if y < ESTIMATE_FLOOR:
            y = float(ESTIMATE_FLOOR)
        elif y > ESTIMATE_CEILING:
            y = float(ESTIMATE_CEILING)
    return y


def _display_score(score_0_100: float, curve: DisplayCurve, *, estimate: bool = False) -> int:
    return int(round(_display_value(score_0_100, curve, estimate=estimate)))
