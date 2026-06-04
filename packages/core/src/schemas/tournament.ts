// Zod schema for Team2026 — boundary schema between ETL projections and runtime.
// Tournament/Bracket2026/RunScenario do not have zod boundaries in WS-0b: they
// are constructed in-process from the dataset, not parsed at a trust boundary.

import { z } from "zod";

import type { Team2026 } from "../types/tournament.js";
import { CardIdSchema } from "./identity.js";
import {
  GroupIdSchema,
  IntegerRangeSchema,
  NonEmptyIdSchema,
  SourceRefSchema,
} from "./primitives.js";
import { TeamStrengthSchema } from "./rating.js";

export const Team2026Schema = z.object({
  team_id: NonEmptyIdSchema,
  nation_id: NonEmptyIdSchema,
  group: GroupIdSchema,
  group_slot: IntegerRangeSchema(1, 4),
  squad_card_ids: z.array(CardIdSchema),
  aggregate_rating: TeamStrengthSchema,
  squad_status: z.enum(["projected", "locked", "final"]),
  rating_version: NonEmptyIdSchema,
  sources: z.array(SourceRefSchema),
}) satisfies z.ZodType<Team2026>;
