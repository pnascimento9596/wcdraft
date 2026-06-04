// Zod schemas for the shared primitive types.
//
// SCOPE: only the leaf vocabulary used by the boundary schemas (Position,
// SourceRef, etc.). Not every internal type needs zod — see schemas/README.md
// for the trust-boundary rule.

import { z } from "zod";

import type {
  Award,
  AwardType,
  Formation,
  GroupId,
  KnockoutRound,
  MatchPhase,
  MatchPeriod,
  MatchRound,
  Position,
  SourceRef,
} from "../types/primitives.js";

export const PositionSchema = z.enum(["GK", "DF", "MF", "FW"]) satisfies z.ZodType<Position>;

export const AwardTypeSchema = z.enum([
  "golden_ball",
  "silver_ball",
  "bronze_ball",
  "golden_boot",
  "silver_boot",
  "bronze_boot",
  "golden_glove",
  "best_young_player",
  "all_tournament_team",
  "fair_play",
]) satisfies z.ZodType<AwardType>;

export const AwardSchema = z.object({
  award_type: AwardTypeSchema,
  description: z.string().nullable(),
}) satisfies z.ZodType<Award>;

/**
 * Formation regex: 2..4 hyphen-separated positive integers. Stays
 * permissive on purpose — exotic shapes (e.g. "3-1-4-2") must validate.
 *
 * Uses `z.custom` rather than `.transform()` so the schema input and output
 * are both `Formation` — required for `satisfies z.ZodType<T>` matching on
 * any owner type that embeds `formation: Formation` (e.g. DraftStateSchema).
 */
const FORMATION_RE = /^\d+-\d+-\d+(-\d+)?$/;
export const FormationSchema: z.ZodType<Formation> = z.custom<Formation>(
  (v) => typeof v === "string" && FORMATION_RE.test(v),
  { message: "Formation must be of form 'X-Y-Z' or 'W-X-Y-Z'" },
);

export const GroupIdSchema = z.enum([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
]) satisfies z.ZodType<GroupId>;

export const KnockoutRoundSchema = z.enum([
  "R32",
  "R16",
  "QF",
  "SF",
  "F",
]) satisfies z.ZodType<KnockoutRound>;

export const MatchRoundSchema = z.enum([
  "G1",
  "G2",
  "G3",
  "R32",
  "R16",
  "QF",
  "SF",
  "F",
]) satisfies z.ZodType<MatchRound>;

export const MatchPhaseSchema = z.enum(["group", "knockout"]) satisfies z.ZodType<MatchPhase>;

export const MatchPeriodSchema = z.enum([
  "1H",
  "2H",
  "ET1",
  "ET2",
  "shootout",
]) satisfies z.ZodType<MatchPeriod>;

export const SourceRefSchema = z.object({
  source: z.string(),
  source_type: z.enum(["fjelstul", "wikipedia", "rsssf", "other"]),
  citation: z.string(),
  retrieved_date: z.string().nullable(),
  field: z.string().nullable(),
  confidence: z.number().nullable(),
}) satisfies z.ZodType<SourceRef>;
