// Template selection + narrative assembly.
//
// DETERMINISM: the outcome CLASS is derived from the run; the VARIANT within
// the class is chosen by an RNG seeded with the run's narrative SUB-SEED
// (`deriveSubseed(run.seed, "narrative")`, carried on the facts). The same
// (run, seed) → the same template → the same filled prose, byte-for-byte.
// There is NO runtime model: selection draws from the static template bank.

import { createRng } from "../rng.js";
import type { MatchResult } from "../types/sim.js";
import type { NarrativeFacts, NarrativeLabels, NarrativeTemplate } from "../types/narrative.js";
import type { RunResult } from "../types/run.js";
import { classifyOutcome, templatesForClass, templatesForScenarioFamily } from "./templates.js";
import { deriveNarrativeFacts } from "./facts.js";
import { fillTemplate, resolveNarrativeTokens } from "./tokens.js";

/**
 * Select the narrative template for a run. The outcome class fixes the bank;
 * the narrative sub-seed picks the variant. Pure and deterministic.
 *
 * `facts.narrative_seed` MUST be the run's narrative sub-seed (it is, when
 * `facts` comes from `deriveNarrativeFacts`) — selection threads THAT seed,
 * never a fresh RNG.
 */
export function selectNarrativeTemplate(run: RunResult, facts: NarrativeFacts): NarrativeTemplate {
  const outcome = classifyOutcome(run);
  for (const spotlight of facts.scenario_spotlights) {
    const bank = templatesForScenarioFamily(outcome, spotlight.family);
    if (bank.length > 0) {
      const rng = createRng(`${facts.narrative_seed}:scenario:${spotlight.family}`);
      return rng.pick(bank);
    }
  }
  const bank = templatesForClass(outcome);
  const rng = createRng(facts.narrative_seed);
  return rng.pick(bank);
}

/**
 * Assemble the full `RunResult.narrative` payload: derive facts, select a
 * template, resolve tokens (honest-state), and fill the prose.
 *
 * `labels` is optional display sugar; without it, tokens resolve from the
 * event log alone (ids fall back to themselves; absent sources render
 * "Unavailable"). The returned `narrative_seed` equals
 * `deriveSubseed(run.seed, "narrative")`.
 */
export function buildNarrative(
  run: RunResult,
  matches: MatchResult[],
  labels?: NarrativeLabels,
): RunResult["narrative"] {
  const facts = deriveNarrativeFacts(run, matches);
  const template = selectNarrativeTemplate(run, facts);
  const tokens = resolveNarrativeTokens(run, facts, labels, template);
  return {
    template_id: template.id,
    narrative_seed: facts.narrative_seed,
    filled_text: fillTemplate(template.text, tokens),
  };
}
