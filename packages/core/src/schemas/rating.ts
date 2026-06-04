// Zod schema for Rating — boundary schema between ETL output and runtime.

import { z } from "zod";

import type { Rating, RatingComponent, TeamStrength } from "../types/rating.js";

export const RatingComponentSchema = z.object({
  signal: z.string(),
  value: z.number().nullable(),
  weight: z.number(),
}) satisfies z.ZodType<RatingComponent>;

export const TeamStrengthSchema = z.object({
  attack: z.number(),
  midfield: z.number(),
  defense: z.number(),
  goalkeeping: z.number(),
  coverage: z.number(),
}) satisfies z.ZodType<TeamStrength>;

export const RatingSchema = z.object({
  card_id: z.string(),
  player_id: z.string(),
  tournament_id: z.number(),
  overall: z.number().nullable(),
  attack: z.number(),
  midfield: z.number(),
  defense: z.number(),
  goalkeeping: z.number(),
  components: z.array(RatingComponentSchema),
  coverage: z.number(),
  coverage_basis: z.enum(["wc_signals", "career_signals"]),
  provenance: z.enum(["wc_performance", "projected_career"]),
  rating_version: z.string(),
}) satisfies z.ZodType<Rating>;
