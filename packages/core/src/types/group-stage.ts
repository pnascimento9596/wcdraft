// I3.3 — group-stage result types.
//
// `runTournamentFull` now returns an additive `group_stage: GroupStageResult`
// alongside the existing `{ run, matches }`. The shape is deliberately small:
//   - `standings` is the user's scoped 4-team table after the full group, with
//     deterministic tiebreakers applied.
//   - `other_matches` are aggregate-vs-aggregate REDUCED summaries (NOT full
//     `MatchResult`s) for the three intra-opponent group games. They feed only
//     the table — never `RunResult.matches`, `player_stats`, top scorer, etc.
//   - `user_qualified` is the authoritative gate; `MatchResult.advanced` on
//     group matches stays `false` (group matches don't "advance" structurally).
//
// HONEST-STATE: no nulls coerced to 0; counts come from real match summaries.

import type { GroupId } from "./primitives.js";

/**
 * Stable sentinel ID for the user XI inside a `GroupStanding`. The user is not
 * a `Team2026` so it does not have a `team_id` — this literal lets schemas
 * enforce "exactly one user standing per group" cleanly.
 */
export const USER_GROUP_PARTICIPANT_ID = "__USER__" as const;

/** Discriminator for a `GroupStanding` row. */
export type GroupParticipantKind = "user" | "team";

/**
 * Qualification outcome for the user XI:
 *   - `top_two`               → finished 1st or 2nd; auto-qualifies.
 *   - `best_third_threshold`  → finished 3rd and met the best-third points
 *                                threshold (ruleset_version-anchored).
 *   - `eliminated`            → otherwise.
 */
export type GroupQualification = "top_two" | "best_third_threshold" | "eliminated";

/**
 * One row of the user's scoped group table.
 *
 * INVARIANTS (enforced by the schema):
 *   - `played === wins + draws + losses` (always 3 for a completed group).
 *   - `goal_difference === goals_for - goals_against`.
 *   - `points === wins * 3 + draws`.
 *   - `rank` is in `1..4` and the four rows collectively cover `[1,2,3,4]`.
 *   - `draw_lots_rank` is in `1..4`; values across the four rows are unique.
 */
export interface GroupStanding {
  /** Final rank within the group after all tiebreakers (1..4). */
  rank: number;
  /**
   * `USER_GROUP_PARTICIPANT_ID` for the user XI; the `Team2026.team_id` for
   * each opponent. Stable across the table.
   */
  participant_id: string;
  kind: GroupParticipantKind;
  /** `team_id` when `kind === "team"`; `null` for the user row. */
  team_id: string | null;

  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;

  /**
   * Deterministic seeded draw-lots order in `1..4`. Lower wins only when ALL
   * preceding tiebreakers (points → GD → GF → H2H points → H2H GD) leave a
   * still-tied bucket. Sourced from `deriveSubseed(seed, "group_table")`.
   */
  draw_lots_rank: number;
}

/**
 * Reduced summary of one intra-opponent (Team2026 vs Team2026) group match.
 * NOT a `MatchResult` — feeds the table only and is not returned in
 * `RunResult.matches`. Identifies sides as `team_a` (sim "user" side) and
 * `team_b` (sim "opp" side) so the implementation can map sim outputs cleanly.
 */
export interface GroupOtherMatchSummary {
  /** 0..2 — fixed pair index in the canonical pairing order. */
  other_match_index: number;
  /** `${runId}.group-other.${index}` — unique per run. */
  match_id: string;
  /** Same round labels as user matches. Used for tiebreaker H2H lookups. */
  round: "G1" | "G2" | "G3";

  team_a_id: string;
  team_b_id: string;

  team_a_goals: number;
  team_b_goals: number;

  /** Sporting outcome of the match. `A` = team_a win, `B` = team_b win. */
  outcome: "A" | "D" | "B";
}

/**
 * Authoritative additive result of the user's group stage. Returned alongside
 * `{ run, matches }` from `runTournamentFull` (NOT embedded in `RunResult`).
 */
export interface GroupStageResult {
  group_id: GroupId;
  /** Length 4, sorted ascending by `rank`. */
  standings: GroupStanding[];
  /** User's final rank in `1..4`. */
  user_rank: number;
  /** True iff the user advances into R32. */
  user_qualified: boolean;
  /** Detailed qualification reason. */
  qualification: GroupQualification;
  /** The three intra-opponent match summaries. Length 3. */
  other_matches: GroupOtherMatchSummary[];
}
