import { describe, it, expect } from "vitest";

import type { Player } from "../types/identity.js";
import type { RunResult } from "../types/run.js";
import type { LeaderboardSubmission } from "./leaderboard.js";

import { LeaderboardSubmissionSchema, PlayerSchema, RunResultSchema } from "./index.js";

// Zod boundary schemas — ACTIVE TESTS (not .skip): the schemas must compile
// and a hand-written fixture for each of Player / RunResult /
// LeaderboardSubmission must round-trip via .parse() to the deep-equal object.
//
// These are not algorithm tests — they exist to keep the schema and the type
// in lockstep. The `satisfies z.ZodType<T>` assertions in the schema files
// catch most drift at compile time; these tests catch any runtime regression
// (e.g. someone makes a `.nullable()` an `.optional()` and a fixture that
// used `null` now fails to parse).

describe("zod boundary schemas — hand-written fixture round-trips", () => {
  it("Player round-trips via PlayerSchema.parse", () => {
    const fixture: Player = {
      player_id: "player.puskas.ferenc",
      full_name: "Ferenc Puskás",
      common_name: "Puskás",
      primary_position: "FW",
      eligible_positions: ["FW", "MF"],
      birth_date: "1927-04-02",
      // heritage_nation_id: NOT the same as the per-card representing nation.
      // Documented invariant — Player.heritage_nation_id is ER/display only.
      heritage_nation_id: "hun",
      sources: [
        {
          source: "fjelstul",
          source_type: "fjelstul",
          citation: "Fjelstul WC Database, players table",
          retrieved_date: "2026-05-01",
          field: null,
          confidence: 0.95,
        },
      ],
    };

    const parsed = PlayerSchema.parse(fixture);
    expect(parsed).toEqual(fixture);
  });

  it("RunResult round-trips via RunResultSchema.parse", () => {
    const fixture: RunResult = {
      run_id: "run.fixture.1",
      scenario_id: "scenario.fixture.1",
      dataset_version: "dataset@0.0.0",
      rating_version: "rating@0.0.0",
      engine_version: "engine@0.0.0",
      reached_round: "F",
      eliminated_in_match_id: null,
      is_champion: true,
      undefeated_regulation: true,
      record: "8-0-0",
      wins: 8,
      draws: 0,
      losses: 0,
      shootout_wins: 0,
      shootout_losses: 0,
      aggregate: {
        goals_for: 20,
        goals_against: 4,
        top_scorer_player_id: "player.puskas.ferenc",
      },
      score: 0, // placeholder weights → 0 (see PLACEHOLDER_SCORING_CONFIG)
      score_breakdown: [
        {
          label: "Goals scored",
          raw: 20,
          weight: 0,
          points: 0,
        },
      ],
      player_stats: [
        {
          player_id: "player.puskas.ferenc",
          card_id: "player.puskas.ferenc:1954",
          per_match: [],
          totals: {
            player_id: "player.puskas.ferenc",
            card_id: "player.puskas.ferenc:1954",
            goals: 4,
            assists: 2,
            shots: 18,
            shots_on_target: 11,
            key_passes: 7,
            fouls_committed: 3,
            fouls_suffered: 9,
            offsides: 2,
            yellows: 0,
            reds: 0,
            saves: 0,
            pens_won: 1,
            pens_scored: 1,
            pens_missed: 0,
            minutes: 720,
          },
          rating_at_draft: 92,
        },
      ],
      narrative: {
        template_id: "narrative.template.undefeated_champion.v1",
        filled_text: "Your XI lifted the trophy unbeaten.",
      },
    };

    const parsed = RunResultSchema.parse(fixture);
    expect(parsed).toEqual(fixture);
  });

  it("LeaderboardSubmission round-trips via LeaderboardSubmissionSchema.parse", () => {
    const fixture: LeaderboardSubmission = {
      run_id: "run.fixture.1",
      draft_id: "run.fixture.1",
      scenario_id: "scenario.fixture.1",
      draft_seed: "seed.draft.fixture.1",
      scenario_seed: "seed.scenario.fixture.1",
      run_seed: "seed.run.fixture.1",
      dataset_version: "dataset@0.0.0",
      rating_version: "rating@0.0.0",
      engine_version: "engine@0.0.0",
      claimed_score: 0,
    };

    const parsed = LeaderboardSubmissionSchema.parse(fixture);
    expect(parsed).toEqual(fixture);
  });

  it("Player parse REJECTS coerced-missing (e.g. heritage_nation_id as empty string is allowed; numeric goals as null is allowed)", () => {
    // Sanity: the honest-state rule means we accept `null` for unknowns. We do
    // NOT coerce; we DO require explicit `null`. A missing field is a parse error.
    const bad = {
      player_id: "x",
      full_name: "X",
      common_name: "X",
      primary_position: "FW",
      eligible_positions: ["FW"],
      // birth_date MISSING — must fail (we require explicit null).
      heritage_nation_id: null,
      sources: [],
    };
    const result = PlayerSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
