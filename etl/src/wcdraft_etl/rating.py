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
RATING_VERSION = "wc-perf-3.0.0"

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

# ─── CAREER-STATURE LIFT (wc-perf-3.0.0, plan E-4.3) ──────────────────────────
# A career-stature merit BASE (built offline in merit/stature.py, keyed by
# player_id) is added to the SAME internal composite that feeds both display OVR
# and the four sim channels, BEFORE score_0_100 is materialized — so a legend's
# off-tournament card and its channels rise coherently (the channel-decoupling
# fix: Pelé-1966 attack no longer sits at the raw 54 floor). This is a FLOOR/LIFT,
# not an override: a card is lifted toward a capped career target only to the
# extent its raw tournament score falls short of that target. A great tournament
# already above the target keeps its (higher) measured score; a mid-tier or
# weakly-sourced player gets little or none. There is NO per-player override table.
#
#   career_elite  = career_stature_score ** CAREER_ELITE_EXPONENT
#   career_target = REPLACEMENT_BASE + CAREER_TARGET_SPAN[pos] * career_elite
#   career_lift   = min(CAREER_MAX_LIFT[pos],
#                       CAREER_BLEND_HISTORICAL * max(0, career_target - raw))
#   score         = clamp01(raw + career_lift)
#
# CALIBRATION NOTE: the era-weighted saturating composite in merit/stature.py
# compresses the elite tail into ~[0.50, 0.66] (its structural max is ≈0.70), so
# the elite EXPONENT is CONCAVE (< 1) — a convex exponent would under-lift the
# strong-but-not-maximal legends (Pelé/Zidane/Platini at ~0.55–0.59) relative to
# the maximal ones. Constants are fitted against the E-4 named-anchor set
# (RATING_METHODOLOGY.md §"Career-stature lift"); they are calibration, not
# algorithm, and golden-locked like the λ / display knobs.
CAREER_ELITE_EXPONENT = 0.85
CAREER_TARGET_SPAN: dict[str, float] = {"FW": 0.80, "MF": 0.80, "DF": 0.74, "GK": 0.72}
CAREER_BLEND_HISTORICAL = 0.70
CAREER_MAX_LIFT: dict[str, float] = {"FW": 0.26, "MF": 0.24, "DF": 0.22, "GK": 0.20}
# Below this career coverage the public record is too thin to support a lift; the
# card keeps its raw tournament score (honest thin coverage, not a zero).
MIN_CAREER_COVERAGE_FOR_LIFT = 0.25
# A card with no individual tournament signal is a "career_stature_estimate" (vs
# the existing capped "baseline_anchor_estimate") only when its career record is
# both well-covered AND clearly elite — otherwise the existing [66, 73] estimate
# clamp still applies.
CAREER_ESTIMATE_MIN_COVERAGE = 0.50
CAREER_ESTIMATE_MIN_SCORE = 0.55

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

# ─── DISPLAY CALIBRATION CURVE (wc-perf-2.0.0) ────────────────────────────────
# Phase 1 rating recalibration: the internal merit model above is UNCHANGED.
# Its output `score_0_100` is mapped through a deterministic monotonic
# piecewise-power curve onto the display band [DISPLAY_FLOOR, DISPLAY_MAX].
# The curve fits ONLY four global INTERNAL anchors of the emitted dataset
# (min, p50, p95, max) onto fixed display targets (66, 73, 88, 99). It is the
# SINGLE knob that reshapes the emitted distribution; the merit math is
# untouched. Low-DOF (three exponents, four data anchors, no per-player
# tuning) so it cannot fudge individuals and stays auditable.
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
DISPLAY_CURVE_KIND = "global_piecewise_power_v1"

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


def _career_lift(
    raw_tournament_score: float, pos: str, cs: dict | None
) -> tuple[float, float | None, float | None, float | None]:
    """Career-stature floor/lift for one card (plan E-4.3 formula).

    Returns ``(lift, career_score, coverage, target)`` where ``lift`` is the
    additive term in [0, CAREER_MAX_LIFT[pos]] applied to the internal composite,
    and the trailing values are the transparency numbers recorded in components[].
    With no usable career row (missing, or coverage below the gate) the lift is 0
    and target is None — the card keeps its raw tournament score (honest thin
    coverage, never a zero against the player).
    """
    if cs is None:
        return 0.0, None, None, None
    career_score = cs["career_stature_score"]
    coverage = cs["coverage"]
    if coverage < MIN_CAREER_COVERAGE_FOR_LIFT:
        # Real score recorded for transparency, but no lift: too thin to support it.
        return 0.0, career_score, coverage, None
    elite = career_score ** CAREER_ELITE_EXPONENT
    target = round(REPLACEMENT_BASE + CAREER_TARGET_SPAN[pos] * elite, _PRECISION)
    lift = min(
        CAREER_MAX_LIFT[pos],
        CAREER_BLEND_HISTORICAL * max(0.0, target - raw_tournament_score),
    )
    return round(lift, _PRECISION), career_score, coverage, target


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

    # ── PASS 1: build per-card INTERNAL rows ──────────────────────────────────
    # Refactor (wc-perf-2.0.0): the final overall/channels are computed in
    # pass 2 from `score_0_100` via the calibrated display curve.
    internal_rows: list[dict] = []
    for c in mens_cards:
        pos = _coarse_pos(c, position_of_player)
        ckey = (c["tournament_id"], pos)

        g_pct = goals_pct[ckey][c["goals"]]
        a_pct = apps_pct[ckey][c["appearances"]] if c["appearances"] is not None else None

        bw = BASE_WEIGHTS[pos]
        # Present, positively-weighted performance signals (honest-state: drop the
        # rest). A signal counts only if its value exists AND its weight is > 0.
        present: list[tuple[str, float, float]] = []  # (name, value, raw_weight)
        if bw["goals"] > 0.0:
            present.append(("goals", g_pct, bw["goals"]))
        if a_pct is not None:
            present.append(("appearances", a_pct, bw["appearances"]))
        present = [(n, v, w) for (n, v, w) in present if w > 0.0]
        present_w = sum(w for _, _, w in present)

        has_individual_signal = present_w > 0.0
        if has_individual_signal:
            # Era-normalized percentile blend in [0,1], scaled onto the performance
            # base band [REPLACEMENT_BASE, BASE_CEILING]. Performance alone tops out
            # at BASE_CEILING; the anchor supplies the rest of the headroom.
            blend = sum(w * v for _, v, w in present) / present_w
            base = REPLACEMENT_BASE + (BASE_CEILING - REPLACEMENT_BASE) * blend
        else:
            # No usable individual performance signal: a DF/GK whose pre-1970
            # appearances could not be sourced & linked from RSSSF (goals carry zero
            # weight for them). The WS-A supplement fills most pre-1970 DF/GK
            # appearances, so this path now covers only the residual unlinked cards.
            # Rather than withholding the display number (the old null path), the
            # card is rated from the position-appropriate replacement baseline plus
            # the era-invariant team-finish / award anchor — an HONEST ESTIMATE, not
            # a fabricated stat, and flagged as such via overall_basis + the card's
            # (low) coverage. No individual box-score value is invented.
            base = REPLACEMENT_BASE

        eff_weight = {
            n: round(w / present_w, _PRECISION) if has_individual_signal else 0.0
            for (n, _, w) in present
        }

        award_score = _award_score(c["awards"]) if c["awards"] is not None else 0.0
        finish = finish_of.get((c["nation_id"], c["tournament_id"]))
        finish_pts = FINISH_POINTS[finish] if finish is not None else None
        # Two independent additive cross-era lifts (see AWARD_WEIGHT / FINISH_WEIGHT).
        anchor = AWARD_WEIGHT[pos] * award_score + FINISH_WEIGHT[pos] * (finish_pts or 0.0)

        # Raw tournament composite (pre-career). This is the score the wc-perf-2.0.0
        # model emitted; the career lift is added on top of it below.
        raw_tournament_score = _clamp01(base + anchor)

        # Career-stature floor/lift: lifts BOTH overall and the four channels
        # coherently because it is added to the single composite that feeds both.
        cs = career_stature_by_player.get(c["player_id"])
        (
            career_lift,
            career_score_val,
            career_coverage,
            career_target,
        ) = _career_lift(raw_tournament_score, pos, cs)

        score = _clamp01(raw_tournament_score + career_lift)
        score_0_100 = 100.0 * score

        # overall_basis split (plan §"overall_basis semantics"):
        #   measured_performance     — a positively-weighted tournament signal exists
        #   career_stature_estimate  — no tournament signal, but a well-covered, elite
        #                              career record (exits via the uncapped curve)
        #   baseline_anchor_estimate — no tournament signal AND no usable career
        #                              record (keeps the existing [66, 73] cap)
        if has_individual_signal:
            overall_basis = "measured_performance"
        elif (
            career_coverage is not None
            and career_coverage >= CAREER_ESTIMATE_MIN_COVERAGE
            and career_score_val is not None
            and career_score_val >= CAREER_ESTIMATE_MIN_SCORE
        ):
            overall_basis = "career_stature_estimate"
        else:
            overall_basis = "baseline_anchor_estimate"

        components = [
            # Raw box-score values for transparency (weight 0 — informational).
            {"signal": "goals", "value": c["goals"], "weight": 0.0},
            {"signal": "appearances", "value": c["appearances"], "weight": 0.0},
            # Era-normalized performance signals with their EFFECTIVE base weights.
            # A dropped signal shows value:null, weight:0.0 — visibly not 0-substituted.
            {
                "signal": "goals_percentile",
                "value": g_pct,
                "weight": eff_weight.get("goals", 0.0),
            },
            {
                "signal": "appearances_percentile",
                "value": a_pct,
                "weight": eff_weight.get("appearances", 0.0),
            },
            # Cross-era anchors, each with its independent position weight. A null
            # team_finish (non-semifinalist) is shown as null, never 0-substituted.
            {"signal": "award_score", "value": award_score, "weight": AWARD_WEIGHT[pos]},
            {"signal": "team_finish", "value": finish_pts, "weight": FINISH_WEIGHT[pos]},
            # Career-stature transparency (wc-perf-3.0.0). Constant across all of a
            # player's cards (score/coverage/target); only the per-card lift varies,
            # since lift depends on how far THIS card's raw score fell short. A
            # player with no usable career row shows null score/coverage/target and
            # a 0 lift — visibly not 0-substituted against the player.
            {
                "signal": "career_stature_score",
                "value": career_score_val,
                "weight": 0.0,
            },
            {
                "signal": "career_stature_coverage",
                "value": career_coverage,
                "weight": 0.0,
            },
            {
                "signal": "career_stature_target",
                "value": career_target,
                "weight": 0.0,
            },
            {
                "signal": "career_stature_lift",
                "value": round(career_lift, _PRECISION),
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
                "raw_tournament_score_0_100": round(100.0 * raw_tournament_score, _PRECISION),
                "overall_basis": overall_basis,
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
) -> list[dict]:
    """Return Rating-shaped records for every men's card, sorted by card_id.

    Records carry the canonical (string) ``tournament_id`` / ``card_id`` so they
    JOIN 1:1 with player_tournaments.json. Mapping the string tournament id to
    the numeric id the runtime ``Rating`` zod schema wants is the later
    packages/data emit-lock step and deliberately out of scope here.
    """
    # ── PASS 2: fit display curve and materialize Rating rows ─────────────────
    internal_rows, curve = build_internal_view(
        players, cards, tournaments, manager_tournaments, career_stature_by_player
    )
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
    """Load the committed canonical tables and build every men's-card rating."""
    return build_ratings(
        players=_load(output_dir, "players"),
        cards=_load(output_dir, "player_tournaments"),
        tournaments=_load(output_dir, "tournaments"),
        manager_tournaments=_load(output_dir, "manager_tournaments"),
        career_stature_by_player=_load_career_stature(output_dir),
    )


def _write_json(path: Path, obj) -> None:
    # Byte-identical with the ingestion's emitter: sorted keys, stable indent,
    # trailing newline, no timestamps.
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def run(output_dir: Path = OUTPUT_DIR) -> list[dict]:
    """Build ratings from the committed canonical tables and emit ratings.json."""
    ratings = build_all(output_dir)
    _write_json(output_dir / "ratings.json", ratings)
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
