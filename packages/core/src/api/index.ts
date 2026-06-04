// Barrel for the wcdraft data-contract function-signature layer.
// WS-B implements sim / score (engine bodies under `../engine/*`); narrative
// stays a typed stub until WS-E.

export type { UserXiSimView, SimulateMatchFn, RunTournamentFn, SimWorld } from "./sim.js";
export { simulateMatch, runTournament } from "./sim.js";

export type { ComputeScoreFn, ResolveTopScorerFn } from "./scoring.js";
export { computeScore, resolveTopScorer } from "./scoring.js";

export type { DeriveNarrativeFactsFn } from "./narrative.js";
export { deriveNarrativeFacts } from "./narrative.js";

// WS-0c depth layer — position compatibility, Synergy, team-strength aggregation.
export { positionCompatibility } from "./compatibility.js";
export { computeSynergy } from "./synergy.js";
export type { StarterContribution, AggregateUserXiStrengthFn } from "./team-strength.js";
export { aggregateUserXiStrength } from "./team-strength.js";
