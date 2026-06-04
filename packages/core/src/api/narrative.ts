// Function signatures for the narrative layer.
//
// CONTRACT-ONLY: implementation lands in WS-E. The runtime stub throws.

import type { MatchResult } from "../types/sim.js";
import type { NarrativeFacts } from "../types/narrative.js";
import type { RunResult } from "../types/run.js";

/**
 * Derive narrative facts from a RunResult + the underlying MatchResults.
 *
 * Inputs are EVENTS — never stored summaries — so any drift between an event
 * stream and a derived summary surfaces here at narrative time rather than
 * silently corrupting the report card.
 *
 * DETERMINISM CONTRACT:
 *  - The `narrative_seed` on the returned facts is DERIVED from the run seed
 *    and MUST be reproducible (`run` + `matches` → same `narrative_seed`).
 *  - A given (run, matches) → byte-identical `NarrativeFacts`.
 *  - The function selects KeyMoments by reading MatchEvent.side,
 *    MatchEvent.score_after, MatchResult.round, and MatchResult.shootout.
 *    It never instantiates a fresh RNG.
 */
export type DeriveNarrativeFactsFn = (run: RunResult, matches: MatchResult[]) => NarrativeFacts;

/**
 * Runtime stub for `deriveNarrativeFacts`. WS-E replaces this body.
 */
export const deriveNarrativeFacts: DeriveNarrativeFactsFn = () => {
  throw new Error("deriveNarrativeFacts is contract-only in WS-0b; the algorithm lands in WS-E.");
};
