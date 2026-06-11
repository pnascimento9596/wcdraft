"""WS-A-2026 PROJECTED rating stage — ratings for the real 2026 squads.

The 2026 players have NO World Cup performance yet, so their ratings are
``provenance = 'projected_career'``: derived from the factual CAREER signals on
the pinned Wikipedia squad lists — international caps, international goals, age,
and listed position — by the SAME original methodology family as the 1930-2022
``wc-perf`` rating (``rating.py``): within-cohort era-fair percentile, position-
weighted base, honest-state drop of absent signals, the identical sim-channel
spread, and a defender/keeper that is NEVER rated on goals.

KEY HONEST DIFFERENCES FROM ``wc-perf`` (all deliberate, all flagged):
  * Performance signals are CAREER (caps stand in for the appearances/minutes
    role; international goals for the goals role) rather than single-tournament
    box score.
  * The two cross-era ANCHORS of ``wc-perf`` — individual tournament awards and
    team final placement — DO NOT EXIST yet (the tournament has not been played).
    They are therefore honestly DROPPED (null, weight 0), never invented. The
    performance BASE (caps/goals percentile) stays within [REPLACEMENT_BASE,
    BASE_CEILING]; a club-league QUALITY anchor (below) supplies the headroom above
    it, exactly as wc-perf's award/finish anchor does. WS-B reconciles 2026-opponent
    strength with the historical pool at aggregation time.
  * The quality anchor is club-league strength (the strongest factual quality proxy
    available pre-tournament); an age-curve modifier (factual, from date of birth)
    positions a card within the band by career stage. Both are wcdraft's own, not a
    proprietary rating.

LEGAL FIREWALL (unchanged): nothing here is ingested or perturbed from EA Sports
FC or any proprietary rating. Every number derives only from the public career
signals by wcdraft's own formula.

HONEST-STATE: every current player has caps and international goals (real measured
integers, possibly 0), so the appearance-role signal (caps) is ALWAYS present —
2026 cards therefore never get the ``overall = null`` insufficient-signal path.
"""

from __future__ import annotations

import bisect
import json
from pathlib import Path

# Reuse the EXACT wc-perf machinery so "same methodology family" is literal, not
# a paraphrase: the position weights, the band, the channel spread, the percentile
# map, and the channel/clamp helpers are imported, not re-implemented. MV2-5 also
# imports the stature-dominant composite pieces (stature target, continuity ramp,
# tier caps, raw-only ceiling) so 2026 linked players sit on the SAME stature scale
# as the historical wc-perf-4.x cards — one scale across both, not a parallel model.
# Non-material 2026 cards are placed on the historical raw-only scale by EMPIRICAL
# QUANTILE MAPPING (not an affine rescale) — see _raw_only_quantile_map — so the
# 2026 non-material internal-score DISTRIBUTION matches the historical raw-only
# quantiles cross-era, the population MV2-6's single monotonic curve pools.
from . import rating
from .rating import (
    _PRECISION,
    BASE_CEILING,
    BASE_WEIGHTS,
    CHANNEL_SPREAD,
    CHANNELS,
    COARSE_POSITIONS,
    COHORT_MIN_N,
    RAW_ONLY_GLOBAL_CEILING,
    REPLACEMENT_BASE,
    STATURE_DOMINANT_WEIGHT,
    TOURNAMENT_DOWN_CAP,
    TOURNAMENT_UP_CAP,
    _channel,
    _clamp01,
    _display_score,
    _quantile,
    _stature_model_weight,
    _stature_target,
)
from .rating import _load_career_stature as _load_historical_career_stature

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"

# Distinct version anchor — a projected rating is a different algorithm from
# wc-perf and must be replay-anchored separately. Team2026.rating_version must
# equal this. MV2-5 (merit-v2): projected 2026 ratings reconcile onto the career-
# stature scale for linked-material players → proj-career-3.0.0.
# proj-career-4.0.0 (merit-v3 V3, design §2): D1 age-conditional quantile curves
# replace the all-age caps/goals percentiles (age_factor RETIRED — keeping both
# would re-create the youth double penalty), the stature seam consults the
# career-stature-3.0.0 person-identity rows for linked AND minted cards, the
# MV2-5 cross-era quantile map is re-derived against the wc-perf-5.0.0 raw-only
# distribution, and rows emit the additive Career/Current dual-basis payload.
RATING_VERSION = "proj-career-4.0.0"

PROVENANCE = "projected_career"
COVERAGE_BASIS = "career_signals"

# Tournament start, for the age-as-of date (the squad tables list age as of the
# opening match, June 11 2026).
_AGE_AS_OF = (2026, 6, 11)

# ─── CALIBRATION ──────────────────────────────────────────────────────────────
# D1 age-conditional quantile conditioning (merit-v3 V3, design §2.1). The old
# all-age percentiles punished youth twice (Yamal: all-age caps p0.502 vs U21-FW
# cohort p0.919, THEN an age_factor floor 0.80 on top), while hard age-band
# cohorts are too grainy (U21 FW n=31). Both all-age percentiles AND age_factor
# are replaced by ONE mechanism: per position × signal, a pooled monotone-in-age
# conditional quantile surface over the full 2026 pool — a player's evidence
# percentile is their signal's quantile AT THEIR AGE. age_factor is RETIRED (the
# career-stage job lives entirely in the conditioning; keeping both re-creates
# the double penalty). Constants are CALIBRATION (golden-locked, tunable):
#   AGE_QUANTILE_BANDWIDTH — triangular-kernel half-width (years) of the pooled
#     smoothing window; soft weights, no hard band edges (the n=31 grain trap).
#     Fit IN-UNIT against the §2.1 pre-registered distribution lock (the minted
#     raw-path age signature must FLATTEN, not invert): measured gap old-vs-young
#     was +4.16 display points pre-V3; h=4 inverted it to −2.31 (overcorrection),
#     h=8 lands +0.09 with every §7.2 control inside its band. Locked at 8.0.
#   AGE_QUANTILE_P_STEPS — resolution of the per-age quantile column (the p-grid
#     has AGE_QUANTILE_P_STEPS + 1 points).
AGE_QUANTILE_BANDWIDTH = 8.0
AGE_QUANTILE_P_STEPS = 200

# Cross-sectional QUALITY anchor — club-league strength. caps + international
# goals measure EXPERIENCE and PRODUCTIVITY, which over-reward longevity (a minnow
# veteran outcaps a young elite). The club a player holds down is the strongest
# factual quality proxy available pre-tournament, and it is the projected analog of
# wc-perf's award/finish anchor: an absolute, position-weighted lift that supplies
# the headroom above the performance band. League strength is keyed by the club's
# nation code (the squad source's `clubnat`), grouped into transparent tiers — a
# CALIBRATION prior (golden-locked, tunable), entirely wcdraft's own; NOT a
# proprietary club/player rating.
_LEAGUE_TIERS: dict[float, tuple[str, ...]] = {
    1.00: ("ENG", "ESP"),
    0.90: ("GER", "ITA", "FRA"),
    0.74: ("POR", "NED", "BRA"),
    0.58: (
        "BEL", "TUR", "ARG", "USA", "KSA", "MEX", "GRE", "SUI", "RUS", "AUT",
        "SCO", "DEN", "CRO", "JPN", "KOR", "NOR", "CZE", "POL", "SRB", "UKR",
    ),
}
LEAGUE_DEFAULT = 0.42  # any league not tiered above (developing / domestic minnow)
LEAGUE_STRENGTH: dict[str, float] = {
    code: score for score, codes in _LEAGUE_TIERS.items() for code in codes
}
# Position weights for the league anchor (an apex top-5 club lifts every position).
# Weighted as the DOMINANT quality signal — deliberately above wc-perf's award
# weights — because for a PROJECTION the club level a player holds down is a better
# quality proxy than caps/goals, which over-reward longevity (a minnow veteran
# out-caps a young elite). This widens the powers-vs-minnows separation without
# letting any single signal pin the score at 100.
LEAGUE_WEIGHT: dict[str, float] = {"FW": 0.31, "MF": 0.34, "DF": 0.31, "GK": 0.28}


def _load_career_stature(output_dir: Path) -> dict[str, dict]:
    """player_id -> FULL career-stature-3.0.0 row (merit-v3 V3).

    V3 retires the V1 rating-compat pin: the projected stage now consumes the
    same full v3 person-identity rows as the historical wc-perf-5.0.0 stage —
    one table, one scale, both eras. Minted 2026 players resolved by the V1
    person-identity resolver carry rows keyed by their minted player_id, so the
    same player_id lookup serves linked and minted cards alike.
    """
    return _load_historical_career_stature(output_dir)


# ─── STATURE RECONCILIATION (proj-career-3.0.0, merit-v2 MV2-5) ───────────────
# Linked + material-stature 2026 players are evaluated through the SAME stature
# scale as the historical wc-perf-4.x cards (plan §"2026 reconciliation"): the
# stature target (rating._stature_target), the continuity ramp
# (rating._stature_model_weight), the tier-tightened modulation caps
# (TOURNAMENT_{UP,DOWN}_CAP), and the global raw-only elite ceiling
# (RAW_ONLY_GLOBAL_CEILING) are imported, not re-implemented — there is ONE scale
# across historical + projected. The ONLY 2026-specific knob is the modulation GAIN
# applied to the PROJECTED context delta (the projected raw score is a different
# composite from the historical tournament box score, so its gain is its own
# golden-locked constant; the caps it clamps into are the shared historical caps).
#
#   linked + material:  projected_final = stature_target(pos, index)
#                          + clamp(PROJECTED_MOD_GAIN[pos]·(projected_raw − ref),
#                                  −DOWN_CAP[pos][tier], +UP_CAP[pos])
#   non-material:        projected_final = quantile_map(projected_raw)  (see below)
#   (linked-material gets weight 1; the continuity ramp interpolates the boundary.)
#
# Aging legends take DOWNWARD projected modulation but never a full collapse below
# recognized stature: the down-cap is tightest at the gold tier (a gold legend's
# weak projected context dips at most DOWN_CAP["gold"] below their stature target).
PROJECTED_MOD_GAIN: dict[str, float] = {"FW": 0.40, "MF": 0.40, "DF": 0.35, "GK": 0.30}


def _historical_raw_only_internal(output_dir: Path) -> list[float]:
    """Sorted internal scores (in [0,1]) of the HISTORICAL PURE raw-only cards
    (``stature_model_weight == 0``) under the LIVE wc-perf-5.0.0 view.

    merit-v3 V3 re-derives the MV2-5 cross-era quantile map against V2's new
    historical raw-only distribution (design §2.1: same mechanism, new inputs).
    The V2-era compatibility reconstruction (rating_compat + legacy raw component)
    is removed: the target is now each raw-only card's actual internal final —
    its ``raw_only_score``, i.e. the participation-scaled raw path including the
    §4.1 award-gated headroom — exactly the population the unified display curve
    pools. (2026 cards have null awards pre-tournament, so their own ceiling
    clamp in pass 1d still binds at the no-award clamp.)
    """
    target: list[float] = []
    internal, _curve = rating.build_internal_view(
        players=rating._load(output_dir, "players"),
        cards=rating._load(output_dir, "player_tournaments"),
        tournaments=rating._load(output_dir, "tournaments"),
        manager_tournaments=rating._load(output_dir, "manager_tournaments"),
        career_stature_by_player=rating._load_career_stature(output_dir),
    )
    for r in internal:
        comps = {c["signal"]: c["value"] for c in r["components"]}
        if comps.get("stature_model_weight") == 0.0:
            # For a weight==0 card the blend collapses to the raw path, so the
            # emitted raw_only_score IS the card's internal final score.
            target.append(comps["raw_only_score"])
    return sorted(target)


def _empirical_percentile(sorted_vals: list[float], x: float) -> float:
    """Mid-rank percentile of ``x`` within ``sorted_vals`` in [0,1]: ``(#strictly-less
    + 0.5·#equal) / N`` — the float analog of ``rating._percentile_map``. Tie-stable,
    deterministic, monotonic non-decreasing in ``x`` (equal values share a percentile);
    empty reference ⇒ 0.5 (neutral)."""
    n = len(sorted_vals)
    if n == 0:
        return 0.5
    lo = bisect.bisect_left(sorted_vals, x)
    hi = bisect.bisect_right(sorted_vals, x)
    return (lo + 0.5 * (hi - lo)) / n


def _raw_only_quantile_map(
    projected_raw: float,
    raw_only_cohort_sorted: list[float],
    historical_raw_only_internal: list[float],
) -> float:
    """Place a non-material 2026 card's projected raw composite onto the HISTORICAL
    raw-only internal scale by EMPIRICAL QUANTILE MAPPING (density neutralization, not
    bound-matching).

    The projected raw composite (caps/goals percentile band + a strong club-league
    quality anchor) runs HOT relative to the historical tournament box score — its
    median is ≈0.66 vs ≈0.43 historically. An affine rescale onto
    ``[REPLACEMENT_BASE, ceiling]`` matched only the BOUNDS: it left the 2026 floor
    lifted (≈0.34 vs the historical 0.20) and the whole non-material distribution
    sitting systematically above comparable historical journeymen, which a single
    monotonic display curve (MV2-6) cannot pull back down. Instead we histogram-match:
    take the card's percentile ``p`` within the 2026 pure-raw-only (``weight == 0``)
    projected-raw cohort, then read the historical raw-only internal score at the SAME
    percentile ``p``. The 2026 non-material internal-score distribution then MATCHES
    the historical raw-only quantiles — a 2026 reserve at percentile ``p`` lands at the
    same internal score as a historical raw-only card at percentile ``p`` (e.g. a 2026
    bench defender aligns with a Mangala-2014-class historical reserve, not above it).

    Monotonic in ``projected_raw`` (mid-rank percentile ∘ linear-interp quantile), so
    within-2026 rank is preserved. Used as the raw COMPONENT everywhere: pure raw-only
    (``weight == 0``) cards AND the raw term of the continuity-ramp blend for
    linked-but-below-material (``0 < weight < 0.5``) cards — the percentile is always
    taken against the ``weight == 0`` cohort. With no historical band to match
    (``ratings.json`` absent) the projected raw passes through rank-preserved.
    """
    if not historical_raw_only_internal:
        return projected_raw
    p = _empirical_percentile(raw_only_cohort_sorted, projected_raw)
    return _quantile(historical_raw_only_internal, p)


def _projected_modulation(
    projected_raw: float, projected_ref: float, pos: str, tier: str | None
) -> float:
    """Signed, bounded projected-context modulation around the stature target —
    the 2026 analog of rating._tournament_modulation. Positive when the card's
    projected raw score beats its 2026 position-cohort median, negative when it
    lags; clamped tighter downward at higher stature tiers (the shared caps)."""
    delta = projected_raw - projected_ref
    down_cap = TOURNAMENT_DOWN_CAP[pos][tier or "bronze"]
    up_cap = TOURNAMENT_UP_CAP[pos]
    return max(-down_cap, min(up_cap, PROJECTED_MOD_GAIN[pos] * delta))


def _league_score(club_nation_code: str | None) -> float | None:
    """League-strength prior for the club's nation, or None when the club is
    UNKNOWN. A present-but-untiered league gets the legitimate baseline tier
    (LEAGUE_DEFAULT); an ABSENT club returns None so the anchor is honestly DROPPED
    (never a fabricated 0.42 applied to a player whose club we don't know)."""
    if not club_nation_code:
        return None
    return LEAGUE_STRENGTH.get(club_nation_code, LEAGUE_DEFAULT)


# Honest career-signal coverage: signals we DO have vs an ideal that also includes
# club-competition minutes and a qualification box-score — neither of which is in
# the squad source, so they are never fabricated and cap coverage below 1.0.
CAREER_IDEAL_SIGNALS = ("caps", "intl_goals", "age", "position", "club",
                        "club_minutes", "qualification_record")


def _age_at(birth_date: str | None) -> int | None:
    if not birth_date:
        return None
    y, m, d = (int(x) for x in birth_date.split("-"))
    ay, am, ad = _AGE_AS_OF
    return ay - y - ((am, ad) < (m, d))


class AgeConditionalQuantiles:
    """D1 (merit-v3 V3, design §2.1): a pooled, monotone-in-age conditional
    quantile surface for one position × signal over the full 2026 pool.

    Construction (deterministic, no randomness):
      1. For every integer age on the observed [min_age, max_age] grid, the
         conditional quantile column ``Q[age][k]`` (k over the p-grid, Hazen
         weighted quantiles) is computed from ALL pool members weighted by a
         triangular kernel ``max(0, 1 − |age_i − age| / AGE_QUANTILE_BANDWIDTH)``
         — pooled smoothing, no hard band edges.
      2. Monotone-in-age is then ENFORCED structurally: for each fixed p, the
         expected signal accrual Q(p, age) is made non-decreasing in age by a
         running max along the age axis (caps/goals are career accruals — an
         older cohort's quantile curve can never sit below a younger one's).

    Lookup: ``percentile(value, age)`` is the mid-rank of ``value`` within the
    (clamped) age's quantile column — the signal's quantile AT THAT AGE.
    Properties (asserted by tests): monotone non-decreasing in ``value`` at any
    fixed age, and monotone NON-INCREASING in ``age`` at any fixed value (the
    same accrual ranks lower against an older expectation), which is exactly the
    structure that removes the youth double penalty without a veteran bonus.
    Unknown age falls back to the unconditional (all-weight-1) column — honest
    neutral, never a penalty.
    """

    __slots__ = ("min_age", "max_age", "columns", "unconditional")

    def __init__(self, pairs: list[tuple[int | None, float]]) -> None:
        aged = [(a, float(v)) for a, v in pairs if a is not None]
        if not aged:
            raise ValueError("AgeConditionalQuantiles needs at least one aged member")
        self.min_age = min(a for a, _ in aged)
        self.max_age = max(a for a, _ in aged)
        by_value = sorted(aged, key=lambda av: (av[1], av[0]))
        values = [v for _, v in by_value]
        ages = [a for a, _ in by_value]

        self.unconditional = self._weighted_column(values, [1.0] * len(values))
        raw_columns: list[list[float]] = []
        for age in range(self.min_age, self.max_age + 1):
            w = [
                max(0.0, 1.0 - abs(ai - age) / AGE_QUANTILE_BANDWIDTH) for ai in ages
            ]
            if sum(w) <= 0.0:  # pragma: no cover — grid spans observed ages
                w = [1.0] * len(values)
            raw_columns.append(self._weighted_column(values, w))
        # Structural monotone-in-age pass: running max along age for each p.
        self.columns = []
        prev: list[float] | None = None
        for col in raw_columns:
            if prev is not None:
                col = [max(p, c) for p, c in zip(prev, col, strict=True)]
            self.columns.append(col)
            prev = col

    @staticmethod
    def _weighted_column(sorted_values: list[float], weights: list[float]) -> list[float]:
        """Hazen weighted quantiles of ``sorted_values`` (ascending, with the
        paired ``weights``) at every p on the fixed p-grid. Deterministic linear
        interpolation between weighted mid-rank positions; clamped at extremes."""
        total = sum(weights)
        # Weighted Hazen plotting positions: ((cumw before) + w/2) / total.
        positions: list[float] = []
        values: list[float] = []
        cum = 0.0
        for v, w in zip(sorted_values, weights, strict=True):
            if w <= 0.0:
                continue
            positions.append((cum + 0.5 * w) / total)
            values.append(v)
            cum += w
        col: list[float] = []
        for k in range(AGE_QUANTILE_P_STEPS + 1):
            p = k / AGE_QUANTILE_P_STEPS
            if p <= positions[0]:
                col.append(values[0])
            elif p >= positions[-1]:
                col.append(values[-1])
            else:
                hi = bisect.bisect_left(positions, p)
                lo = hi - 1
                span = positions[hi] - positions[lo]
                frac = (p - positions[lo]) / span if span > 0.0 else 0.0
                col.append(values[lo] * (1.0 - frac) + values[hi] * frac)
        return col

    def percentile(self, value: float, age: int | None) -> float:
        """Mid-rank of ``value`` within the age's quantile column, in [0,1]."""
        if age is None:
            col = self.unconditional
        else:
            a = min(max(age, self.min_age), self.max_age)
            col = self.columns[a - self.min_age]
        less = bisect.bisect_left(col, float(value))
        more = bisect.bisect_right(col, float(value))
        return round((less + 0.5 * (more - less)) / len(col), _PRECISION)


def career_coverage(card: dict) -> float:
    """Honest career-signal coverage for a 2026 card (used by the card builder)."""
    present = {
        "caps": card.get("caps") is not None,
        "intl_goals": card.get("intl_goals") is not None,
        "age": card.get("birth_date") is not None,
        "position": card.get("position_listed") in COARSE_POSITIONS,
        "club": bool(card.get("club")),
        "club_minutes": False,  # not in source — never fabricated
        "qualification_record": False,  # not in source — never fabricated
    }
    return round(sum(present[s] for s in CAREER_IDEAL_SIGNALS) / len(CAREER_IDEAL_SIGNALS), 4)


def _projected_raw_score(c: dict, g_pct: float, a_pct: float) -> tuple[float, dict]:
    """The factual projected RAW composite (AGE-CONDITIONED caps/goals percentile
    band plus the league-strength quality anchor) in [0,1], with the eff-weight
    bookkeeping. merit-v3 V3 (design §2.1): the incoming percentiles are already
    conditioned on age by the D1 quantile surface, and ``age_factor`` is RETIRED —
    applying a second age temper on an already-age-conditioned percentile would
    re-create the youth double penalty the unit exists to remove. Under MV2-5
    semantics this remains the projected CONTEXT signal (cohort reference +
    bounded modulation for material players; the capped raw path for everyone
    else), not the standalone final score."""
    pos = c["position_listed"]
    bw = BASE_WEIGHTS[pos]
    # caps takes the appearances-role weight; intl goals the goals-role weight.
    # A DF/GK has goals weight 0 -> never rated on goals (the firewall holds).
    present: list[tuple[str, float, float]] = []
    if bw["goals"] > 0.0:
        present.append(("goals", g_pct, bw["goals"]))
    if bw["appearances"] > 0.0:
        present.append(("appearances", a_pct, bw["appearances"]))
    present_w = sum(w for _, _, w in present)

    blend = sum(w * v for _, v, w in present) / present_w  # caps always present
    age = _age_at(c.get("birth_date"))
    league = _league_score(c.get("club_nation_code"))
    # Age-conditioned performance band plus the league-strength quality anchor —
    # the projected analog of wc-perf's award/finish anchor, supplying headroom
    # above BASE_CEILING. The tournament award/finish anchors themselves are
    # UNEARNED pre-tournament -> dropped.
    # An UNKNOWN club drops the anchor entirely (honest-state), never 0-substituted.
    base = REPLACEMENT_BASE + (BASE_CEILING - REPLACEMENT_BASE) * blend
    league_weight = LEAGUE_WEIGHT[pos] if league is not None else 0.0
    anchor = league_weight * (league or 0.0)
    score = _clamp01(base + anchor)
    eff = {n: round(w / present_w, _PRECISION) for (n, _, w) in present}
    book = {
        "age": age,
        "league": league,
        "league_weight": league_weight,
        "eff": eff,
    }
    return score, book


def _build_internal_rows(
    cards: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
    historical_raw_only_internal: list[float] | None = None,
) -> list[dict]:
    """Pass 1 of the projected build — one INTERNAL row per 2026 card carrying the
    pre-display ``score_0_100`` (now on the stature scale for linked-material cards),
    the basis flag, the legend flag, and the components array. Exposed via
    ``build_internal_view`` for the acceptance suite, which asserts the INTERNAL
    score behavior (the assertable MV2-5 quantity; display is provisional → MV2-6).

    Whose career row clears the material-stature gate is reconciled onto the SAME
    stature scale as the historical wc-perf-5.x cards (stature target + bounded
    projected-context modulation). merit-v3 V3: the stature seam is PERSON
    identity — linked cards consult by their shared canonical id, minted cards by
    their minted id (the V1 resolver materializes minted persons' rows under
    those ids; ambiguity is withheld upstream and yields no row). Cards with no
    career row stay on the honest projected raw path, capped below the
    recognized-greats band by the shared raw-only ceiling and never carrying a
    factual ``legend``.
    """
    career_stature_by_player = career_stature_by_player or {}
    historical_raw_only_internal = historical_raw_only_internal or []

    # D1 age-conditional quantile surfaces per (position × signal) — for 2026
    # there is one tournament, so the cohort is (position) across all 48 squads:
    # a striker is normalized against every other 2026 striker AT THEIR AGE
    # (design §2.1), replacing the all-age percentile maps.
    goals_cohort: dict[str, list[tuple[int | None, float]]] = {}
    caps_cohort: dict[str, list[tuple[int | None, float]]] = {}
    for c in cards:
        pos = c["position_listed"]
        if pos not in COARSE_POSITIONS:
            raise ValueError(f"2026 card {c['card_id']} has non-coarse position {pos!r}")
        age = _age_at(c.get("birth_date"))
        goals_cohort.setdefault(pos, []).append((age, c["intl_goals"]))
        caps_cohort.setdefault(pos, []).append((age, c["caps"]))
    goals_curves = {p: AgeConditionalQuantiles(v) for p, v in goals_cohort.items()}
    caps_curves = {p: AgeConditionalQuantiles(v) for p, v in caps_cohort.items()}

    # ── PASS 1a: projected RAW composite + per-pos raw cohort (the context base) ─
    staged: list[dict] = []
    raw_by_pos: dict[str, list[float]] = {}
    for c in cards:
        pos = c["position_listed"]
        age = _age_at(c.get("birth_date"))
        g_pct = goals_curves[pos].percentile(c["intl_goals"], age)
        a_pct = caps_curves[pos].percentile(c["caps"], age)
        projected_raw, book = _projected_raw_score(c, g_pct, a_pct)
        raw_by_pos.setdefault(pos, []).append(projected_raw)
        staged.append(
            {
                "card": c,
                "pos": pos,
                "g_pct": g_pct,
                "a_pct": a_pct,
                "projected_raw": projected_raw,
                **book,
            }
        )

    # ── PASS 1b: cohort reference median per 2026 position cohort ───────────────
    # 2026 is a single tournament, so (tournament_id, pos) collapses to (pos). Mirror
    # the historical fallback chain: cohort median when n >= COHORT_MIN_N, else the
    # card's own raw (→ delta 0, no modulation). (Every 2026 position cohort is large,
    # so the cohort median always applies; the guard matches rating.py for parity.)
    ref_pos = {
        p: _quantile(sorted(v), 0.5) for p, v in raw_by_pos.items() if len(v) >= COHORT_MIN_N
    }

    def _projected_ref(pos: str, raw: float) -> float:
        return ref_pos.get(pos, raw)

    # ── PASS 1c: stature path + continuity weight for LINKED players; collect the
    # material finals that bound the raw-only ceiling beside them ────────────────
    material_finals_by_pos: dict[str, list[float]] = {}
    for s in staged:
        c = s["card"]
        pos = s["pos"]
        # link_status drives whether career stature is consulted AT ALL. Missing it
        # is a contract break (the identity seam must stamp every 2026 card) — fail
        # loudly, never default to a status.
        link_status = c.get("link_status")
        if link_status is None:
            raise ValueError(f"2026 card {c['card_id']} has no link_status")
        # merit-v3 V3 person-identity seam (design §1.1): "linked" cards consult
        # by their shared canonical id; "minted" cards consult by their minted id
        # (the V1 person-identity resolver emits minted persons' rows under those
        # ids — Audit-1 C1's structural bar is removed). Any OTHER status (an
        # unlinked/ambiguous future state) stays non-stature by construction:
        # ambiguity is withheld, never assigned (the Timber-twins trap).
        cs = (
            career_stature_by_player.get(c["player_id"])
            if link_status in ("linked", "minted")
            else None
        )
        weight = _stature_model_weight(cs)
        ref = _projected_ref(pos, s["projected_raw"])
        if cs is not None:
            index = cs["career_stature_index"]
            tier = cs.get("stature_tier")
            target = _stature_target(pos, index)
            modulation = _projected_modulation(s["projected_raw"], ref, pos, tier)
            stature_path = _clamp01(target + modulation)
        else:
            target = None
            modulation = 0.0
            stature_path = 0.0
        s["link_status"] = link_status
        s["cs"] = cs
        s["weight"] = weight
        s["ref"] = ref
        s["target"] = target
        s["modulation"] = modulation
        s["stature_path"] = stature_path
        if weight >= STATURE_DOMINANT_WEIGHT:
            material_finals_by_pos.setdefault(pos, []).append(stature_path)

    # ── PASS 1d: raw-only quantile map + per-cohort ceiling, blend, basis, legend ─
    # Non-material 2026 cards are histogram-matched onto the HISTORICAL raw-only
    # internal distribution (the population MV2-6 pools): the card's percentile within
    # the 2026 pure-raw-only (weight == 0) projected-raw cohort is read off the
    # historical raw-only internal scores at the SAME percentile. This NEUTRALIZES the
    # hot 2026 scale cross-era (a 2026 reserve aligns with a comparable historical
    # reserve, not above it), unlike the affine rescale it replaces, which only matched
    # the bounds and left the 2026 floor/median lifted. The per-cohort raw-only ceiling
    # (min of the global elite ceiling and the cohort's material-stature median) is
    # still applied as the absolute cap that keeps every non-material card strictly
    # below the recognized-greats / legend band — the fix for the spurious OVR-99
    # projected MF cards. The quantile-map target already tops out at the historical
    # raw-only ceiling (≈0.62), so this clamp only binds in the rare cohort whose
    # material median dips below it.
    raw_only_cohort_sorted = sorted(s["projected_raw"] for s in staged if s["weight"] == 0.0)
    has_any_material = any(s["weight"] >= STATURE_DOMINANT_WEIGHT for s in staged)
    internal_rows: list[dict] = []
    for s in staged:
        c = s["card"]
        pos = s["pos"]
        cs = s["cs"]
        weight = s["weight"]
        raw = s["projected_raw"]

        cohort_material = material_finals_by_pos.get(pos)
        raw_only_ceiling = RAW_ONLY_GLOBAL_CEILING if has_any_material else 1.0
        if cohort_material:
            raw_only_ceiling = min(raw_only_ceiling, _quantile(sorted(cohort_material), 0.5))
        raw_path = min(
            _raw_only_quantile_map(raw, raw_only_cohort_sorted, historical_raw_only_internal),
            raw_only_ceiling,
        )

        # Continuous blend: weight 0 ⇒ projected-raw-only, weight 1 ⇒ stature-dominant.
        final = _clamp01(weight * s["stature_path"] + (1.0 - weight) * raw_path)
        score_0_100 = 100.0 * final

        career_score_val = cs["career_stature_score"] if cs else None
        career_index_val = cs["career_stature_index"] if cs else None
        career_coverage = cs["coverage"] if cs else None

        # overall_basis (constrained to the shared RatingSchema vocabulary): a 2026
        # card NEVER takes the baseline_anchor_estimate path (caps are always
        # present). When the stature path dominates the blend the score is career-
        # stature driven (career_stature_estimate); otherwise the projected raw path
        # drives it (measured_performance — the projected analog of the raw path).
        if weight >= STATURE_DOMINANT_WEIGHT:
            overall_basis = "career_stature_estimate"
        else:
            overall_basis = "measured_performance"

        # Factual legend joins the person's career row (missing row → False).
        # A card with no career row (or a barred status) never consulted stature
        # (cs is None) → legend False. In practice every legend=true person is
        # material, so this never tags a below-material card as a legend.
        legend = bool(cs["legend"]) if cs else False

        components = [
            {"signal": "caps", "value": c["caps"], "weight": 0.0},
            {"signal": "intl_goals", "value": c["intl_goals"], "weight": 0.0},
            {"signal": "age", "value": s["age"], "weight": 0.0},
            # D1 (proj-career-4.0.0): the two percentiles below are AGE-CONDITIONED
            # (the signal's quantile at the player's age); age_factor is retired
            # and intentionally absent from this array.
            {
                "signal": "goals_percentile",
                "value": s["g_pct"],
                "weight": s["eff"].get("goals", 0.0),
            },
            {
                "signal": "caps_percentile",
                "value": s["a_pct"],
                "weight": s["eff"].get("appearances", 0.0),
            },
            {"signal": "club_nation", "value": None, "weight": 0.0},  # raw code on the card
            {"signal": "league_strength", "value": s["league"], "weight": s["league_weight"]},
            # The wc-perf cross-era anchors are structurally UNEARNED pre-tournament:
            # shown as null/weight 0 — honestly dropped, never substituted with 0.
            {"signal": "award_score", "value": None, "weight": 0.0},
            {"signal": "team_finish", "value": None, "weight": 0.0},
            # Stature-reconciliation transparency (proj-career-3.0.0). projected_* vary
            # per card; career_* are the linked player's CAREER aggregates (null for a
            # non-linked / no-career-row card — visibly not 0-substituted). All numeric.
            {"signal": "projected_raw_score", "value": round(raw, _PRECISION), "weight": 0.0},
            {
                "signal": "projected_reference_score",
                "value": round(s["ref"], _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "projected_modulation",
                "value": round(s["modulation"], _PRECISION) if weight > 0.0 else 0.0,
                "weight": 0.0,
            },
            {"signal": "career_stature_score", "value": career_score_val, "weight": 0.0},
            {"signal": "career_stature_index", "value": career_index_val, "weight": 0.0},
            {"signal": "career_stature_coverage", "value": career_coverage, "weight": 0.0},
            {
                "signal": "stature_target_score",
                # Only APPLIED on the stature path (weight>0); null on a pure raw-only
                # card so the component never implies a target that did not move the score.
                "value": (
                    round(s["target"], _PRECISION)
                    if (weight > 0.0 and s["target"] is not None)
                    else None
                ),
                "weight": 0.0,
            },
            {"signal": "stature_model_weight", "value": round(weight, _PRECISION), "weight": 1.0},
        ]

        internal_rows.append(
            {
                "card_id": c["card_id"],
                "player_id": c["player_id"],
                "tournament_id": c["tournament_id"],
                "pos": pos,
                "score_0_100": score_0_100,
                # Current basis (design §5): the at-2026 measured path — the D1
                # age-conditioned projected raw, quantile-mapped and ceiling-capped
                # (raw_path) — with no career-stature blend. For a weight==0 card
                # current == career by construction.
                "current_score_0_100": 100.0 * raw_path,
                "overall_basis": overall_basis,
                # 2026 caps are always present, so the current basis is always the
                # measured projected path (never baseline_anchor_estimate).
                "current_basis": "measured_performance",
                "legend": legend,
                "components": components,
                "coverage": c["coverage"],
            }
        )

    return internal_rows


def build_internal_view(
    cards: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
    historical_raw_only_internal: list[float] | None = None,
    output_dir: Path = OUTPUT_DIR,
) -> list[dict]:
    """Pass 1, exposed for the acceptance suite — internal rows carrying the
    pre-display stature-scale ``score_0_100``, ``overall_basis``, ``legend``, and
    ``components``. Display (``overall``) is provisional until MV2-6, so MV2-5 tests
    assert on these INTERNAL rows, not the materialized display band.

    ``historical_raw_only_internal`` (the quantile-map target) defaults to the
    committed ``ratings.json`` raw-only distribution under ``output_dir``."""
    if historical_raw_only_internal is None:
        historical_raw_only_internal = _historical_raw_only_internal(output_dir)
    return _build_internal_rows(
        cards, career_stature_by_player, historical_raw_only_internal
    )


def build_ratings(
    cards: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
    historical_raw_only_internal: list[float] | None = None,
    output_dir: Path = OUTPUT_DIR,
    curve=None,
    internal_rows: list[dict] | None = None,
) -> list[dict]:
    """Return projected Rating-shaped records for every 2026 card, sorted by card_id.

    Records carry the canonical string ``tournament_id`` ("WC-2026") / ``card_id``
    so they JOIN 1:1 with player_tournaments_2026.json (same seam as wc-perf).

    ``historical_raw_only_internal`` (the quantile-map target) defaults to the
    committed ``ratings.json`` raw-only distribution under ``output_dir``.

    ``curve`` is the MV2-6 UNIFIED display curve (fit on the pooled historical +
    2026 internal distribution by ``display_curve.fit_unified_curve``). Passing
    ``None`` self-fits it so a bare call still emits the final unified display.

    merit-v3 V3: every row additionally carries the ``basis_ratings`` payload
    (design §5) — ``career`` (the full stature-dominant blend; identical to the
    top-level compatibility surface) and ``current`` (the at-2026 measured path:
    the D1 age-conditioned projected raw, quantile-mapped + ceiling-capped, no
    career blend, no career badge). Both bases share the ONE display curve.

    ``internal_rows`` accepts the precomputed pass-1 rows (``build_internal_view``
    output for the SAME cards/career/distribution args) so a caller that also
    needs the internal ``score_0_100`` (MV2-10: best-XI selection) computes pass 1
    exactly once. ``None`` self-computes — identical rows either way.
    """
    from . import display_curve  # lazy: avoid an import cycle

    if historical_raw_only_internal is None:
        historical_raw_only_internal = _historical_raw_only_internal(output_dir)
    if internal_rows is None:
        internal_rows = _build_internal_rows(
            cards, career_stature_by_player, historical_raw_only_internal
        )

    # ── PASS 2: materialize Rating rows on the UNIFIED display curve (MV2-6) ───
    # The display `overall` is now mapped by the ONE pooled curve shared with the
    # historical wc-perf-4.2.0 cards (no longer the MV2-5 provisional 2026-only
    # fit). The INTERNAL score_0_100 (on the stature scale) is unchanged, so the
    # four sim channels stay byte-identical. baseline_anchor_estimate never occurs
    # for 2026, so the estimate cap is structurally inert here.
    if curve is None:
        curve = display_curve.fit_unified_curve(output_dir)
    ratings: list[dict] = []
    for row in internal_rows:
        pos = row["pos"]
        s = row["score_0_100"]
        estimate = row["overall_basis"] == "baseline_anchor_estimate"
        overall = _display_score(s, curve, estimate=estimate)
        current_s = row["current_score_0_100"]
        current_overall = _display_score(current_s, curve, estimate=False)
        channels = {
            # DECOUPLED CHANNELS — see rating.py for rationale. Sim channels stay on
            # the pre-recal [FLOOR_CHANNEL, 100] band so the engine's λ stays calibrated.
            ch: _channel(s, CHANNEL_SPREAD[pos][ch]) for ch in CHANNELS
        }
        current_channels = {
            ch: _channel(current_s, CHANNEL_SPREAD[pos][ch]) for ch in CHANNELS
        }
        career_basis = {
            "overall": overall,
            "overall_basis": row["overall_basis"],
            "attack": channels["attack"],
            "midfield": channels["midfield"],
            "defense": channels["defense"],
            "goalkeeping": channels["goalkeeping"],
            "coverage": row["coverage"],
            "components": row["components"],
            "basis_metadata": {
                "basis": "career",
                "score_0_100": round(s, _PRECISION),
                "rating_version": RATING_VERSION,
            },
        }
        current_basis = {
            "overall": current_overall,
            "overall_basis": row["current_basis"],
            "attack": current_channels["attack"],
            "midfield": current_channels["midfield"],
            "defense": current_channels["defense"],
            "goalkeeping": current_channels["goalkeeping"],
            "coverage": row["coverage"],
            "components": row["components"],
            "basis_metadata": {
                "basis": "current",
                "score_0_100": round(current_s, _PRECISION),
                "rating_version": RATING_VERSION,
            },
        }
        ratings.append(
            {
                "card_id": row["card_id"],
                "player_id": row["player_id"],
                "tournament_id": row["tournament_id"],
                "overall": overall,
                "overall_basis": row["overall_basis"],
                # First-class factual legend flag, joined from career_stature.json for
                # linked players (missing row / non-linked → False). MV2-7's compact
                # builder reads THIS field; it never re-derives the badge from overall.
                "legend": row["legend"],
                "attack": channels["attack"],
                "midfield": channels["midfield"],
                "defense": channels["defense"],
                "goalkeeping": channels["goalkeeping"],
                "basis_ratings": {
                    "career": career_basis,
                    "current": current_basis,
                },
                "components": row["components"],
                "coverage": row["coverage"],
                "coverage_basis": COVERAGE_BASIS,
                "provenance": PROVENANCE,
                "rating_version": RATING_VERSION,
            }
        )
    ratings.sort(key=lambda r: r["card_id"])
    return ratings


def build_all(output_dir: Path = OUTPUT_DIR) -> list[dict]:
    cards = json.loads((output_dir / "player_tournaments_2026.json").read_text(encoding="utf-8"))
    # Career stature is consumed READ-ONLY for linked-material reconciliation. Missing
    # file → {} (every card stays on the projected raw path), so the stage never hard-
    # depends on the merit artifact existing (mirrors rating._load_career_stature).
    career = _load_career_stature(output_dir)
    # Historical raw-only internal distribution (the quantile-map target), read
    # READ-ONLY from the committed ratings.json. Missing → [] (raw passes through).
    historical_raw_only = _historical_raw_only_internal(output_dir)
    return build_ratings(cards, career, historical_raw_only, output_dir)


# ─── MV2-5 accuracy-eyeball SAMPLE (2026 INTERNAL-score shape) ────────────────
# Appended to etl/output/merit/MERIT_V2_SAMPLE.md (after the historical MV2-4
# section) so Paulo can eyeball the 2026 reconciliation: linked-material players on
# the stature scale, the previously-spurious OVR-99 projected MF cards now capped on
# the raw-only path, and a journeyman control. INTERNAL scores only — display is
# provisional until the unified curve (MV2-6).

# Explicit eyeball anchors (canonical player_ids): Messi, Mbappé, Vinícius,
# Bellingham, Modrić. The 4 previously-spurious cards are the OVR-99 projected MF
# cards on the old proj-career-2.0.0 raw formula. Names are rendered from the player
# tables at write time, so only the ids are pinned here.
_SAMPLE_NAMED_ANCHORS: tuple[str, ...] = (
    "P-14758",
    "P-64077",
    "P-92812",
    "P-15674",
    "P-29491",
)
_SAMPLE_SPURIOUS_99: tuple[str, ...] = ("P-34205", "P-39584", "P-58692", "P-W26-0177")


def _sample_comp(row: dict, signal: str):
    return next(c["value"] for c in row["components"] if c["signal"] == signal)


def render_merit_v2_sample_2026(
    internal_rows: list[dict],
    cards: list[dict],
    name_of: dict[str, str],
) -> str:
    by_pid = {ir["player_id"]: ir for ir in internal_rows}
    link_of = {c["player_id"]: c["link_status"] for c in cards}

    def status(ir: dict) -> str:
        ls = link_of.get(ir["player_id"], "?")
        wt = _sample_comp(ir, "stature_model_weight")
        if ls != "linked":
            return ls
        return "linked·material" if wt >= STATURE_DOMINANT_WEIGHT else "linked·below"

    def row_line(ir: dict) -> str:
        idx = _sample_comp(ir, "career_stature_index")
        wt = _sample_comp(ir, "stature_model_weight")
        raw = _sample_comp(ir, "projected_raw_score")
        tgt = _sample_comp(ir, "stature_target_score")
        mod = _sample_comp(ir, "projected_modulation")
        nm = name_of.get(ir["player_id"], ir["player_id"])
        # Channels recomputed from the internal score (the materialized rating uses
        # the same _channel on the same score), so the table needs only internal rows.
        chans = {ch: _channel(ir["score_0_100"], CHANNEL_SPREAD[ir["pos"]][ch]) for ch in CHANNELS}
        return (
            f"| {nm} | `{ir['player_id']}` | {ir['pos']} | {status(ir)} "
            f"| {idx if idx is not None else '—'} | {wt:.2f} | {raw:.3f} "
            f"| {tgt if tgt is not None else '—'} | {mod:+.3f} "
            f"| {ir['score_0_100'] / 100:.3f} | {chans['attack']} | {chans['midfield']} "
            f"| {chans['defense']} | {chans['goalkeeping']} | {'✓' if ir['legend'] else '—'} |"
        )

    header = (
        "| Player | Player ID | Pos | Status | Index | Wt | Raw | Target | Mod | Final "
        "| ATT | MID | DEF | GK | Lgd |\n|---|---|---|---|---:|---:|---:|---:|---:|---:|"
        "---:|---:|---:|---:|---|"
    )
    L: list[str] = []
    L.append(f"\n---\n\n# 2026 reconciliation INTERNAL-score sample ({RATING_VERSION})\n")
    L.append(
        "MV2-5 brings linked + material-stature 2026 players onto the SAME stature "
        "scale as the historical wc-perf-4.x cards, and caps non-material 2026 cards "
        "below the recognized-greats band on the projected raw path. Columns mirror "
        "the historical sample: **Status** (linked·material / linked·below / minted), "
        "career **Index**, stature model **Wt**, **Raw** projected score, stature "
        "**Target**, projected **Mod**ulation, blended **Final** (internal, NOT "
        "display — display is provisional until MV2-6), the four sim channels, and "
        "the factual **L**e**g**en**d** flag.\n"
    )

    # Linked-material cohort, top by index.
    material = sorted(
        (
            ir
            for ir in internal_rows
            if _sample_comp(ir, "stature_model_weight") >= STATURE_DOMINANT_WEIGHT
        ),
        key=lambda r: -(_sample_comp(r, "career_stature_index") or 0.0),
    )
    L.append("## Linked + material (reconciled onto the stature scale)\n")
    L.append(header)
    for ir in material:
        L.append(row_line(ir))

    L.append("\n## Named eyeball anchors\n")
    L.append(header)
    for pid in _SAMPLE_NAMED_ANCHORS:
        ir = by_pid.get(pid)
        if ir is not None:
            L.append(row_line(ir))

    L.append(
        "\n## Previously-spurious OVR-99 projected cards (now raw-only capped)\n"
    )
    L.append(header)
    for pid in _SAMPLE_SPURIOUS_99:
        ir = by_pid.get(pid)
        if ir is not None:
            L.append(row_line(ir))

    # Raw-only controls: the top non-material cards by projected raw (the band the
    # ceiling protects) and the single lowest-Final card (the journeyman floor).
    raw_only = sorted(
        (ir for ir in internal_rows if _sample_comp(ir, "stature_model_weight") == 0.0),
        key=lambda r: -_sample_comp(r, "projected_raw_score"),
    )
    L.append("\n## Raw-only controls (non-material — top of the raw band + journeyman floor)\n")
    L.append(header)
    for ir in raw_only[:5]:
        L.append(row_line(ir))
    if raw_only:
        floor_ir = min(internal_rows, key=lambda r: r["score_0_100"])
        L.append(row_line(floor_ir))

    L.append(
        f"\n_A non-material 2026 card's projected raw path is capped at the global "
        f"raw-only ceiling ({RAW_ONLY_GLOBAL_CEILING}), strictly below the marginal-"
        f"material stature floor, so it cannot occupy the high-90s/legend band on the "
        f"projection alone — the fix for the spurious OVR-99 projected MF cards. A "
        f"linked aging legend takes bounded DOWNWARD projected modulation (tightest at "
        f"the gold tier) but never collapses below recognized stature._\n"
    )
    return "\n".join(L) + "\n"


def render_merit_v2_sample_full(output_dir: Path = OUTPUT_DIR) -> str:
    """Render the full 3-section MERIT_V2_SAMPLE.md (no write): historical MV2-4
    section (rendered fresh from rating.py) + 2026 MV2-5 reconciliation section +
    MV2-6 unified-display section. Deterministic: regenerated entirely from the
    committed canonical + career-stature + 2026 tables."""
    cards = json.loads((output_dir / "player_tournaments_2026.json").read_text(encoding="utf-8"))
    career = _load_career_stature(output_dir)
    historical_raw_only = _historical_raw_only_internal(output_dir)
    internal_rows = _build_internal_rows(cards, career, historical_raw_only)

    players_canon = json.loads((output_dir / "players.json").read_text(encoding="utf-8"))
    players_minted = json.loads((output_dir / "players_2026.json").read_text(encoding="utf-8"))
    name_of: dict[str, str] = {}
    for p in players_canon + players_minted:
        name_of[p["player_id"]] = p.get("common_name") or p.get("full_name") or p["player_id"]

    historical = rating.render_merit_v2_sample(output_dir)
    section_2026 = render_merit_v2_sample_2026(internal_rows, cards, name_of)
    # MV2-6: append the unified DISPLAY-band section (final `overall`, both eras on
    # the one pooled curve + the anti-inflation band distribution — Paulo's gate).
    from . import display_curve

    section_display = display_curve.render_unified_display_sample(output_dir)
    return historical + section_2026 + section_display


def write_merit_v2_sample(output_dir: Path = OUTPUT_DIR) -> str:
    """(Re)write etl/output/merit/MERIT_V2_SAMPLE.md — the SOLE owner of that file
    (invoked from ``ingest_2026.run``; ``rating.run`` deliberately does not write
    it). Runs LAST in the ingest lane and regenerates the whole 3-section file, so
    a clean rebuild reproduces the committed bytes regardless of stage order."""
    md = render_merit_v2_sample_full(output_dir)
    out = output_dir / "merit" / "MERIT_V2_SAMPLE.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md, encoding="utf-8")
    return md
