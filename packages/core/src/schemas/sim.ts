// Zod schema for MatchResult — referenced by the persisted-run boundary
// (a RunResult is derivable from events, but the persisted RunResult does NOT
// embed full event logs; tests + replays use MatchResult separately).
//
// The event schema is a DISCRIMINATED UNION over the typed `MatchEvent`
// variants (see `types/sim.ts`). The match result superRefines for:
//   - phase/round consistency
//   - ET only when knockout + tied after regulation
//   - shootout non-null iff knockout + ET played + still level after ET
//   - shootout sequence equal to projected `shootout_kick` events
//   - lineup uniqueness + card_id consistency

import { z } from "zod";

import type {
  FoulEvent,
  GoalEvent,
  AvailabilityEvent,
  InjuryEvent,
  KeyPassEvent,
  MatchEvent,
  MatchLineupEntry,
  MatchResult,
  OffsideEvent,
  OwnGoalEvent,
  PenMissedEvent,
  PenScoredEvent,
  PenWonEvent,
  RedEvent,
  SaveEvent,
  ShootoutKick,
  ShootoutKickEvent,
  ShotOffEvent,
  ShotOnEvent,
  SubEvent,
  YellowEvent,
} from "../types/sim.js";
import { CardIdSchema, refineCardIdConsistency } from "./identity.js";
import { TeamStrengthSchema } from "./rating.js";
import { applyManagerTacticalAdjustment } from "../engine/manager-tactics.js";
import { INJURY } from "../engine/calibration.js";
import { FORMATION_TEMPLATES, slotPositionLine } from "../types/formation.js";
import { SynergyResultSchema } from "./synergy.js";
import {
  IntegerRangeSchema,
  MatchPeriodSchema,
  MatchPhaseSchema,
  MatchRoundSchema,
  MinuteSchema,
  NonEmptyIdSchema,
  NonNegativeIntegerSchema,
  PositionSchema,
  PositiveIntegerSchema,
} from "./primitives.js";

const SideSchema = z.enum(["user", "opp"]);

const ScoreAfterSchema = z.object({
  user: NonNegativeIntegerSchema,
  opp: NonNegativeIntegerSchema,
});

const ProbabilitySchema = z
  .number()
  .min(0)
  .max(1)
  .refine(Number.isFinite, { message: "probability must be finite" });

const ContinuousTacticalStrengthSchema = z.object({
  attack: z.number().finite().min(0).max(100),
  midfield: z.number().finite().min(0).max(100),
  defense: z.number().finite().min(0).max(100),
  goalkeeping: z.number().finite().min(0).max(100),
  coverage: ProbabilitySchema,
});

const EventBase = {
  event_id: NonEmptyIdSchema,
  minute: MinuteSchema,
  period: MatchPeriodSchema,
  side: SideSchema,
};

const GoalEventSchema = z.object({
  ...EventBase,
  type: z.literal("goal"),
  scorer_card_id: CardIdSchema,
  scorer_player_id: NonEmptyIdSchema,
  assist_card_id: CardIdSchema.nullable(),
  assist_player_id: NonEmptyIdSchema.nullable(),
  score_after: ScoreAfterSchema,
}) satisfies z.ZodType<GoalEvent>;

const OwnGoalEventSchema = z.object({
  ...EventBase,
  type: z.literal("own_goal"),
  scorer_card_id: CardIdSchema,
  scorer_player_id: NonEmptyIdSchema,
  beneficiary_side: SideSchema,
  score_after: ScoreAfterSchema,
}) satisfies z.ZodType<OwnGoalEvent>;

const PenScoredEventSchema = z.object({
  ...EventBase,
  type: z.literal("pen_scored"),
  taker_card_id: CardIdSchema,
  taker_player_id: NonEmptyIdSchema,
  score_after: ScoreAfterSchema,
}) satisfies z.ZodType<PenScoredEvent>;

const PenMissedEventSchema = z.object({
  ...EventBase,
  type: z.literal("pen_missed"),
  taker_card_id: CardIdSchema,
  taker_player_id: NonEmptyIdSchema,
  on_target: z.boolean(),
  saved_by_card_id: CardIdSchema.nullable(),
  saved_by_player_id: NonEmptyIdSchema.nullable(),
}) satisfies z.ZodType<PenMissedEvent>;

const PenWonEventSchema = z.object({
  ...EventBase,
  type: z.literal("pen_won"),
  won_by_card_id: CardIdSchema,
  won_by_player_id: NonEmptyIdSchema,
  conceded_by_card_id: CardIdSchema.nullable(),
  conceded_by_player_id: NonEmptyIdSchema.nullable(),
}) satisfies z.ZodType<PenWonEvent>;

const ShotOnEventSchema = z.object({
  ...EventBase,
  type: z.literal("shot_on"),
  card_id: CardIdSchema,
  player_id: NonEmptyIdSchema,
}) satisfies z.ZodType<ShotOnEvent>;

const ShotOffEventSchema = z.object({
  ...EventBase,
  type: z.literal("shot_off"),
  card_id: CardIdSchema,
  player_id: NonEmptyIdSchema,
}) satisfies z.ZodType<ShotOffEvent>;

const SaveEventSchema = z.object({
  ...EventBase,
  type: z.literal("save"),
  keeper_card_id: CardIdSchema,
  keeper_player_id: NonEmptyIdSchema,
  shot_event_id: NonEmptyIdSchema.nullable(),
}) satisfies z.ZodType<SaveEvent>;

const KeyPassEventSchema = z.object({
  ...EventBase,
  type: z.literal("key_pass"),
  card_id: CardIdSchema,
  player_id: NonEmptyIdSchema,
  for_event_id: NonEmptyIdSchema.nullable(),
}) satisfies z.ZodType<KeyPassEvent>;

const FoulEventSchema = z.object({
  ...EventBase,
  type: z.literal("foul"),
  committed_by_card_id: CardIdSchema,
  committed_by_player_id: NonEmptyIdSchema,
  suffered_by_card_id: CardIdSchema,
  suffered_by_player_id: NonEmptyIdSchema,
}) satisfies z.ZodType<FoulEvent>;

const OffsideEventSchema = z.object({
  ...EventBase,
  type: z.literal("offside"),
  card_id: CardIdSchema,
  player_id: NonEmptyIdSchema,
}) satisfies z.ZodType<OffsideEvent>;

const YellowEventSchema = z.object({
  ...EventBase,
  type: z.literal("yellow"),
  card_id: CardIdSchema,
  player_id: NonEmptyIdSchema,
}) satisfies z.ZodType<YellowEvent>;

const RedEventSchema = z.object({
  ...EventBase,
  type: z.literal("red"),
  card_id: CardIdSchema,
  player_id: NonEmptyIdSchema,
}) satisfies z.ZodType<RedEvent>;

const InjuryEventSchema = z.object({
  ...EventBase,
  type: z.literal("injury"),
  card_id: CardIdSchema,
  player_id: NonEmptyIdSchema,
  tournament_ending: z.boolean(),
}) satisfies z.ZodType<InjuryEvent>;

const AvailabilityEventSchema = z.object({
  ...EventBase,
  type: z.literal("availability"),
  minute: z.literal(0),
  period: z.literal("1H"),
  card_id: CardIdSchema,
  player_id: NonEmptyIdSchema,
  slot_id: NonEmptyIdSchema,
  position: PositionSchema,
  reason: z.enum(["knock", "suspension", "tournament_injury"]),
  duration_matches: z.union([z.literal(1), z.literal(2)]).nullable(),
  replacement_card_id: CardIdSchema.nullable(),
  replacement_player_id: NonEmptyIdSchema.nullable(),
  short_handed: z.boolean(),
}) satisfies z.ZodType<AvailabilityEvent>;

const SubEventSchema = z.object({
  ...EventBase,
  type: z.literal("sub"),
  in_card_id: CardIdSchema,
  in_player_id: NonEmptyIdSchema,
  out_card_id: CardIdSchema,
  out_player_id: NonEmptyIdSchema,
  reason: z.enum(["tactical", "injury"]),
}) satisfies z.ZodType<SubEvent>;

const ShootoutKickEventSchema = z.object({
  ...EventBase,
  type: z.literal("shootout_kick"),
  period: z.literal("shootout"),
  minute: z.literal(0),
  index: NonNegativeIntegerSchema,
  taker_card_id: CardIdSchema.nullable(),
  taker_player_id: NonEmptyIdSchema.nullable(),
  scored: z.boolean(),
}) satisfies z.ZodType<ShootoutKickEvent>;

export const MatchEventSchema = z.discriminatedUnion("type", [
  GoalEventSchema,
  OwnGoalEventSchema,
  PenScoredEventSchema,
  PenMissedEventSchema,
  PenWonEventSchema,
  ShotOnEventSchema,
  ShotOffEventSchema,
  SaveEventSchema,
  KeyPassEventSchema,
  FoulEventSchema,
  OffsideEventSchema,
  YellowEventSchema,
  RedEventSchema,
  InjuryEventSchema,
  AvailabilityEventSchema,
  SubEventSchema,
  ShootoutKickEventSchema,
]) as unknown as z.ZodType<MatchEvent>;

export const ShootoutKickSchema = z.object({
  index: NonNegativeIntegerSchema,
  side: SideSchema,
  taker_card_id: CardIdSchema.nullable(),
  taker_player_id: NonEmptyIdSchema.nullable(),
  scored: z.boolean(),
}) satisfies z.ZodType<ShootoutKick>;

export const MatchLineupEntrySchema = z
  .object({
    side: SideSchema,
    card_id: CardIdSchema,
    player_id: NonEmptyIdSchema,
    tournament_id: PositiveIntegerSchema,
    slot_id: NonEmptyIdSchema,
    position: PositionSchema,
    started: z.boolean(),
    minutes: MinuteSchema,
  })
  // refineCardIdConsistency wraps buildCardId in try/catch so an empty
  // player_id / non-positive tournament_id yields a clean issue, not an
  // exception escaping safeParse at the trust boundary.
  .superRefine(refineCardIdConsistency) satisfies z.ZodType<MatchLineupEntry>;

const KNOCKOUT_ROUNDS = new Set(["R32", "R16", "QF", "SF", "F"] as const);
const GROUP_ROUNDS = new Set(["G1", "G2", "G3"] as const);
const CANONICAL_XI_SIZE = 11;

function accountsForExactKnownFormation(
  startedUserEntries: readonly Pick<MatchLineupEntry, "slot_id" | "position">[],
  shortHandedSlotIds: readonly string[],
  unavailable: readonly { slot_id: string; position: MatchLineupEntry["position"] }[],
): boolean {
  const shortHandedEntries = shortHandedSlotIds.map((slotId) => {
    const facts = unavailable.filter((entry) => entry.slot_id === slotId);
    return facts.length === 1 ? { slot_id: slotId, position: facts[0]!.position } : null;
  });
  if (shortHandedEntries.some((entry) => entry === null)) return false;
  const accounted = [...startedUserEntries, ...shortHandedEntries];
  const accountedSlotIds = accounted.map((entry) => entry!.slot_id);
  const accountedSet = new Set(accountedSlotIds);
  if (accounted.length !== CANONICAL_XI_SIZE || accountedSet.size !== accounted.length)
    return false;
  return Object.values(FORMATION_TEMPLATES).some((template) => {
    const expectedPositions = new Map(
      template.slots.map((slot) => [slot.slot_id, slotPositionLine(slot.slot_position)]),
    );
    return (
      expectedPositions.size === accountedSet.size &&
      [...expectedPositions].every(([slotId]) => accountedSet.has(slotId)) &&
      accounted.every(
        (entry) => entry !== null && expectedPositions.get(entry.slot_id) === entry.position,
      )
    );
  });
}

function isKnockoutRound(round: string): boolean {
  return (KNOCKOUT_ROUNDS as ReadonlySet<string>).has(round);
}
function isGroupRound(round: string): boolean {
  return (GROUP_ROUNDS as ReadonlySet<string>).has(round);
}

export const MatchResultSchema = z
  .object({
    match_id: NonEmptyIdSchema,
    match_index: IntegerRangeSchema(0, 7),
    round: MatchRoundSchema,
    phase: MatchPhaseSchema,
    opponent_team_id: NonEmptyIdSchema,
    pre_match_win_probability: ProbabilitySchema,
    team_facts: z
      .object({
        base_strength: TeamStrengthSchema,
        active_strength: TeamStrengthSchema,
        manager_present: z.boolean(),
        manager_presence_band: z.union([z.literal(0), z.literal(1)]),
        manager_link_band: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        manager_tactical_band: z.number().int().min(0).max(3),
        manager_tactical_multiplier: z.number().finite().min(1),
        post_tactical_strength: ContinuousTacticalStrengthSchema,
        tactical_applied_to_outcome: z.boolean(),
        base_synergy: SynergyResultSchema,
        active_synergy: SynergyResultSchema,
        unavailable: z.array(
          z.object({
            card_id: CardIdSchema,
            player_id: NonEmptyIdSchema,
            slot_id: NonEmptyIdSchema,
            position: PositionSchema,
            reason: z.enum(["knock", "suspension", "tournament_injury"]),
            duration_matches: z.union([z.literal(1), z.literal(2)]).nullable(),
          }),
        ),
        bench_activations: z.array(
          z
            .object({
              out_card_id: CardIdSchema,
              out_player_id: NonEmptyIdSchema,
              in_card_id: CardIdSchema,
              in_player_id: NonEmptyIdSchema,
              slot_id: NonEmptyIdSchema,
              line: PositionSchema,
              fit: ProbabilitySchema,
              internal_score: z.number().finite().min(0).max(100),
              replacement_contribution_multiplier: z.number().finite().gt(0).max(1),
              replacement_score: z.number().finite().min(0).max(100),
              outgoing_score: z.number().finite().min(0).max(100),
              line_contribution_delta: z.number().finite().min(-100).max(100),
            })
            .superRefine((activation, ctx) => {
              if (
                activation.replacement_contribution_multiplier !==
                INJURY.BENCH_REPLACEMENT_CONTRIBUTION_MULTIPLIER
              ) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "replacement contribution multiplier must match the calibrated engine constant",
                  path: ["replacement_contribution_multiplier"],
                });
              }
              if (
                activation.replacement_score !==
                activation.internal_score *
                  activation.fit *
                  activation.replacement_contribution_multiplier
              ) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "replacement_score must equal internal_score * fit * contribution multiplier",
                  path: ["replacement_score"],
                });
              }
              if (
                activation.line_contribution_delta !==
                activation.replacement_score - activation.outgoing_score
              ) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: "line_contribution_delta must equal replacement_score - outgoing_score",
                  path: ["line_contribution_delta"],
                });
              }
            }),
        ),
        short_handed_slot_ids: z.array(NonEmptyIdSchema),
      })
      .optional(),
    user_goals: NonNegativeIntegerSchema,
    opp_goals: NonNegativeIntegerSchema,
    user_goals_et: NonNegativeIntegerSchema.nullable(),
    opp_goals_et: NonNegativeIntegerSchema.nullable(),
    shootout: z
      .object({
        user: NonNegativeIntegerSchema,
        opp: NonNegativeIntegerSchema,
        sequence: z.array(ShootoutKickSchema),
      })
      .nullable(),
    outcome: z.enum(["W", "D", "L"]),
    counts_as_run_win: z.boolean(),
    advanced: z.boolean(),
    lineup: z.array(MatchLineupEntrySchema),
    events: z.array(MatchEventSchema),
  })
  .superRefine((m, ctx) => {
    if (m.team_facts) {
      const userStartedCount = m.lineup.filter(
        (entry) => entry.side === "user" && entry.started,
      ).length;
      if (userStartedCount + m.team_facts.short_handed_slot_ids.length !== CANONICAL_XI_SIZE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "started user lineup entries plus short_handed_slot_ids must account for the canonical XI",
          path: ["team_facts", "short_handed_slot_ids"],
        });
      }
      if (m.team_facts.short_handed_slot_ids.length > 0) {
        const startedUserEntries = m.lineup.filter(
          (entry) => entry.side === "user" && entry.started,
        );
        if (
          !accountsForExactKnownFormation(
            startedUserEntries,
            m.team_facts.short_handed_slot_ids,
            m.team_facts.unavailable,
          )
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "started user and short-handed slots must match the identities and coarse positions of one known formation",
            path: ["team_facts", "short_handed_slot_ids"],
          });
        }
      }
      const expectedTactical = applyManagerTacticalAdjustment(
        m.team_facts.active_strength,
        m.team_facts.manager_present,
        m.team_facts.active_synergy.manager_link,
        m.team_facts.tactical_applied_to_outcome,
      );
      if (
        m.team_facts.manager_presence_band !== expectedTactical.manager_presence_band ||
        m.team_facts.manager_link_band !== expectedTactical.manager_link_band
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "manager presence/link bands must reconcile with persisted manager facts",
          path: ["team_facts", "manager_presence_band"],
        });
      }
      if (m.team_facts.manager_tactical_band !== expectedTactical.manager_tactical_band) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "manager_tactical_band must reconcile with active manager link and application",
          path: ["team_facts", "manager_tactical_band"],
        });
      }
      if (
        m.team_facts.manager_tactical_multiplier !== expectedTactical.manager_tactical_multiplier
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "manager_tactical_multiplier must reconcile with the applied tactical band",
          path: ["team_facts", "manager_tactical_multiplier"],
        });
      }
      for (const channel of ["attack", "midfield", "defense", "goalkeeping", "coverage"] as const) {
        if (
          m.team_facts.post_tactical_strength[channel] !==
          expectedTactical.post_tactical_strength[channel]
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `post_tactical_strength.${channel} must reconcile with active strength and multiplier`,
            path: ["team_facts", "post_tactical_strength", channel],
          });
        }
      }
      const honestBypassedOutcome =
        m.pre_match_win_probability === 0 &&
        m.user_goals === 0 &&
        m.opp_goals === INJURY.FORFEIT_OPP_GOALS &&
        m.user_goals_et === null &&
        m.opp_goals_et === null &&
        m.shootout === null &&
        m.outcome === "L" &&
        !m.counts_as_run_win &&
        !m.advanced &&
        m.lineup.every((entry) => entry.side === "user") &&
        m.lineup.filter((entry) => entry.side === "user" && entry.started).length <
          INJURY.FIELDABLE_FLOOR &&
        m.lineup.every((entry) => entry.minutes === 0) &&
        m.events.every((event) => event.type === "availability" && event.side === "user");
      if (
        (m.team_facts.tactical_applied_to_outcome && m.pre_match_win_probability <= 0) ||
        (!m.team_facts.tactical_applied_to_outcome && !honestBypassedOutcome)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "tactical_applied_to_outcome must be true for simulated matches and false only for canonical forfeits",
          path: ["team_facts", "tactical_applied_to_outcome"],
        });
      }
      const allAvailabilityEvents = m.events.filter(
        (event): event is AvailabilityEvent => event.type === "availability",
      );
      if (allAvailabilityEvents.some((event) => event.side !== "user")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "availability events in user team facts must be user-side",
          path: ["events"],
        });
      }
      const availabilityEvents = allAvailabilityEvents.filter(
        (event): event is AvailabilityEvent => event.side === "user",
      );
      for (let index = 0; index < m.team_facts.unavailable.length; index++) {
        const unavailable = m.team_facts.unavailable[index]!;
        const corresponding = availabilityEvents.filter(
          (event) => event.player_id === unavailable.player_id,
        );
        if (corresponding.length !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "unavailable fact must have exactly one corresponding availability event",
            path: ["team_facts", "unavailable", index],
          });
          continue;
        }
        const event = corresponding[0]!;
        if (
          (event.card_id as string) !== (unavailable.card_id as string) ||
          event.slot_id !== unavailable.slot_id ||
          event.position !== unavailable.position ||
          event.reason !== unavailable.reason ||
          event.duration_matches !== unavailable.duration_matches
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "unavailable fact contradicts its availability event",
            path: ["team_facts", "unavailable", index],
          });
        }
      }
      for (const event of availabilityEvents) {
        const corresponding = m.team_facts.unavailable.filter(
          (unavailable) => unavailable.player_id === event.player_id,
        );
        if (corresponding.length !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "availability event must have exactly one corresponding unavailable fact",
            path: ["events", m.events.indexOf(event)],
          });
        }
      }

      const actualShortHanded = m.team_facts.short_handed_slot_ids.slice().sort();
      const eventShortHanded = availabilityEvents
        .filter((event) => event.short_handed)
        .map((event) => event.slot_id)
        .sort();
      if (
        new Set(actualShortHanded).size !== actualShortHanded.length ||
        actualShortHanded.length !== eventShortHanded.length ||
        actualShortHanded.some((slotId, index) => slotId !== eventShortHanded[index])
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "short_handed_slot_ids must equal the short-handed availability event slots",
          path: ["team_facts", "short_handed_slot_ids"],
        });
      }

      for (let index = 0; index < m.team_facts.bench_activations.length; index++) {
        const activation = m.team_facts.bench_activations[index]!;
        const corresponding = availabilityEvents.filter(
          (event) => event.player_id === activation.out_player_id,
        );
        if (corresponding.length !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "bench activation must have exactly one corresponding availability event",
            path: ["team_facts", "bench_activations", index],
          });
          continue;
        }
        const event = corresponding[0]!;
        if (
          (event.card_id as string) !== (activation.out_card_id as string) ||
          event.slot_id !== activation.slot_id ||
          event.position !== activation.line ||
          (event.replacement_card_id as string | null) !== (activation.in_card_id as string) ||
          event.replacement_player_id !== activation.in_player_id ||
          event.short_handed
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "bench activation contradicts its availability event",
            path: ["team_facts", "bench_activations", index],
          });
        }
        const activeReplacement = m.lineup.filter(
          (entry) => entry.side === "user" && entry.started && entry.slot_id === activation.slot_id,
        );
        if (
          activeReplacement.length !== 1 ||
          (activeReplacement[0]!.card_id as string) !== (activation.in_card_id as string) ||
          activeReplacement[0]!.player_id !== activation.in_player_id ||
          activeReplacement[0]!.position !== activation.line
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "bench activation must match the active replacement in the lineup",
            path: ["team_facts", "bench_activations", index],
          });
        }
      }
      for (let index = 0; index < availabilityEvents.length; index++) {
        const event = availabilityEvents[index]!;
        const corresponding = m.team_facts.bench_activations.filter(
          (activation) => activation.out_player_id === event.player_id,
        );
        const validShortHanded =
          event.short_handed &&
          corresponding.length === 0 &&
          event.replacement_card_id === null &&
          event.replacement_player_id === null;
        const validReplacement =
          !event.short_handed &&
          corresponding.length === 1 &&
          event.replacement_card_id !== null &&
          event.replacement_player_id !== null;
        if (!validShortHanded && !validReplacement) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "availability event replacement state contradicts bench activations",
            path: ["events", m.events.indexOf(event)],
          });
        }
      }
    }

    // Phase / round consistency.
    if (isGroupRound(m.round) && m.phase !== "group") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "group rounds must have phase 'group'",
        path: ["phase"],
      });
    }
    if (isKnockoutRound(m.round) && m.phase !== "knockout") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "knockout rounds must have phase 'knockout'",
        path: ["phase"],
      });
    }

    const regTied = m.user_goals === m.opp_goals;

    if (m.phase === "group") {
      if (m.user_goals_et !== null || m.opp_goals_et !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "group-stage matches never have ET goals",
          path: ["user_goals_et"],
        });
      }
      if (m.shootout !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "group-stage matches never have a shootout",
          path: ["shootout"],
        });
      }
      const expected: "W" | "D" | "L" =
        m.user_goals > m.opp_goals ? "W" : m.user_goals < m.opp_goals ? "L" : "D";
      if (m.outcome !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `group outcome ${m.outcome} does not match regulation score ${m.user_goals}-${m.opp_goals}`,
          path: ["outcome"],
        });
      }
      if (m.events.some((e) => e.type === "shootout_kick")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "group-stage matches must not contain shootout_kick events",
          path: ["events"],
        });
      }
    } else {
      // knockout
      if (m.outcome === "D") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "knockout matches must resolve to W or L (never D)",
          path: ["outcome"],
        });
      }
      if (!regTied) {
        // Decided in regulation.
        if (m.user_goals_et !== null || m.opp_goals_et !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "ET fields must be null when regulation is not tied",
            path: ["user_goals_et"],
          });
        }
        if (m.shootout !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "shootout must be null when regulation is not tied",
            path: ["shootout"],
          });
        }
        const expected: "W" | "L" = m.user_goals > m.opp_goals ? "W" : "L";
        if (m.outcome !== expected) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `knockout outcome ${m.outcome} does not match regulation winner`,
            path: ["outcome"],
          });
        }
      } else {
        // Tied after regulation → ET MUST be played.
        if (m.user_goals_et === null || m.opp_goals_et === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "ET fields must be non-null when knockout regulation is tied",
            path: ["user_goals_et"],
          });
        } else {
          const userFinal = m.user_goals + m.user_goals_et;
          const oppFinal = m.opp_goals + m.opp_goals_et;
          if (userFinal !== oppFinal) {
            if (m.shootout !== null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "shootout must be null when ET resolves the tie",
                path: ["shootout"],
              });
            }
            const expected: "W" | "L" = userFinal > oppFinal ? "W" : "L";
            if (m.outcome !== expected) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `knockout outcome ${m.outcome} does not match ET-included score`,
                path: ["outcome"],
              });
            }
          } else {
            // Still tied after ET — shootout MUST resolve.
            if (m.shootout === null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "shootout must be non-null when knockout is still tied after ET",
                path: ["shootout"],
              });
            } else if (m.shootout.user === m.shootout.opp) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "shootout cannot end level",
                path: ["shootout"],
              });
            } else {
              const expected: "W" | "L" = m.shootout.user > m.shootout.opp ? "W" : "L";
              if (m.outcome !== expected) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `knockout outcome ${m.outcome} does not match shootout winner`,
                  path: ["outcome"],
                });
              }
            }
          }
        }
      }

      // counts_as_run_win and advanced mirror W outcomes.
      if (m.counts_as_run_win !== (m.outcome === "W")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "counts_as_run_win must equal (outcome === 'W')",
          path: ["counts_as_run_win"],
        });
      }
      if (m.advanced !== (m.outcome === "W")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "advanced must equal (outcome === 'W') for knockout matches",
          path: ["advanced"],
        });
      }
    }

    // Shootout sequence ↔ shootout_kick events agreement.
    const shootoutEvents = m.events
      .filter((e): e is ShootoutKickEvent => e.type === "shootout_kick")
      .slice()
      .sort((a, b) => a.index - b.index);
    if (m.shootout !== null) {
      const seq = m.shootout.sequence.slice().sort((a, b) => a.index - b.index);
      if (seq.length !== shootoutEvents.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "shootout.sequence length must equal count of shootout_kick events",
          path: ["shootout", "sequence"],
        });
      } else {
        for (let i = 0; i < seq.length; i++) {
          const s = seq[i]!;
          const ev = shootoutEvents[i]!;
          if (
            s.index !== ev.index ||
            s.side !== ev.side ||
            s.scored !== ev.scored ||
            (s.taker_card_id as string | null) !== (ev.taker_card_id as string | null) ||
            s.taker_player_id !== ev.taker_player_id
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `shootout.sequence[${i}] does not match the projected shootout_kick event`,
              path: ["shootout", "sequence", i],
            });
            break;
          }
        }
      }
      const userScored = seq.filter((s) => s.side === "user" && s.scored).length;
      const oppScored = seq.filter((s) => s.side === "opp" && s.scored).length;
      if (m.shootout.user !== userScored || m.shootout.opp !== oppScored) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "shootout.user / shootout.opp must equal sequence scored-kick counts",
          path: ["shootout"],
        });
      }
    } else if (shootoutEvents.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shootout_kick events present but shootout payload is null",
        path: ["events"],
      });
    }

    // Lineup uniqueness on (side, player_id).
    const lineupKey = (e: { side: string; player_id: string }): string =>
      `${e.side}:${e.player_id}`;
    const seen = new Set<string>();
    for (let i = 0; i < m.lineup.length; i++) {
      const k = lineupKey(m.lineup[i]!);
      if (seen.has(k)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `lineup contains duplicate (side, player_id) at index ${i}`,
          path: ["lineup", i],
        });
        break;
      }
      seen.add(k);
    }
  }) as unknown as z.ZodType<MatchResult>;
