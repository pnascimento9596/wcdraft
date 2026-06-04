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
  /** User-side hero (own top scorer); null when nobody scored. */
  hero_player_id: string | null;
  /** Opposition villain — highest cumulative harm against the user XI; null when none. */
  villain_player_id: string | null;
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
