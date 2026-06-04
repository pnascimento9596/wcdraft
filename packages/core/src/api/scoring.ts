// Function signatures for scoring + top-scorer derivation.
//
// CONTRACT-ONLY: implementations land in WS-B. Runtime stubs throw.

import type { MatchResult } from "../types/sim.js";
import type { RunResult } from "../types/run.js";
import type { ScoreComponent, ScoringConfig } from "../types/scoring.js";

/**
 * Compute the final leaderboard points + a transparent line-by-line breakdown
 * for a RunResult, under the given (versioned) scoring config.
 *
 * SELF-CONTAINMENT CONTRACT:
 *  - `computeScore` reads ONLY from `RunResult` and `ScoringConfig`. It never
 *    reaches back into raw `MatchResult[]`. The per-round multipliers consume
 *    `run.round_results`; the clean-sheet bonus consumes
 *    `run.aggregate.clean_sheets`; the discipline / offside / foul /
 *    missed-pen penalties consume `run.player_stats[*].totals`; the
 *    undefeated bonus consumes `run.undefeated_regulation`.
 *
 * DETERMINISM CONTRACT:
 *  - `score = sum(breakdown[i].points)` — the engine MUST enforce this equality
 *    so the UI can show a tally that exactly sums to the stored score.
 *  - Same (run, cfg) → byte-identical (score, breakdown). Because the inputs
 *    are entirely persisted on `RunResult`, the server can re-derive the
 *    score from the leaderboard submission without re-running the sim.
 */
export type ComputeScoreFn = (
  run: RunResult,
  cfg: ScoringConfig,
) => { score: number; breakdown: ScoreComponent[] };

/**
 * Resolve the run top-scorer from the MATCH EVENTS + per-match lineups —
 * events + `MatchResult.lineup` are the source of truth; no derived flag is
 * read.
 *
 * ELIGIBILITY (derived from atomic event variants — never stored on events):
 *   a `MatchEvent` counts toward top-scorer IFF:
 *     event.side === "user"
 *     && (event.type === "goal" || event.type === "pen_scored")
 *
 *   EXCLUSIONS (by event type, not by a stored flag):
 *     - own_goal     → never counts (scorer of an OG never wins TS)
 *     - shootout_kick → never counts (shootout pens never win TS)
 *     - pen_missed   → never counts
 *     - opposition events (`side === "opp"`) never count.
 *
 * TIEBREAKS, in order:
 *   1) Most counting goals.
 *   2) Fewest minutes played across the run (summed from `MatchLineupEntry`
 *      entries on the user side for this player across all `matches[*]`).
 *   3) Lowest `player_id` lexicographically (code-point order).
 *
 * Returns `null` IFF nobody on the user side scored a counting goal.
 *
 * `MatchResult.lineup` is the atomic source of `minutes` — the resolver MUST
 * NOT read `PlayerTournament.minutes` (that field does not exist; Fjelstul
 * has no minutes at any era).
 */
export type ResolveTopScorerFn = (matches: readonly MatchResult[]) => string | null;

// WS-B IMPLEMENTATIONS (engine bodies in `../engine/scoring.ts`).
import { computeScore as computeScoreImpl, resolveTopScorer as resolveTopScorerImpl } from "../engine/scoring.js";

/** Compute leaderboard points + transparent breakdown for a RunResult. */
export const computeScore: ComputeScoreFn = computeScoreImpl;

/** Resolve the user-side run top scorer from match events + lineups. */
export const resolveTopScorer: ResolveTopScorerFn = resolveTopScorerImpl;
