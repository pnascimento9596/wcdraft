// Narrative layer of the wcdraft data contract.
//
// CONTRACT SHAPE ONLY. The narrative engine itself (template selection, prose
// generation, etc.) lands in WS-E. This file defines:
//   - the `NarrativeFacts` shape that `deriveNarrativeFacts` returns from a
//     RunResult + the underlying MatchResults, and
//   - the eventual `RunResult.narrative` payload pointer.
//
// DETERMINISM CONTRACT: narrative selection threads a SUB-SEED derived from
// the run seed via `deriveSubseed(run.seed, "narrative")` — it MUST NOT
// instantiate a fresh RNG. The sub-seed is part of the NARRATIVE substream
// (distinct from draft / match_sim / event_gen / opponent_selection
// substreams). The same seed lineage is persisted on
// `RunResult.narrative.narrative_seed` so a leaderboard re-derivation can
// reproduce template selection byte-for-byte.

import type { MatchRound } from "./primitives.js";

/**
 * A single in-event moment of dramatic weight — the building block for late
 * winners, equalizers, comeback runs, etc.
 *
 * The set of `kind` values mirrors the moments the narrative templates ever
 * need to reach for. Add cautiously — every new kind is a contract change.
 */
export type KeyMoment = {
  /** Discrete moment taxonomy. */
  kind:
    | "late_winner"
    | "stoppage_winner"
    | "early_lead"
    | "equalizer"
    | "comeback_win"
    | "shootout_win"
    | "shootout_loss"
    | "shock_loss"
    | "thrashing"
    | "red_card_swing"
    | "missed_penalty";
  /** Which match this moment belongs to. */
  match_id: string;
  /** Round the moment occurred in (group or knockout). */
  round: MatchRound;
  /** Period + minute snapshot from the underlying event. */
  period: "1H" | "2H" | "ET1" | "ET2" | "shootout";
  minute: number;
  /** Primary actor (scorer / sender-off / shootout taker). */
  player_id: string | null;
  /** Secondary actor for paired events (e.g. assister, defender beaten). */
  secondary_player_id: string | null;
  /** Score after the moment, mirrored from the underlying MatchEvent. */
  score_after: { user: number; opp: number } | null;
};

/**
 * Derived narrative facts. Everything here is derivable from the RunResult +
 * MatchResults — `deriveNarrativeFacts` is the canonical reducer; templates
 * never look directly at MatchEvents.
 *
 * `villain_player_id` is the opposition player with the most "harm done"
 * across the run (most goals, then most assists, then earliest involvement) —
 * exact tiebreak rules live in WS-E once template needs are settled.
 */
export interface NarrativeFacts {
  /** Reached round (final achievement). */
  reached_round: MatchRound;
  /** True for the run that wins the whole tournament. */
  is_champion: boolean;
  /** True for an undefeated REGULATION run (no shootouts needed). */
  undefeated_regulation: boolean;
  /** User-side hero (own top scorer across the run); null when nobody scored. */
  hero_player_id: string | null;
  /**
   * User-side top scorer in the FINAL specifically; null when no final was
   * played or nobody scored a counting goal in it. Distinct from
   * `hero_player_id` (the run-wide top scorer) so the {FINAL_HERO} token can
   * crown the player who decided the title match.
   */
  final_hero_player_id: string | null;
  /** Opposition villain — highest cumulative harm against the user XI; null when none. */
  villain_player_id: string | null;
  /**
   * Team id of the opponent most associated with the run's defining match —
   * the final opponent for a champion / finalist, otherwise the opponent in
   * the elimination match. Null when there is no such match. Source for the
   * {OPPONENT} token; the {VILLAIN} token resolves a PLAYER, this a TEAM.
   */
  nemesis_team_id: string | null;
  /** Match in which the user was eliminated; null if the user won the tournament. */
  eliminated_in_match_id: string | null;
  /** Dramatic moments in chronological order. */
  key_moments: KeyMoment[];
  /**
   * Narrative sub-seed used by template selection. MUST equal
   * `deriveSubseed(run.seed, "narrative")` and is persisted as
   * `RunResult.narrative.narrative_seed`. NEVER a fresh RNG — see file header.
   */
  narrative_seed: string;
}

/**
 * Coarse classification of how a run ended. Every run maps to exactly ONE
 * outcome class, and each class owns a bank of pre-authored templates. The
 * class is the FIRST selection axis (the sub-seed only chooses a variant
 * WITHIN the class), so a champion run never reaches for a group-exit
 * template and vice-versa.
 *
 * Derivation (see `classifyOutcome`):
 *   - CHAMPION_UNDEFEATED — won the trophy with a clean 8-0 (no draws, no
 *     losses, no shootouts; `undefeated_regulation === true`).
 *   - CHAMPION_WITH_DRAWS — won the trophy but dropped points along the way
 *     (a draw and/or a shootout was needed somewhere on the path).
 *   - FINAL_LOSS — reached the final and lost it.
 *   - SF_EXIT / QF_EXIT / R16_EXIT / R32_EXIT — eliminated in that knockout
 *     round.
 *   - GROUP_EXIT — did not escape the group, but won at least one group game.
 *   - GROUP_WINLESS — did not escape the group with zero wins.
 */
export type OutcomeClass =
  | "CHAMPION_UNDEFEATED"
  | "CHAMPION_WITH_DRAWS"
  | "FINAL_LOSS"
  | "SF_EXIT"
  | "QF_EXIT"
  | "R16_EXIT"
  | "R32_EXIT"
  | "GROUP_EXIT"
  | "GROUP_WINLESS";

/**
 * The named tokens a template may interpolate. Each resolves DETERMINISTICALLY
 * from `(RunResult, MatchResult[])` plus an optional display-label map — never
 * from a runtime model and never invented. A token with no source resolves to
 * `null` (honest-state) and renders as the `UNAVAILABLE_TOKEN_TEXT` sentinel.
 *
 *   - TEAM_NAME    — the user's squad/team display name (label-only; the core
 *                    contract has no user team entity, so without a label this
 *                    is always Unavailable).
 *   - MANAGER      — the user's drafted manager display name (label-only).
 *   - TOP_SCORER   — run top scorer (`hero_player_id`).
 *   - FINAL_HERO   — top scorer in the final (`final_hero_player_id`).
 *   - VILLAIN      — opposition villain player (`villain_player_id`).
 *   - OPPONENT     — defining-match opponent team (`nemesis_team_id`).
 *   - KEY_MOMENT   — a phrase describing the run's headline `KeyMoment`.
 *   - RECORD       — the run's display record (e.g. "8-0"); always available.
 */
export type TokenName =
  | "TEAM_NAME"
  | "MANAGER"
  | "TOP_SCORER"
  | "FINAL_HERO"
  | "VILLAIN"
  | "OPPONENT"
  | "KEY_MOMENT"
  | "RECORD";

/**
 * Optional display-label overrides supplied by a caller (e.g. the UI layer)
 * so player/team/manager IDs render as human names. ENTIRELY OPTIONAL: the
 * core contract resolves every token from the event log alone, falling back to
 * the raw id (a real, event-derived value — never a guess) when no label is
 * supplied. Labels never CHANGE which entity a token resolves to; they only
 * change how that entity is DISPLAYED.
 */
export interface NarrativeLabels {
  /** The user's squad/team display name. No id source exists in the contract. */
  team_name?: string | null;
  /** The user's manager display name. No id source exists in the contract. */
  manager_name?: string | null;
  /** player_id → display name. Missing ids fall back to the raw player_id. */
  player_names?: Readonly<Record<string, string>>;
  /** team_id → display name. Missing ids fall back to the raw team_id. */
  team_names?: Readonly<Record<string, string>>;
}

/**
 * One pre-authored narrative template. STATIC DATA — the prose is authored
 * offline (drafted with AI assistance, then committed as data); there is NO
 * runtime language model in the selection or fill path.
 *
 * `text` carries `{TOKEN}` placeholders drawn from `TokenName`. Selection is
 * keyed on `outcome_class`; the run's narrative sub-seed only chooses among
 * the variants that share the class.
 */
export interface NarrativeTemplate {
  /** Stable id, persisted on `RunResult.narrative.template_id`. */
  id: string;
  /** The outcome class this template belongs to. */
  outcome_class: OutcomeClass;
  /** Prose with `{TOKEN}` placeholders. */
  text: string;
}
