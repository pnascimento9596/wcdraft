"""Projected 2026 rating component scoring helpers."""

from __future__ import annotations

import bisect

from . import league_strength
from .rating import (
    _PRECISION,
    BASE_CEILING,
    BASE_WEIGHTS,
    COARSE_POSITIONS,
    REPLACEMENT_BASE,
    STATURE_DOMINANT_WEIGHT,
    TOURNAMENT_DOWN_CAP,
    TOURNAMENT_UP_CAP,
    _active_component_names,
    _clamp01,
    _renormalized_context_score,
    _thresholded_log_component,
)

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
LEAGUE_DEFAULT = league_strength.LEAGUE_DEFAULT
LEAGUE_STRENGTH = league_strength.LEAGUE_STRENGTH
# Position weights for the league anchor (an apex top-5 club lifts every position).
# merit-v4.1 trims the prior from "dominant quality signal" to "smooth quality
# context": league still separates elite club employment from weaker/domestic
# leagues, but objective individual records can now overcome it through the
# projected objective-record pathway below.
LEAGUE_WEIGHT: dict[str, float] = {"FW": 0.18, "MF": 0.20, "DF": 0.18, "GK": 0.16}

# merit-v4: active career-stature rows are stage-normalized so young in-progress
# players can clear materiality before their career is complete. That is right for
# "has enough evidence to leave raw-only" but too strong if the projected 2026 path
# treats the normalized row as a completed all-time career. Cap the projected
# stature path by the active stage already emitted by career_stature.json; completed
# / non-active rows are untouched.
PROJECTED_ACTIVE_STATURE_CAP_FLOOR = 0.72
PROJECTED_ACTIVE_STATURE_CAP_SPAN = 0.25

# merit-v4.1 projected objective-record pathway. The all-time stature gate in
# rating.py stays deliberately high (coverage >= .25, index >= .40). For the 2026
# projection, however, the product requirement is different: a currently-active
# player with citation-backed objective records (regional player-of-year,
# continental title/MVP facts, or high international-record strength) should be
# able to leave the raw-only league-prior path even if they are not an all-time
# global great. This pathway is 2026-only, source-derived, and still conservative:
# no career row -> no lift; no objective family evidence -> no lift; ordinary weak-
# league players with only squad-table caps/goals stay raw/current-path.
PROJECTED_OBJECTIVE_MIN_COVERAGE = 0.07
PROJECTED_OBJECTIVE_MIN_INDEX = 0.05
PROJECTED_OBJECTIVE_HIGH_INTL_RECORD = 0.30
PROJECTED_OBJECTIVE_MATERIAL_WEIGHT = 0.70
PROJECTED_OBJECTIVE_PRIORITY_NATION_IDS = frozenset(
    {
        # AFC 2026 squads
        "T-04",  # Australia
        "T-38",  # Iran
        "T-39",  # Iraq
        "T-44",  # Japan
        "T-59",  # Qatar
        "T-63",  # Saudi Arabia
        "T-W26-5",  # Uzbekistan
        # CONCACAF 2026 squads
        "T-12",  # Canada
        "T-34",  # Haiti
        "T-46",  # Mexico
        "T-54",  # Panama
        "T-83",  # United States
        # CAF 2026 squads
        "T-01",  # Algeria
        "T-26",  # Egypt
        "T-32",  # Ghana
        "T-42",  # Ivory Coast
        "T-47",  # Morocco
        "T-65",  # Senegal
        "T-70",  # South Africa
        "T-79",  # Tunisia
    }
)
PROJECTED_OBJECTIVE_FAMILIES = frozenset(
    {
        "club_honors",
        "club_season_honors",
        "global_annual_recognition",
        "position_balanced_selection",
        "regional_annual_recognition",
        "retrospective_selection",
        "wc_legacy",
    }
)

# ─── STATURE RECONCILIATION (proj-career-3.0.0, merit-v2 MV2-5) ───────────────
# Linked + material-stature 2026 players are evaluated through the SAME stature
# scale as the historical wc-perf-4.x cards. The caps are imported from rating.py;
# the only 2026-specific knob is the gain applied to projected-context deltas.
PROJECTED_MOD_GAIN: dict[str, float] = {"FW": 0.40, "MF": 0.40, "DF": 0.35, "GK": 0.30}
PROJECTED_MATERIAL_UP_CAP_SNAP_EPSILON = 0.005

# Honest career-signal coverage: signals we DO have vs an ideal that also includes
# club-competition minutes and a qualification box-score — neither is in the squad
# source, so they are never fabricated and cap coverage below 1.0.
CAREER_IDEAL_SIGNALS = (
    "caps",
    "intl_goals",
    "age",
    "position",
    "club",
    "club_minutes",
    "qualification_record",
)


def _projected_objective_record_weight(
    cs: dict | None, base_weight: float, nation_id: str
) -> float:
    """Projected-only material entry for active objective records.

    The shared _stature_model_weight remains the all-time gate. This overlay admits
    objectively distinguished active players from the under-covered AFC, CAF, and
    CONCACAF squad set into the 2026 stature path when their career-stature row has
    enough cited evidence to be a national/continental standout. It does not lower
    the historical all-time gate, and it does not make thin European control rows
    material merely because they have one position-balanced or longevity fact.
    """
    if cs is None or base_weight >= STATURE_DOMINANT_WEIGHT:
        return base_weight
    if (
        cs.get("coverage", 0.0) < PROJECTED_OBJECTIVE_MIN_COVERAGE
        or cs.get("career_stature_index", 0.0) < PROJECTED_OBJECTIVE_MIN_INDEX
    ):
        return base_weight

    family_scores = cs.get("family_scores") or {}
    objective_family = any(
        (family_scores.get(fam) or 0.0) > 0.0 for fam in PROJECTED_OBJECTIVE_FAMILIES
    )
    captaincy = float(family_scores.get("captaincy") or 0.0)
    international_record = float(family_scores.get("international_record") or 0.0)
    enough_record_breadth = int(cs.get("fact_count") or 0) >= 2 and (
        captaincy > 0.0 or international_record > 0.0
    )
    high_international_record = international_record >= PROJECTED_OBJECTIVE_HIGH_INTL_RECORD

    active_current_fact = int(cs.get("active_fact_count") or 0) > 0
    priority_squad = nation_id in PROJECTED_OBJECTIVE_PRIORITY_NATION_IDS

    if active_current_fact and (objective_family or high_international_record):
        return max(base_weight, PROJECTED_OBJECTIVE_MATERIAL_WEIGHT)
    if priority_squad and (objective_family or enough_record_breadth or high_international_record):
        return max(base_weight, PROJECTED_OBJECTIVE_MATERIAL_WEIGHT)
    return base_weight

def _projected_active_stature_cap(cs: dict | None) -> float | None:
    if not cs or not cs.get("active_source_set_version"):
        return None
    stage_factors = cs.get("active_stage_factors") or {}
    if not stage_factors:
        return None
    stage = min(float(v) for v in stage_factors.values())
    return _clamp01(
        PROJECTED_ACTIVE_STATURE_CAP_FLOOR + PROJECTED_ACTIVE_STATURE_CAP_SPAN * _clamp01(stage)
    )

def _projected_modulation(
    projected_raw: float, projected_ref: float, pos: str, tier: str | None, material_weight: float
) -> float:
    """Signed, bounded projected-context modulation around the stature target —
    the 2026 analog of rating._tournament_modulation. Positive when the card's
    projected raw score beats its 2026 position-cohort median, negative when it
    lags; clamped tighter downward at higher stature tiers (the shared caps)."""
    delta = projected_raw - projected_ref
    down_cap = TOURNAMENT_DOWN_CAP[pos][tier or "bronze"]
    up_cap = TOURNAMENT_UP_CAP[pos]
    scaled = PROJECTED_MOD_GAIN[pos] * delta
    if (
        material_weight >= 1.0
        and scaled > 0.0
        and up_cap - scaled <= PROJECTED_MATERIAL_UP_CAP_SNAP_EPSILON
    ):
        scaled = up_cap
    return max(-down_cap, min(up_cap, scaled))

def _league_score(club_nation_code: str | None) -> float | None:
    """League-strength prior for the club's nation, or None when the club is
    UNKNOWN. A present-but-untiered league gets the legitimate baseline tier
    (LEAGUE_DEFAULT); an ABSENT club returns None so the anchor is honestly DROPPED
    (never a fabricated 0.42 applied to a player whose club we don't know)."""
    return league_strength.league_score(club_nation_code)

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
            w = [max(0.0, 1.0 - abs(ai - age) / AGE_QUANTILE_BANDWIDTH) for ai in ages]
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

def _projected_factual_context_by_card(cards: list[dict]) -> dict[str, dict]:
    by_squad: dict[str, list[dict]] = {}
    for card in cards:
        by_squad.setdefault(card.get("nation_id", "__unknown__"), []).append(card)

    def available(card: dict, name: str) -> bool:
        if name == "caps":
            return card.get("caps") is not None
        if name == "intl_goals":
            return card.get("position_listed") != "GK" and card.get("intl_goals") is not None
        if name == "league":
            return (
                league_strength.league_context_component(card.get("club_nation_code")) is not None
            )
        if name == "role":
            return False
        raise KeyError(name)

    out: dict[str, dict] = {}
    for squad_cards in by_squad.values():
        active = _active_component_names(squad_cards, available)
        active.discard("role")
        for card in squad_cards:
            pos = card["position_listed"]
            caps = _thresholded_log_component(card.get("caps"), start=5.0, full=100.0)
            intl_goals = (
                None
                if pos == "GK"
                else _thresholded_log_component(card.get("intl_goals"), start=2.0, full=30.0)
            )
            league = league_strength.league_context_component(card.get("club_nation_code"))
            values = {
                "caps": caps,
                "intl_goals": intl_goals,
                "league": league,
                "role": None,
            }
            out[card["card_id"]] = {
                "score": _renormalized_context_score(values, active),
                "active_count": len(active),
                **values,
            }
    return out

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
