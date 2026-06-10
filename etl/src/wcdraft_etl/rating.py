"""WS-A Rating stage — the per-card player Rating MOAT.

Computes an ORIGINAL, era-normalized, position-weighted, awards-anchored player
``Rating`` for every men's World Cup card, from the *committed canonical JSON*
in ``etl/output/`` (the ingestion's output — NOT the upstream CSVs). Keeping the
input to the already-committed canonical tables makes this stage self-contained
and byte-deterministic without the vendor source clone: same canonical input ->
identical ``ratings.json`` bytes.

LEGAL FIREWALL (non-negotiable): every number here is derived ONLY from the
factual public signals in the Fjelstul database (goals, appearances, awards,
team finish, position). NOTHING is ingested, mirrored, or "perturbed" from EA
Sports FC or any proprietary rating set. The formula is entirely wcdraft's own.
See RATING_METHODOLOGY.md for the derivation and the calibration rationale.

HONEST-STATE: a signal that is absent for a card (e.g. match appearances that
could not be sourced for the pre-1970 era) is DROPPED from that card's weighting
and surfaced as a ``null`` component value — it is NEVER substituted with 0.

NO NULL OVERALL (wc-perf-1.1.0): every card now carries a real ``overall``. Most
pre-1970 defenders/keepers gain a measured appearances signal from the WS-A
supplement (RSSSF starting XIs, linked to player_id); the residual cards with no
linkable individual signal are rated from a position-appropriate replacement
baseline plus the era-invariant team-finish / award anchor. That is an HONEST
ESTIMATE — flagged by ``overall_basis = "baseline_anchor_estimate"`` and the
card's (low) coverage — NOT a fabricated box score: no individual stat is ever
invented; the absent stat stays ``null`` in components. This replaces the old
``overall = null`` "insufficient signal" path.

SCOPE: men's tournaments 1930-2022 (the contract's gameplay scope). Women's
cards present in the canonical tables are explicitly excluded here, not silently
dropped — the count is reported by ``run()``.
"""

from __future__ import annotations

import json
from pathlib import Path

# Anchored to the package location (etl/src/wcdraft_etl/ -> etl/output) so the
# stage reads/writes the same place regardless of the caller's cwd. Mirrors
# pipeline.OUTPUT_DIR.
OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"

# Rating-algorithm version anchor — one of the three replay anchors in the core
# contract. Bump on ANY change to weights, normalization, or channel mapping;
# the golden git-diff guard will force the committed ratings.json to move with it.
# wc-perf-4.2.0 (MV2-6): the display `overall` is now reshaped by the UNIFIED
# pooled display curve (`display_curve.fit_unified_curve`) — ONE monotonic curve
# fit over the combined historical + 2026 internal distribution and applied
# identically to BOTH eras. Channels/internal merit math are UNCHANGED; this is a
# display-`overall`-only bump (the same shared curve also maps 2026 — see
# rating_2026, which keeps its own internal-algorithm anchor proj-career-3.0.0).
RATING_VERSION = "wc-perf-4.2.0"

# ─── CALIBRATION CONSTANTS ────────────────────────────────────────────────────
# Everything below is a CALIBRATION choice (like the sim's lambda / scoring
# knobs): documented, golden-locked, and tunable without touching the algorithm.

COARSE_POSITIONS = ("GK", "DF", "MF", "FW")

# Cross-era ANCHOR #1 — individual awards. Absolute, era-invariant points in
# [0,1]: a 1962 Golden Ball anchors the same lift as a 2014 one, which is what
# equalizes cross-era comparability. Keyed by the canonical award_name strings
# carried on each card. (all_tournament_team / fair_play never appear in the
# source, so they are absent here by construction, not omitted by choice.)
AWARD_POINTS: dict[str, float] = {
    "Golden Ball": 1.00,
    "Silver Ball": 0.70,
    "Bronze Ball": 0.50,
    "Golden Boot": 0.90,
    "Silver Boot": 0.60,
    "Bronze Boot": 0.45,
    "Golden Glove": 0.85,
    "Best Young Player": 0.55,
}

# Cross-era ANCHOR #2 — team final placement that tournament. Semifinalists only
# (positions 1-4); the source ranks no further, so non-semifinalists have a null
# finish that is DROPPED, never read as 0. Absolute and era-invariant: winning in
# 1950 anchors the same as winning in 2022.
FINISH_POINTS: dict[int, float] = {1: 1.00, 2: 0.75, 3: 0.55, 4: 0.40}

# Position-specific BASE weights over the era-normalized PERFORMANCE signals
# (goals, appearances). A defender/keeper is never rated on goals: their base
# leans on appearances and their strength comes through the team-finish/awards
# anchor. Weights need not sum to 1 — they are renormalized over whatever signals
# are actually PRESENT for the card (honest-state drop).
BASE_WEIGHTS: dict[str, dict[str, float]] = {
    "FW": {"goals": 0.75, "appearances": 0.25},
    "MF": {"goals": 0.40, "appearances": 0.60},
    "DF": {"goals": 0.00, "appearances": 1.00},
    "GK": {"goals": 0.00, "appearances": 1.00},
}

# Position-specific ANCHOR weights. The anchor is the SUM of two INDEPENDENT
# cross-era lifts so they never wash each other out:
#   award lift  = AWARD_WEIGHT[pos]  * award_score   (individual distinction)
#   finish lift = FINISH_WEIGHT[pos] * finish_points  (team success)
# Keeping them separate is what lets a Golden-Ball winner on the champion team
# out-rate an undecorated starter on the same team — if the two lifts shared one
# saturating term, the champion's finish alone would max it and the award would
# add nothing (the bug that let a squad defender tie Maradona).
#
# AWARD_WEIGHT is broadly even across positions (an award is an award). FINISH is
# weighted UP for DF/GK (team defensive success is their headline signal) and
# DOWN for FW (whose own box score already carries them through the base).
AWARD_WEIGHT: dict[str, float] = {"FW": 0.20, "MF": 0.22, "DF": 0.18, "GK": 0.22}
FINISH_WEIGHT: dict[str, float] = {"FW": 0.16, "MF": 0.16, "DF": 0.24, "GK": 0.28}

# ─── STATURE-DOMINANT COMPOSITE (wc-perf-4.0.0, merit-v2 MV2-4) ───────────────
# Career stature is now the PRIMARY base for material-stature players, not a capped
# additive lift on top of the raw tournament score. The merit-v2 inversion (plan
# docs/plans/merit-v2-stature-dominant-2026-06-08.md §"Stature-dominant rating
# formula"): a recognized great's WORST World Cup still reads elite; a journeyman's
# BEST tournament does not. The old wc-perf-3.0.0 capped-lift design (raw was the
# base, stature could only add a positive, capped fraction of the gap) is REMOVED —
# there is no _career_lift, no CAREER_MAX_LIFT, no positive-gap-only max(0,…).
#
#   stature_target = STATURE_TARGET_FLOOR[pos]
#                  + STATURE_TARGET_SPAN[pos] * norm(career_stature_index)
#   tournament_ref = median raw_tournament_score for (tournament_id, pos) cohort
#   modulation     = clamp(TOURNAMENT_MOD_GAIN[pos] * (raw - tournament_ref),
#                          -TOURNAMENT_DOWN_CAP[pos][tier], +TOURNAMENT_UP_CAP[pos])
#   stature_path   = clamp01(stature_target + modulation)             # signed!
#   raw_path       = min(raw_tournament_score, raw_only_ceiling)      # bounded
#   stature_weight = ramp01(index over the MATERIAL band)             # 0 → 1
#   final          = clamp01(stature_weight*stature_path + (1-stature_weight)*raw_path)
#
# The blend RAMPS continuously from raw-only (weight 0) to stature-dominant
# (weight 1) across a small band around the material-stature index threshold, so two
# near-identical cards straddling the threshold do not land far apart (no cliff).
# Tournament context is a SIGNED, bounded modulation: a weak tournament lowers the
# stature target within a (tier-tightened) down-cap; an apex tournament raises it
# within an up-cap. There is NO per-player override table; every constant is global.
#
# INDICATIVE constants (plan §"Initial fitting ranges"). The precise constant-lock +
# final named-anchor + display-invariant tests are MV2-8 (after the unified display
# curve, MV2-6). Here we assert INTERNAL-score behavior, not final display.

# Material-stature gate (mirrors merit/stature.py MATERIAL_MIN_* — the stature stage
# computes stature_tier over the SAME cohort definition). A card joins the
# stature-dominant path only with a career row clearing BOTH gates; the ramp half-
# width softens the index edge into a continuous blend.
MATERIAL_STATURE_MIN_COVERAGE = 0.25
MATERIAL_STATURE_MIN_INDEX = 0.40
STATURE_RAMP_HALF_WIDTH = 0.06

# The continuity-blend weight at/above which the stature path DOMINATES the final
# (final = weight·stature_path + (1−weight)·raw_path, so weight ≥ 0.5 ⇒ stature is
# the larger half). This single line marks a card as "clearly material": it (a)
# admits a card into the cohort's elite internal band, (b) decides whether the
# global raw-only ceiling applies, and (c) selects the career_stature_estimate
# basis label — all three are the same "stature dominates" notion.
STATURE_DOMINANT_WEIGHT = 0.5

# stature_target(pos, index): material index in [MIN_INDEX, 1.0] maps onto
# [FLOOR, FLOOR+SPAN]. FLOOR is the internal score of a marginal-material card; an
# index near 1.0 (the all-time peak) maps near the internal ceiling (→ display
# high-90s once the unified curve lands in MV2-6). DF/GK floors/spans are a touch
# lower (their tournament box score is thinner, but their channel still reads elite
# on-position via CHANNEL_SPREAD — see the channel-shape invariant).
STATURE_TARGET_FLOOR: dict[str, float] = {"FW": 0.60, "MF": 0.60, "DF": 0.60, "GK": 0.58}
STATURE_TARGET_SPAN: dict[str, float] = {"FW": 0.40, "MF": 0.40, "DF": 0.38, "GK": 0.38}

# Signed tournament modulation. GAIN scales the raw-vs-cohort delta; the UP cap is
# small (an apex tournament nudges a great above their career target) and the DOWN
# cap is TIGHTER at higher stature tiers (a gold legend's weakest WC barely dips).
TOURNAMENT_MOD_GAIN: dict[str, float] = {"FW": 0.40, "MF": 0.40, "DF": 0.35, "GK": 0.30}
TOURNAMENT_UP_CAP: dict[str, float] = {"FW": 0.08, "MF": 0.08, "DF": 0.07, "GK": 0.06}
TOURNAMENT_DOWN_CAP: dict[str, dict[str, float]] = {
    "FW": {"gold": 0.06, "silver": 0.09, "bronze": 0.12},
    "MF": {"gold": 0.06, "silver": 0.09, "bronze": 0.12},
    "DF": {"gold": 0.05, "silver": 0.08, "bronze": 0.11},
    "GK": {"gold": 0.05, "silver": 0.08, "bronze": 0.11},
}
# Cohort reference needs at least this many cards at (tournament_id, pos) before its
# own median is trusted; otherwise fall back to the (pos) cross-tournament median,
# then to the card's own raw score (→ delta 0, no modulation).
COHORT_MIN_N = 8

# Global raw-only elite ceiling (internal score). A non-material card's raw_path is
# capped at the LOWER of (a) this fixed global ceiling and (b) the median final
# internal score of the material-stature cards in its (tournament_id, pos) cohort —
# so a journeyman's strong tournament never enters the high-stature / legend
# internal band. Never a per-player value; never silently zeroed (the card keeps its
# honest raw score up to the ceiling). Sits below the marginal-material STATURE
# floor (0.58–0.60) so raw-only cards stay below the recognized-greats band.
RAW_ONLY_GLOBAL_CEILING = 0.62

# A no-tournament-signal card is a "career_stature_estimate" (exits the [66,73]
# estimate cap via the normal curve) only when its career record is material AND
# clearly elite; otherwise it stays a capped "baseline_anchor_estimate".
CAREER_ESTIMATE_MIN_INDEX = 0.50

# Replacement-level base in [0,1] used (a) as the off-position channel floor,
# (b) as the FLOOR of the performance base scale, and (c) as the base for a card
# with no individual performance signal — so such a card's overall is an honest
# baseline+anchor ESTIMATE (flagged overall_basis="baseline_anchor_estimate"),
# not a fabricated box score and not a withheld null.
REPLACEMENT_BASE = 0.20
FLOOR_CHANNEL = round(REPLACEMENT_BASE * 100)  # 20

# Performance base scale. The era-normalized percentile blend in [0,1] is mapped
# onto [REPLACEMENT_BASE, BASE_CEILING] rather than straight to [0,1]. This is
# deliberate: raw box-score performance can only carry a card to "very good"
# (BASE_CEILING); reaching the top of the scale REQUIRES the cross-era anchor
# (awards + team finish). That is what makes awards the differentiator between
# the merely-excellent and the legendary, and keeps the elite tail spread out
# instead of everyone with a high percentile pinning at 100.
BASE_CEILING = 0.68

# Position -> sim-channel SPREAD. The card's own channel gets the full score
# (spread 1.0); off-position channels are a convex blend toward REPLACEMENT_BASE.
# Outfielders get spread 0.0 into goalkeeping (you cannot keep goal by being a
# good striker) -> they sit at the replacement floor in that channel.
CHANNEL_SPREAD: dict[str, dict[str, float]] = {
    "FW": {"attack": 1.00, "midfield": 0.60, "defense": 0.30, "goalkeeping": 0.00},
    "MF": {"attack": 0.65, "midfield": 1.00, "defense": 0.60, "goalkeeping": 0.00},
    "DF": {"attack": 0.35, "midfield": 0.60, "defense": 1.00, "goalkeeping": 0.00},
    "GK": {"attack": 0.05, "midfield": 0.20, "defense": 0.55, "goalkeeping": 1.00},
}

CHANNELS = ("attack", "midfield", "defense", "goalkeeping")

# Rounding precision for component float values, so the emitted JSON is stable.
_PRECISION = 6

# ─── DISPLAY CALIBRATION CURVE (wc-perf-2.0.0; unified pool MV2-6) ─────────────
# Phase 1 rating recalibration: the internal merit model above is UNCHANGED.
# Its output `score_0_100` is mapped through a deterministic monotonic
# piecewise-power curve onto the display band [DISPLAY_FLOOR, DISPLAY_MAX].
# The curve fits ONLY four global INTERNAL anchors of the emitted dataset
# (min, p50, p95, max) onto fixed display targets (66, 73, 88, 99). It is the
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
# through the display curve. This is the DECOUPLED path (plan §3.2 fallback);
# `packages/core/src/engine/calibration.ts` (λ, channel scale, engine_version)
# is UNCHANGED from `origin/main`, and the sim is byte-identical to main
# (sim-golden.json: 0 diff). OVR is the believability view of the pre-display
# COMPOSITE merit score; channels are the sim-strength inputs. They DIVERGE
# by design — see `packages/core/SIM_CALIBRATION.md`.
#
# ESTIMATE BAND: `baseline_anchor_estimate` cards are capped into
# [ESTIMATE_FLOOR, ESTIMATE_CEILING] AFTER the curve. They never out-rate
# linked greats, never fabricate a box score (the absent stat stays null in
# components), and remain flagged via overall_basis + low coverage.
DISPLAY_CURVE_KIND = "unified_pooled_piecewise_power_v1"

DISPLAY_FLOOR = 66
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
DISPLAY_HIGH_EXPONENT = 1.85


class DisplayCurve:
    """Frozen fitted-anchor record for the display calibration curve."""

    __slots__ = ("raw_floor", "raw_median", "raw_p95", "raw_max")

    def __init__(
        self, raw_floor: float, raw_median: float, raw_p95: float, raw_max: float
    ) -> None:
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


def _display_value(
    score_0_100: float, curve: DisplayCurve, *, estimate: bool = False
) -> float:
    x = score_0_100
    if x <= curve.raw_floor:
        y = float(DISPLAY_FLOOR)
    elif x >= curve.raw_max:
        y = float(DISPLAY_MAX)
    elif x <= curve.raw_median:
        span_raw = curve.raw_median - curve.raw_floor
        t = (x - curve.raw_floor) / span_raw if span_raw > 0.0 else 0.0
        y = DISPLAY_FLOOR + (DISPLAY_MEDIAN - DISPLAY_FLOOR) * (t ** DISPLAY_LOW_EXPONENT)
    elif x <= curve.raw_p95:
        span_raw = curve.raw_p95 - curve.raw_median
        t = (x - curve.raw_median) / span_raw if span_raw > 0.0 else 0.0
        y = DISPLAY_MEDIAN + (DISPLAY_P95 - DISPLAY_MEDIAN) * (t ** DISPLAY_MID_EXPONENT)
    else:
        span_raw = curve.raw_max - curve.raw_p95
        t = (x - curve.raw_p95) / span_raw if span_raw > 0.0 else 0.0
        y = DISPLAY_P95 + (DISPLAY_MAX - DISPLAY_P95) * (t ** DISPLAY_HIGH_EXPONENT)
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


def _display_score(
    score_0_100: float, curve: DisplayCurve, *, estimate: bool = False
) -> int:
    return int(round(_display_value(score_0_100, curve, estimate=estimate)))


# ─── INPUT LOADING ────────────────────────────────────────────────────────────


def _load(output_dir: Path, name: str) -> list[dict]:
    return json.loads((output_dir / f"{name}.json").read_text(encoding="utf-8"))


def _load_career_stature(output_dir: Path) -> dict[str, dict]:
    """player_id -> career-stature row from the offline merit composite.

    Missing file is tolerated (returns {}): the rating stage then degrades to the
    pre-career behavior with every lift = 0, so rating.py never hard-depends on the
    merit artifact existing. A present file must carry unique player_id keys.
    """
    path = output_dir / "career_stature.json"
    if not path.exists():
        return {}
    table = json.loads(path.read_text(encoding="utf-8"))
    by_player: dict[str, dict] = {}
    for row in table["career_stature"]:
        pid = row["player_id"]
        if pid in by_player:
            raise ValueError(f"duplicate career_stature row for {pid}")
        by_player[pid] = row
    return by_player


# ─── ERA NORMALIZATION ────────────────────────────────────────────────────────


def _percentile_map(values: list[int]) -> dict[int, float]:
    """Mid-rank percentile in [0,1] for each distinct integer value in a cohort.

    pct(v) = (#strictly-less + 0.5 * #equal) / N. Deterministic and tie-stable;
    an all-equal cohort maps every member to 0.5 (neutral), and a singleton maps
    to 0.5. This is the era equalizer: a value is ranked against its own
    (tournament, position) contemporaries, so a 1954 striker and a 2022 striker
    are placed on the same 0..1 scale despite very different raw counts.
    """
    n = len(values)
    if n == 0:
        return {}
    counts: dict[int, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    pct: dict[int, float] = {}
    cum_less = 0
    for v in sorted(counts):
        eq = counts[v]
        pct[v] = round((cum_less + 0.5 * eq) / n, _PRECISION)
        cum_less += eq
    return pct


# ─── ANCHOR COMPONENTS ────────────────────────────────────────────────────────


def _award_score(award_names: list[str]) -> float:
    """Saturating combine of held awards in [0,1]: 1 - prod(1 - points_i).

    Multiple awards lift more but never past 1.0. Raises on an unrecognized award
    name — drift protection: an unknown award must fail loud, never be silently
    dropped (which would understate) or fabricated.
    """
    acc = 1.0
    for name in award_names:
        if name not in AWARD_POINTS:
            raise KeyError(f"unrecognized award_name {name!r}; refusing to silently drop it")
        acc *= 1.0 - AWARD_POINTS[name]
    return round(1.0 - acc, _PRECISION)


# ─── CORE ─────────────────────────────────────────────────────────────────────


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def _ramp01(x: float, lo: float, hi: float) -> float:
    """Monotonic 0→1 ramp: 0 at/below lo, 1 at/above hi, linear between."""
    if hi <= lo:
        return 1.0 if x >= hi else 0.0
    return _clamp01((x - lo) / (hi - lo))


def _stature_model_weight(cs: dict | None) -> float:
    """Continuity ramp 0→1 across [MIN_INDEX ± HALF_WIDTH], gated to 0 when no career
    row exists or coverage is below the material gate. The endpoints are the
    asymptotes the plan requires: 0 = pure raw-only, 1 = pure stature-dominant."""
    if cs is None or cs["coverage"] < MATERIAL_STATURE_MIN_COVERAGE:
        return 0.0
    return _ramp01(
        cs["career_stature_index"],
        MATERIAL_STATURE_MIN_INDEX - STATURE_RAMP_HALF_WIDTH,
        MATERIAL_STATURE_MIN_INDEX + STATURE_RAMP_HALF_WIDTH,
    )


def _stature_target(pos: str, index: float) -> float:
    """Map a career-stature index onto the position's internal stature target. Index
    at the material floor maps to STATURE_TARGET_FLOOR; index ~1.0 (all-time peak)
    maps near the internal ceiling."""
    span = 1.0 - MATERIAL_STATURE_MIN_INDEX
    norm = _clamp01((index - MATERIAL_STATURE_MIN_INDEX) / span) if span > 0 else 0.0
    return _clamp01(STATURE_TARGET_FLOOR[pos] + STATURE_TARGET_SPAN[pos] * norm)


def _tournament_modulation(
    raw_tournament_score: float, tournament_ref: float, pos: str, tier: str | None
) -> float:
    """Signed, bounded tournament context around the stature target. Positive when
    the card's raw tournament score beats its (tournament_id, pos) cohort median,
    negative when it lags — capped tighter downward at higher stature tiers."""
    raw_delta = raw_tournament_score - tournament_ref
    down_cap = TOURNAMENT_DOWN_CAP[pos][tier or "bronze"]
    up_cap = TOURNAMENT_UP_CAP[pos]
    return max(-down_cap, min(up_cap, TOURNAMENT_MOD_GAIN[pos] * raw_delta))


def _channel(score_0_100: float, spread: float) -> int:
    """Convex blend between the card score (spread=1) and the replacement floor
    (spread=0), rounded to an integer in [0,100]."""
    val = score_0_100 * spread + FLOOR_CHANNEL * (1.0 - spread)
    return max(0, min(100, round(val)))


def _coarse_pos(card: dict, position_of_player: dict[str, str | None]) -> str:
    """Per-card coarse position to weight on: the listed position, falling back
    to the player's primary position. Raises if neither is a coarse code so a
    rating is never silently produced for an unweightable card."""
    pos = card["position_listed"] or position_of_player.get(card["player_id"])
    if pos not in COARSE_POSITIONS:
        raise ValueError(f"card {card['card_id']} has no coarse position to weight on")
    return pos


def _build_internal_rows(
    players: list[dict],
    cards: list[dict],
    tournaments: list[dict],
    manager_tournaments: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
) -> list[dict]:
    """Pass 1 of the rating build — return one INTERNAL row per men's card,
    carrying the pre-display COMPOSITE merit score ``score_0_100``, the
    coarse position ``pos``, the basis flag, and the components array.

    The composite is the curve's input: pass 2 (``build_ratings``) maps
    ``score_0_100`` through the fitted display curve to produce the final
    ``overall``, and through ``_channel`` to produce the four sim channels.
    Exposed via ``build_internal_view`` for the §4 acceptance suite —
    the curve's monotonicity invariant is asserted on this composite, NOT
    on per-channel values (channels are decoupled; OVR is the composite's
    believability view, not a single-channel proxy).
    """
    mens = {t["tournament_id"] for t in tournaments if "Men's" in t["name"]}
    position_of_player = {p["player_id"]: p.get("primary_position") for p in players}
    career_stature_by_player = career_stature_by_player or {}

    # Team final placement keyed by (nation_id, tournament_id). Semifinalists only;
    # everything else is genuinely absent (-> None -> dropped, never 0).
    finish_of: dict[tuple[str, str], int] = {}
    for m in manager_tournaments:
        fp = m.get("final_placement")
        if fp is None:
            continue
        key = (m["nation_id"], m["tournament_id"])
        # A mid-tournament manager change repeats the team's placement; keep the
        # best (min) deterministically if the source ever disagreed.
        finish_of[key] = fp if key not in finish_of else min(finish_of[key], fp)

    mens_cards = [c for c in cards if c["tournament_id"] in mens]

    # Build per-(tournament, position) percentile maps for the two era-dependent
    # performance signals. Appearances are null pre-1970 and excluded from their
    # cohort entirely (the signal does not exist for that era).
    goals_cohort: dict[tuple[str, str], list[int]] = {}
    apps_cohort: dict[tuple[str, str], list[int]] = {}
    for c in mens_cards:
        ckey = (c["tournament_id"], _coarse_pos(c, position_of_player))
        goals_cohort.setdefault(ckey, []).append(c["goals"])
        if c["appearances"] is not None:
            apps_cohort.setdefault(ckey, []).append(c["appearances"])
    goals_pct = {k: _percentile_map(v) for k, v in goals_cohort.items()}
    apps_pct = {k: _percentile_map(v) for k, v in apps_cohort.items()}

    # ── PASS 1a: per-card RAW tournament composite + performance bookkeeping ──
    # The raw tournament score is now a CONTEXT signal (cohort reference + bounded
    # modulation), not the base. Stage every card's raw stage first so the cohort
    # medians (pass 1b) and the raw-only ceiling (pass 1d) can be computed globally.
    staged: list[dict] = []
    raw_by_cohort: dict[tuple[str, str], list[float]] = {}
    raw_by_pos: dict[str, list[float]] = {}
    for c in mens_cards:
        pos = _coarse_pos(c, position_of_player)
        ckey = (c["tournament_id"], pos)

        g_pct = goals_pct[ckey][c["goals"]]
        a_pct = apps_pct[ckey][c["appearances"]] if c["appearances"] is not None else None

        bw = BASE_WEIGHTS[pos]
        present: list[tuple[str, float, float]] = []  # (name, value, raw_weight)
        if bw["goals"] > 0.0:
            present.append(("goals", g_pct, bw["goals"]))
        if a_pct is not None:
            present.append(("appearances", a_pct, bw["appearances"]))
        present = [(n, v, w) for (n, v, w) in present if w > 0.0]
        present_w = sum(w for _, _, w in present)

        has_individual_signal = present_w > 0.0
        if has_individual_signal:
            blend = sum(w * v for _, v, w in present) / present_w
            base = REPLACEMENT_BASE + (BASE_CEILING - REPLACEMENT_BASE) * blend
        else:
            # No usable individual performance signal (a residual unlinked pre-1970
            # DF/GK): rate from the replacement baseline + the era-invariant anchor —
            # an honest estimate, never a fabricated box score.
            base = REPLACEMENT_BASE

        eff_weight = {
            n: round(w / present_w, _PRECISION) if has_individual_signal else 0.0
            for (n, _, w) in present
        }

        award_score = _award_score(c["awards"]) if c["awards"] is not None else 0.0
        finish = finish_of.get((c["nation_id"], c["tournament_id"]))
        finish_pts = FINISH_POINTS[finish] if finish is not None else None
        anchor = AWARD_WEIGHT[pos] * award_score + FINISH_WEIGHT[pos] * (finish_pts or 0.0)

        raw_tournament_score = _clamp01(base + anchor)
        raw_by_cohort.setdefault(ckey, []).append(raw_tournament_score)
        raw_by_pos.setdefault(pos, []).append(raw_tournament_score)

        staged.append(
            {
                "card": c,
                "pos": pos,
                "g_pct": g_pct,
                "a_pct": a_pct,
                "eff_weight": eff_weight,
                "award_score": award_score,
                "finish_pts": finish_pts,
                "has_individual_signal": has_individual_signal,
                "raw_tournament_score": raw_tournament_score,
            }
        )

    # ── PASS 1b: cohort reference medians ──────────────────────────────────────
    # tournament_ref = median raw_tournament_score for (tournament_id, pos) when the
    # cohort is large enough; else the (pos) cross-tournament median; else the card's
    # own raw (→ delta 0, no modulation).
    ref_cohort = {
        k: _quantile(sorted(v), 0.5)
        for k, v in raw_by_cohort.items()
        if len(v) >= COHORT_MIN_N
    }
    ref_pos = {p: _quantile(sorted(v), 0.5) for p, v in raw_by_pos.items()}

    def _tournament_ref(tid: str, pos: str, raw: float) -> float:
        k = (tid, pos)
        if k in ref_cohort:
            return ref_cohort[k]
        if pos in ref_pos:
            return ref_pos[pos]
        return raw

    # ── PASS 1c: stature path + continuity weight; collect material finals ──────
    material_finals_by_cohort: dict[tuple[str, str], list[float]] = {}
    for s in staged:
        c = s["card"]
        pos = s["pos"]
        cs = career_stature_by_player.get(c["player_id"])
        weight = _stature_model_weight(cs)
        ref = _tournament_ref(c["tournament_id"], pos, s["raw_tournament_score"])
        if cs is not None:
            index = cs["career_stature_index"]
            tier = cs.get("stature_tier")
            target = _stature_target(pos, index)
            modulation = _tournament_modulation(
                s["raw_tournament_score"], ref, pos, tier
            )
            stature_path = _clamp01(target + modulation)
        else:
            target = None
            modulation = 0.0
            stature_path = 0.0
        s["cs"] = cs
        s["weight"] = weight
        s["ref"] = ref
        s["target"] = target
        s["modulation"] = modulation
        s["stature_path"] = stature_path
        # A clearly-material card (weight ≥ STATURE_DOMINANT_WEIGHT) defines the
        # cohort's elite internal band, which bounds the raw-only ceiling for
        # non-material cards beside it.
        if weight >= STATURE_DOMINANT_WEIGHT:
            material_finals_by_cohort.setdefault((c["tournament_id"], pos), []).append(
                stature_path
            )

    # ── PASS 1d: raw-only ceiling, final blend, basis, components ──────────────
    # The raw-only ceiling exists ONLY to keep non-material cards below the stature
    # band; when no material stature exists at all (e.g. the career table is absent,
    # as in the divergence baseline), there is no band to protect and the global
    # ceiling is not applied (it would otherwise flatten the whole distribution).
    has_any_material = any(s["weight"] >= STATURE_DOMINANT_WEIGHT for s in staged)
    internal_rows: list[dict] = []
    for s in staged:
        c = s["card"]
        pos = s["pos"]
        cs = s["cs"]
        weight = s["weight"]
        raw = s["raw_tournament_score"]

        cohort_material = material_finals_by_cohort.get((c["tournament_id"], pos))
        raw_only_ceiling = RAW_ONLY_GLOBAL_CEILING if has_any_material else 1.0
        if cohort_material:
            raw_only_ceiling = min(
                raw_only_ceiling, _quantile(sorted(cohort_material), 0.5)
            )
        raw_path = min(raw, raw_only_ceiling)

        # The continuous blend: weight 0 ⇒ raw-only, weight 1 ⇒ stature-dominant.
        final = _clamp01(weight * s["stature_path"] + (1.0 - weight) * raw_path)
        score_0_100 = 100.0 * final

        career_score_val = cs["career_stature_score"] if cs else None
        career_index_val = cs["career_stature_index"] if cs else None
        career_coverage = cs["coverage"] if cs else None
        is_material_elite = (
            cs is not None
            and cs["coverage"] >= MATERIAL_STATURE_MIN_COVERAGE
            and cs["career_stature_index"] >= CAREER_ESTIMATE_MIN_INDEX
        )

        # overall_basis split (stature-dominant model, wc-perf-4.x). The label reports
        # what actually DROVE the final score, not merely whether a tournament box
        # score exists. Under the continuity blend a material card's final is
        # weight·stature_path + (1−weight)·raw_path, so once the stature path
        # dominates (weight ≥ STATURE_DOMINANT_WEIGHT) the score is career-stature
        # driven even when the card also carries a tournament signal — keying the
        # label on has_individual_signal mislabelled ~all material greats as
        # "measured_performance".
        #   baseline_anchor_estimate — no tournament signal AND no material-elite
        #                              career: the display-capped [66,73] honest
        #                              estimate. Predicate UNCHANGED from before, so
        #                              every estimate-capped overall stays byte-
        #                              identical (this is the ONLY basis that feeds a
        #                              numeric — the estimate=True display cap).
        #   career_stature_estimate  — the stature path dominates the merit blend:
        #                              the final is primarily career stature, not
        #                              measured tournament performance.
        #   measured_performance     — the raw tournament path drives the final.
        if not s["has_individual_signal"] and not is_material_elite:
            overall_basis = "baseline_anchor_estimate"
        elif weight >= STATURE_DOMINANT_WEIGHT:
            overall_basis = "career_stature_estimate"
        else:
            overall_basis = "measured_performance"

        components = [
            {"signal": "goals", "value": c["goals"], "weight": 0.0},
            {"signal": "appearances", "value": c["appearances"], "weight": 0.0},
            {
                "signal": "goals_percentile",
                "value": s["g_pct"],
                "weight": s["eff_weight"].get("goals", 0.0),
            },
            {
                "signal": "appearances_percentile",
                "value": s["a_pct"],
                "weight": s["eff_weight"].get("appearances", 0.0),
            },
            {"signal": "award_score", "value": s["award_score"], "weight": AWARD_WEIGHT[pos]},
            {"signal": "team_finish", "value": s["finish_pts"], "weight": FINISH_WEIGHT[pos]},
            # Stature-dominant transparency (wc-perf-4.0.0). career_* are CAREER
            # aggregates (constant across a player's cards); raw_tournament_score and
            # tournament_modulation vary per card. A player with no career row shows
            # null career_*/target and a 0 stature_model_weight — visibly not
            # 0-substituted against the player. All numeric (RatingComponentSchema).
            {
                "signal": "raw_tournament_score",
                "value": round(raw, _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "tournament_reference_score",
                "value": round(s["ref"], _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "tournament_modulation",
                "value": round(s["modulation"], _PRECISION) if weight > 0.0 else 0.0,
                "weight": 0.0,
            },
            {
                "signal": "career_stature_score",
                "value": career_score_val,
                "weight": 0.0,
            },
            {
                "signal": "career_stature_index",
                "value": career_index_val,
                "weight": 0.0,
            },
            {
                "signal": "career_stature_coverage",
                "value": career_coverage,
                "weight": 0.0,
            },
            {
                "signal": "stature_target_score",
                # The position target is only APPLIED on the stature path (weight>0);
                # null on a pure raw-only card so the component never implies a
                # target that did not move the score.
                "value": (
                    round(s["target"], _PRECISION)
                    if (weight > 0.0 and s["target"] is not None)
                    else None
                ),
                "weight": 0.0,
            },
            {
                "signal": "stature_model_weight",
                "value": round(weight, _PRECISION),
                "weight": 1.0,
            },
        ]

        internal_rows.append(
            {
                "card_id": c["card_id"],
                "player_id": c["player_id"],
                "tournament_id": c["tournament_id"],
                "pos": pos,
                "score_0_100": score_0_100,
                "raw_tournament_score_0_100": round(100.0 * raw, _PRECISION),
                "overall_basis": overall_basis,
                "legend": bool(cs["legend"]) if cs else False,
                "components": components,
                "coverage": c["coverage"],
                "appearances_source": c.get("appearances_source"),
            }
        )

    return internal_rows


def build_internal_view(
    players: list[dict],
    cards: list[dict],
    tournaments: list[dict],
    manager_tournaments: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
) -> tuple[list[dict], DisplayCurve]:
    """Pass 1 + curve fit, exposed for the §4 acceptance suite.

    Returns the internal rows (each carrying ``score_0_100``, ``overall_basis``,
    ``pos``, ``components``) AND the fitted ``DisplayCurve``. The acceptance
    tests use this to assert that ``overall`` is monotonic vs the pre-display
    composite for measured cards — the right curve invariant — without
    surrogate channel-vs-overall checks.
    """
    internal = _build_internal_rows(
        players, cards, tournaments, manager_tournaments, career_stature_by_player
    )
    curve = _fit_display_curve([r["score_0_100"] for r in internal])
    return internal, curve


def build_ratings(
    players: list[dict],
    cards: list[dict],
    tournaments: list[dict],
    manager_tournaments: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
    curve: DisplayCurve | None = None,
) -> list[dict]:
    """Return Rating-shaped records for every men's card, sorted by card_id.

    Records carry the canonical (string) ``tournament_id`` / ``card_id`` so they
    JOIN 1:1 with player_tournaments.json. Mapping the string tournament id to
    the numeric id the runtime ``Rating`` zod schema wants is the later
    packages/data emit-lock step and deliberately out of scope here.

    ``curve`` is the MV2-6 UNIFIED display curve (fit on the pooled historical +
    2026 internal distribution). Passing ``None`` self-fits it via
    ``display_curve.fit_unified_curve`` so a bare call still emits the unified
    display; the orchestrator passes the curve once to avoid the redundant fit.
    The curve reshapes ``overall`` ONLY — channels are materialized independently
    from ``score_0_100`` and stay byte-identical regardless of the curve.
    """
    from . import display_curve  # lazy: avoid an import cycle

    # ── PASS 2: materialize Rating rows on the UNIFIED display curve ───────────
    internal_rows, _self_curve = build_internal_view(
        players, cards, tournaments, manager_tournaments, career_stature_by_player
    )
    if curve is None:
        curve = display_curve.fit_unified_curve()
    ratings: list[dict] = []
    for row in internal_rows:
        pos = row["pos"]
        s = row["score_0_100"]
        estimate = row["overall_basis"] == "baseline_anchor_estimate"
        overall = _display_score(s, curve, estimate=estimate)
        # DECOUPLED CHANNELS (Phase 1.1, plan §3.2 fallback).
        # Sim channels stay on the pre-recal [FLOOR_CHANNEL, 100] band so the
        # ENGINE's λ stays calibrated and the symmetric coherent-XI control
        # lands inside the modern-era (1998-2022) WC norms — see
        # tests/realism/test_modern_wc_norms.py and the realism-norms fixture.
        # Only  (display-only) passes through the calibration curve;
        # the visible bars expose the merit channel values directly.
        channels = {
            ch: _channel(s, CHANNEL_SPREAD[pos][ch])
            for ch in CHANNELS
        }
        ratings.append(
            {
                "card_id": row["card_id"],
                "player_id": row["player_id"],
                "tournament_id": row["tournament_id"],
                "overall": overall,
                "overall_basis": row["overall_basis"],
                # First-class factual legend flag, joined from career_stature.json
                # (missing row → False). MV2-7's compact builder reads THIS field;
                # it never re-derives the badge from overall >= 96.
                "legend": row["legend"],
                "attack": channels["attack"],
                "midfield": channels["midfield"],
                "defense": channels["defense"],
                "goalkeeping": channels["goalkeeping"],
                "components": row["components"],
                "coverage": row["coverage"],
                "coverage_basis": "wc_signals",
                "appearances_source": row["appearances_source"],
                "provenance": "wc_performance",
                "rating_version": RATING_VERSION,
            }
        )

    ratings.sort(key=lambda r: r["card_id"])
    return ratings


def build_all(output_dir: Path = OUTPUT_DIR) -> list[dict]:
    """Load the committed canonical tables and build every men's-card rating on
    the MV2-6 unified pooled display curve (fit once here, passed down)."""
    from . import display_curve  # lazy: avoid an import cycle

    return build_ratings(
        players=_load(output_dir, "players"),
        cards=_load(output_dir, "player_tournaments"),
        tournaments=_load(output_dir, "tournaments"),
        manager_tournaments=_load(output_dir, "manager_tournaments"),
        career_stature_by_player=_load_career_stature(output_dir),
        curve=display_curve.fit_unified_curve(output_dir),
    )


def _write_json(path: Path, obj) -> None:
    # Byte-identical with the ingestion's emitter: sorted keys, stable indent,
    # trailing newline, no timestamps.
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


# ─── MV2-4 accuracy-eyeball SAMPLE (INTERNAL-score shape) ─────────────────────
# A human-readable shape sample for Paulo's first eyeball BEFORE MV2-5/MV2-6 commit
# further effort. It shows INTERNAL scores (final, stature_path ingredients, four
# channels), NOT final display — if the curve is visibly wrong here, MV2-4 iterates
# before the downstream stages bake in a bad shape.

# Position-channel anchors surfaced explicitly so the channel-shape is legible.
_SAMPLE_POSITION_ANCHORS: tuple[tuple[str, str, str], ...] = (
    ("Paolo Maldini", "P-43222", "DF"),
    ("Franco Baresi", "P-42920", "DF"),
    ("Franz Beckenbauer", "P-72864", "DF"),
    ("Cafu", "P-91718", "DF"),
    ("Lev Yashin", "P-09317", "GK"),
    ("Gianluigi Buffon", "P-11392", "GK"),
    ("Lothar Matthäus", "P-49502", "MF"),
    ("Johan Cruyff", "P-50564", "MF"),
)


def _sample_comp(row: dict, signal: str):
    return next(c["value"] for c in row["components"] if c["signal"] == signal)


def _render_merit_v2_sample(
    internal_rows: list[dict],
    ratings_by_card: dict[str, dict],
    players: list[dict],
    career_by_player: dict[str, dict],
) -> str:
    name_of = {p["player_id"]: p.get("common_name") or p["player_id"] for p in players}
    # Representative card per player = their highest internal score.
    best: dict[str, dict] = {}
    for r in internal_rows:
        cur = best.get(r["player_id"])
        if cur is None or r["score_0_100"] > cur["score_0_100"]:
            best[r["player_id"]] = r

    def row_line(ir: dict) -> str:
        rr = ratings_by_card[ir["card_id"]]
        idx = _sample_comp(ir, "career_stature_index")
        wt = _sample_comp(ir, "stature_model_weight")
        raw = _sample_comp(ir, "raw_tournament_score")
        tgt = _sample_comp(ir, "stature_target_score")
        mod = _sample_comp(ir, "tournament_modulation")
        nm = name_of.get(ir["player_id"], ir["player_id"])
        return (
            f"| {nm} | `{ir['tournament_id']}` | {ir['pos']} "
            f"| {idx if idx is not None else '—'} | {wt:.2f} | {raw:.3f} "
            f"| {tgt if tgt is not None else '—'} | {mod:+.3f} "
            f"| {ir['score_0_100'] / 100:.3f} | {rr['attack']} | {rr['midfield']} "
            f"| {rr['defense']} | {rr['goalkeeping']} | {'✓' if rr['legend'] else '—'} |"
        )

    header = (
        "| Player | Card | Pos | Index | Wt | Raw | Target | Mod | Final | ATT | MID "
        "| DEF | GK | Lgd |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"
    )
    L: list[str] = []
    L.append(f"# Merit-v2 internal-score SHAPE sample ({RATING_VERSION})\n")
    L.append(
        "First-eyeball accuracy check of the stature-dominant INTERNAL scores (final "
        "= stature_model_weight·stature_path + (1−weight)·raw_path). NOT final "
        "display — the unified display curve is MV2-6 and final display anchors are "
        "MV2-8. `overall` is provisional here. Columns: career-stature **Index**, "
        "stature model **Wt**(eight), **Raw** tournament score, stature **Target**, "
        "tournament **Mod**ulation, blended **Final**, the four sim channels, and the "
        "factual **L**e**g**en**d** flag. Channels expose the position shape (a "
        "DF/GK legend reads elite on-position, not uniformly elite).\n"
    )

    material = [
        ir
        for pid, ir in best.items()
        if (career_by_player.get(pid) or {}).get("career_stature_index") is not None
        and _sample_comp(ir, "stature_model_weight") > 0.0
    ]
    material.sort(key=lambda r: -_sample_comp(r, "career_stature_index"))

    L.append("## Top 20 by career-stature index (representative card)\n")
    L.append(header)
    for ir in material[:20]:
        L.append(row_line(ir))

    mid = [
        ir
        for ir in material
        if 0.40 <= _sample_comp(ir, "career_stature_index") <= 0.58
    ]
    L.append("\n## Mid-band material sample (index 0.40–0.58)\n")
    L.append(header)
    for ir in mid[:12]:
        L.append(row_line(ir))

    L.append("\n## Position-channel anchors (DF / GK / MF — channel-shape check)\n")
    L.append(header)
    for _name, pid, _pos in _SAMPLE_POSITION_ANCHORS:
        ir = best.get(pid)
        if ir is not None:
            L.append(row_line(ir))

    # A raw-only control so the band separation is visible.
    raw_only = [
        ir for pid, ir in best.items()
        if _sample_comp(ir, "stature_model_weight") == 0.0
    ]
    raw_only.sort(key=lambda r: -r["score_0_100"])
    L.append("\n## Raw-only controls (no material stature — top of the raw band)\n")
    L.append(header)
    for ir in raw_only[:6]:
        L.append(row_line(ir))

    L.append(
        "\n_SHAPE check only. A recognized great's weak tournament should still read "
        "elite (bounded down-modulation off a high stature target); an apex "
        "tournament can exceed the target; a raw-only control stays below the "
        f"material band (capped at the global raw-only ceiling {RAW_ONLY_GLOBAL_CEILING})._\n"
    )
    return "\n".join(L) + "\n"


def render_merit_v2_sample(output_dir: Path = OUTPUT_DIR) -> str:
    """Render the historical INTERNAL-score shape sample as markdown (no write).

    Exposed (non-behavioral) so the 2026 stage (MV2-5) can prepend this exact
    historical section before appending its own 2026 reconciliation section into
    the SAME ``MERIT_V2_SAMPLE.md`` — see ``rating_2026.write_merit_v2_sample``.
    """
    players = _load(output_dir, "players")
    cards = _load(output_dir, "player_tournaments")
    tournaments = _load(output_dir, "tournaments")
    manager_tournaments = _load(output_dir, "manager_tournaments")
    career = _load_career_stature(output_dir)
    internal, _curve = build_internal_view(
        players, cards, tournaments, manager_tournaments, career
    )
    ratings = build_ratings(players, cards, tournaments, manager_tournaments, career)
    return _render_merit_v2_sample(
        internal, {r["card_id"]: r for r in ratings}, players, career
    )


def write_merit_v2_sample(output_dir: Path = OUTPUT_DIR) -> str:
    md = render_merit_v2_sample(output_dir)
    out = output_dir / "merit" / "MERIT_V2_SAMPLE.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md, encoding="utf-8")
    return md


def run(output_dir: Path = OUTPUT_DIR) -> list[dict]:
    """Build ratings from the committed canonical tables and emit ratings.json + the
    MV2-4 accuracy-eyeball INTERNAL-score sample."""
    ratings = build_all(output_dir)
    _write_json(output_dir / "ratings.json", ratings)
    write_merit_v2_sample(output_dir)
    return ratings


if __name__ == "__main__":
    rows = run()
    rated = len(rows)
    nulls = sum(1 for r in rows if r["overall"] is None)
    estimates = sum(1 for r in rows if r["overall_basis"] == "baseline_anchor_estimate")
    sourced = sum(1 for r in rows if r["appearances_source"] == "rsssf_starting_xi")
    print(f"wcdraft rating: wrote {rated:,} men's-card ratings -> {OUTPUT_DIR}/ratings.json")
    print(f"  overall=null: {nulls:,} (target 0)")
    print(f"  baseline_anchor_estimate (honest low-coverage estimate): {estimates:,}")
    print(f"  appearances sourced from RSSSF (pre-1970): {sourced:,}")
