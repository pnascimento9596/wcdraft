// Public surface of @wcdraft/core.
//
// Layers:
//   1. RNG primitive — the SINGLE source of randomness for the system.
//   2. Domain data-contract TYPES — the typed spine consumed by WS-A (ETL +
//      ratings), WS-B (sim + scoring), WS-C (draft), WS-D (UI), WS-E
//      (narrative). Field types here are AUTHORITATIVE.
//   3. Function SIGNATURES — sim / score / narrative function contracts.
//      Runtime stubs ship in WS-0b and throw "not implemented" so importing
//      compiles and consumers can wire integrations against the type
//      signatures. The algorithms land in Phase 1 workstreams.
//   4. Zod BOUNDARY schemas — for the trust boundaries only: ETL dataset
//      output, persisted DraftState, persisted RunResult, and the server-side
//      LeaderboardSubmission. Internal-only types deliberately do NOT carry a
//      zod schema.

// ─── 1. RNG primitive ────────────────────────────────────────────────────────
export { createRng } from "./rng.js";
export type { Rng } from "./rng.js";

// ─── 2. Domain types ─────────────────────────────────────────────────────────
export type {
  // primitives
  Position,
  AwardType,
  Award,
  Formation,
  GroupId,
  KnockoutRound,
  MatchRound,
  MatchPhase,
  MatchPeriod,
  SourceRef,
  // identity
  Nation,
  Player,
  PlayerTournament,
  // rating
  Rating,
  RatingComponent,
  TeamStrength,
  // tournament
  Tournament,
  Team2026,
  Group,
  Slot,
  SlotSource,
  Bracket2026,
  KnockoutOpponentRule,
  RunScenario,
  Team2026RatingView,
  // draft
  Spin,
  SquadSlot,
  SquadValidation,
  DraftState,
  // sim
  MatchEvent,
  ShootoutKick,
  MatchResult,
  // scoring
  ScoringConfig,
  ScoreComponent,
  // stats
  PlayerMatchStats,
  PlayerRunStats,
  // narrative
  KeyMoment,
  NarrativeFacts,
  // run
  RunResult,
} from "./types/index.js";

export { GROUP_IDS, PLACEHOLDER_SCORING_CONFIG } from "./types/index.js";

// ─── 3. Function signatures (typed stubs; algorithms in Phase 1) ─────────────
export type {
  UserXiSimView,
  SimulateMatchFn,
  RunTournamentFn,
  ComputeScoreFn,
  ResolveTopScorerFn,
  DeriveNarrativeFactsFn,
} from "./api/index.js";

export {
  simulateMatch,
  runTournament,
  computeScore,
  resolveTopScorer,
  deriveNarrativeFacts,
} from "./api/index.js";

// ─── 4. Zod boundary schemas ─────────────────────────────────────────────────
export {
  // primitives
  PositionSchema,
  AwardTypeSchema,
  AwardSchema,
  FormationSchema,
  GroupIdSchema,
  KnockoutRoundSchema,
  MatchRoundSchema,
  MatchPhaseSchema,
  MatchPeriodSchema,
  SourceRefSchema,
  // identity
  NationSchema,
  PlayerSchema,
  PlayerTournamentSchema,
  // rating
  RatingComponentSchema,
  TeamStrengthSchema,
  RatingSchema,
  // tournament
  Team2026Schema,
  // draft
  SpinSchema,
  SquadSlotSchema,
  SquadValidationSchema,
  DraftStateSchema,
  // sim
  MatchEventSchema,
  ShootoutKickSchema,
  MatchResultSchema,
  // run
  ScoreComponentSchema,
  PlayerMatchStatsSchema,
  PlayerRunStatsSchema,
  RunResultSchema,
  // leaderboard
  LeaderboardSubmissionSchema,
} from "./schemas/index.js";

export type { LeaderboardSubmission } from "./schemas/index.js";
