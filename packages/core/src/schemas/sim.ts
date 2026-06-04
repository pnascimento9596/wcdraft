// Zod schema for MatchResult — referenced by the persisted-run boundary
// (a RunResult is derivable from events, but the persisted RunResult does NOT
// embed full event logs; tests + replays use MatchResult separately).

import { z } from "zod";

import type { MatchEvent, MatchResult, ShootoutKick } from "../types/sim.js";
import { MatchPeriodSchema, MatchPhaseSchema, MatchRoundSchema } from "./primitives.js";

export const MatchEventSchema = z.object({
  event_id: z.string(),
  minute: z.number(),
  period: MatchPeriodSchema,
  side: z.enum(["user", "opp"]),
  type: z.enum([
    "goal",
    "own_goal",
    "pen_scored",
    "pen_missed",
    "assist",
    "shot_on",
    "shot_off",
    "save",
    "shootout_score",
    "shootout_miss",
    "shootout_save",
    "foul",
    "offside",
    "yellow",
    "red",
    "injury",
    "sub",
  ]),
  player_id: z.string().nullable(),
  assist_player_id: z.string().nullable(),
  score_after: z
    .object({
      user: z.number(),
      opp: z.number(),
    })
    .nullable(),
  counts_for_top_scorer: z.boolean(),
  detail: z.string().nullable(),
}) satisfies z.ZodType<MatchEvent>;

export const ShootoutKickSchema = z.object({
  index: z.number(),
  side: z.enum(["user", "opp"]),
  player_id: z.string().nullable(),
  scored: z.boolean(),
}) satisfies z.ZodType<ShootoutKick>;

export const MatchResultSchema = z.object({
  match_id: z.string(),
  match_index: z.number(),
  round: MatchRoundSchema,
  phase: MatchPhaseSchema,
  opponent_team_id: z.string(),
  user_goals: z.number(),
  opp_goals: z.number(),
  user_goals_et: z.number().nullable(),
  opp_goals_et: z.number().nullable(),
  shootout: z
    .object({
      user: z.number(),
      opp: z.number(),
      sequence: z.array(ShootoutKickSchema),
    })
    .nullable(),
  outcome: z.enum(["W", "D", "L"]),
  counts_as_run_win: z.boolean(),
  advanced: z.boolean(),
  events: z.array(MatchEventSchema),
}) satisfies z.ZodType<MatchResult>;
