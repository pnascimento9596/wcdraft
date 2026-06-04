// Zod schema for persisted DraftState — boundary between disk / network and runtime.

import { z } from "zod";

import type { DraftState, Spin, SquadSlot, SquadValidation } from "../types/draft.js";
import { FormationSchema, PositionSchema } from "./primitives.js";

export const SpinSchema = z.object({
  index: z.number(),
  tournament_id: z.number(),
  nation_id: z.string(),
  rolled_card_ids: z.array(z.string()),
  excluded_player_ids: z.array(z.string()),
  picked_card_id: z.string().nullable(),
  picked_player_id: z.string().nullable(),
  assigned_slot_id: z.string().nullable(),
  status: z.enum(["pending", "picked"]),
}) satisfies z.ZodType<Spin>;

export const SquadSlotSchema = z.object({
  slot_id: z.string(),
  is_starter: z.boolean(),
  lineup_position: PositionSchema,
  allowed_positions: z.array(PositionSchema),
  card_id: z.string().nullable(),
  player_id: z.string().nullable(),
  slot_valid: z.boolean(),
  validation_warnings: z.array(z.string()),
}) satisfies z.ZodType<SquadSlot>;

export const SquadValidationSchema = z.object({
  is_fieldable: z.boolean(),
  has_goalkeeper: z.boolean(),
  warnings: z.array(z.string()),
}) satisfies z.ZodType<SquadValidation>;

export const DraftStateSchema = z.object({
  run_id: z.string(),
  draft_seed: z.string(),
  mode: z.enum(["classic", "hidden"]),
  formation: FormationSchema,
  team_name: z.string(),
  spins: z.array(SpinSchema),
  squad: z.array(SquadSlotSchema),
  status: z.enum(["drafting", "ready", "simulated"]),
  deduped_player_ids: z.array(z.string()),
  dataset_version: z.string(),
  rating_version: z.string(),
  engine_version: z.string(),
}) satisfies z.ZodType<DraftState>;
