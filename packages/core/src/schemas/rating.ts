// Zod schema for Rating — boundary schema between ETL output and runtime.

import { z } from "zod";

import type { ProvenanceRating, Rating, RatingComponent, TeamStrength } from "../types/rating.js";
import { CardIdSchema, refineCardIdConsistency } from "./identity.js";
import {
  NonEmptyIdSchema,
  PercentSchema,
  PositiveIntegerSchema,
  RatingChannelSchema,
} from "./primitives.js";

export const RatingComponentSchema = z.object({
  signal: NonEmptyIdSchema,
  value: z.number().nullable(),
  weight: z.number().refine((n) => Number.isFinite(n) && n >= 0, {
    message: "rating component weight must be a finite, non-negative number",
  }),
}) satisfies z.ZodType<RatingComponent>;

export const TeamStrengthSchema = z.object({
  attack: RatingChannelSchema,
  midfield: RatingChannelSchema,
  defense: RatingChannelSchema,
  goalkeeping: RatingChannelSchema,
  coverage: PercentSchema,
}) satisfies z.ZodType<TeamStrength>;

export const RatingSchema = z
  .object({
    card_id: CardIdSchema,
    player_id: NonEmptyIdSchema,
    tournament_id: PositiveIntegerSchema,
    overall: RatingChannelSchema.nullable(),
    attack: RatingChannelSchema,
    midfield: RatingChannelSchema,
    defense: RatingChannelSchema,
    goalkeeping: RatingChannelSchema,
    coverage: PercentSchema,
    coverage_basis: z.enum(["wc_signals", "career_signals"]),
    provenance: z.enum(["wc_performance", "projected_career"]),
    rating_version: NonEmptyIdSchema,
  })
  .superRefine(refineCardIdConsistency) satisfies z.ZodType<Rating>;

export const ProvenanceRatingSchema = RatingSchema.extend({
  components: z.array(RatingComponentSchema),
}) satisfies z.ZodType<ProvenanceRating>;
