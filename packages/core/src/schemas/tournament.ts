// Zod schema for Team2026 — boundary schema between ETL projections and runtime.
// Tournament/Bracket2026/RunScenario do not have zod boundaries in WS-0b: they
// are constructed in-process from the dataset, not parsed at a trust boundary.

import { z } from "zod";

import type { Team2026 } from "../types/tournament.js";
import { GroupIdSchema, SourceRefSchema } from "./primitives.js";
import { TeamStrengthSchema } from "./rating.js";

export const Team2026Schema = z.object({
  team_id: z.string(),
  nation_id: z.string(),
  group: GroupIdSchema,
  group_slot: z.number(),
  squad_card_ids: z.array(z.string()),
  aggregate_rating: TeamStrengthSchema,
  squad_status: z.enum(["projected", "locked", "final"]),
  rating_version: z.string(),
  sources: z.array(SourceRefSchema),
}) satisfies z.ZodType<Team2026>;
