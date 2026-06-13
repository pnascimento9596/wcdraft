// Barrel for the WS-E narrative implementation.
//
// The narrative system is STATIC + DETERMINISTIC: a pre-authored template bank
// (data, not a model), an event-log-driven facts reducer, deterministic token
// resolution, and sub-seed-threaded template selection. No runtime LLM.

export {
  NARRATIVE_TEMPLATES,
  templatesForClass,
  templatesForScenarioFamily,
  classifyOutcome,
} from "./templates.js";
export { deriveNarrativeFacts } from "./facts.js";
export {
  resolveNarrativeTokens,
  fillTemplate,
  headlineMoment,
  UNAVAILABLE_TOKEN_TEXT,
} from "./tokens.js";
export { selectNarrativeTemplate, buildNarrative } from "./select.js";
