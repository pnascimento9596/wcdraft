// Zod schemas for persisted RunResult + supporting stats — boundary between
// disk / leaderboard submissions and the runtime.
//
// SuperRefine on the run + stats schemas enforces:
//   - PlayerMatchStats/PlayerRunStats card_id === buildCardId(player_id, tournament_id)
//   - per-match identity consistency with the outer PlayerRunStats
//   - RunResult: score = sum(breakdown.points)
//   - RunResult: aggregate.goals_for / goals_against / clean_sheets = sums over round_results
//   - RunResult: wins/draws/losses match round_results outcomes
//   - RunResult: narrative.narrative_seed === deriveSubseed(seed, "narrative")
//   - RunResult: is_champion / eliminated_in_match_id coherence

import { z } from "zod";

import type { PlayerMatchStats, PlayerRunStats } from "../types/stats.js";
import type { RoundResult, RunResult } from "../types/run.js";
import type { ScoreComponent } from "../types/scoring.js";
import { deriveSubseed } from "../rng.js";
import { CardIdSchema, refineCardIdConsistency } from "./identity.js";
import {
  MatchRoundSchema,
  MinuteSchema,
  NonEmptyIdSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
} from "./primitives.js";

export const ScoreComponentSchema = z
  .object({
    label: NonEmptyIdSchema,
    raw: z.number().refine(Number.isFinite, { message: "raw must be finite" }),
    weight: z.number().refine(Number.isFinite, { message: "weight must be finite" }),
    points: z.number().refine(Number.isFinite, { message: "points must be finite" }),
  })
  .superRefine((c, ctx) => {
    if (c.raw * c.weight !== c.points) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `points must equal raw * weight (got ${c.points} vs ${c.raw * c.weight})`,
        path: ["points"],
      });
    }
  }) satisfies z.ZodType<ScoreComponent>;

export const RoundResultSchema = z.object({
  round: MatchRoundSchema,
  advanced: z.boolean(),
  outcome: z.enum(["W", "D", "L"]),
  goals_for: NonNegativeIntegerSchema,
  goals_against: NonNegativeIntegerSchema,
}) satisfies z.ZodType<RoundResult>;

export const PlayerMatchStatsSchema = z
  .object({
    player_id: NonEmptyIdSchema,
    card_id: CardIdSchema,
    tournament_id: PositiveIntegerSchema,
    match_id: NonEmptyIdSchema,
    goals: NonNegativeIntegerSchema,
    assists: NonNegativeIntegerSchema,
    shots: NonNegativeIntegerSchema,
    shots_on_target: NonNegativeIntegerSchema,
    key_passes: NonNegativeIntegerSchema,
    fouls_committed: NonNegativeIntegerSchema,
    fouls_suffered: NonNegativeIntegerSchema,
    offsides: NonNegativeIntegerSchema,
    yellows: NonNegativeIntegerSchema,
    reds: NonNegativeIntegerSchema,
    saves: NonNegativeIntegerSchema,
    pens_won: NonNegativeIntegerSchema,
    pens_scored: NonNegativeIntegerSchema,
    pens_missed: NonNegativeIntegerSchema,
    minutes: MinuteSchema,
    subbed_on: z.boolean(),
    subbed_off: z.boolean(),
    injured: z.boolean(),
  })
  .superRefine((s, ctx) => {
    // try/catch-guarded card_id consistency — never throws out of safeParse.
    refineCardIdConsistency(s, ctx);
    // shots_on_target cannot exceed shots.
    if (s.shots_on_target > s.shots) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shots_on_target cannot exceed shots",
        path: ["shots_on_target"],
      });
    }
  }) satisfies z.ZodType<PlayerMatchStats>;

/**
 * Totals object excludes per-match-only flags (match_id, subbed_on,
 * subbed_off, injured) AND identity fields (player_id, card_id,
 * tournament_id) — see PlayerRunStats type docstring for rationale.
 */
const PlayerRunStatsTotalsSchema = z.object({
  goals: NonNegativeIntegerSchema,
  assists: NonNegativeIntegerSchema,
  shots: NonNegativeIntegerSchema,
  shots_on_target: NonNegativeIntegerSchema,
  key_passes: NonNegativeIntegerSchema,
  fouls_committed: NonNegativeIntegerSchema,
  fouls_suffered: NonNegativeIntegerSchema,
  offsides: NonNegativeIntegerSchema,
  yellows: NonNegativeIntegerSchema,
  reds: NonNegativeIntegerSchema,
  saves: NonNegativeIntegerSchema,
  pens_won: NonNegativeIntegerSchema,
  pens_scored: NonNegativeIntegerSchema,
  pens_missed: NonNegativeIntegerSchema,
  minutes: NonNegativeIntegerSchema,
}) satisfies z.ZodType<PlayerRunStats["totals"]>;

export const PlayerRunStatsSchema = z
  .object({
    player_id: NonEmptyIdSchema,
    card_id: CardIdSchema,
    tournament_id: PositiveIntegerSchema,
    per_match: z.array(PlayerMatchStatsSchema),
    totals: PlayerRunStatsTotalsSchema,
    rating_at_draft: z.number().nullable(),
  })
  .superRefine((s, ctx) => {
    // try/catch-guarded card_id consistency — never throws out of safeParse.
    refineCardIdConsistency(s, ctx);
    for (let i = 0; i < s.per_match.length; i++) {
      const row = s.per_match[i]!;
      if (
        row.player_id !== s.player_id ||
        (row.card_id as string) !== (s.card_id as string) ||
        row.tournament_id !== s.tournament_id
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `per_match[${i}] identity differs from PlayerRunStats root identity`,
          path: ["per_match", i],
        });
        break;
      }
    }
  }) satisfies z.ZodType<PlayerRunStats>;

export const RunResultSchema = z
  .object({
    run_id: NonEmptyIdSchema,
    scenario_id: NonEmptyIdSchema,
    dataset_version: NonEmptyIdSchema,
    rating_version: NonEmptyIdSchema,
    engine_version: NonEmptyIdSchema,
    seed: NonEmptyIdSchema,
    reached_round: MatchRoundSchema,
    eliminated_in_match_id: NonEmptyIdSchema.nullable(),
    is_champion: z.boolean(),
    undefeated_regulation: z.boolean(),
    record: NonEmptyIdSchema,
    wins: NonNegativeIntegerSchema,
    draws: NonNegativeIntegerSchema,
    losses: NonNegativeIntegerSchema,
    shootout_wins: NonNegativeIntegerSchema,
    shootout_losses: NonNegativeIntegerSchema,
    round_results: z.array(RoundResultSchema),
    aggregate: z.object({
      goals_for: NonNegativeIntegerSchema,
      goals_against: NonNegativeIntegerSchema,
      clean_sheets: NonNegativeIntegerSchema,
      top_scorer_player_id: NonEmptyIdSchema.nullable(),
    }),
    score: z.number().refine(Number.isFinite, { message: "score must be finite" }),
    score_breakdown: z.array(ScoreComponentSchema),
    player_stats: z.array(PlayerRunStatsSchema),
    narrative: z.object({
      template_id: NonEmptyIdSchema,
      narrative_seed: NonEmptyIdSchema,
      filled_text: z.string(),
    }),
  })
  .superRefine((run, ctx) => {
    // score === sum(breakdown.points)
    const summed = run.score_breakdown.reduce((acc, c) => acc + c.points, 0);
    if (summed !== run.score) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `score (${run.score}) must equal sum of score_breakdown.points (${summed})`,
        path: ["score"],
      });
    }

    // aggregate goals + clean sheets derive from round_results.
    const gf = run.round_results.reduce((a, r) => a + r.goals_for, 0);
    const ga = run.round_results.reduce((a, r) => a + r.goals_against, 0);
    const cs = run.round_results.filter((r) => r.goals_against === 0).length;
    if (run.aggregate.goals_for !== gf) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `aggregate.goals_for (${run.aggregate.goals_for}) must equal sum of round_results.goals_for (${gf})`,
        path: ["aggregate", "goals_for"],
      });
    }
    if (run.aggregate.goals_against !== ga) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `aggregate.goals_against (${run.aggregate.goals_against}) must equal sum of round_results.goals_against (${ga})`,
        path: ["aggregate", "goals_against"],
      });
    }
    if (run.aggregate.clean_sheets !== cs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `aggregate.clean_sheets (${run.aggregate.clean_sheets}) must equal count of round_results with goals_against === 0 (${cs})`,
        path: ["aggregate", "clean_sheets"],
      });
    }

    // wins/draws/losses match round_results outcomes.
    const wCount = run.round_results.filter((r) => r.outcome === "W").length;
    const dCount = run.round_results.filter((r) => r.outcome === "D").length;
    const lCount = run.round_results.filter((r) => r.outcome === "L").length;
    if (run.wins !== wCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `wins (${run.wins}) must equal count of round_results.outcome === 'W' (${wCount})`,
        path: ["wins"],
      });
    }
    if (run.draws !== dCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `draws (${run.draws}) must equal count of round_results.outcome === 'D' (${dCount})`,
        path: ["draws"],
      });
    }
    if (run.losses !== lCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `losses (${run.losses}) must equal count of round_results.outcome === 'L' (${lCount})`,
        path: ["losses"],
      });
    }
    if (run.shootout_wins > run.wins) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shootout_wins cannot exceed wins",
        path: ["shootout_wins"],
      });
    }
    if (run.shootout_losses > run.losses) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shootout_losses cannot exceed losses",
        path: ["shootout_losses"],
      });
    }

    // is_champion / eliminated coherence.
    if (run.is_champion) {
      if (run.eliminated_in_match_id !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "is_champion=true requires eliminated_in_match_id === null",
          path: ["eliminated_in_match_id"],
        });
      }
      const last = run.round_results[run.round_results.length - 1];
      if (!last || last.round !== "F" || last.outcome !== "W") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "is_champion=true requires the final round_result to be round F with outcome W",
          path: ["is_champion"],
        });
      }
    } else if (run.eliminated_in_match_id === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "non-champion runs require eliminated_in_match_id to be non-null",
        path: ["eliminated_in_match_id"],
      });
    }

    // narrative_seed must equal deriveSubseed(seed, "narrative").
    let expectedNarrative: string;
    try {
      expectedNarrative = deriveSubseed(run.seed, "narrative");
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `cannot derive narrative seed from run.seed: ${(err as Error).message}`,
        path: ["seed"],
      });
      return;
    }
    if (run.narrative.narrative_seed !== expectedNarrative) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `narrative.narrative_seed must equal deriveSubseed(seed, "narrative") = "${expectedNarrative}"`,
        path: ["narrative", "narrative_seed"],
      });
    }
  }) satisfies z.ZodType<RunResult>;
