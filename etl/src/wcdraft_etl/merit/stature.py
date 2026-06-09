"""MERIT-V2 MV2-3 — deterministic per-player career-stature composite (v2).

Reads the committed v2 linked-fact file (``etl/output/merit/source_facts.json`` —
the full ``merit-source-set-2.0.0`` set: WC legacy + global/regional annual
recognition + position-balanced selections + international records + retrospective
all-time selections + captaincy) and the canonical men's World Cup years, and emits
one career-stature row per linked ``player_id``:

    etl/output/career_stature.json               the per-player composite table
    etl/output/merit/CAREER_STATURE.md            the human-readable build report
    etl/output/merit/career_stature_review.json   rows held below the material gate

This table is the ONLY place career aggregates live. ``rating.py`` (MV2-4) consumes
``career_stature.json`` keyed by ``player_id`` and is the only downstream reader.

WHAT CHANGED FROM career-stature-1.0.0 (MV2-3):

  * The v1 table scored ONLY the v1 source subset through a v1 family relabel
    (``_v1_facts``) so MV2-1/MV2-2 could broaden ``source_facts.json`` without
    moving any rating. That isolation is REMOVED. The v2 table scores the FULL
    ``source_facts.json`` over the v2 position-balanced family taxonomy.
  * Two distinct numbers are emitted (the load-bearing distinction):
      - ``career_stature_score`` — the transparent saturating factual composite
        (per-family ``1 − Π(1 − strength)``; cross-family ``1 − Π(1 − w[f]·fs[f])``).
        It is structurally compressed: even the all-time peak tops out near ~0.67.
      - ``career_stature_index`` — a global, monotonic, documented re-spread of the
        score onto [0, 1] that corrects that compression so the recognized-greats
        cohort lands near the top and the material distribution is not clumped.
        The rating stage consumes the INDEX, never the raw score.
  * Position-balanced family weights: attacker-heavy annual awards CANNOT be the
    only route to high stature. Defenders / goalkeepers / midfielders reach high
    stature via all-time XI / dream-team / positional / repeated world-XI /
    captaincy facts (the defender/GK repair the v1 striker-biased set could not do).
  * ``stature_tier`` ∈ {bronze, silver, gold} — index quantiles WITHIN the material
    cohort; consumed only by the rating stage's per-pos tournament down-cap table.
  * A factual ``legend`` boolean + ``legend_reason_codes`` (closed set) is derived
    from the SOURCE FACTS alone — it never inspects ``overall`` or any rating
    channel. It replaces the UI's old ``overall >= 96`` heuristic (MV2-7 switches
    the badge). Threshold = the tightened, Paulo-approved (2026-06-08) routes
    (see ``_legend_reason_codes``).

INVARIANT LINE (mirrors the E-4.1 intake and the RSSSF supplement):

  * Pure + offline: a re-run over the committed ``source_facts.json`` reproduces
    byte-identical outputs. No network, no clock, no randomness.
  * Missing coverage is coverage. A player absent from a source contributes no fact
    and is never scored a zero AGAINST themselves — the absent family is simply
    dropped from that player's denominator, surfaced as ``coverage`` < 1.0.
  * No per-player override. Every score, index, tier and legend flag is the same
    era-weighted saturating product / global transform / factual route applied to
    every player; there is no name-keyed table anywhere.
  * The composite assigns NO rating. It is the merit BASE that MV2-4 turns into a
    stature target; this module emits no ``overall`` and touches no engine constant.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import ERA_BUCKETS, SOURCE_SET_VERSION, VERSION
from .paths import OUTPUT_DIR

# career_stature.json lives next to the canonical tables (the rating stage reads it
# from there), NOT under merit/output — it is a first-class ETL artifact.
_CANON_DIR = Path(__file__).resolve().parents[3] / "output"
CAREER_STATURE_PATH = _CANON_DIR / "career_stature.json"

# Float rounding so emitted JSON is byte-stable (matches rating._PRECISION).
_PRECISION = 6

# ─── v2 family taxonomy (position-balanced) ───────────────────────────────────
# The families the v2 table scores, in the fixed combine order. ``club_honors`` is
# registered for schema stability but weight 0.0 in every era (deferred, no source).
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
)

# ─── era-bucketed family weights (v2) ─────────────────────────────────────────
# A family weight of 0.0 means the family is structurally UNAVAILABLE for that era
# and is excluded from BOTH the score product and the coverage denominator — the
# same era-gating principle the v1 table used for annual_recognition pre-1956.
#
# Era-gating rationale (the defender/GK repair):
#   * Annual player-of-the-year ballots did not exist pre-1956 (first Ballon d'Or
#     1956) and continental ballots not until ~1970 → weight 0 pre_1956.
#   * Annual position-balanced XIs (UEFA Team of the Year 2001+, FIFPro 2005+, ESM
#     1994+, UEFA positional 1997+) did not exist DURING a 1956–1990 player's career
#     → position_balanced weight 0 for pre_1956 / 1956_1990. A pre-1991 great's
#     position-balanced recognition lives in the RETROSPECTIVE all-time dream teams,
#     which carry heavy weight in those eras. This is what lets a pre-1991 defender
#     (Baresi, Beckenbauer) clear the material gate on all-time selections alone,
#     instead of being penalised for missing awards that could not exist in-era.
#   * club_honors deferred everywhere (weight 0.0, no source).
ERA_FAMILY_WEIGHTS: dict[str, dict[str, float]] = {
    "pre_1956": {
        "wc_legacy": 0.30,
        "global_annual_recognition": 0.00,
        "regional_annual_recognition": 0.00,
        "position_balanced_selection": 0.00,
        "international_record": 0.15,
        "retrospective_selection": 0.50,
        "captaincy": 0.05,
        "club_honors": 0.00,
    },
    "1956_1990": {
        "wc_legacy": 0.22,
        "global_annual_recognition": 0.25,
        "regional_annual_recognition": 0.10,
        "position_balanced_selection": 0.00,
        "international_record": 0.08,
        "retrospective_selection": 0.25,
        "captaincy": 0.05,
        "club_honors": 0.00,
    },
    "1991_plus": {
        "wc_legacy": 0.15,
        "global_annual_recognition": 0.27,
        "regional_annual_recognition": 0.10,
        "position_balanced_selection": 0.25,
        "international_record": 0.08,
        "retrospective_selection": 0.10,
        "captaincy": 0.05,
        "club_honors": 0.00,
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
# player-voted FIFPro World 11 and the annual UEFA Team of the Year rank below; ESM
# (league-scope) lowest. Each selection is one input; repeats saturate.
_POSITION_BALANCED_STRENGTH: dict[str, float] = {
    "uefa_club_positional": 0.62,
    "fifpro_world11": 0.50,
    "uefa_team_of_the_year": 0.45,
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
    living_legends = False
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
        if sid == "living_legends_2004":
            living_legends = True
    return {
        "global_wins": global_wins,
        "approved_all_time": approved_all_time,
        "position_balanced": position_balanced,
        "regional": regional,
        "caps_100": caps_100,
        "living_legends": living_legends,
    }


def _legend_reason_codes(facts: list[dict], index: float) -> list[str]:
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
    return codes


# ─── canonical men's WC years (peak year) ─────────────────────────────────────


def _mens_wc_years(cards: list[dict], tournaments: list[dict]) -> dict[str, list[int]]:
    """player_id -> sorted list of the men's World Cup years they have a card in."""
    year_of = {
        t["tournament_id"]: t["year"] for t in tournaments if not t.get("womens")
    }
    years: dict[str, list[int]] = {}
    for c in cards:
        y = year_of.get(c["tournament_id"])
        if y is None:
            continue
        years.setdefault(c["player_id"], []).append(int(y))
    for pid in years:
        years[pid].sort()
    return years


def _career_peak_year(years: list[int]) -> int | None:
    """Lower-median men's WC year — deterministic, no inference of unobserved
    club-career peaks."""
    if not years:
        return None
    return years[(len(years) - 1) // 2]


def _modal_position(facts: list[dict]) -> str | None:
    """Most-frequent stated fact position (GK/DF/MF/FW) — REPORT-ONLY (the rating
    stage weights on the card position, not this). Ties broken by GK<DF<MF<FW."""
    counts: dict[str, int] = {}
    for f in facts:
        p = f.get("position")
        if p:
            counts[p] = counts.get(p, 0) + 1
    if not counts:
        return None
    order = {"GK": 0, "DF": 1, "MF": 2, "FW": 3}
    return min(counts, key=lambda p: (-counts[p], order.get(p, 9)))


# ─── row build ────────────────────────────────────────────────────────────────


def _build_player_rows(source_facts: dict, mens_years: dict[str, list[int]]) -> list[dict]:
    """Build the per-player rows WITHOUT tier (tier needs the whole cohort). Pure."""
    by_player: dict[str, list[dict]] = {}
    for f in source_facts["facts"]:
        by_player.setdefault(f["player_id"], []).append(f)

    rows: list[dict] = []
    for pid in sorted(by_player):
        pfacts = by_player[pid]
        # Every fact for a player carries the same player-era (derived from the
        # player's earliest WC); assert it so a mislabeled fact fails loud.
        eras = {f["era"] for f in pfacts}
        if len(eras) != 1:
            raise ValueError(f"player {pid} has conflicting fact eras {eras}")
        era = next(iter(eras))
        if era not in ERA_BUCKETS:
            raise ValueError(f"player {pid} has unknown era {era!r}")
        weights = ERA_FAMILY_WEIGHTS[era]

        # Per-family saturating fold over that family's facts.
        family_facts: dict[str, list[dict]] = {}
        for f in pfacts:
            fam = f["family"]
            if fam not in _V2_FAMILY_KEYS:
                raise ValueError(f"player {pid} fact in unknown family {fam!r}")
            family_facts.setdefault(fam, []).append(f)
        family_scores: dict[str, float] = {}
        for fam, ff in family_facts.items():
            family_scores[fam] = round(
                _saturate([_fact_strength(f) for f in ff]), _PRECISION
            )

        # Era-weighted saturating combine across the structurally-available families.
        active = [fam for fam in _V2_FAMILY_KEYS if weights.get(fam, 0.0) > 0.0]
        acc = 1.0
        for fam in active:
            acc *= 1.0 - weights[fam] * family_scores.get(fam, 0.0)
        career_score = round(1.0 - acc, _PRECISION)
        career_index = round(_index_of(career_score), _PRECISION)

        # Coverage: fraction of era-available family weight that has a positive fact.
        total_w = sum(weights[fam] for fam in active)
        present_w = sum(
            weights[fam] for fam in active if family_scores.get(fam, 0.0) > 0.0
        )
        coverage = round(present_w / total_w, _PRECISION) if total_w > 0 else 0.0

        legend_codes = _legend_reason_codes(pfacts, career_index)
        peak_year = _career_peak_year(mens_years.get(pid, []))
        source_refs = sorted({f"{f['source_id']}:{f['detail']}" for f in pfacts})

        rows.append(
            {
                "player_id": pid,
                "stature_version": VERSION,
                "source_set_version": SOURCE_SET_VERSION,
                "career_stature_score": career_score,
                "career_stature_index": career_index,
                "coverage": coverage,
                "era_bucket": era,
                "career_peak_year": peak_year,
                "modal_position": _modal_position(pfacts),
                "family_scores": {
                    fam: family_scores.get(fam, None) for fam in _V2_FAMILY_KEYS
                },
                "family_weights": {fam: weights.get(fam, 0.0) for fam in _V2_FAMILY_KEYS},
                "stature_tier": None,  # filled by _assign_tiers over the full cohort
                "legend": bool(legend_codes),
                "legend_reason_codes": legend_codes,
                "fact_count": len(pfacts),
                "review_flags": _review_flags(coverage, career_index, family_scores),
                "source_refs": source_refs,
            }
        )
    return rows


def _is_material(row: dict) -> bool:
    return (
        row["coverage"] >= MATERIAL_MIN_COVERAGE
        and row["career_stature_index"] >= MATERIAL_MIN_INDEX
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


def _assign_tiers(rows: list[dict]) -> dict[str, float | None]:
    """Assign stature_tier in place over the material cohort by index quantiles.
    Returns the (deterministic) gold/silver cut thresholds for the table meta."""
    material_idx = sorted(r["career_stature_index"] for r in rows if _is_material(r))
    if not material_idx:
        return {"gold_min_index": None, "silver_min_index": None}
    gold_cut = round(_quantile(material_idx, TIER_GOLD_QUANTILE), _PRECISION)
    silver_cut = round(_quantile(material_idx, TIER_SILVER_QUANTILE), _PRECISION)
    for r in rows:
        if not _is_material(r):
            r["stature_tier"] = None
            continue
        idx = r["career_stature_index"]
        r["stature_tier"] = (
            "gold" if idx >= gold_cut else "silver" if idx >= silver_cut else "bronze"
        )
    return {"gold_min_index": gold_cut, "silver_min_index": silver_cut}


def build_rows(source_facts: dict, mens_years: dict[str, list[int]]) -> tuple[list[dict], dict]:
    """Build the sorted per-player career-stature rows + tier meta (pure)."""
    rows = _build_player_rows(source_facts, mens_years)
    tier_meta = _assign_tiers(rows)
    return rows, tier_meta


def _review_flags(
    coverage: float, index: float, family_scores: dict[str, float]
) -> list[str]:
    """Non-fatal advisory flags for the review queue (never affect the score)."""
    flags: list[str] = []
    if coverage < MATERIAL_MIN_COVERAGE:
        flags.append("below_material_coverage_gate")
    if index < MATERIAL_MIN_INDEX:
        flags.append("below_material_index_gate")
    if len(family_scores) == 1:
        flags.append("single_family_only")
    return flags


def build(write: bool = True) -> dict:
    source_facts = json.loads(
        (OUTPUT_DIR / "source_facts.json").read_text(encoding="utf-8")
    )
    cards = json.loads((_CANON_DIR / "player_tournaments.json").read_text("utf-8"))
    tournaments = json.loads((_CANON_DIR / "tournaments.json").read_text("utf-8"))
    mens_years = _mens_wc_years(cards, tournaments)

    rows, tier_meta = build_rows(source_facts, mens_years)
    review = [r for r in rows if r["review_flags"]]
    material = [r for r in rows if _is_material(r)]
    legends = [r for r in rows if r["legend"]]

    table = {
        "version": VERSION,
        "source_set_version": SOURCE_SET_VERSION,
        "player_count": len(rows),
        "material_count": len(material),
        "legend_count": len(legends),
        "material_gate": {
            "min_coverage": MATERIAL_MIN_COVERAGE,
            "min_index": MATERIAL_MIN_INDEX,
        },
        "tier_thresholds": tier_meta,
        "career_stature": rows,
    }
    review_doc = {
        "version": VERSION,
        "review_count": len(review),
        "coverage_gate": MATERIAL_MIN_COVERAGE,
        "index_gate": MATERIAL_MIN_INDEX,
        "review": review,
    }
    report_md = _render_report(rows, tier_meta)

    if write:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        _write_json(CAREER_STATURE_PATH, table)
        _write_json(OUTPUT_DIR / "career_stature_review.json", review_doc)
        (OUTPUT_DIR / "CAREER_STATURE.md").write_text(report_md, encoding="utf-8")

    return {
        "rows": rows,
        "review": review,
        "table": table,
        "review_doc": review_doc,
        "report_md": report_md,
    }


# Canonical-greats checklist (mirrors merit.report._GREATS) — report-only de-risk
# signal so the career composite is legible run-to-run.
_GREATS: tuple[tuple[str, str], ...] = (
    ("Pelé", "P-38906"),
    ("Alfredo Di Stéfano", "P-34403"),
    ("Garrincha", "P-46080"),
    ("Ferenc Puskás", "P-12676"),
    ("Lev Yashin (GK)", "P-09317"),
    ("Bobby Charlton", "P-08601"),
    ("Eusébio", "P-74747"),
    ("Franz Beckenbauer", "P-72864"),
    ("Johan Cruyff", "P-50564"),
    ("Gerd Müller", "P-72441"),
    ("Diego Maradona", "P-80404"),
    ("Michel Platini", "P-08939"),
    ("Zico", "P-37483"),
    ("Karl-Heinz Rummenigge", "P-59574"),
    ("Franco Baresi (DF)", "P-42920"),
    ("Lothar Matthäus", "P-49502"),
    ("Marco van Basten", "P-76874"),
    ("Roberto Baggio", "P-78756"),
    ("Zinedine Zidane", "P-56430"),
    ("Ronaldo", "P-62722"),
    ("Ronaldinho", "P-57361"),
    ("Cafu (DF)", "P-91718"),
    ("Gianluigi Buffon (GK)", "P-11392"),
    ("Paolo Maldini (DF)", "P-43222"),
    ("Lionel Messi", "P-14758"),
    ("Cristiano Ronaldo", "P-70442"),
)

# Defender / goalkeeper checklist — the v2 repair target (these legends were thin or
# zeroed in the striker-biased v1 set; v2 must surface them via the position-balanced
# and all-time routes).
_DEF_GK_CHECK: tuple[tuple[str, str], ...] = (
    ("Paolo Maldini (DF)", "P-43222"),
    ("Franco Baresi (DF)", "P-42920"),
    ("Franz Beckenbauer (DF)", "P-72864"),
    ("Cafu (DF)", "P-91718"),
    ("Lev Yashin (GK)", "P-09317"),
    ("Dino Zoff (GK)", "P-30086"),
    ("Gianluigi Buffon (GK)", "P-11392"),
    ("Iker Casillas (GK)", "P-46821"),
)


def _render_report(rows: list[dict], tier_meta: dict) -> str:
    by_pid = {r["player_id"]: r for r in rows}
    material = [r for r in rows if _is_material(r)]
    legends = [r for r in rows if r["legend"]]
    L: list[str] = []
    L.append(f"# Career-stature composite ({VERSION})\n")
    L.append(
        "Per-player career-stature BASE consumed by the stature-dominant rating "
        "stage (MV2-4). NOT a rating. Built deterministically from the committed "
        f"`merit/source_facts.json` ({SOURCE_SET_VERSION}) + canonical men's World "
        "Cup years.\n"
    )
    L.append(f"- Players scored: **{len(rows)}**")
    L.append(
        f"- Material-stature (coverage ≥ {MATERIAL_MIN_COVERAGE} AND index ≥ "
        f"{MATERIAL_MIN_INDEX}): **{len(material)}** (the cohort the rating stage "
        "ramps onto the stature-dominant path; the rest stay raw-tournament)"
    )
    L.append(f"- Factual legends: **{len(legends)}**")
    gold = tier_meta.get("gold_min_index")
    silver = tier_meta.get("silver_min_index")
    L.append(
        f"- Tier cuts (index quantiles of the material cohort): gold ≥ "
        f"`{gold}`, silver ≥ `{silver}`, bronze = qualifying remainder\n"
    )

    # score + index distribution by era
    L.append("## Score / index distribution by era bucket\n")
    L.append("| Era | players | score min/med/max | index min/med/max |")
    L.append("|---|---:|---|---|")
    for era in ERA_BUCKETS:
        er = [r for r in rows if r["era_bucket"] == era]
        if not er:
            continue
        ss = sorted(r["career_stature_score"] for r in er)
        ii = sorted(r["career_stature_index"] for r in er)
        L.append(
            f"| `{era}` | {len(er)} | {ss[0]:.3f} / {ss[len(ss)//2]:.3f} / {ss[-1]:.3f} "
            f"| {ii[0]:.3f} / {ii[len(ii)//2]:.3f} / {ii[-1]:.3f} |"
        )

    # index distribution by modal position (the position-balance check)
    L.append("\n## Material-cohort index by modal position\n")
    L.append("| Position | material players | index min/med/max |")
    L.append("|---|---:|---|")
    for pos in ("GK", "DF", "MF", "FW"):
        pr = [r for r in material if r["modal_position"] == pos]
        if not pr:
            L.append(f"| {pos} | 0 | — |")
            continue
        ii = sorted(r["career_stature_index"] for r in pr)
        L.append(f"| {pos} | {len(pr)} | {ii[0]:.3f} / {ii[len(ii)//2]:.3f} / {ii[-1]:.3f} |")

    # legend reason-code breakdown
    L.append("\n## Legend reason-code breakdown\n")
    L.append("| Reason code | players |")
    L.append("|---|---:|")
    for code in _LEGEND_REASON_CODES:
        n = sum(1 for r in legends if code in r["legend_reason_codes"])
        L.append(f"| `{code}` | {n} |")

    # canonical greats
    L.append("\n## Canonical-greats checklist (de-risk signal)\n")
    L.append("| Great | Era | Score | Index | Cov | Tier | Legend |")
    L.append("|---|---|---:|---:|---:|---|---|")
    for name, pid in _GREATS:
        r = by_pid.get(pid)
        if r is None:
            L.append(f"| {name} | — | — | — | — | — | (no linked facts) |")
            continue
        L.append(
            f"| {name} | `{r['era_bucket']}` | {r['career_stature_score']:.3f} "
            f"| {r['career_stature_index']:.3f} | {r['coverage']:.2f} "
            f"| {r['stature_tier'] or '—'} | {'✓' if r['legend'] else '—'} |"
        )

    # defender / GK repair checklist
    L.append("\n## Defender / goalkeeper checklist (the v2 repair target)\n")
    L.append("| Player | Era | Index | Cov | Tier | Legend | Reason codes |")
    L.append("|---|---|---:|---:|---|---|---|")
    for name, pid in _DEF_GK_CHECK:
        r = by_pid.get(pid)
        if r is None:
            L.append(f"| {name} | — | — | — | — | — | (no linked facts) |")
            continue
        L.append(
            f"| {name} | `{r['era_bucket']}` | {r['career_stature_index']:.3f} "
            f"| {r['coverage']:.2f} | {r['stature_tier'] or '—'} "
            f"| {'✓' if r['legend'] else '—'} | {', '.join(r['legend_reason_codes']) or '—'} |"
        )

    L.append(
        "\n_Thin-coverage / low-index rows are withheld from the stature-dominant "
        "rating path (they keep their raw tournament score — missing coverage is "
        "coverage, never a zero against the player) and listed in "
        "`career_stature_review.json`. Legend is SOURCE-derived and never inspects a "
        "rating; the Route-4 index floor (a documented in-spirit tightening of the "
        "plan) keeps the broad living-legends long-tail out of the badge._\n"
    )
    return "\n".join(L) + "\n"


def _write_json(path: Path, obj: dict) -> None:
    path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    out = build(write=True)
    t = out["table"]
    print(f"career stature {VERSION}")
    print(
        f"  players: {t['player_count']}  material: {t['material_count']}  "
        f"legends: {t['legend_count']}"
    )
    print(f"  -> {CAREER_STATURE_PATH}")
    print(f"  -> {OUTPUT_DIR / 'CAREER_STATURE.md'}")
