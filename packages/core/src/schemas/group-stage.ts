// I3.3 — Zod boundary schemas for the additive group-stage result.
//
// Used by the I3.6 real-data e2e golden (and any future leaderboard / replay
// boundary that serializes `GroupStageResult`). Internal callers in the
// engine consume the typed surface directly; the schema enforces the
// invariants the type comments document.

import { z } from "zod";

import {
  USER_GROUP_PARTICIPANT_ID,
  type GroupOtherMatchSummary,
  type GroupParticipantKind,
  type GroupQualification,
  type GroupStageResult,
  type GroupStanding,
} from "../types/group-stage.js";
import {
  GroupIdSchema,
  IntegerRangeSchema,
  NonEmptyIdSchema,
  NonNegativeIntegerSchema,
} from "./primitives.js";

const GroupParticipantKindSchema: z.ZodType<GroupParticipantKind> = z.enum(["user", "team"]);

const GroupQualificationSchema: z.ZodType<GroupQualification> = z.enum([
  "top_two",
  "best_third_threshold",
  "eliminated",
]);

const GroupOtherOutcomeSchema = z.enum(["A", "D", "B"]);

const GroupRoundSchema = z.enum(["G1", "G2", "G3"]);

export const GroupStandingSchema = z
  .object({
    rank: IntegerRangeSchema(1, 4),
    participant_id: NonEmptyIdSchema,
    kind: GroupParticipantKindSchema,
    team_id: NonEmptyIdSchema.nullable(),
    played: NonNegativeIntegerSchema,
    wins: NonNegativeIntegerSchema,
    draws: NonNegativeIntegerSchema,
    losses: NonNegativeIntegerSchema,
    goals_for: NonNegativeIntegerSchema,
    goals_against: NonNegativeIntegerSchema,
    goal_difference: z.number().refine(Number.isInteger, "goal_difference must be an integer"),
    points: NonNegativeIntegerSchema,
    draw_lots_rank: IntegerRangeSchema(1, 4),
  })
  .superRefine((s, ctx) => {
    if (s.played !== s.wins + s.draws + s.losses) {
      ctx.addIssue({
        code: "custom",
        message: `played (${s.played}) must equal wins+draws+losses (${s.wins + s.draws + s.losses})`,
      });
    }
    if (s.goal_difference !== s.goals_for - s.goals_against) {
      ctx.addIssue({
        code: "custom",
        message: `goal_difference (${s.goal_difference}) must equal goals_for-goals_against`,
      });
    }
    if (s.points !== s.wins * 3 + s.draws) {
      ctx.addIssue({
        code: "custom",
        message: `points (${s.points}) must equal wins*3 + draws`,
      });
    }
    if (s.kind === "user") {
      if (s.participant_id !== USER_GROUP_PARTICIPANT_ID) {
        ctx.addIssue({
          code: "custom",
          message: `user standing must have participant_id "${USER_GROUP_PARTICIPANT_ID}"`,
        });
      }
      if (s.team_id !== null) {
        ctx.addIssue({ code: "custom", message: "user standing must have team_id === null" });
      }
    } else {
      // team
      if (s.team_id === null) {
        ctx.addIssue({ code: "custom", message: "team standing must have non-null team_id" });
      }
      if (s.participant_id !== s.team_id) {
        ctx.addIssue({
          code: "custom",
          message: "team standing participant_id must equal team_id",
        });
      }
    }
  }) satisfies z.ZodType<GroupStanding>;

export const GroupOtherMatchSummarySchema = z
  .object({
    other_match_index: IntegerRangeSchema(0, 2),
    match_id: NonEmptyIdSchema,
    round: GroupRoundSchema,
    team_a_id: NonEmptyIdSchema,
    team_b_id: NonEmptyIdSchema,
    team_a_goals: NonNegativeIntegerSchema,
    team_b_goals: NonNegativeIntegerSchema,
    outcome: GroupOtherOutcomeSchema,
  })
  .superRefine((m, ctx) => {
    if (m.team_a_id === m.team_b_id) {
      ctx.addIssue({ code: "custom", message: "team_a_id and team_b_id must differ" });
    }
    const expected =
      m.team_a_goals > m.team_b_goals ? "A" : m.team_a_goals < m.team_b_goals ? "B" : "D";
    if (m.outcome !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `outcome ${m.outcome} disagrees with scoreline (expected ${expected})`,
      });
    }
  }) satisfies z.ZodType<GroupOtherMatchSummary>;

export const GroupStageResultSchema = z
  .object({
    group_id: GroupIdSchema,
    standings: z.array(GroupStandingSchema).length(4),
    user_rank: IntegerRangeSchema(1, 4),
    user_qualified: z.boolean(),
    qualification: GroupQualificationSchema,
    other_matches: z.array(GroupOtherMatchSummarySchema).length(3),
  })
  .superRefine((gs, ctx) => {
    // Ranks form exactly {1,2,3,4}.
    const ranks = gs.standings.map((s) => s.rank).sort();
    if (!(ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3 && ranks[3] === 4)) {
      ctx.addIssue({
        code: "custom",
        message: `standings ranks must be a permutation of [1,2,3,4], got ${JSON.stringify(ranks)}`,
      });
    }
    // Draw-lots ranks form exactly {1,2,3,4}.
    const dls = gs.standings.map((s) => s.draw_lots_rank).sort();
    if (!(dls[0] === 1 && dls[1] === 2 && dls[2] === 3 && dls[3] === 4)) {
      ctx.addIssue({
        code: "custom",
        message: `draw_lots_ranks must be a permutation of [1,2,3,4], got ${JSON.stringify(dls)}`,
      });
    }
    // Exactly one user row.
    const userRows = gs.standings.filter((s) => s.kind === "user");
    if (userRows.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `expected exactly one user standing, got ${userRows.length}`,
      });
    }
    // user_rank must match the user row's rank.
    const userRow = userRows[0];
    if (userRow && userRow.rank !== gs.user_rank) {
      ctx.addIssue({
        code: "custom",
        message: `user_rank (${gs.user_rank}) must equal user standing.rank (${userRow.rank})`,
      });
    }
    // Qualification coherence.
    if (gs.user_rank <= 2) {
      if (!gs.user_qualified || gs.qualification !== "top_two") {
        ctx.addIssue({
          code: "custom",
          message: "user_rank<=2 must imply user_qualified=true AND qualification='top_two'",
        });
      }
    } else if (gs.user_rank === 3) {
      if (gs.user_qualified && gs.qualification !== "best_third_threshold") {
        ctx.addIssue({
          code: "custom",
          message: "user_rank=3 qualified must imply qualification='best_third_threshold'",
        });
      }
      if (!gs.user_qualified && gs.qualification !== "eliminated") {
        ctx.addIssue({
          code: "custom",
          message: "user_rank=3 not qualified must imply qualification='eliminated'",
        });
      }
    } else {
      // rank 4
      if (gs.user_qualified || gs.qualification !== "eliminated") {
        ctx.addIssue({
          code: "custom",
          message: "user_rank=4 must imply user_qualified=false AND qualification='eliminated'",
        });
      }
    }
    // Team rows have unique team_ids and match the other_matches participant set.
    const teamRows = gs.standings.filter((s) => s.kind === "team");
    const teamIds = new Set(teamRows.map((s) => s.team_id));
    if (teamIds.size !== teamRows.length) {
      ctx.addIssue({ code: "custom", message: "team standings must have unique team_ids" });
    }
    for (const om of gs.other_matches) {
      if (!teamIds.has(om.team_a_id) || !teamIds.has(om.team_b_id)) {
        ctx.addIssue({
          code: "custom",
          message: `other_match ${om.match_id} references unknown team(s)`,
        });
      }
    }
    // other_match_index is exactly {0,1,2}.
    const omIdx = gs.other_matches.map((m) => m.other_match_index).sort();
    if (!(omIdx[0] === 0 && omIdx[1] === 1 && omIdx[2] === 2)) {
      ctx.addIssue({
        code: "custom",
        message: `other_match_index must be a permutation of [0,1,2], got ${JSON.stringify(omIdx)}`,
      });
    }
  }) satisfies z.ZodType<GroupStageResult>;
