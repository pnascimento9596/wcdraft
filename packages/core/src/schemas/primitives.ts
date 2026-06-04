// Zod schemas for the shared primitive types.
//
// SCOPE: only the leaf vocabulary used by the boundary schemas (Position,
// SourceRef, etc.) plus a small set of reusable numeric/string validators.
//
// HARD RULE: trust-boundary schemas (identity, rating, draft, sim, run,
// tournament, leaderboard) MUST consume these helpers instead of raw
// `z.string()` / `z.number()`. Bare `z.string()` accepts empty strings; bare
// `z.number()` accepts NaN / Infinity / negative ratings / out-of-range
// minutes — none of which represent honest state for this engine.

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

// ─── Shared numeric / string primitives ──────────────────────────────────────

/**
 * Non-empty, non-whitespace identifier string. Use anywhere a missing /
 * empty / whitespace-only id would silently corrupt downstream joins:
 * player_id, nation_id, tournament_id (string), card_id, seed strings,
 * version anchors, source.source / source.citation.
 *
 * Output is the original string — NO trim/transform — so persisted ids stay
 * byte-identical across round-trips.
 */
export const NonEmptyIdSchema: z.ZodType<string> = z
  .string()
  .refine((s) => s.trim().length > 0, { message: "id must be non-empty" });

/** Finite number in inclusive `[0, 1]` — used for coverage / confidence fractions. */
export const PercentSchema: z.ZodType<number> = z
  .number()
  .refine((n) => Number.isFinite(n) && n >= 0 && n <= 1, {
    message: "value must be a finite number in [0, 1]",
  });

/** Integer in inclusive `[0, 100]` — used for the four sim rating channels. */
export const RatingChannelSchema: z.ZodType<number> = z
  .number()
  .refine((n) => Number.isInteger(n) && n >= 0 && n <= 100, {
    message: "rating channel must be an integer in [0, 100]",
  });

/**
 * Integer minute marker in inclusive `[0, 130]`. Covers full regulation,
 * extra time, and a small overshoot for late stoppage events. Shootout
 * kicks may use minute `0` (their order is carried on the kick index, not
 * the minute), so `0` is allowed.
 */
export const MinuteSchema: z.ZodType<number> = z
  .number()
  .refine((n) => Number.isInteger(n) && n >= 0 && n <= 130, {
    message: "minute must be an integer in [0, 130]",
  });

/**
 * Build an inclusive integer-range schema. Output is a plain `number` so
 * the schema substitutes for the raw type in `satisfies z.ZodType<T>`.
 */
export function IntegerRangeSchema(min: number, max: number): z.ZodType<number> {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new RangeError(
      `IntegerRangeSchema requires integer min <= max, received: (${min}, ${max})`,
    );
  }
  return z.number().refine((n) => Number.isInteger(n) && n >= min && n <= max, {
    message: `value must be an integer in [${min}, ${max}]`,
  });
}

/** Convenience: non-negative finite integer (e.g. counts, appearances). */
export const NonNegativeIntegerSchema: z.ZodType<number> = z
  .number()
  .refine((n) => Number.isInteger(n) && n >= 0, {
    message: "value must be a non-negative integer",
  });

/** Convenience: positive finite integer (e.g. tournament_id, group_slot once narrowed). */
export const PositiveIntegerSchema: z.ZodType<number> = z
  .number()
  .refine((n) => Number.isInteger(n) && n > 0, { message: "value must be a positive integer" });

// ─── Enum / shape schemas ────────────────────────────────────────────────────

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
 * Formation: 3 or 4 hyphen-separated POSITIVE integer parts whose sum equals
 * exactly 10 (the outfield count; the goalkeeper is implicit).
 *
 * Rejects:
 *  - shapes with a zero part (e.g. "0-5-5")
 *  - shapes whose sum is not 10 (e.g. "4-4-3")
 *  - shapes with too few / too many parts (e.g. "4-4", "4-3-2-1-0")
 *  - leading zeros in any part (e.g. "04-3-3")
 *
 * Uses `z.custom` so the schema input and output are both `Formation` —
 * required for `satisfies z.ZodType<T>` on owners like `DraftStateSchema`.
 */
const FORMATION_RE = /^[1-9]\d*-[1-9]\d*-[1-9]\d*(-[1-9]\d*)?$/;
export const FormationSchema: z.ZodType<Formation> = z.custom<Formation>(
  (v) => {
    if (typeof v !== "string") return false;
    if (!FORMATION_RE.test(v)) return false;
    const parts = v.split("-").map((p) => Number.parseInt(p, 10));
    if (parts.some((p) => !Number.isInteger(p) || p <= 0)) return false;
    const sum = parts.reduce((a, b) => a + b, 0);
    return sum === 10;
  },
  {
    message:
      "Formation must be 3 or 4 hyphen-separated positive integers summing to exactly 10",
  },
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
  source: NonEmptyIdSchema,
  source_type: z.enum(["fjelstul", "wikipedia", "rsssf", "other"]),
  citation: NonEmptyIdSchema,
  retrieved_date: z.string().nullable(),
  field: z.string().nullable(),
  confidence: PercentSchema.nullable(),
}) satisfies z.ZodType<SourceRef>;
