// Public surface of @wcdraft/core.
//
// SCAFFOLD NOTE (WS-0): domain data-contract types (Player, Rating, Sim,
// DraftState, MatchResult, etc.) are intentionally NOT defined here yet. They
// are deferred to WS-0b pending an oracle review. The only export today is the
// deterministic RNG primitive — the single source of randomness for the system.
export { createRng } from "./rng.js";
export type { Rng } from "./rng.js";
