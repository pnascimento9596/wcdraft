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
  PickedKind,
} from "./draft.js";

export type {
  // formation.ts (WS-0c depth layer)
  SlotPosition,
  FormationChannel,
  FormationSlot,
  FormationTemplate,
  PositionCompatibilityFn,
} from "./formation.js";
export {
  SLOT_POSITIONS,
  slotPositionLine,
  POSITION_COMPATIBILITY_FACTORS,
  FORMATION_TEMPLATES,
  FORMATION_IDS,
  deriveFormationAdjacency,
} from "./formation.js";

export type {
  // manager.ts (WS-0c depth layer)
  Manager,
  ManagerTournament,
  ManagerRating,
  ManagerCardId,
} from "./manager.js";
export { buildManagerCardId, parseManagerCardId } from "./manager.js";

export type {
  // synergy.ts (WS-0c depth layer)
  NationCluster,
  LinkedPair,
  SynergyResult,
  ComputeSynergyFn,
} from "./synergy.js";

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
  SimWorld,
} from "./sim.js";

export type {
  // scoring.ts
  ScoringConfig,
  ScoreComponent,
} from "./scoring.js";

export type {
  // stats.ts
  PlayerMatchStats,
  PlayerRunStats,
} from "./stats.js";

export type {
  // narrative.ts
  KeyMoment,
  NarrativeMatchMethod,
  NarrativeScenarioFamily,
  NarrativeScenarioSpotlight,
  NarrativeFacts,
  OutcomeClass,
  TokenName,
  NarrativeLabels,
  NarrativeTemplateOutcomeClass,
  NarrativeTemplate,
} from "./narrative.js";

export type {
  // run.ts
  RoundResult,
  RunResult,
} from "./run.js";

export type {
  // group-stage.ts (I3.3 additive return from runTournamentFull)
  GroupParticipantKind,
  GroupQualification,
  GroupStanding,
  GroupOtherMatchSummary,
  GroupStageResult,
} from "./group-stage.js";
export { USER_GROUP_PARTICIPANT_ID } from "./group-stage.js";
