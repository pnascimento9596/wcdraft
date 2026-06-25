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
