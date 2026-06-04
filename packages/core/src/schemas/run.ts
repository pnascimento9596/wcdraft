// Zod schemas for persisted RunResult + supporting stats — boundary between
// disk / leaderboard submissions and the runtime.

import { z } from "zod";

import type { PlayerMatchStats, PlayerRunStats } from "../types/stats.js";
import type { RunResult } from "../types/run.js";
import type { ScoreComponent } from "../types/scoring.js";
import { MatchRoundSchema } from "./primitives.js";

export const ScoreComponentSchema = z.object({
  label: z.string(),
  raw: z.number(),
  weight: z.number(),
  points: z.number(),
}) satisfies z.ZodType<ScoreComponent>;

export const PlayerMatchStatsSchema = z.object({
  player_id: z.string(),
  card_id: z.string(),
  match_id: z.string(),
  goals: z.number(),
  assists: z.number(),
  shots: z.number(),
  shots_on_target: z.number(),
  key_passes: z.number(),
  fouls_committed: z.number(),
  fouls_suffered: z.number(),
  offsides: z.number(),
  yellows: z.number(),
  reds: z.number(),
  saves: z.number(),
  pens_won: z.number(),
  pens_scored: z.number(),
  pens_missed: z.number(),
  minutes: z.number(),
  subbed_on: z.boolean(),
  subbed_off: z.boolean(),
  injured: z.boolean(),
}) satisfies z.ZodType<PlayerMatchStats>;

/**
 * Totals object excludes per-match-only flags (match_id, subbed_on,
 * subbed_off, injured) — see PlayerRunStats type docstring for rationale.
 */
const PlayerRunStatsTotalsSchema = z.object({
  player_id: z.string(),
  card_id: z.string(),
  goals: z.number(),
  assists: z.number(),
  shots: z.number(),
  shots_on_target: z.number(),
  key_passes: z.number(),
  fouls_committed: z.number(),
  fouls_suffered: z.number(),
  offsides: z.number(),
  yellows: z.number(),
  reds: z.number(),
  saves: z.number(),
  pens_won: z.number(),
  pens_scored: z.number(),
  pens_missed: z.number(),
  minutes: z.number(),
}) satisfies z.ZodType<PlayerRunStats["totals"]>;

export const PlayerRunStatsSchema = z.object({
  player_id: z.string(),
  card_id: z.string(),
  per_match: z.array(PlayerMatchStatsSchema),
  totals: PlayerRunStatsTotalsSchema,
  rating_at_draft: z.number().nullable(),
}) satisfies z.ZodType<PlayerRunStats>;

export const RunResultSchema = z.object({
  run_id: z.string(),
  scenario_id: z.string(),
  dataset_version: z.string(),
  rating_version: z.string(),
  engine_version: z.string(),
  reached_round: MatchRoundSchema,
  eliminated_in_match_id: z.string().nullable(),
  is_champion: z.boolean(),
  undefeated_regulation: z.boolean(),
  record: z.string(),
  wins: z.number(),
  draws: z.number(),
  losses: z.number(),
  shootout_wins: z.number(),
  shootout_losses: z.number(),
  aggregate: z.object({
    goals_for: z.number(),
    goals_against: z.number(),
    top_scorer_player_id: z.string().nullable(),
  }),
  score: z.number(),
  score_breakdown: z.array(ScoreComponentSchema),
  player_stats: z.array(PlayerRunStatsSchema),
  narrative: z.object({
    template_id: z.string(),
    filled_text: z.string(),
  }),
}) satisfies z.ZodType<RunResult>;
