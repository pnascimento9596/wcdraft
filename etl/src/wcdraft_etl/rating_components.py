"""Historical rating component scoring helpers.

This module owns the stable calibration constants and pure component helpers used
by ``rating.py`` pass 1. The row-construction loop remains in ``rating.py`` so the
emitted-row contract stays in one place.
"""

from __future__ import annotations

import math

from . import league_strength, national_strength
from .merit.stature import MATERIAL_MIN_COVERAGE as MATERIAL_STATURE_MIN_COVERAGE
from .merit.stature import MATERIAL_MIN_INDEX as MATERIAL_STATURE_MIN_INDEX

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

# Material-stature gate aliases are imported from merit/stature.py so the rating
# stage consumes the same cohort definition that assigns stature tiers.
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

# merit-v4: raw-only elite ceiling prior. A non-material card's raw_path is capped
# at the LOWER of (a) a smooth national-team-strength ceiling read from
# national_strength.json and (b) the median final internal score of the material-
# stature cards in its (tournament_id, pos) cohort. The old fixed 0.62 wall is
# retired for real builds; this alias remains as the absolute top of the smooth
# prior and for tests that need a global upper-bound constant.
RAW_ONLY_GLOBAL_CEILING = national_strength.RAW_ONLY_CEILING_TOP

# merit-v3 V2 §4.1: raw-only tournament performances may escape the old 0.62
# ceiling only when the card has public major-individual-award evidence. No award
# means gate 0 and byte-identical raw-only score versus the old clamp.
RAW_AWARD_GATE_START = 0.30
RAW_AWARD_GATE_FULL = AWARD_POINTS["Golden Ball"]
RAW_AWARD_HEADROOM = 0.18

# merit-v4.2 declustering: non-material raw-only cards are allocated WITHIN the
# replacement-to-raw-ceiling band by that player's own public factual record.
# The movement is bounded and cannot escape the existing raw-only ceiling. It is
# inactive for career-stature-dominant or award-headroom rows, so elite gates stay
# source-derived and the term cannot create new 90+ players.
RAW_CONTEXT_LIFT_PRESSURE = 0.60
RAW_CONTEXT_DROP_PRESSURE = 0.35
RAW_CONTEXT_MAX_LIFT = 0.14
RAW_CONTEXT_MAX_DROP = 0.14
RAW_CONTEXT_TARGET_EXPONENT = 0.88

FACTUAL_CONTEXT_MIN_SQUAD_COVERAGE = 0.80
FACTUAL_CONTEXT_WEIGHTS: dict[str, float] = {
    "caps": 0.42,
    "intl_goals": 0.13,
    "league": 0.32,
    "role": 0.13,
}

# merit-v3 V2 §4.3a: weak-tournament stature modulation should read participation
# evidence. Unknown historical participation is neutral; sourced low/no-show
# participation both widens the allowed down-cap and adds a bounded negative
# context term before the cap is applied.
PARTICIPATION_CONTEXT_PENALTY: dict[str, float] = {
    "FW": 0.15,
    "MF": 0.15,
    "DF": 0.13,
    "GK": 0.12,
}
TOURNAMENT_LOW_PARTICIPATION_DOWN_CAP_EXTRA: dict[str, dict[str, float]] = {
    "FW": {"gold": 0.09, "silver": 0.08, "bronze": 0.07},
    "MF": {"gold": 0.09, "silver": 0.08, "bronze": 0.07},
    "DF": {"gold": 0.08, "silver": 0.07, "bronze": 0.06},
    "GK": {"gold": 0.08, "silver": 0.07, "bronze": 0.06},
}

# merit-v3 V2 §4.3b: 0-app champion reserves retain bounded squad credit instead
# of full starter-level team-finish credit. Sourced unknown appearances remain
# neutral rather than guessed low.
FINISH_PARTICIPATION_FLOOR = 0.55

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


def _participation_factor(appearances: int | None, appearances_percentile: float | None) -> float:
    """Participation factor in [FINISH_PARTICIPATION_FLOOR, 1] for sourced apps.

    Missing appearances are genuinely unknown for older cards, so they are neutral
    rather than treated as zero participation.
    """
    if appearances is None or appearances_percentile is None:
        return 1.0
    if appearances <= 0:
        return FINISH_PARTICIPATION_FLOOR
    return max(FINISH_PARTICIPATION_FLOOR, min(1.0, appearances_percentile))


def _stature_participation_context(
    appearances: int | None, appearances_percentile: float | None
) -> float:
    """Participation context for stature down-modulation.

    Unknown appearances are neutral. For sourced apps, use the app percentile but
    make 0-app cards a true no-show signal instead of the mid-rank 0-app percentile.
    """
    if appearances is None or appearances_percentile is None:
        return 1.0
    if appearances <= 0:
        return 0.0
    return max(0.0, min(1.0, appearances_percentile))


def _award_gate(award_anchor: float) -> float:
    return _ramp01(award_anchor, RAW_AWARD_GATE_START, RAW_AWARD_GATE_FULL)


def _thresholded_log_component(
    value: int | float | None, *, start: float, full: float
) -> float | None:
    if value is None:
        return None
    value = float(value)
    if value <= start:
        return 0.0
    return _clamp01(
        (math.log1p(value) - math.log1p(start)) / (math.log1p(full) - math.log1p(start))
    )


def _active_component_names(cards: list[dict], component_available) -> set[str]:
    if not cards:
        return set()
    active: set[str] = set()
    for name in FACTUAL_CONTEXT_WEIGHTS:
        count = sum(1 for card in cards if component_available(card, name))
        if count / len(cards) >= FACTUAL_CONTEXT_MIN_SQUAD_COVERAGE:
            active.add(name)
    return active


def _renormalized_context_score(values: dict[str, float | None], active: set[str]) -> float | None:
    weighted: list[tuple[float, float]] = []
    for name in sorted(active):
        weight = FACTUAL_CONTEXT_WEIGHTS[name]
        value = values.get(name)
        weighted.append((weight, _clamp01(float(value or 0.0))))
    total = sum(weight for weight, _ in weighted)
    if total <= 0.0:
        return None
    return _clamp01(sum(weight * value for weight, value in weighted) / total)


def _context_adjusted_raw_only_score(
    *,
    raw_score: float,
    raw_only_ceiling: float,
    raw_path: float,
    context_score: float | None,
    material_weight: float,
    award_headroom: float = 0.0,
) -> tuple[float, float, float, float]:
    """Apply the merit-v4.2 factual declustering adjustment.

    Returns ``(adjusted_raw_path, context_score_or_null, signed_adjustment,
    context_band)``. The adjustment is active only for non-material,
    no-award-headroom rows. It can move a row up or down inside the existing
    replacement-to-ceiling band, but it cannot push a score above the raw-only
    ceiling or below replacement.
    """
    if (
        context_score is None
        or material_weight >= STATURE_DOMINANT_WEIGHT
        or award_headroom > 0.0
        or raw_only_ceiling <= REPLACEMENT_BASE
    ):
        return raw_path, context_score if context_score is not None else None, 0.0, 0.0
    base = min(raw_path, raw_only_ceiling)
    context = _clamp01(context_score)
    band = raw_only_ceiling - REPLACEMENT_BASE
    target = REPLACEMENT_BASE + band * (context**RAW_CONTEXT_TARGET_EXPONENT)
    delta = target - base
    if delta >= 0.0:
        movement = min(RAW_CONTEXT_MAX_LIFT, RAW_CONTEXT_LIFT_PRESSURE * delta)
    else:
        movement = -min(RAW_CONTEXT_MAX_DROP, RAW_CONTEXT_DROP_PRESSURE * abs(delta))
    adjusted = max(REPLACEMENT_BASE, min(raw_only_ceiling, base + movement))
    return adjusted, context, movement, band


def _raw_only_score(
    raw_tournament_score: float, raw_only_ceiling: float, award_anchor: float
) -> float:
    capped = min(raw_tournament_score, raw_only_ceiling)
    headroom = _award_gate(award_anchor) * min(
        max(raw_tournament_score - raw_only_ceiling, 0.0),
        RAW_AWARD_HEADROOM,
    )
    return _clamp01(capped + headroom)


def _national_strength_row(
    national_strength_by_key: dict[tuple[str, str], dict] | None,
    card: dict,
) -> dict | None:
    if national_strength_by_key is None:
        return None
    key = (card["tournament_id"], card["nation_id"])
    try:
        return national_strength_by_key[key]
    except KeyError as exc:
        raise ValueError(f"card {card['card_id']} has no national_strength row for {key}") from exc


def _tournament_modulation(
    raw_tournament_score: float,
    tournament_ref: float,
    pos: str,
    tier: str | None,
    participation_context: float = 1.0,
) -> float:
    """Signed, bounded tournament context around the stature target. Positive when
    the card's raw tournament score beats its (tournament_id, pos) cohort median,
    negative when it lags — capped tighter downward at higher stature tiers."""
    participation_gap = 1.0 - _clamp01(participation_context)
    raw_delta = raw_tournament_score - tournament_ref
    if raw_delta < 0.0 or participation_gap > 0.0:
        raw_delta -= PARTICIPATION_CONTEXT_PENALTY[pos] * participation_gap
    down_cap = TOURNAMENT_DOWN_CAP[pos][tier or "bronze"] + (
        TOURNAMENT_LOW_PARTICIPATION_DOWN_CAP_EXTRA[pos][tier or "bronze"] * participation_gap
    )
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


def _historical_factual_context_by_card(
    cards: list[dict],
    position_of_player: dict[str, str | None],
) -> dict[str, dict]:
    """card_id -> public factual context score for raw-only declustering.

    Components activate at the squad level only when the pinned sources provide
    that field for >=80% of the squad. Missing individual values for an active
    component are then honest-low (0), while inactive components are omitted and
    weights are renormalized. This prevents a half-sourced page from creating
    arbitrary gaps.
    """

    by_squad: dict[tuple[str, str], list[dict]] = {}
    for card in cards:
        by_squad.setdefault((card["tournament_id"], card["nation_id"]), []).append(card)

    out: dict[str, dict] = {}

    def available(card: dict, name: str) -> bool:
        if name == "caps":
            return card.get("caps") is not None
        if name == "intl_goals":
            pos = _coarse_pos(card, position_of_player)
            return pos != "GK" and card.get("intl_goals") is not None
        if name == "league":
            return (
                league_strength.league_context_component(card.get("club_nation_code")) is not None
            )
        if name == "role":
            return card.get("appearances") is not None
        raise KeyError(name)

    for squad_cards in by_squad.values():
        active = _active_component_names(squad_cards, available)
        if not active:
            for card in squad_cards:
                out[card["card_id"]] = {
                    "score": None,
                    "active_count": 0,
                    "caps": None,
                    "intl_goals": None,
                    "league": None,
                    "role": None,
                }
            continue
        max_apps = max(
            (
                int(card["appearances"])
                for card in squad_cards
                if card.get("appearances") is not None
            ),
            default=0,
        )
        for card in squad_cards:
            pos = _coarse_pos(card, position_of_player)
            caps = _thresholded_log_component(card.get("caps"), start=5.0, full=100.0)
            intl_goals = (
                None
                if pos == "GK"
                else _thresholded_log_component(card.get("intl_goals"), start=2.0, full=30.0)
            )
            league = league_strength.league_context_component(card.get("club_nation_code"))
            role = None
            if card.get("appearances") is not None and max_apps > 0:
                role = _clamp01(int(card["appearances"]) / max_apps)
            values = {
                "caps": caps,
                "intl_goals": intl_goals,
                "league": league,
                "role": role,
            }
            out[card["card_id"]] = {
                "score": _renormalized_context_score(values, active),
                "active_count": len(active),
                **values,
            }
    return out
