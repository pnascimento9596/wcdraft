// Zod schemas for the identity layer — Nation / Player / PlayerTournament.
// These are TRUST-BOUNDARY schemas: the ETL dataset output is parsed through
// them before any sim / draft code touches the data.

import { z } from "zod";

import type { CardId, Nation, Player, PlayerTournament } from "../types/identity.js";
import { buildCardId, parseCardId } from "../types/identity.js";
import {
  AwardSchema,
  NonEmptyIdSchema,
  NonNegativeIntegerSchema,
  PercentSchema,
  PositionSchema,
  PositiveIntegerSchema,
  SourceRefSchema,
} from "./primitives.js";

/**
 * Branded `CardId` schema. Accepts only strings that parse via `parseCardId`
 * (i.e. `<player_id>:<tournament_id>` with non-empty player_id and a positive
 * safe-integer tournament_id). The schema OUTPUT is the branded `CardId`
 * type so `satisfies z.ZodType<CardId>` on owner schemas type-checks.
 */
export const CardIdSchema = z.string().refine((s) => parseCardId(s) !== null, {
  message: "card_id must be of form '<player_id>:<tournament_id>'",
}) as unknown as z.ZodType<CardId>;

/**
 * Helper: shared cross-field refinement asserting that a record's `card_id`
 * exactly equals `buildCardId(player_id, tournament_id)`. Used by every
 * schema whose record carries all three fields.
 */
export function refineCardIdConsistency<
  T extends { card_id: CardId; player_id: string; tournament_id: number },
>(value: T, ctx: z.RefinementCtx): void {
  let expected: string;
  try {
    expected = buildCardId(value.player_id, value.tournament_id);
  } catch (err) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `card_id cannot be built from (player_id, tournament_id): ${(err as Error).message}`,
      path: ["card_id"],
    });
    return;
  }
  if ((value.card_id as string) !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `card_id must equal buildCardId(player_id, tournament_id) = "${expected}"`,
      path: ["card_id"],
    });
  }
}

export const NationSchema = z.object({
  nation_id: NonEmptyIdSchema,
  canonical_name: NonEmptyIdSchema,
  aliases: z.array(z.string()),
}) satisfies z.ZodType<Nation>;

export const PlayerSchema = z.object({
  player_id: NonEmptyIdSchema,
  full_name: NonEmptyIdSchema,
  common_name: NonEmptyIdSchema,
  primary_position: PositionSchema,
  eligible_positions: z.array(PositionSchema).min(1),
  birth_date: z.string().nullable(),
  heritage_nation_id: NonEmptyIdSchema.nullable(),
  sources: z.array(SourceRefSchema),
}) satisfies z.ZodType<Player>;

export const PlayerTournamentSchema = z
  .object({
    // SOURCE-DATA NOTE: `minutes` and `assists` are intentionally OMITTED
    // from this schema and the underlying type. Fjelstul has no
    // assists/minutes at any era — do not re-add to the source layer.
    card_id: CardIdSchema,
    player_id: NonEmptyIdSchema,
    tournament_id: PositiveIntegerSchema,
    nation_id: NonEmptyIdSchema,
    shirt_number: z.number().int().nullable(),
    position_listed: PositionSchema.nullable(),
    eligible_positions: z.array(PositionSchema).min(1),
    club_at_tournament: z.string().nullable(),
    // Match-level appearance counts exist 1970+ only; null pre-1970.
    appearances: NonNegativeIntegerSchema.nullable(),
    goals: NonNegativeIntegerSchema.nullable(),
    awards: z.array(AwardSchema).nullable(),
    captain: z.boolean().nullable(),
    coverage: PercentSchema,
    sources: z.array(SourceRefSchema),
  })
  .superRefine(refineCardIdConsistency) satisfies z.ZodType<PlayerTournament>;
