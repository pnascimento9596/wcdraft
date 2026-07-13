// Public surface of @wcdraft/core.
//
// Layers:
//   1. RNG primitive — the SINGLE source of randomness for the system.
//      Includes `deriveSubseed` for substream sub-seeds and `canonicalSortBy`
//      for canonical sampling-pool ordering.
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

// ─── 1. RNG primitive + determinism helpers ──────────────────────────────────
export {
  createRng,
  deriveSubseed,
  canonicalSortBy,
  canonicalSortStrings,
  compareCodePointStrings,
} from "./rng.js";
export type { Rng, SubstreamName, CanonicalSortKey } from "./rng.js";

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
  CardId,
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
  DraftMode,
  RankedDraftMode,
  OpenDraftMode,
  BlindDraftMode,
  PickedKind,
  // formation (WS-0c)
  SlotPosition,
  FormationChannel,
  FormationSlot,
  FormationTemplate,
  PositionCompatibilityFn,
  // manager (WS-0c)
  Manager,
  ManagerTournament,
  ManagerRating,
  ManagerCardId,
  // synergy (WS-0c)
  NationCluster,
  LinkedPair,
  SynergyResult,
  ComputeSynergyFn,
  // sim
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
  AvailabilityEvent,
  SubEvent,
  ShootoutKickEvent,
  ShootoutKick,
  MatchLineupEntry,
  MatchResult,
  AvailabilityFact,
  BenchActivationFact,
  MatchTeamFacts,
  ManagerTacticalBand,
  SimWorld,
  // scoring
  ScoringConfig,
  ScoreComponent,
  // stats
  PlayerMatchStats,
  PlayerRunStats,
  // narrative
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
  // run
  RoundResult,
  RunResult,
  // group-stage (I3.3)
  GroupParticipantKind,
  GroupQualification,
  GroupStanding,
  GroupOtherMatchSummary,
  GroupStageResult,
} from "./types/index.js";

export {
  GROUP_IDS,
  buildCardId,
  parseCardId,
  USER_GROUP_PARTICIPANT_ID,
  // WS-0c
  SLOT_POSITIONS,
  slotPositionLine,
  POSITION_COMPATIBILITY_FACTORS,
  FORMATION_TEMPLATES,
  FORMATION_IDS,
  deriveFormationAdjacency,
  buildManagerCardId,
  parseManagerCardId,
  isRankedDraftMode,
  isOpenDraftMode,
  isBlindDraftMode,
} from "./types/index.js";

// ─── 3. Function signatures (typed stubs; algorithms in Phase 1) ─────────────
export type {
  UserXiSimView,
  SimulateMatchFn,
  RunTournamentFn,
  ComputeScoreFn,
  ResolveTopScorerFn,
  DeriveNarrativeFactsFn,
  NarrativeFactsOptions,
  // WS-0c
  StarterContribution,
  AggregateUserXiStrengthFn,
} from "./api/index.js";

export {
  simulateMatch,
  runTournament,
  computeScore,
  resolveTopScorer,
  // WS-E narrative
  deriveNarrativeFacts,
  buildNarrative,
  selectNarrativeTemplate,
  resolveNarrativeTokens,
  fillTemplate,
  headlineMoment,
  classifyOutcome,
  templatesForClass,
  templatesForScenarioFamily,
  NARRATIVE_TEMPLATES,
  UNAVAILABLE_TOKEN_TEXT,
  // WS-0c
  positionCompatibility,
  computeSynergy,
  aggregateUserXiStrength,
  aggregateActiveXiStrength,
  projectSlotContribution,
  managerBandModifier,
} from "./api/index.js";

// ─── 3b. WS-B engine — usable run entry + calibration ─────────────────────────
// `runTournament` (above) is the public 4-arg contract that returns only the
// schema-clean `RunResult`. `runTournamentFull` is the event-bearing 4-arg
// entry (returns the RunResult AND the per-match `MatchResult[]`) for
// consumers that need the atomic event stream.
export { runTournamentFull, isBelowFieldableFloor } from "./engine/tournament.js";
export {
  DEFAULT_SCORING_CONFIG,
  // D6 fit override mechanism — OFFLINE TOOL ONLY. Production code MUST
  // NOT call these; the symbol names are `__UNSAFE_*` so the call sites
  // are grep-visible. See calibration.ts for the safety contract.
  __UNSAFE_setCalibrationOverride,
  __UNSAFE_clearCalibrationOverride,
  type CalibrationOverride,
} from "./engine/calibration.js";
// PUBLIC SIM PRIMITIVES — surfaced for the realism golden test
// (`@wcdraft/data` test/realism-modern-norms.golden.test.ts) which runs a
// 3,006-match symmetric coherent-XI sweep through the engine and validates
// against modern-era WC norms. `simulateMatch` (UserXiSimView path) is the
// drafted-user surface; these are the Team2026-vs-Team2026 primitives.
export { simulateMatchCore, membersFromTeam2026 } from "./engine/match.js";
export {
  applyManagerTacticalAdjustment,
  managerTacticalBand,
  type ManagerTacticalAdjustment,
} from "./engine/manager-tactics.js";
export type { CoreMatchInput, InternalMatchResult, SimMember } from "./engine/match.js";

// ─── I3.2 scenario builder — RunScenario from real Team2026[] + Bracket2026 ─
export {
  buildRunScenario,
  SCENARIO_KNOCKOUT_ROUNDS,
  SCENARIO_KNOCKOUT_SEED_SUFFIX,
} from "./scenario.js";
export type {
  BuildRunScenarioParams,
  BuildRunScenarioResult,
  RunScenarioMeta,
} from "./scenario.js";

// ─── WS-C draft engine (the deterministic 17-spin DRAFT state machine) ───────
export {
  buildDraftCatalog,
  filterDraftDataset,
  MAX_PLAYER_CHOICES_PER_SPIN,
  createDraft,
  activeSpin,
  isDraftComplete,
  pickPlayer,
  pickManager,
  selectDraftTarget,
  DraftTargetDeadEndError,
  stepDraft,
  autoDraft,
  validateSquad,
} from "./draft.js";
export type {
  DraftPlayerCard,
  DraftManagerCard,
  DraftTournament,
  DraftDataset,
  DraftCatalog,
  CreateDraftParams,
} from "./draft.js";

// ─── DC-1 draft configuration axes (draft-config season) ─────────────────────
export {
  ERA_PRESETS,
  ERA_PRESET_IDS,
  DEFAULT_DRAFT_FLOW,
  DEFAULT_RATING_BASIS,
  DEFAULT_ERA_PRESET,
  DEFAULT_DRAFT_CONFIG,
  isDraftFlow,
  isRatingBasis,
  isEraPresetId,
  isCanonicalDraftConfig,
} from "./types/draft-config.js";
export type {
  DraftFlow,
  RatingBasis,
  EraPresetId,
  EraPreset,
  DraftConfig,
} from "./types/draft-config.js";

// Shared run-token wire contract (pure decode/encode helpers only).
export {
  RUN_TOKEN_PREFIX,
  RUN_TOKEN_V2_PREFIX,
  RUN_TOKEN_V3_PREFIX,
  RUN_TOKEN_V4_PREFIX,
  RUN_TOKEN_MAX_LEN,
  RunTokenError,
  base64UrlEncode,
  base64UrlDecode,
  encodeRunTokenBody,
  tokenDraftConfig,
  isNewerRunTokenVersion,
  decodeRunToken,
  versionsAgree,
} from "./run-token.js";
export type {
  RunTokenPick,
  RunTokenPickV2,
  RunTokenPickV3,
  RunTokenPickV4,
  RunTokenDailyChallenge,
  RunTokenOgSummary,
  RunTokenV1Body,
  RunTokenV2Body,
  RunTokenV3Body,
  RunTokenV4Body,
  RunTokenBody,
  RunTokenVersions,
} from "./run-token.js";

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
  NonEmptyIdSchema,
  PercentSchema,
  RatingChannelSchema,
  MinuteSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  IntegerRangeSchema,
  // identity
  NationSchema,
  PlayerSchema,
  PlayerTournamentSchema,
  CardIdSchema,
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
  MatchLineupEntrySchema,
  MatchResultSchema,
  // run
  ScoreComponentSchema,
  RoundResultSchema,
  PlayerMatchStatsSchema,
  PlayerRunStatsSchema,
  RunResultSchema,
  // group-stage (I3.3)
  GroupStandingSchema,
  GroupOtherMatchSummarySchema,
  GroupStageResultSchema,
  // leaderboard
  LeaderboardSubmissionSchema,
  // WS-0c
  SlotPositionSchema,
  FormationChannelSchema,
  FormationSlotSchema,
  FormationTemplateSchema,
  ManagerCardIdSchema,
  ManagerSchema,
  ManagerTournamentSchema,
  ManagerRatingSchema,
  ManagerRatingComponentSchema,
  NationClusterSchema,
  LinkedPairSchema,
  SynergyResultSchema,
} from "./schemas/index.js";

export type { LeaderboardSubmission } from "./schemas/index.js";
