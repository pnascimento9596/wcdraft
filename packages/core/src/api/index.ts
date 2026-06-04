// Barrel for the wcdraft data-contract function-signature layer.
// Implementations land in Phase 1 workstreams (WS-B for sim/score, WS-E for
// narrative). The runtime exports here are typed "not implemented" stubs.

export type { UserXiSimView, SimulateMatchFn, RunTournamentFn } from "./sim.js";
export { simulateMatch, runTournament } from "./sim.js";

export type { ComputeScoreFn, ResolveTopScorerFn } from "./scoring.js";
export { computeScore, resolveTopScorer } from "./scoring.js";

export type { DeriveNarrativeFactsFn } from "./narrative.js";
export { deriveNarrativeFacts } from "./narrative.js";
