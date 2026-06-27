"""Career-stature scoring constants and pure helpers."""

from __future__ import annotations

import re

# Float rounding so emitted JSON is byte-stable (matches rating._PRECISION).
_PRECISION = 6

# ─── v4 family taxonomy (position-balanced + club achievement) ───────────────
# The families the v4 table scores, in fixed combine order. ``club_honors`` is
# active only when a player has an objective club-achievement fact; absent club
# evidence is dropped from that player's eligible denominator.
# The legacy v1 ``annual_recognition`` key is NOT scored here — v2 splits annual
# recognition into the global_/regional_ families.
_V2_FAMILY_KEYS: tuple[str, ...] = (
    "wc_legacy",
    "global_annual_recognition",
    "regional_annual_recognition",
    "position_balanced_selection",
    "international_record",
    "retrospective_selection",
    "captaincy",
    "club_honors",
    "club_season_honors",
)

# ─── era-bucketed family weights (v2) ─────────────────────────────────────────
# A family weight of 0.0 means the family is structurally UNAVAILABLE for that era
# and is excluded from BOTH the score product and the coverage denominator — the
# same era-gating principle the v1 table used for annual_recognition pre-1956.
#
# Era-gating rationale (the defender/GK repair):
#   * Annual player-of-the-year ballots did not exist pre-1956 (first Ballon d'Or
#     1956) and continental ballots not until ~1970 → weight 0 pre_1956.
#   * Annual position-balanced XIs (FIFPro 2005+, ESM 1994+, UEFA positional 1997+)
#     did not exist DURING a 1956–1990 player's career
#     → position_balanced weight 0 for pre_1956 / 1956_1990. A pre-1991 great's
#     position-balanced recognition lives in the RETROSPECTIVE all-time dream teams,
#     which carry heavy weight in those eras. This is what lets a pre-1991 defender
#     (Baresi, Beckenbauer) clear the material gate on all-time selections alone,
#     instead of being penalised for missing awards that could not exist in-era.
#   * club_honors is objective-only and evidence-gated. When no such fact is
#     present, the family is removed from the player's denominator, preserving
#     the existing honest-absence semantics.
#   * club_season_honors is active for every era because top-tier continental
#     club titles and public annual player-of-year honors exist across the post-war
#     table; v3.1 adds the complete Guldbollen table as a non-fan W2b extension.
ERA_FAMILY_WEIGHTS: dict[str, dict[str, float]] = {
    "pre_1956": {
        "wc_legacy": 0.26,
        "global_annual_recognition": 0.00,
        "regional_annual_recognition": 0.00,
        "position_balanced_selection": 0.00,
        "international_record": 0.14,
        "retrospective_selection": 0.50,
        "captaincy": 0.04,
        "club_honors": 0.08,
        "club_season_honors": 0.06,
    },
    "1956_1990": {
        "wc_legacy": 0.20,
        "global_annual_recognition": 0.22,
        "regional_annual_recognition": 0.10,
        "position_balanced_selection": 0.00,
        "international_record": 0.07,
        "retrospective_selection": 0.25,
        "captaincy": 0.04,
        "club_honors": 0.18,
        "club_season_honors": 0.12,
    },
    "1991_plus": {
        "wc_legacy": 0.17,
        "global_annual_recognition": 0.20,
        "regional_annual_recognition": 0.07,
        "position_balanced_selection": 0.18,
        "international_record": 0.09,
        "retrospective_selection": 0.06,
        "captaincy": 0.03,
        "club_honors": 0.35,
        "club_season_honors": 0.20,
    },
}

# ─── per-fact strengths (the family input scorers) ────────────────────────────
# Each linked fact contributes one input s ∈ (0, 1] to its family's saturating
# product. Values are absolute and era-invariant (a 1962 Golden Ball anchors the
# same input as a 2014 one), per KIND of distinction — never per-player.

# World Cup individual awards — reuse the rating stage's award anchor points so the
# career view and the per-tournament view agree on what a Golden Ball is worth.
_WC_AWARD_STRENGTH: dict[str, float] = {
    "Golden Ball": 1.00,
    "Silver Ball": 0.70,
    "Bronze Ball": 0.50,
    "Golden Boot": 0.90,
    "Silver Boot": 0.60,
    "Bronze Boot": 0.45,
    "Golden Glove": 0.85,
    "Best Young Player": 0.55,
    # MV2-3.5 — a World Cup All-Star Team / Team-of-the-Tournament selection (the
    # research_wc_all_star gap-fill) is a contemporaneous, position-aware best-XI
    # honour. It is a NEW recognised award KIND, not a new tuning constant: its
    # strength REUSES the existing Bronze-Boot anchor (0.45) — a best-XI-of-tournament
    # selection (11 slots) is a bronze-tier individual honour, below Best Young Player
    # (0.55, one slot) and at/below the Bronze Ball (0.50, the third-best player).
    # Repeated selections saturate through the unchanged per-family product.
    "WC All-Star Team": 0.45,
}

# Global annual player-of-the-year recognition, by source. Ballon d'Or (and its
# canonical-name research recovery) is the strongest; the IFFHS / UEFA / World
# Soccer global ballots rank just below. Onze d'Or/d'Argent/de Bronze map to a
# winner / 2nd / 3rd strength. Each WIN/placement is one input; repeats saturate.
_GLOBAL_ANNUAL_STRENGTH: dict[str, float] = {
    "european_poy": 0.85,
    "research_global_annual": 0.85,
    "iffhs_worlds_best": 0.80,
    "uefa_mens_poy": 0.78,
    "world_soccer_poy": 0.72,
}
_ONZE_STRENGTH = {"onze_dor": 0.70, "onze_dargent": 0.40, "onze_de_bronze": 0.28}

# Regional annual recognition — continental ballots for non-European greats the
# global ballots could not reach. South America (the strongest confederation
# historically) ranks highest; placements rank below the regional winner.
_REGIONAL_ANNUAL_STRENGTH: dict[str, float] = {
    "south_american_poy": 0.70,
    "african_poy": 0.62,
    "asian_poy": 0.55,
    "concacaf_poy": 0.52,
}
_SAM_PLACEMENT_STRENGTH = {"2nd": 0.38, "3rd": 0.26}

# Position-balanced selections (the defender / goalkeeper repair). A UEFA positional
# award (the single best GK/DF/MF/FW in Europe that year) is the strongest; the
# player-voted FIFPro World 11 and ESM's league-scope team rank below. Fan-voted
# selections are deliberately excluded from the source set. Each selection is one
# input; repeats saturate.
_POSITION_BALANCED_STRENGTH: dict[str, float] = {
    "uefa_club_positional": 0.62,
    "fifpro_world11": 0.50,
    "esm_team_of_the_season": 0.40,
    # MV2-3.5 — World's-Best-Goalkeeper annual award (the research_gk_award gap-fill):
    # the GK-specific analogue of the single-best-at-a-position UEFA award. NEW
    # recognised source, NOT a new tuning constant: its strength REUSES the existing
    # uefa_club_positional anchor (0.62, the single best at a position that year). It
    # is era-gated to the post-1990 annual-award era like every other annual
    # position-balanced selection (ERA_FAMILY_WEIGHTS unchanged).
    "research_gk_award": 0.62,
}

# Retrospective / all-time selections. A World Player-of-the-Century election is the
# strongest single retrospective fact; the all-time WORLD dream teams (Ballon d'Or
# Dream Team by team tier, IFFHS all-time world dream team) are very strong;
# continental / national century elections are strong corroboration; a broad
# living-legends (125-player) inclusion is a softer corroboration.
_RETRO_WORLD_CENTURY = 1.00
_RETRO_CONTINENTAL_CENTURY = 0.72
_RETRO_LIVING_LEGENDS = 0.55
_BALLONDOR_DREAM_TEAM_STRENGTH = {"first": 0.95, "second": 0.80, "third": 0.65}
_IFFHS_DREAM_TEAM_STRENGTH = 0.90

# Public season honors for W1 active historical honest-miss cards. These are
# individual season distinctions, so they ride the existing club-season-honors
# family but remain below the top-tier continental-title final-participant anchor.
_PUBLIC_SEASON_HONOR_STRENGTH: dict[str, float] = {
    "top_tier_league_mvp": 0.55,
    "uefa_secondary_competition_player_of_season": 0.50,
    "domestic_top_flight_player_of_year": 0.45,
}

# International longevity records. Caps and goals are LONGEVITY/volume signals, not
# peak-quality signals, so they saturate to a deliberately modest ceiling.
_CAPS_FLOOR_STRENGTH = 0.28
_CAPS_PER_CAP = 1.0 / 320.0
_CAPS_CEILING_STRENGTH = 0.55
_GOALS_FLOOR_STRENGTH = 0.30
_GOALS_PER_GOAL = 1.0 / 120.0
_GOALS_CEILING_STRENGTH = 0.65

# National-team captaincy (a secondary modifier). A World-Cup-winning captain is the
# strongest captaincy distinction; a plain national captain a softer one.
_CAPTAINCY_WC_WINNER = 0.60
_CAPTAINCY_BASE = 0.40

# Top-tier continental club title with documented final participation. This is a
# title/final-participation fact, not a subjective "importance" grade; repeated
# titles saturate through the same per-family product as every other family.
_CLUB_SEASON_TITLE_FINAL_PARTICIPANT = 0.60

# Objective club-achievement facts. These are factual achievements and market facts,
# not subjective player-of-year votes. Repeated facts saturate inside the family.
_CLUB_HONORS_STRENGTH: dict[str, float] = {
    "league_top_scorer": 1.00,
    "major_club_trophy_count_5plus": 0.85,
    "continental_club_titles_4plus": 0.85,
    "world_record_transfer": 0.85,
}

# Active-career stage normalization. A dated active family is evaluated against a
# deterministic accrual-to-date expectation from age 18 to 34, then capped at the
# normal completed-family [0,1] scale. Undated active families use the completed
# denominator (no inflation by default).
_ACTIVE_STAGE_START_AGE = 18
_ACTIVE_STAGE_FULL_AGE = 34
_ACTIVE_STAGE_MIN_FRACTION = 0.35

# Index-bias controls (§3): the top band requires breadth, and sparse profiles
# cannot occupy the extreme all-time tier on a tiny fact count. Below the gold
# floor the index is left untouched.
GOLD_FLOOR_INDEX = 0.85
SINGLE_FAMILY_INDEX_CAP = 0.84
SPARSE_FACT_COUNT_THRESHOLD = 6
SPARSE_FAMILY_COUNT_THRESHOLD = 4
SPARSE_FACT_CONFIDENCE_DENOMINATOR = 24

# ─── career_stature_index — global monotonic re-spread ────────────────────────
# The saturating ``career_stature_score`` is structurally compressed: cross-family
# ``1 − Π(1 − w[f]·fs[f])`` tops out near ~0.67 even for the all-time peak, and the
# recognized-greats cohort sits in a narrow ~[0.40, 0.67] band. Feeding that raw
# score to the rating target would under-spread the greats (the v1 failure mode).
#
# ``career_stature_index`` corrects this with a GLOBAL, MONOTONIC, DOCUMENTED
# piecewise-linear re-spread of the score onto [0, 1], pinned by five fixed
# (score → index) control points (NOT population quantiles — so the transform is
# stable as the scored set grows, and carries no per-player parameter):
#
#     score 0.00 → index 0.00   (no factual recognition)
#     score 0.10 → index 0.20   (thin tail: a single cap-list / regional placement)
#     score 0.25 → index 0.50   (material-stature floor)
#     score 0.45 → index 0.80   (strong recognized greats: Pelé, Maldini, Cruyff)
#     score 0.68 → index 1.00   (the all-time peak; ≥ the realised score max ~0.671)
#
# Linear interpolation between points, clamped at the ends. The two "expansion"
# segments (0.25→0.45→0.68) deliberately stretch the compressed elite band across
# [0.50, 1.00], so recognized greats land near the top of [0, 1] while the thin
# tail stays low — the anti-compression / anti-inflation goal in one transform.
INDEX_CONTROL_POINTS: tuple[tuple[float, float], ...] = (
    (0.00, 0.00),
    (0.10, 0.20),
    (0.25, 0.50),
    (0.45, 0.80),
    (0.68, 1.00),
)

# ─── material-stature cohort (tier + report) ──────────────────────────────────
# A row is "material stature" when it clears BOTH a coverage floor (enough breadth /
# all-time evidence to trust the record) and an index floor (enough recognition to
# matter to the rating). The rating stage mirrors these as MATERIAL_STATURE_MIN_*
# for its continuity ramp; here they define the tiering cohort and the report split.
MATERIAL_MIN_COVERAGE = 0.25
MATERIAL_MIN_INDEX = 0.40

# stature_tier ∈ {bronze, silver, gold} partitions the material cohort by index
# quantiles: gold ≈ top quintile of material index, silver the next band, bronze the
# qualifying remainder. Used ONLY by the rating stage's per-pos tournament down-cap
# (tighter cap at higher tier → a higher-tier legend's weakest WC stays elite).
TIER_GOLD_QUANTILE = 0.80
TIER_SILVER_QUANTILE = 0.50

# ─── factual legend threshold (tightened, Paulo-approved 2026-06-08) ──────────
# legend is SOURCE-DERIVED and NEVER inspects overall/channels. Routes (closed-set
# reason codes):
#   1. global_annual_multi_winner            — ≥2 global annual WINS
#      global_annual_winner_with_corroboration — 1 global win + ≥1 corroborating
#                                                major fact
#   2. approved_all_time_selection           — ≥1 world top-tier all-time selection
#      (Ballon d'Or Dream Team XI / IFFHS all-time world dream team / World
#       Player-of-the-Century). National/continental century elections are NOT a
#       Route-2 trigger — they score in the retrospective family and corroborate
#       Route 1, but the world-legend badge requires world-tier recognition.
#   3. position_balanced_world_xi_3plus      — ≥3 position-balanced world-XI facts
#      AND index ≥ LEGEND_INDEX_FLOOR        (the defender/GK/midfielder route)
#   4. retrospective_plus_major_fact         — broad living-legends inclusion + ≥1
#      additional major fact AND index ≥ LEGEND_INDEX_FLOOR.
#
# DEVIATION NOTE (documented): the plan's Approach §"Factual Legend badge" puts an
# explicit index floor only on Route 3. Route 4 (the broad 125-player living-legends
# list + one major fact) without a floor admits the well-known living-legends
# long-tail (e.g. very-good-not-legendary inclusions) as legends, defeating the
# "reads as a known legend" intent. Per the plan's own escape hatch ("tunable via
# the LEGEND_INDEX_FLOOR constant ... without a re-plan"), Route 4 is gated by the
# SAME index floor as Route 3. This is an in-spirit tightening, surfaced in
# CAREER_STATURE.md; MV2-8's named anchors finalise it.
LEGEND_INDEX_FLOOR = 0.50

_LEGEND_REASON_CODES: tuple[str, ...] = (
    "global_annual_multi_winner",
    "global_annual_winner_with_corroboration",
    "approved_all_time_selection",
    "position_balanced_world_xi_3plus",
    "retrospective_plus_major_fact",
    "pre_1967_retrospective_consensus",
)

# Sources counted as a GLOBAL ANNUAL WIN for the legend gate (onze handled by tier).
_GLOBAL_ANNUAL_WIN_SOURCES: frozenset[str] = frozenset(
    {
        "european_poy",
        "research_global_annual",
        "iffhs_worlds_best",
        "uefa_mens_poy",
        "world_soccer_poy",
    }
)

# Coverage below which a row's material-stature evidence is "thin" — surfaced in the
# report's review queue (the rating stage's own gate mirrors MATERIAL_MIN_COVERAGE).
REVIEW_COVERAGE_THRESHOLD = MATERIAL_MIN_COVERAGE


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


def _saturate(strengths: list[float]) -> float:
    """1 - Π(1 - s): positive evidence accumulates toward 1.0, never past it."""
    acc = 1.0
    for s in strengths:
        acc *= 1.0 - _clamp01(s)
    return 1.0 - acc


def _fact_strength(fact: dict) -> float:
    """Map one linked source fact to its family input strength in (0, 1].

    Raises on an unrecognized distinction — drift protection identical to
    ``rating._award_score``: an unknown fact kind must fail loud, never be silently
    dropped (understating the player) or guessed.
    """
    family = fact["family"]
    detail = fact["detail"]
    sid = fact["source_id"]
    if family == "wc_legacy":
        kind = detail.split(" WC-")[0]
        if kind not in _WC_AWARD_STRENGTH:
            raise KeyError(f"unrecognized WC award {kind!r} in fact {fact!r}")
        return _WC_AWARD_STRENGTH[kind]
    if family == "global_annual_recognition":
        if sid == "active_global_annual":
            if "Ballon d'Or" in detail and "runner-up" in detail:
                return 0.60
            if "Kopa Trophy" in detail:
                return 0.45
            raise KeyError(f"unrecognized active-global annual fact {detail!r}")
        if sid == "onze_awards":
            for token, s in _ONZE_STRENGTH.items():
                if token in detail:
                    return s
            raise KeyError(f"unrecognized onze fact {detail!r}")
        if sid not in _GLOBAL_ANNUAL_STRENGTH:
            raise KeyError(f"unrecognized global-annual source {sid!r}")
        return _GLOBAL_ANNUAL_STRENGTH[sid]
    if family == "regional_annual_recognition":
        if sid == "south_american_poy_placements":
            return _SAM_PLACEMENT_STRENGTH["2nd" if "2nd" in detail else "3rd"]
        if sid not in _REGIONAL_ANNUAL_STRENGTH:
            raise KeyError(f"unrecognized regional-annual source {sid!r}")
        return _REGIONAL_ANNUAL_STRENGTH[sid]
    if family == "position_balanced_selection":
        if sid == "active_gk_award":
            return _POSITION_BALANCED_STRENGTH["research_gk_award"]
        if sid not in _POSITION_BALANCED_STRENGTH:
            raise KeyError(f"unrecognized position-balanced source {sid!r}")
        return _POSITION_BALANCED_STRENGTH[sid]
    if family == "retrospective_selection":
        if sid == "iffhs_century":
            if "World - Player of the Century" in detail:
                return _RETRO_WORLD_CENTURY
            if "century election" in detail:
                return _RETRO_CONTINENTAL_CENTURY
            raise KeyError(f"unrecognized century fact {detail!r}")
        if sid == "living_legends_2004":
            return _RETRO_LIVING_LEGENDS
        if sid == "iffhs_men_legends":
            return _RETRO_LIVING_LEGENDS
        if sid == "ballondor_dream_team":
            for token, s in _BALLONDOR_DREAM_TEAM_STRENGTH.items():
                if token in detail:
                    return s
            raise KeyError(f"unrecognized ballon d'or dream-team fact {detail!r}")
        if sid == "iffhs_dream_teams":
            return _IFFHS_DREAM_TEAM_STRENGTH
        raise KeyError(f"unrecognized retrospective source {sid!r}")
    if family == "international_record":
        m = re.search(r"caps=(\d+)", detail)
        if m:
            caps = int(m.group(1))
            return min(
                _CAPS_CEILING_STRENGTH,
                _CAPS_FLOOR_STRENGTH + max(0, caps - 100) * _CAPS_PER_CAP,
            )
        m = re.search(r"goals=(\d+)", detail)
        if m:
            goals = int(m.group(1))
            return min(
                _GOALS_CEILING_STRENGTH,
                _GOALS_FLOOR_STRENGTH + max(0, goals - 30) * _GOALS_PER_GOAL,
            )
        raise KeyError(f"unrecognized international-record fact {detail!r}")
    if family == "captaincy":
        return _CAPTAINCY_WC_WINNER if "lifted the" in detail else _CAPTAINCY_BASE
    if family == "club_season_honors":
        if sid == "active_club_season_honors":
            return _CLUB_SEASON_TITLE_FINAL_PARTICIPANT
        if sid == "swedish_footballer_of_year":
            return _PUBLIC_SEASON_HONOR_STRENGTH["domestic_top_flight_player_of_year"]
        if sid == "active_public_season_honors":
            for token, strength in _PUBLIC_SEASON_HONOR_STRENGTH.items():
                if token in detail:
                    return strength
            raise KeyError(f"unrecognized public season honor fact {detail!r}")
        raise KeyError(f"unrecognized club-season honors source {sid!r}")
    if family == "club_honors":
        if sid != "research_objective_club_honors":
            raise KeyError(f"unrecognized club-honors source {sid!r}")
        kind = detail.split(":", 1)[0]
        if kind not in _CLUB_HONORS_STRENGTH:
            raise KeyError(f"unrecognized club-honors fact {detail!r}")
        return _CLUB_HONORS_STRENGTH[kind]
    raise KeyError(f"fact carries unknown family {family!r}: {fact!r}")


def _index_of(score: float) -> float:
    """Global monotonic piecewise-linear re-spread of the compressed score onto
    [0, 1] (see INDEX_CONTROL_POINTS). Deterministic, population-independent, no
    per-player parameter."""
    pts = INDEX_CONTROL_POINTS
    if score <= pts[0][0]:
        return 0.0
    if score >= pts[-1][0]:
        return 1.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
        if score <= x1:
            return y0 + (y1 - y0) * (score - x0) / (x1 - x0)
    return 1.0


# ─── legend fact aggregates ───────────────────────────────────────────────────


def _legend_aggregates(facts: list[dict]) -> dict:
    """Per-player factual counts the legend routes read. SOURCE-only; never touches
    a rating."""
    global_wins = 0
    approved_all_time = 0
    position_balanced = 0
    regional = 0
    caps_100 = False
    broad_retrospective = False
    for f in facts:
        sid = f["source_id"]
        fam = f["family"]
        detail = f["detail"]
        if sid in _GLOBAL_ANNUAL_WIN_SOURCES:
            global_wins += 1
        elif sid == "onze_awards" and "onze_dor" in detail:
            global_wins += 1
        if sid in ("ballondor_dream_team", "iffhs_dream_teams"):
            approved_all_time += 1
        elif sid == "iffhs_century" and "World - Player of the Century" in detail:
            approved_all_time += 1
        if fam == "position_balanced_selection":
            position_balanced += 1
        if fam == "regional_annual_recognition":
            regional += 1
        if fam == "international_record":
            m = re.search(r"caps=(\d+)", detail)
            if m and int(m.group(1)) >= 100:
                caps_100 = True
        if sid in {"living_legends_2004", "iffhs_men_legends"}:
            broad_retrospective = True
    return {
        "global_wins": global_wins,
        "approved_all_time": approved_all_time,
        "position_balanced": position_balanced,
        "regional": regional,
        "caps_100": caps_100,
        "living_legends": broad_retrospective,
    }


def _pre_1967_retrospective_consensus(
    facts: list[dict], index: float, career_peak_year: int | None
) -> bool:
    """Pre-1967 legend coherence route.

    The shipped v3 route counted only world-tier all-time selections, modern
    repeated XI selections, or the 2004 living-legends list. That left
    high-index pre-1967 players with continental/national player-of-century
    consensus as high-90s non-legends. This route stays source-derived: it reads
    only existing public retrospective facts plus major corroboration and never
    inspects a card's display overall.
    """
    if career_peak_year is None or career_peak_year >= 1967 or index < 0.70:
        return False
    century = sum(
        1 for f in facts if f["source_id"] == "iffhs_century" and "century election:" in f["detail"]
    )
    has_international_record = any(f["family"] == "international_record" for f in facts)
    living_legends = any(f["source_id"] == "living_legends_2004" for f in facts)
    wc_legacy = sum(1 for f in facts if f["family"] == "wc_legacy")
    return (
        century >= 2
        or (century >= 1 and has_international_record)
        or (living_legends and wc_legacy >= 2)
    )


def _legend_reason_codes(
    facts: list[dict], index: float, career_peak_year: int | None = None
) -> list[str]:
    """Closed-set legend reason codes for a player (empty list ⇒ not a legend)."""
    a = _legend_aggregates(facts)
    codes: list[str] = []
    corroborating = (
        a["approved_all_time"] >= 1
        or a["position_balanced"] >= 1
        or a["regional"] >= 1
        or a["caps_100"]
    )
    # Route 1 — global annual recognition.
    if a["global_wins"] >= 2:
        codes.append("global_annual_multi_winner")
    elif a["global_wins"] >= 1 and corroborating:
        codes.append("global_annual_winner_with_corroboration")
    # Route 2 — world top-tier all-time selection.
    if a["approved_all_time"] >= 1:
        codes.append("approved_all_time_selection")
    # Route 3 — position-balanced world-XI route (defenders / GKs / midfielders).
    if a["position_balanced"] >= 3 and index >= LEGEND_INDEX_FLOOR:
        codes.append("position_balanced_world_xi_3plus")
    # Route 4 — broad retrospective inclusion + a corroborating major fact.
    major_fact = (
        a["global_wins"] >= 1
        or a["approved_all_time"] >= 1
        or a["regional"] >= 1
        or a["position_balanced"] >= 1
    )
    if a["living_legends"] and major_fact and index >= LEGEND_INDEX_FLOOR:
        codes.append("retrospective_plus_major_fact")
    # Route 5 — pre-1967 retrospective consensus. This closes the v3 coherence
    # gap for players whose source evidence is continental/national century
    # recognition rather than modern annual/XI ballots.
    if _pre_1967_retrospective_consensus(facts, index, career_peak_year):
        codes.append("pre_1967_retrospective_consensus")
    return codes
