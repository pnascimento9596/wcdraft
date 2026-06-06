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

import json
from pathlib import Path

# Reuse the EXACT wc-perf machinery so "same methodology family" is literal, not
# a paraphrase: the position weights, the band, the channel spread, the percentile
# map, and the channel/clamp helpers are imported, not re-implemented.
from .rating import (
    _PRECISION,
    BASE_CEILING,
    BASE_WEIGHTS,
    CHANNEL_SPREAD,
    CHANNELS,
    COARSE_POSITIONS,
    REPLACEMENT_BASE,
    _clamp01,
    _display_channel,
    _display_score,
    _fit_display_curve,
    _percentile_map,
)

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"

# Distinct version anchor — a projected rating is a different algorithm from
# wc-perf and must be replay-anchored separately. Team2026.rating_version must
# equal this.
RATING_VERSION = "proj-career-2.0.0"

PROVENANCE = "projected_career"
COVERAGE_BASIS = "career_signals"

# Tournament start, for the age-as-of date (the squad tables list age as of the
# opening match, June 11 2026).
_AGE_AS_OF = (2026, 6, 11)

# ─── CALIBRATION ──────────────────────────────────────────────────────────────
# Age-curve modifier in [AGE_FLOOR, 1.0]. A factual career-stage positioner: a
# prime-age player sits at the top of the band their box score earns; the very
# young (still developing) and the older (past peak) are modestly tempered. These
# are CALIBRATION constants (golden-locked, tunable without touching the formula).
AGE_PRIME_LO = 24
AGE_PRIME_HI = 30
AGE_FLOOR = 0.80  # most-tempered multiplier (very young / well past peak)
# Linear ramps either side of the prime plateau.
AGE_YOUNG_REF = 17  # youngest expected; maps to AGE_FLOOR
AGE_OLD_REF = 38  # oldest expected; maps to AGE_FLOOR

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


def _age_factor(age: int | None) -> float:
    """Career-stage multiplier in [AGE_FLOOR, 1.0]; 1.0 across the prime plateau."""
    if age is None:
        return 1.0  # unknown age does not penalize (honest neutral)
    if AGE_PRIME_LO <= age <= AGE_PRIME_HI:
        return 1.0
    if age < AGE_PRIME_LO:
        span = AGE_PRIME_LO - AGE_YOUNG_REF
        f = AGE_FLOOR + (1.0 - AGE_FLOOR) * (age - AGE_YOUNG_REF) / span
    else:
        span = AGE_OLD_REF - AGE_PRIME_HI
        f = AGE_FLOOR + (1.0 - AGE_FLOOR) * (AGE_OLD_REF - age) / span
    return round(max(AGE_FLOOR, min(1.0, f)), _PRECISION)


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


def build_ratings(cards: list[dict]) -> list[dict]:
    """Return projected Rating-shaped records for every 2026 card, sorted by card_id.

    Records carry the canonical string ``tournament_id`` ("WC-2026") / ``card_id``
    so they JOIN 1:1 with player_tournaments_2026.json (same seam as wc-perf).
    """
    # Within-(tournament, position) cohorts — for 2026 there is one tournament, so
    # the cohort is effectively (position) across all 48 squads: a striker is
    # era-fairly normalized against every other 2026 striker, exactly as wc-perf
    # normalizes within a tournament.
    goals_cohort: dict[str, list[int]] = {}
    caps_cohort: dict[str, list[int]] = {}
    for c in cards:
        pos = c["position_listed"]
        if pos not in COARSE_POSITIONS:
            raise ValueError(f"2026 card {c['card_id']} has non-coarse position {pos!r}")
        goals_cohort.setdefault(pos, []).append(c["intl_goals"])
        caps_cohort.setdefault(pos, []).append(c["caps"])
    goals_pct = {p: _percentile_map(v) for p, v in goals_cohort.items()}
    caps_pct = {p: _percentile_map(v) for p, v in caps_cohort.items()}

    # ── PASS 1: build INTERNAL rows ────────────────────────────────────────────
    internal_rows: list[dict] = []
    for c in cards:
        pos = c["position_listed"]
        g_pct = goals_pct[pos][c["intl_goals"]]
        a_pct = caps_pct[pos][c["caps"]]

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
        af = _age_factor(age)
        league = _league_score(c.get("club_nation_code"))
        # Performance band (caps/goals percentile), modulated by career stage, plus
        # the league-strength quality anchor — the projected analog of wc-perf's
        # award/finish anchor, supplying headroom above BASE_CEILING. The tournament
        # award/finish anchors themselves are UNEARNED pre-tournament -> dropped.
        # An UNKNOWN club drops the anchor entirely (honest-state), never 0-substituted.
        base = REPLACEMENT_BASE + (BASE_CEILING - REPLACEMENT_BASE) * blend * af
        league_weight = LEAGUE_WEIGHT[pos] if league is not None else 0.0
        anchor = league_weight * (league or 0.0)
        score = _clamp01(base + anchor)
        score_0_100 = 100.0 * score
        # Final display value computed in pass 2 via fitted display curve.

        eff = {n: round(w / present_w, _PRECISION) for (n, _, w) in present}

        components = [
            {"signal": "caps", "value": c["caps"], "weight": 0.0},
            {"signal": "intl_goals", "value": c["intl_goals"], "weight": 0.0},
            {"signal": "age", "value": age, "weight": 0.0},
            {"signal": "goals_percentile", "value": g_pct, "weight": eff.get("goals", 0.0)},
            {"signal": "caps_percentile", "value": a_pct, "weight": eff.get("appearances", 0.0)},
            {"signal": "age_factor", "value": af, "weight": 0.0},
            {"signal": "club_nation", "value": None, "weight": 0.0},  # raw code on the card
            {"signal": "league_strength", "value": league, "weight": league_weight},
            # The wc-perf cross-era anchors are structurally UNEARNED pre-tournament:
            # shown as null/weight 0 — honestly dropped, never substituted with 0.
            {"signal": "award_score", "value": None, "weight": 0.0},
            {"signal": "team_finish", "value": None, "weight": 0.0},
        ]

        internal_rows.append(
            {
                "card_id": c["card_id"],
                "player_id": c["player_id"],
                "tournament_id": c["tournament_id"],
                "pos": pos,
                "score_0_100": score_0_100,
                "components": components,
                "coverage": c["coverage"],
            }
        )

    # ── PASS 2: fit display curve on the projected pool, materialize Rating ────
    # Same shared display helpers + targets as wc-perf-2.0.0. The projected RAW
    # anchors are fitted on the projected dataset only — historical and
    # projected raw scales have different provenance.
    curve = _fit_display_curve([r["score_0_100"] for r in internal_rows])
    ratings: list[dict] = []
    for row in internal_rows:
        pos = row["pos"]
        s = row["score_0_100"]
        overall = _display_score(s, curve)
        channels = {
            ch: _display_channel(s, CHANNEL_SPREAD[pos][ch], curve) for ch in CHANNELS
        }
        ratings.append(
            {
                "card_id": row["card_id"],
                "player_id": row["player_id"],
                "tournament_id": row["tournament_id"],
                "overall": overall,
                "attack": channels["attack"],
                "midfield": channels["midfield"],
                "defense": channels["defense"],
                "goalkeeping": channels["goalkeeping"],
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
    return build_ratings(cards)
