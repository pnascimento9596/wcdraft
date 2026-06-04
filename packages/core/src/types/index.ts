// Barrel for the wcdraft data-contract type layer. All consumers (WS-A ETL,
// WS-B sim/score, WS-C draft, WS-D UI, WS-E narrative) import contract types
// from here — not from the leaf modules — so a future re-org of the leaves is
// non-breaking.

export type {
  // primitives.ts
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
} from "./primitives.js";
export { GROUP_IDS } from "./primitives.js";

export type {
  // identity.ts
  Nation,
  Player,
  PlayerTournament,
  CardId,
} from "./identity.js";
export { buildCardId, parseCardId } from "./identity.js";

export type {
  // rating.ts
  Rating,
  RatingComponent,
  TeamStrength,
} from "./rating.js";

export type {
  // tournament.ts
  Tournament,
  Team2026,
  Group,
  Slot,
  SlotSource,
  Bracket2026,
  KnockoutOpponentRule,
  RunScenario,
  Team2026RatingView,
} from "./tournament.js";

export type {
  // draft.ts
  Spin,
  SquadSlot,
  SquadValidation,
  DraftState,
} from "./draft.js";

export type {
  // sim.ts
  MatchEvent,
  MatchEventType,
  GoalEvent,
  OwnGoalEvent,
  PenScoredEvent,
  PenMissedEvent,
  PenWonEvent,
  ShotOnEvent,
  ShotOffEvent,
  SaveEvent,
  KeyPassEvent,
  FoulEvent,
  OffsideEvent,
  YellowEvent,
  RedEvent,
  InjuryEvent,
  SubEvent,
  ShootoutKickEvent,
  ShootoutKick,
  MatchLineupEntry,
  MatchResult,
} from "./sim.js";

export type {
  // scoring.ts
  ScoringConfig,
  ScoreComponent,
} from "./scoring.js";
export { PLACEHOLDER_SCORING_CONFIG } from "./scoring.js";

export type {
  // stats.ts
  PlayerMatchStats,
  PlayerRunStats,
} from "./stats.js";

export type {
  // narrative.ts
  KeyMoment,
  NarrativeFacts,
} from "./narrative.js";

export type {
  // run.ts
  RoundResult,
  RunResult,
} from "./run.js";
