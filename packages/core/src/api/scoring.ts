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
 * DETERMINISM CONTRACT:
 *  - `score = sum(breakdown[i].points)` — the engine MUST enforce this equality
 *    so the UI can show a tally that exactly sums to the stored score.
 *  - Same (run, cfg) → byte-identical (score, breakdown).
 */
export type ComputeScoreFn = (
  run: RunResult,
  cfg: ScoringConfig,
) => { score: number; breakdown: ScoreComponent[] };

/**
 * Resolve the run top-scorer from the MATCH EVENTS — events are the source of
 * truth; no summary field is read.
 *
 * RULES (locked here as part of the contract; tests in `top-scorer.golden.test.ts`):
 *  - Count: events where `counts_for_top_scorer === true`.
 *    This means open-play goals + IN-MATCH penalties scored.
 *  - EXCLUDE: `own_goal` (scorer of an OG never wins TS) and `shootout_score`
 *    (shootout pens never win TS).
 *  - TIEBREAKS, in order:
 *      1. Most counting goals.
 *      2. Fewest minutes played across the run.
 *      3. Lowest `player_id` lexicographically.
 *  - Returns `null` IFF nobody on the user side scored a counting goal.
 */
export type ResolveTopScorerFn = (matches: MatchResult[]) => string | null;

/**
 * Runtime stub for `computeScore`. WS-B replaces this body.
 */
export const computeScore: ComputeScoreFn = () => {
  throw new Error("computeScore is contract-only in WS-0b; the algorithm lands in WS-B.");
};

/**
 * Runtime stub for `resolveTopScorer`. WS-B replaces this body.
 */
export const resolveTopScorer: ResolveTopScorerFn = () => {
  throw new Error("resolveTopScorer is contract-only in WS-0b; the algorithm lands in WS-B.");
};
