// Barrel for zod boundary schemas. Only TRUST-BOUNDARY entities have zod
// schemas — ETL output, persisted DraftState / RunResult, and the
// LeaderboardSubmission. Internal-only types do not.

export {
  // primitives.ts
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
  NonEmptyIdSchema,
  PercentSchema,
  RatingChannelSchema,
  MinuteSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  IntegerRangeSchema,
} from "./primitives.js";

export {
  // identity.ts
  NationSchema,
  PlayerSchema,
  PlayerTournamentSchema,
  CardIdSchema,
} from "./identity.js";

export {
  // rating.ts
  RatingComponentSchema,
  TeamStrengthSchema,
  RatingSchema,
} from "./rating.js";

export {
  // tournament.ts
  Team2026Schema,
} from "./tournament.js";

export {
  // draft.ts
  SpinSchema,
  SquadSlotSchema,
  SquadValidationSchema,
  DraftStateSchema,
} from "./draft.js";

export {
  // sim.ts
  MatchEventSchema,
  ShootoutKickSchema,
  MatchLineupEntrySchema,
  MatchResultSchema,
} from "./sim.js";

export {
  // run.ts
  ScoreComponentSchema,
  RoundResultSchema,
  PlayerMatchStatsSchema,
  PlayerRunStatsSchema,
  RunResultSchema,
} from "./run.js";

export { LeaderboardSubmissionSchema } from "./leaderboard.js";
export type { LeaderboardSubmission } from "./leaderboard.js";

export {
  // formation.ts (WS-0c depth layer)
  SlotPositionSchema,
  FormationChannelSchema,
  FormationSlotSchema,
  FormationTemplateSchema,
} from "./formation.js";

export {
  // manager.ts (WS-0c depth layer)
  ManagerCardIdSchema,
  ManagerSchema,
  ManagerTournamentSchema,
  ManagerRatingSchema,
  ManagerRatingComponentSchema,
  refineManagerCardIdConsistency,
} from "./manager.js";

export {
  // synergy.ts (WS-0c depth layer)
  NationClusterSchema,
  LinkedPairSchema,
  SynergyResultSchema,
} from "./synergy.js";

export {
  // group-stage.ts (I3.3 — additive runTournamentFull return)
  GroupStandingSchema,
  GroupOtherMatchSummarySchema,
  GroupStageResultSchema,
} from "./group-stage.js";
