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

from pathlib import Path

from . import manual_overrides, national_strength
from .rating_components import (  # noqa: F401 - private helpers remain part of rating.py's test surface
    _PRECISION,
    AWARD_WEIGHT,
    BASE_CEILING,
    BASE_WEIGHTS,
    CHANNEL_SPREAD,
    CHANNELS,
    COARSE_POSITIONS,
    COHORT_MIN_N,
    FINISH_PARTICIPATION_FLOOR,
    FINISH_POINTS,
    FINISH_WEIGHT,
    FLOOR_CHANNEL,
    MATERIAL_STATURE_MIN_COVERAGE,
    MATERIAL_STATURE_MIN_INDEX,
    RAW_ONLY_GLOBAL_CEILING,
    REPLACEMENT_BASE,
    STATURE_DOMINANT_WEIGHT,
    TOURNAMENT_DOWN_CAP,
    TOURNAMENT_UP_CAP,
    _active_component_names,
    _award_score,
    _channel,
    _clamp01,
    _coarse_pos,
    _context_adjusted_raw_only_score,
    _historical_factual_context_by_card,
    _national_strength_row,
    _participation_factor,
    _percentile_map,
    _ramp01,
    _raw_only_score,
    _renormalized_context_score,
    _stature_model_weight,
    _stature_participation_context,
    _stature_target,
    _thresholded_log_component,
    _tournament_modulation,
)
from .rating_display import (  # noqa: F401 - private helpers remain part of rating.py's test surface
    DISPLAY_CURVE_KIND,
    DISPLAY_FLOOR,
    DISPLAY_HIGH_EXPONENT,
    DISPLAY_LOW_EXPONENT,
    DISPLAY_MAX,
    DISPLAY_MEDIAN,
    DISPLAY_MID_EXPONENT,
    DISPLAY_P95,
    ESTIMATE_CEILING,
    ESTIMATE_FLOOR,
    DisplayCurve,
    _display_score,
    _display_value,
    _fit_display_curve,
    _quantile,
)
from .rating_io import (  # noqa: F401 - private helpers remain part of rating.py's test surface
    _career_stature_rating_version,
    _json_text,
    _load,
    _load_career_stature,
    _write_json,
)
from .rating_io import (
    _write_ratings_with_lock as _write_ratings_with_lock_impl,
)

# Anchored to the package location (etl/src/wcdraft_etl/ -> etl/output) so the
# stage reads/writes the same place regardless of the caller's cwd. Mirrors
# pipeline.OUTPUT_DIR.
OUTPUT_DIR = Path(__file__).resolve().parents[2] / "output"

# Rating-algorithm version anchor — one of the three replay anchors in the core
# contract. Bump on ANY change to weights, normalization, or channel mapping;
# the golden git-diff guard will force the committed ratings.json to move with it.
# wc-perf-6.5.0 (merit-v4.5): conservative recovery of 46 previously-unresolved
# merit-v4.3 owner rows. Recovered rows are folded into the same Career+Current
# authoritative pin and canonical duplicate-average contract as v4.3; v4.4
# current-only pins still supersede the current basis on overlap.
# wc-perf-6.4.0 (merit-v4.4): owner re-rate of the 85–90 CURRENT-basis band layered
# on v4.3. v4.4 pins the CURRENT basis ONLY (current_score_0_100); the career
# score_0_100, the default/Career display overall, and the top-level sim channels
# are UNTOUCHED — historical legends keep their all-time 95–99. On a card named by
# both, the v4.4 current target supersedes v4.3's current pin while v4.3's career
# pin remains. See etl/overrides/manual-ratings-v4.4.csv + manual_overrides.py.
# wc-perf-6.3.0 (merit-v4.3): owner-authored manual rating overrides are resolved
# to canonical card_id and applied as an authoritative post-merit internal-score
# pin. For resolved rows, score_0_100/current_score_0_100, display overall, and
# sim channels all move from the same target value; non-overridden rows keep the
# base merit-v4.2 numeric score/curve behavior.
# wc-perf-6.2.0 (merit-v4.2): historical raw-only rows consume resolved public
# squad-list facts (caps, international goals when available, club league, and
# tournament role) to allocate within raw-only plateaus; the display floor widens
# to 60 so weak-squad differences remain visible instead of rounding into filler
# walls. Stature/award rows remain protected by their existing gates.
# wc-perf-6.1.0 (merit-v4.1): historical ratings consume career-stature-4.1.0
# active objective-achievement curation; the historical formula itself is
# unchanged, but the replay anchor moves with the source-derived table.
# wc-perf-6.0.0 (merit-v4): historical ratings consume national-strength
# contextual ceilings plus the career-stature-4.0.0 curation update. W1/W2/W2b
# source-derived stature facts
# move ratings through the existing formula; W3 made no rating-formula change
# because the requested global pile-up gate is documented as incompatible.
# wc-perf-5.0.0 (merit-v3 V2): historical ratings consume the full
# career-stature-3.0.0 table, replace the raw-only hard clamp with award-gated
# soft headroom, scale weak-tournament stature modulation and team-finish credit
# by participation evidence, and emit additive Career/Current basis material for
# the future runtime-data-2.0.0 unit. The top-level row remains the Career
# compatibility surface until compact/runtime consumers are changed in V6.
# wc-perf-4.2.0 (MV2-6): the display `overall` is now reshaped by the UNIFIED
# pooled display curve (`display_curve.fit_unified_curve`) — ONE monotonic curve
# fit over the combined historical + 2026 internal distribution and applied
# identically to BOTH eras. Channels/internal merit math are UNCHANGED; this is a
# display-`overall`-only bump (the same shared curve also maps 2026 — see
# rating_2026, which keeps its own internal-algorithm anchor proj-career-3.0.0).
RATING_VERSION = "wc-perf-6.5.0"







def _build_internal_rows(
    players: list[dict],
    cards: list[dict],
    tournaments: list[dict],
    manager_tournaments: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
    national_strength_by_key: dict[tuple[str, str], dict] | None = None,
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
    factual_context_by_card = _historical_factual_context_by_card(mens_cards, position_of_player)

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
        finish_participation = _participation_factor(c["appearances"], a_pct)
        stature_participation = _stature_participation_context(c["appearances"], a_pct)
        effective_finish_pts = (
            round(finish_pts * finish_participation, _PRECISION) if finish_pts is not None else None
        )
        legacy_anchor = AWARD_WEIGHT[pos] * award_score + FINISH_WEIGHT[pos] * (
            0.0 if finish_pts is None else finish_pts
        )
        anchor = AWARD_WEIGHT[pos] * award_score + FINISH_WEIGHT[pos] * (
            0.0 if effective_finish_pts is None else effective_finish_pts
        )

        legacy_raw_tournament_score = _clamp01(base + legacy_anchor)
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
                "effective_finish_pts": effective_finish_pts,
                "finish_participation": finish_participation,
                "stature_participation": stature_participation,
                "has_individual_signal": has_individual_signal,
                "legacy_raw_tournament_score": legacy_raw_tournament_score,
                "raw_tournament_score": raw_tournament_score,
            }
        )

    # ── PASS 1b: cohort reference medians ──────────────────────────────────────
    # tournament_ref = median raw_tournament_score for (tournament_id, pos) when the
    # cohort is large enough; else the (pos) cross-tournament median; else the card's
    # own raw (→ delta 0, no modulation).
    ref_cohort = {
        k: _quantile(sorted(v), 0.5) for k, v in raw_by_cohort.items() if len(v) >= COHORT_MIN_N
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
                s["raw_tournament_score"],
                ref,
                pos,
                tier,
                s["stature_participation"],
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
            material_finals_by_cohort.setdefault((c["tournament_id"], pos), []).append(stature_path)

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
        strength_row = _national_strength_row(national_strength_by_key, c)
        national_raw_only_ceiling = (
            strength_row["raw_only_ceiling"]
            if strength_row is not None
            else RAW_ONLY_GLOBAL_CEILING
        )
        raw_only_ceiling = national_raw_only_ceiling if has_any_material else 1.0
        if cohort_material:
            raw_only_ceiling = min(raw_only_ceiling, _quantile(sorted(cohort_material), 0.5))
        raw_path = _raw_only_score(raw, raw_only_ceiling, s["award_score"])
        award_headroom = raw_path - min(raw, raw_only_ceiling)
        factual_context = factual_context_by_card.get(c["card_id"], {})
        (
            raw_path,
            context_score,
            context_adjustment,
            context_window,
        ) = _context_adjusted_raw_only_score(
            raw_score=raw,
            raw_only_ceiling=raw_only_ceiling,
            raw_path=raw_path,
            context_score=factual_context.get("score"),
            material_weight=weight,
            award_headroom=award_headroom,
        )

        # The continuous blend: weight 0 ⇒ raw-only, weight 1 ⇒ stature-dominant.
        final = _clamp01(weight * s["stature_path"] + (1.0 - weight) * raw_path)
        score_0_100 = 100.0 * final

        career_score_val = cs["career_stature_score"] if cs else None
        career_index_val = cs["career_stature_index"] if cs else None
        career_coverage = cs["coverage"] if cs else None

        # overall_basis split (stature-dominant model, wc-perf-4.x). The label reports
        # what actually DROVE the final score, not merely whether a tournament box
        # score exists. Under the continuity blend
        #     final = weight·stature_path + (1−weight)·raw_path
        # the stature path drives the score iff weight ≥ STATURE_DOMINANT_WEIGHT.
        # That is the SAME ramp threshold the rest of the model uses to admit a card
        # into the elite stature band and to apply the raw-only ceiling — keying the
        # basis label on it is the one principled choice.
        #
        # The previous gate used a stricter `is_material_elite` predicate (career
        # index ≥ 0.50) that was strictly TIGHTER than the v4 ramp's dominance
        # threshold (index ≥ MATERIAL_STATURE_MIN_INDEX = 0.40, since weight = 1.0
        # at index ≥ MIN + HALF_WIDTH = 0.46). A no-signal card with index in
        # [0.40, 0.50) had stature dominate its score but was mislabeled
        # baseline_anchor_estimate and display-capped into [66,73] — see
        # Sepp Maier P-14080:WC-1966 (index 0.446, weight 0.881, score_0_100 62.2,
        # displayed 73 vs measured-channel peers 1970/74/78 at 88).
        #
        #   baseline_anchor_estimate — no measured tournament signal AND stature
        #                              does NOT dominate (weight < threshold): the
        #                              display-capped [66,73] honest estimate.
        #   career_stature_estimate  — the stature path dominates the merit blend
        #                              (weight ≥ STATURE_DOMINANT_WEIGHT): the
        #                              final is primarily career stature, not
        #                              measured tournament performance. This is
        #                              the path that escapes the estimate cap and
        #                              reads the unified display curve directly.
        #   measured_performance     — a measured tournament signal exists and the
        #                              raw tournament path drives the final.
        if weight >= STATURE_DOMINANT_WEIGHT:
            overall_basis = "career_stature_estimate"
        elif not s["has_individual_signal"]:
            overall_basis = "baseline_anchor_estimate"
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
            {
                "signal": "finish_participation_factor",
                "value": round(s["finish_participation"], _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "effective_team_finish",
                "value": s["effective_finish_pts"],
                "weight": FINISH_WEIGHT[pos],
            },
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
                "signal": "legacy_raw_tournament_score",
                "value": round(s["legacy_raw_tournament_score"], _PRECISION),
                "weight": 0.0,
            },
            {
                "signal": "raw_only_ceiling",
                "value": round(raw_only_ceiling, _PRECISION),
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
            {
                "signal": "award_headroom",
                "value": round(award_headroom, _PRECISION),
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
                "signal": "factual_context_role",
                "value": (
                    round(factual_context["role"], _PRECISION)
                    if factual_context.get("role") is not None
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
                "signal": "stature_participation_context",
                "value": round(s["stature_participation"], _PRECISION),
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
                "current_score_0_100": 100.0 * raw_path,
                "raw_tournament_score_0_100": round(100.0 * raw, _PRECISION),
                "raw_only_score_0_100": round(100.0 * raw_path, _PRECISION),
                "overall_basis": overall_basis,
                "current_basis": (
                    "baseline_anchor_estimate"
                    if not s["has_individual_signal"]
                    else "measured_performance"
                ),
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
    national_strength_by_key: dict[tuple[str, str], dict] | None = None,
    *,
    output_dir: Path = OUTPUT_DIR,
    apply_manual_overrides: bool = True,
) -> tuple[list[dict], DisplayCurve]:
    """Pass 1 + curve fit, exposed for the §4 acceptance suite.

    Returns the internal rows (each carrying ``score_0_100``, ``overall_basis``,
    ``pos``, ``components``) AND the fitted ``DisplayCurve``. The acceptance
    tests use this to assert that ``overall`` is monotonic vs the pre-display
    composite for measured cards — the right curve invariant — without
    surrogate channel-vs-overall checks.
    """
    if national_strength_by_key is None:
        national_strength_by_key = national_strength.load_by_key(OUTPUT_DIR)
    internal = _build_internal_rows(
        players,
        cards,
        tournaments,
        manager_tournaments,
        career_stature_by_player,
        national_strength_by_key,
    )
    if apply_manual_overrides:
        manual_overrides.apply_to_internal_rows(internal, output_dir)
    curve = _fit_display_curve([r["score_0_100"] for r in internal])
    return internal, curve


def build_ratings(
    players: list[dict],
    cards: list[dict],
    tournaments: list[dict],
    manager_tournaments: list[dict],
    career_stature_by_player: dict[str, dict] | None = None,
    national_strength_by_key: dict[tuple[str, str], dict] | None = None,
    curve: DisplayCurve | None = None,
    *,
    output_dir: Path = OUTPUT_DIR,
    apply_manual_overrides: bool = True,
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
        players,
        cards,
        tournaments,
        manager_tournaments,
        career_stature_by_player,
        national_strength_by_key,
        output_dir=output_dir,
        apply_manual_overrides=apply_manual_overrides,
    )
    if curve is None:
        curve = display_curve.fit_unified_curve()
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
        current_estimate = row["current_basis"] == "baseline_anchor_estimate"
        manual_current = manual_overrides.manual_current_overall(row)
        current_overall = (
            manual_current
            if manual_current is not None
            else _display_score(current_s, curve, estimate=current_estimate)
        )
        # DECOUPLED CHANNELS (Phase 1.1, plan §3.2 fallback).
        # Sim channels stay on the pre-recal [FLOOR_CHANNEL, 100] band so the
        # ENGINE's λ stays calibrated and the symmetric coherent-XI control
        # lands inside the modern-era (1998-2022) WC norms — see
        # tests/realism/test_modern_wc_norms.py and the realism-norms fixture.
        # Only  (display-only) passes through the calibration curve;
        # the visible bars expose the merit channel values directly.
        channels = {ch: _channel(s, CHANNEL_SPREAD[pos][ch]) for ch in CHANNELS}
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
                # First-class factual legend flag, joined from career_stature.json
                # (missing row → False). MV2-7's compact builder reads THIS field;
                # it never re-derives the badge from overall >= 96.
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
        national_strength_by_key=national_strength.load_by_key(output_dir),
        curve=display_curve.fit_unified_curve(output_dir),
        output_dir=output_dir,
    )




def _write_ratings_with_lock(output_dir: Path, ratings: list[dict]) -> None:
    _write_ratings_with_lock_impl(output_dir, ratings, rating_version=RATING_VERSION)


def _render_merit_v2_sample(
    internal_rows: list[dict],
    ratings_by_card: dict[str, dict],
    players: list[dict],
    career_by_player: dict[str, dict],
) -> str:
    from .rating_reports import _render_merit_v2_sample as _impl

    return _impl(
        internal_rows,
        ratings_by_card,
        players,
        career_by_player,
        rating_version=RATING_VERSION,
    )


def render_merit_v2_sample(output_dir: Path = OUTPUT_DIR) -> str:
    from .rating_reports import render_merit_v2_sample as _impl

    return _impl(output_dir)


def run(output_dir: Path = OUTPUT_DIR) -> list[dict]:
    """Build ratings from the committed canonical tables and emit ratings.json.

    Deliberately does NOT write MERIT_V2_SAMPLE.md — the canonical 3-section
    sample is owned solely by ``rating_2026.write_merit_v2_sample`` (via
    ``ingest_2026.run``); see ``render_merit_v2_sample``."""
    ratings = build_all(output_dir)
    _write_ratings_with_lock(output_dir, ratings)
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
