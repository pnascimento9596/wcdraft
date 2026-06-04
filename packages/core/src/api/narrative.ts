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
 * SEED LINEAGE:
 *  - `run.seed` is the master run seed.
 *  - `narrative_seed = deriveSubseed(run.seed, "narrative")` — persisted on
 *    `RunResult.narrative.narrative_seed`. The reducer MUST derive (or
 *    verify) the seed via this helper; never via a fresh RNG.
 *
 * DETERMINISM CONTRACT:
 *  - The `narrative_seed` on the returned facts MUST equal
 *    `deriveSubseed(run.seed, "narrative")`.
 *  - A given (run, matches) → byte-identical `NarrativeFacts`.
 *  - The function selects KeyMoments by reading typed `MatchEvent` variants,
 *    `MatchResult.shootout`, `MatchResult.round`, and the
 *    `MatchEvent.score_after` field carried on goal-type variants. It never
 *    reads a removed `counts_for_top_scorer` flag or a stringly-typed
 *    `detail` field — both are gone from the contract.
 */
export type DeriveNarrativeFactsFn = (run: RunResult, matches: MatchResult[]) => NarrativeFacts;

/**
 * Runtime stub for `deriveNarrativeFacts`. WS-E replaces this body.
 */
export const deriveNarrativeFacts: DeriveNarrativeFactsFn = () => {
  throw new Error("deriveNarrativeFacts is contract-only in WS-0b; the algorithm lands in WS-E.");
};
