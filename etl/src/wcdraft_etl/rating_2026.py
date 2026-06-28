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
# map, and the channel/clamp helpers are imported, not re-implemented. MV2-5 also
# imports the stature-dominant composite pieces (stature target, continuity ramp,
# tier caps, raw-only ceiling) so 2026 linked players sit on the SAME stature scale
# as the historical wc-perf-4.x cards — one scale across both, not a parallel model.
# Non-material 2026 cards are placed on the historical raw-only scale by EMPIRICAL
# QUANTILE MAPPING (not an affine rescale) — see _raw_only_quantile_map — so the
# 2026 non-material internal-score DISTRIBUTION matches the historical raw-only
# quantiles cross-era, the population MV2-6's single monotonic curve pools.
from . import manual_overrides, national_strength, rating
from .rating import (
    _PRECISION,
    CHANNEL_SPREAD,
    CHANNELS,
    COARSE_POSITIONS,
    COHORT_MIN_N,
    RAW_ONLY_GLOBAL_CEILING,
    STATURE_DOMINANT_WEIGHT,
    _channel,
    _clamp01,
    _context_adjusted_raw_only_score,
    _display_score,
    _quantile,
    _stature_model_weight,
    _stature_target,
)
from .rating_2026_components import (  # noqa: F401 - private helpers remain part of rating_2026.py's test surface
    _AGE_AS_OF,
    AGE_QUANTILE_BANDWIDTH,
    AGE_QUANTILE_P_STEPS,
    CAREER_IDEAL_SIGNALS,
    LEAGUE_DEFAULT,
    LEAGUE_STRENGTH,
    LEAGUE_WEIGHT,
    PROJECTED_ACTIVE_STATURE_CAP_FLOOR,
    PROJECTED_ACTIVE_STATURE_CAP_SPAN,
    PROJECTED_MATERIAL_UP_CAP_SNAP_EPSILON,
    PROJECTED_MOD_GAIN,
    PROJECTED_OBJECTIVE_FAMILIES,
    PROJECTED_OBJECTIVE_HIGH_INTL_RECORD,
    PROJECTED_OBJECTIVE_MATERIAL_WEIGHT,
    PROJECTED_OBJECTIVE_MIN_COVERAGE,
    PROJECTED_OBJECTIVE_MIN_INDEX,
    PROJECTED_OBJECTIVE_PRIORITY_NATION_IDS,
    AgeConditionalQuantiles,
    _age_at,
    _league_score,
    _projected_active_stature_cap,
    _projected_factual_context_by_card,
    _projected_modulation,
    _projected_objective_record_weight,
    _projected_raw_score,
    career_coverage,
)
from .rating_2026_io import (  # noqa: F401 - private helpers remain part of rating_2026.py's test surface
    _empirical_percentile,
    _historical_raw_only_internal,
    _load_career_stature,
    _raw_only_quantile_map,
)

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"

# Distinct version anchor — a projected rating is a different algorithm from
# wc-perf and must be replay-anchored separately. Team2026.rating_version must
# equal this. MV2-5 (merit-v2): projected 2026 ratings reconcile onto the career-
# stature scale for linked-material players → proj-career-3.0.0.
# proj-career-5.6.0 (merit-v4.6): manual owner override display targets are
# curve-inverted back onto the natural internal score scale before sim channels
# materialize; display pins remain exact.
# proj-career-5.5.0 (merit-v4.5): conservative recovery of 2026 rows among the
# previously-unresolved merit-v4.3 owner set. Recovered rows use the same
# Career+Current authoritative pin as v4.3; v4.4 current-only pins still
# supersede the current basis on overlap.
# proj-career-5.4.0 (merit-v4.4): owner re-rate of the 85–90 CURRENT-basis band.
# 2026 cards in the file are pinned on the CURRENT basis ONLY; the Career/default
# projected overall, team aggregates, and top-level sim channels are UNTOUCHED.
# On overlap with v4.3 the v4.4 current target supersedes v4.3's current pin.
# proj-career-5.3.0 (merit-v4.3): owner-authored manual rating overrides are
# resolved to canonical WC-2026 cards and applied as the same authoritative
# internal-score pin used by historical ratings. Best-XI selection, team
# aggregates, display overall, and sim channels all consume the pinned score.
# proj-career-5.2.0 (merit-v4.2): projected raw-only rows use the same public
# factual context allocation as historical ratings, applying caps/goals/club
# nation inside raw-only plateaus without lifting any row above the existing
# ceiling.
# proj-career-5.1.0 (merit-v4.1): reduces the league-of-employment prior from a
# dominant pre-tournament anchor to a smoother quality input and adds a 2026-only
# objective-record pathway for citation-backed active-career standouts. The
# completed-career all-time material gate remains unchanged in rating.py.
# proj-career-5.0.0 (merit-v4): projected ratings consume the same
# career-stature-4.0.0 source-curation update as historical ratings; the
# projected formula itself is unchanged.
# proj-career-4.0.0 (merit-v3 V3, design §2): D1 age-conditional quantile curves
# replace the all-age caps/goals percentiles (age_factor RETIRED — keeping both
# would re-create the youth double penalty), the stature seam consults the
# career-stature-3.0.0 person-identity rows for linked AND minted cards, the
# MV2-5 cross-era quantile map is re-derived against the wc-perf-5.0.0 raw-only
# distribution, and rows emit the additive Career/Current dual-basis payload.
RATING_VERSION = "proj-career-5.6.0"

PROVENANCE = "projected_career"
COVERAGE_BASIS = "career_signals"

def _build_internal_rows(
    cards: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
    historical_raw_only_internal: list[float] | None = None,
    national_strength_by_key: dict[tuple[str, str], dict] | None = None,
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
    factual_context_by_card = _projected_factual_context_by_card(cards)

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
        base_weight = _stature_model_weight(cs)
        weight = _projected_objective_record_weight(cs, base_weight, c["nation_id"])
        ref = _projected_ref(pos, s["projected_raw"])
        if cs is not None:
            index = cs["career_stature_index"]
            tier = cs.get("stature_tier")
            target = _stature_target(pos, index)
            modulation = _projected_modulation(s["projected_raw"], ref, pos, tier, weight)
            uncapped_stature_path = _clamp01(target + modulation)
            active_stature_cap = _projected_active_stature_cap(cs)
            stature_path = (
                min(uncapped_stature_path, active_stature_cap)
                if active_stature_cap is not None
                else uncapped_stature_path
            )
        else:
            target = None
            modulation = 0.0
            uncapped_stature_path = 0.0
            active_stature_cap = None
            stature_path = 0.0
        s["link_status"] = link_status
        s["cs"] = cs
        s["base_weight"] = base_weight
        s["weight"] = weight
        s["ref"] = ref
        s["target"] = target
        s["modulation"] = modulation
        s["uncapped_stature_path"] = uncapped_stature_path
        s["active_stature_cap"] = active_stature_cap
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
        strength_row = rating._national_strength_row(national_strength_by_key, c)
        national_raw_only_ceiling = (
            strength_row["raw_only_ceiling"]
            if strength_row is not None
            else RAW_ONLY_GLOBAL_CEILING
        )
        raw_only_ceiling = national_raw_only_ceiling if has_any_material else 1.0
        if cohort_material:
            raw_only_ceiling = min(raw_only_ceiling, _quantile(sorted(cohort_material), 0.5))
        mapped_raw = _raw_only_quantile_map(
            raw, raw_only_cohort_sorted, historical_raw_only_internal
        )
        raw_path = min(mapped_raw, raw_only_ceiling)
        factual_context = factual_context_by_card.get(c["card_id"], {})
        (
            raw_path,
            context_score,
            context_adjustment,
            context_window,
        ) = _context_adjusted_raw_only_score(
            raw_score=mapped_raw,
            raw_only_ceiling=raw_only_ceiling,
            raw_path=raw_path,
            context_score=factual_context.get("score"),
            material_weight=weight,
        )

        # Continuous blend: weight 0 ⇒ projected-raw-only, weight 1 ⇒ stature-dominant.
        final = _clamp01(weight * s["stature_path"] + (1.0 - weight) * raw_path)
        score_0_100 = 100.0 * final

        career_score_val = cs["career_stature_score"] if cs else None
        career_index_val = cs["career_stature_index"] if cs else None
        career_coverage_val = cs["coverage"] if cs else None

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
            {
                "signal": "raw_only_ceiling",
                "value": round(raw_only_ceiling, _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "raw_only_quantile_mapped_score",
                "value": round(mapped_raw, _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "raw_only_score",
                "value": round(raw_path, _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "factual_context_score",
                "value": (round(context_score, _PRECISION) if context_score is not None else None),
                "weight": 0.0,
            },
            {
                "signal": "factual_context_active_components",
                "value": factual_context.get("active_count"),
                "weight": 0.0,
            },
            {
                "signal": "factual_context_caps",
                "value": (
                    round(factual_context["caps"], _PRECISION)
                    if factual_context.get("caps") is not None
                    else None
                ),
                "weight": 0.0,
            },
            {
                "signal": "factual_context_intl_goals",
                "value": (
                    round(factual_context["intl_goals"], _PRECISION)
                    if factual_context.get("intl_goals") is not None
                    else None
                ),
                "weight": 0.0,
            },
            {
                "signal": "factual_context_league",
                "value": (
                    round(factual_context["league"], _PRECISION)
                    if factual_context.get("league") is not None
                    else None
                ),
                "weight": 0.0,
            },
            {
                "signal": "factual_context_adjustment",
                "value": round(context_adjustment, _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "factual_context_band",
                "value": round(context_window, _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "national_team_strength",
                "value": (
                    round(strength_row["strength"], _PRECISION)
                    if strength_row is not None
                    else None
                ),
                "weight": 0.0,
            },
            {
                "signal": "national_team_elo_rank",
                "value": strength_row["elo_global_rank"] if strength_row is not None else None,
                "weight": 0.0,
            },
            {
                "signal": "national_team_fifa_rank",
                "value": strength_row["fifa_rank"] if strength_row is not None else None,
                "weight": 0.0,
            },
            {
                "signal": "national_raw_only_ceiling_prior",
                "value": (
                    round(national_raw_only_ceiling, _PRECISION)
                    if strength_row is not None
                    else None
                ),
                "weight": 0.0,
            },
            {"signal": "career_stature_score", "value": career_score_val, "weight": 0.0},
            {"signal": "career_stature_index", "value": career_index_val, "weight": 0.0},
            {"signal": "career_stature_coverage", "value": career_coverage_val, "weight": 0.0},
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
            {
                "signal": "projected_active_stature_cap",
                "value": (
                    round(s["active_stature_cap"], _PRECISION)
                    if s["active_stature_cap"] is not None
                    else None
                ),
                "weight": 0.0,
            },
            {
                "signal": "projected_active_stature_cap_delta",
                "value": round(
                    max(0.0, s["uncapped_stature_path"] - s["stature_path"]),
                    _PRECISION,
                ),
                "weight": 0.0,
            },
            {
                "signal": "projected_objective_record_path",
                "value": 1.0 if weight > s["base_weight"] else 0.0,
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
    national_strength_by_key: dict[tuple[str, str], dict] | None = None,
    *,
    apply_manual_overrides: bool = True,
) -> list[dict]:
    """Pass 1, exposed for the acceptance suite — internal rows carrying the
    pre-display stature-scale ``score_0_100``, ``overall_basis``, ``legend``, and
    ``components``. Display (``overall``) is provisional until MV2-6, so MV2-5 tests
    assert on these INTERNAL rows, not the materialized display band.

    ``historical_raw_only_internal`` (the quantile-map target) defaults to the
    committed ``ratings.json`` raw-only distribution under ``output_dir``."""
    if historical_raw_only_internal is None:
        historical_raw_only_internal = _historical_raw_only_internal(output_dir)
    if national_strength_by_key is None:
        national_strength_by_key = national_strength.load_by_key(output_dir)
    internal_rows = _build_internal_rows(
        cards,
        career_stature_by_player,
        historical_raw_only_internal,
        national_strength_by_key,
    )
    if apply_manual_overrides:
        manual_overrides.apply_to_internal_rows(internal_rows, output_dir)
    return internal_rows


def build_ratings(
    cards: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
    historical_raw_only_internal: list[float] | None = None,
    output_dir: Path = OUTPUT_DIR,
    curve=None,
    internal_rows: list[dict] | None = None,
    national_strength_by_key: dict[tuple[str, str], dict] | None = None,
    apply_manual_overrides: bool = True,
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
    if national_strength_by_key is None:
        national_strength_by_key = national_strength.load_by_key(output_dir)
    if internal_rows is None:
        internal_rows = build_internal_view(
            cards,
            career_stature_by_player,
            historical_raw_only_internal,
            output_dir,
            national_strength_by_key,
            apply_manual_overrides=apply_manual_overrides,
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
        manual_career = manual_overrides.manual_overall(row)
        overall = (
            manual_career
            if manual_career is not None
            else _display_score(s, curve, estimate=estimate)
        )
        current_s = row["current_score_0_100"]
        manual_current = manual_overrides.manual_current_overall(row)
        current_overall = (
            manual_current
            if manual_current is not None
            else _display_score(current_s, curve, estimate=False)
        )
        channels = {
            # DECOUPLED CHANNELS — see rating.py for rationale. Sim channels stay on
            # the pre-recal [FLOOR_CHANNEL, 100] band so the engine's λ stays calibrated.
            ch: _channel(s, CHANNEL_SPREAD[pos][ch])
            for ch in CHANNELS
        }
        current_channels = {ch: _channel(current_s, CHANNEL_SPREAD[pos][ch]) for ch in CHANNELS}
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
    return build_ratings(
        cards,
        career,
        historical_raw_only,
        output_dir,
        national_strength_by_key=national_strength.load_by_key(output_dir),
    )

def render_merit_v2_sample_2026(
    internal_rows: list[dict],
    cards: list[dict],
    name_of: dict[str, str],
) -> str:
    from .rating_2026_reports import render_merit_v2_sample_2026 as _impl

    return _impl(internal_rows, cards, name_of, rating_version=RATING_VERSION)


def render_merit_v2_sample_full(output_dir: Path = OUTPUT_DIR) -> str:
    from .rating_2026_reports import render_merit_v2_sample_full as _impl

    return _impl(output_dir)


def write_merit_v2_sample(output_dir: Path = OUTPUT_DIR) -> str:
    from .rating_2026_reports import write_merit_v2_sample as _impl

    return _impl(output_dir)
