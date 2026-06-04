// Zod schemas for the identity layer — Nation / Player / PlayerTournament.
// These are TRUST-BOUNDARY schemas: the ETL dataset output is parsed through
// them before any sim / draft code touches the data.

import { z } from "zod";

import type { Nation, Player, PlayerTournament } from "../types/identity.js";
import { AwardSchema, PositionSchema, SourceRefSchema } from "./primitives.js";

export const NationSchema = z.object({
  nation_id: z.string(),
  canonical_name: z.string(),
  aliases: z.array(z.string()),
}) satisfies z.ZodType<Nation>;

export const PlayerSchema = z.object({
  player_id: z.string(),
  full_name: z.string(),
  common_name: z.string(),
  primary_position: PositionSchema,
  eligible_positions: z.array(PositionSchema),
  birth_date: z.string().nullable(),
  heritage_nation_id: z.string().nullable(),
  sources: z.array(SourceRefSchema),
}) satisfies z.ZodType<Player>;

export const PlayerTournamentSchema = z.object({
  card_id: z.string(),
  player_id: z.string(),
  tournament_id: z.number(),
  nation_id: z.string(),
  shirt_number: z.number().nullable(),
  position_listed: PositionSchema.nullable(),
  eligible_positions: z.array(PositionSchema),
  club_at_tournament: z.string().nullable(),
  appearances: z.number().nullable(),
  minutes: z.number().nullable(),
  goals: z.number().nullable(),
  assists: z.number().nullable(),
  awards: z.array(AwardSchema).nullable(),
  captain: z.boolean().nullable(),
  coverage: z.number(),
  sources: z.array(SourceRefSchema),
}) satisfies z.ZodType<PlayerTournament>;
