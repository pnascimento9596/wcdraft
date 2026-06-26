// Public API surface for the narrative layer (WS-E).
//
// The contract function `deriveNarrativeFacts` is now IMPLEMENTED (it was a
// throwing stub in WS-0b). The implementation lives in `../narrative/*`; this
// module re-exports it together with the rest of the narrative public surface
// (template selection, token resolution, full-narrative assembly).
//
// DETERMINISM / NO RUNTIME LLM: every export here is a pure function over the
// RunResult + MatchResults (+ optional display labels). Template selection
// threads the run's narrative SUB-SEED (`deriveSubseed(run.seed, "narrative")`)
// — never a fresh RNG — and draws from a STATIC, pre-authored template bank.

import type { MatchResult } from "../types/sim.js";
import type { NarrativeFacts } from "../types/narrative.js";
import type { RunResult } from "../types/run.js";
import type { NarrativeFactsOptions } from "../narrative/facts.js";

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
 *    `RunResult.narrative.narrative_seed`. The reducer DERIVES the seed via
 *    this helper; never via a fresh RNG.
 *
 * DETERMINISM CONTRACT:
 *  - The `narrative_seed` on the returned facts equals
 *    `deriveSubseed(run.seed, "narrative")`.
 *  - A given (run, matches) → byte-identical `NarrativeFacts`.
 *  - Selection of KeyMoments reads typed `MatchEvent` variants,
 *    `MatchResult.shootout`, `MatchResult.round`, and the
 *    `MatchEvent.score_after` field carried on goal-type variants — never a
 *    removed `counts_for_top_scorer` flag or a stringly-typed `detail` field.
 */
export type DeriveNarrativeFactsFn = (
  run: RunResult,
  matches: MatchResult[],
  options?: NarrativeFactsOptions,
) => NarrativeFacts;

export { deriveNarrativeFacts } from "../narrative/facts.js";
export type { NarrativeFactsOptions } from "../narrative/facts.js";
export {
  NARRATIVE_TEMPLATES,
  templatesForClass,
  templatesForScenarioFamily,
  classifyOutcome,
} from "../narrative/templates.js";
export {
  resolveNarrativeTokens,
  fillTemplate,
  headlineMoment,
  UNAVAILABLE_TOKEN_TEXT,
} from "../narrative/tokens.js";
export { selectNarrativeTemplate, buildNarrative } from "../narrative/select.js";
