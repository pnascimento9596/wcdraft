// I3.6 — real-data end-to-end determinism golden.
//
// Loads the generated locked compact bundles, drives the full pipeline:
//   real DraftPoolBundle  → DraftCatalog
//                         → autoDraft (deterministic, fixed seed)
//                         → buildRunScenario (real Bracket2026 + Team2026[])
//                         → runTournamentFull
// and asserts byte-identical `DraftState` / `RunScenario` / `RunResult` /
// `MatchResult[]` / `GroupStageResult` against a committed JSON fixture.
//
// FIXED SEED RATIONALE:
//   `PARENT_SEED` was chosen by a bounded deterministic search (see PR notes)
//   so the drafted squad includes at least one historical rating with
//   `overall_basis === "baseline_anchor_estimate"` (locks the honest-state
//   adapter path through the full pipeline) AND the user qualifies out of the
//   group (so the bracket-constrained R32 selection path is exercised on
//   real data).
//
// FIXTURE REGEN: do NOT have the test write the fixture. If the engine /
// dataset / rating / ruleset versions intentionally change, regenerate the
// fixture manually, inspect the diff, and explain it in the PR.

import { describe, expect, it } from "vitest";

import {
  autoDraft,
  buildRunScenario,
  runTournamentFull,
  type Bracket2026,
  type DraftDataset,
  type ManagerTournament,
  type SimWorld,
  type Team2026,
} from "@wcdraft/core";
import {
  DraftStateSchema,
  GroupStageResultSchema,
  MatchResultSchema,
  RunResultSchema,
} from "@wcdraft/core";

import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST, SCENARIO_2026_BUNDLE } from "../src/index.js";
import fixtureJson from "./fixtures/e2e-real-run-golden.json" with { type: "json" };

// ─── Fixed inputs ────────────────────────────────────────────────────────────

// :881 is the first satisfying seed after U5 choose-from-3 soft-floor spread.
// Same search criteria, same prefix -- see scripts/generate-e2e-golden.mjs.
const PARENT_SEED = "wcdraft:e2e-real-run:engine-v2-e3a:881";
const RUN_SEED = PARENT_SEED;
const COMBINED_RATING_VERSION = `${RUNTIME_DATA_MANIFEST.rating_version_historical}+${RUNTIME_DATA_MANIFEST.rating_version_projected}`;

// ─── Test harness builders ───────────────────────────────────────────────────

/** Build the `DraftDataset` consumed by `autoDraft` / `buildDraftCatalog`. */
function buildDataset(): DraftDataset {
  const ratingByCardId = new Map(DRAFT_POOL_BUNDLE.ratings.map((r) => [r.card_id, r.overall]));
  return {
    players: DRAFT_POOL_BUNDLE.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
      choice_overall: ratingByCardId.get(c.card_id) ?? null,
    })),
    managers: DRAFT_POOL_BUNDLE.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    // ENGINE-V2 E-1: era-weighted sampling needs tournament years.
    tournaments: Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

/** Build the `SimWorld` from compact bundles — never coerce null fields. */
function buildSimWorld(): SimWorld {
  const opponents: Record<string, Team2026> = Object.fromEntries(
    SCENARIO_2026_BUNDLE.teams.map((t) => [t.team_id, t as Team2026]),
  );
  const managerTournaments: Record<string, ManagerTournament> = Object.fromEntries(
    DRAFT_POOL_BUNDLE.manager_cards.map((m) => [
      m.manager_card_id,
      {
        manager_card_id: m.manager_card_id,
        manager_id: m.manager_id,
        tournament_id: m.tournament_id,
        nation_id: m.nation_id,
        matches: m.matches,
        final_placement: m.final_placement,
        sources: m.sources,
      } satisfies ManagerTournament,
    ]),
  );
  const bracket: Bracket2026 = {
    groups: SCENARIO_2026_BUNDLE.groups,
    knockout_slots: SCENARIO_2026_BUNDLE.knockout_slots,
  };
  return {
    ratings: Object.fromEntries(DRAFT_POOL_BUNDLE.ratings.map((r) => [r.card_id, r])),
    opponents,
    managerTournaments,
    nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
    eligiblePositionsByCardId: Object.fromEntries(
      DRAFT_POOL_BUNDLE.player_cards.map((card) => [card.card_id, card.eligible_positions]),
    ),
    bracket,
    // managerRatings omitted — runtime data does not publish a manager rating.
    // scoringConfig omitted — defaults to DEFAULT_SCORING_CONFIG.
  };
}

/** Drive the full pipeline once. */
function runE2E(): {
  draft: ReturnType<typeof autoDraft>;
  scenario: ReturnType<typeof buildRunScenario>["scenario"];
  scenario_meta: ReturnType<typeof buildRunScenario>["meta"];
  run: ReturnType<typeof runTournamentFull>["run"];
  matches: ReturnType<typeof runTournamentFull>["matches"];
  group_stage: ReturnType<typeof runTournamentFull>["group_stage"];
  knockout_ladder_meta: ReturnType<typeof runTournamentFull>["knockout_ladder_meta"];
} {
  const dataset = buildDataset();
  const draft = autoDraft({
    run_id: "e2e-real-run-golden",
    parent_seed: RUN_SEED,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Golden XI",
    dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
    rating_version: COMBINED_RATING_VERSION,
    engine_version: RUNTIME_DATA_MANIFEST.engine_version,
    dataset,
  });
  const scenarioBundle = buildRunScenario({
    parent_seed: RUN_SEED,
    teams: SCENARIO_2026_BUNDLE.teams as readonly Team2026[],
    bracket: {
      groups: SCENARIO_2026_BUNDLE.groups,
      knockout_slots: SCENARIO_2026_BUNDLE.knockout_slots,
    },
    ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
  });
  const world = buildSimWorld();
  const result = runTournamentFull(draft, scenarioBundle.scenario, RUN_SEED, world);
  return {
    draft,
    scenario: scenarioBundle.scenario,
    scenario_meta: scenarioBundle.meta,
    run: result.run,
    matches: result.matches,
    group_stage: result.group_stage,
    knockout_ladder_meta: result.knockout_ladder_meta,
  };
}

/** Read the committed golden fixture as a plain `unknown`. */
interface GoldenShape {
  parent_seed: string;
  run_seed: string;
  draft: unknown;
  scenario: unknown;
  scenario_meta: unknown;
  run: unknown;
  matches: unknown[];
  group_stage: unknown;
  knockout_ladder_meta: unknown;
}
const GOLDEN = fixtureJson as unknown as GoldenShape;

/** Strip mutable JS quirks (frozen arrays, prototype) — JSON round-trip. */
function asPlain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("e2e real-run determinism golden — committed fixture", () => {
  it("the test harness uses the documented fixed seed", () => {
    expect(GOLDEN.parent_seed).toBe(PARENT_SEED);
    expect(GOLDEN.run_seed).toBe(RUN_SEED);
  });

  it("re-running the full pipeline reproduces the committed fixture byte-for-byte", () => {
    const actual = runE2E();
    expect(asPlain(actual.draft)).toEqual(GOLDEN.draft);
    expect(asPlain(actual.scenario)).toEqual(GOLDEN.scenario);
    expect(asPlain(actual.scenario_meta)).toEqual(GOLDEN.scenario_meta);
    expect(asPlain(actual.run)).toEqual(GOLDEN.run);
    expect(asPlain(actual.matches)).toEqual(GOLDEN.matches);
    expect(asPlain(actual.group_stage)).toEqual(GOLDEN.group_stage);
    expect(asPlain(actual.knockout_ladder_meta)).toEqual(GOLDEN.knockout_ladder_meta);
  });

  it("two back-to-back runs are deep-equal to each other (idempotent)", () => {
    const a = runE2E();
    const b = runE2E();
    expect(a.draft).toEqual(b.draft);
    expect(a.scenario).toEqual(b.scenario);
    expect(a.scenario_meta).toEqual(b.scenario_meta);
    expect(a.run).toEqual(b.run);
    expect(a.matches).toEqual(b.matches);
    expect(a.group_stage).toEqual(b.group_stage);
    expect(a.knockout_ladder_meta).toEqual(b.knockout_ladder_meta);
  });

  it("every boundary object passes its zod schema", () => {
    const { draft, run, matches, group_stage } = runE2E();
    {
      const r = DraftStateSchema.safeParse(draft);
      if (!r.success) {
        throw new Error(`DraftState schema failed: ${JSON.stringify(r.error.issues, null, 2)}`);
      }
    }
    {
      const r = RunResultSchema.safeParse(run);
      if (!r.success) {
        throw new Error(`RunResult schema failed: ${JSON.stringify(r.error.issues, null, 2)}`);
      }
    }
    for (const m of matches) {
      const r = MatchResultSchema.safeParse(m);
      if (!r.success) {
        throw new Error(
          `MatchResult ${m.match_id} schema failed: ${JSON.stringify(r.error.issues, null, 2)}`,
        );
      }
    }
    {
      const r = GroupStageResultSchema.safeParse(group_stage);
      if (!r.success) {
        throw new Error(
          `GroupStageResult schema failed: ${JSON.stringify(r.error.issues, null, 2)}`,
        );
      }
    }
  });

  it("score === sum(score_breakdown.points)", () => {
    const { run } = runE2E();
    const summed = run.score_breakdown.reduce((a, c) => a + c.points, 0);
    expect(run.score).toBe(summed);
    for (const c of run.score_breakdown) {
      expect(c.points === c.raw * c.weight).toBe(true);
    }
  });

  it("the drafted squad includes at least one card flagged 'baseline_anchor_estimate' (honest-state path)", () => {
    const { draft } = runE2E();
    const estimateCardIds = new Set(
      DRAFT_POOL_BUNDLE.ratings
        .filter((r) => r.overall_basis === "baseline_anchor_estimate")
        .map((r) => r.card_id),
    );
    const draftedEstimate = draft.squad.find(
      (s) => s.card_id !== null && estimateCardIds.has(s.card_id),
    );
    expect(
      draftedEstimate,
      "fixed seed must draft at least one estimate-flagged historical card",
    ).toBeDefined();
  });

  it("display-name resolution: every opponent_team_id resolves to a team display name", () => {
    const { matches } = runE2E();
    for (const m of matches) {
      expect(
        SCENARIO_2026_BUNDLE.team_display_names[m.opponent_team_id],
        `team_display_names missing ${m.opponent_team_id}`,
      ).toBeDefined();
    }
  });

  it("top scorer (if any) resolves to a drafted runtime player card with a non-empty common_name", () => {
    const { run } = runE2E();
    const ts = run.aggregate.top_scorer_player_id;
    if (ts === null) return;
    const playerCard = DRAFT_POOL_BUNDLE.player_cards.find((c) => c.player_id === ts);
    expect(
      playerCard,
      `top scorer player_id ${ts} must be in the runtime player pool`,
    ).toBeDefined();
    expect(playerCard!.common_name.trim().length).toBeGreaterThan(0);
  });

  it("every player_stats[*].card_id resolves to a runtime player card", () => {
    const { run } = runE2E();
    const cardIds = new Set(DRAFT_POOL_BUNDLE.player_cards.map((c) => c.card_id));
    for (const ps of run.player_stats) {
      expect(cardIds.has(ps.card_id), `player_stats card ${ps.card_id} not in pool`).toBe(true);
    }
  });

  it("R32 selection is bracket-constrained (real Bracket2026 path exercised)", () => {
    const { group_stage, knockout_ladder_meta, scenario } = runE2E();
    expect(group_stage.user_qualified).toBe(true);
    const r32 = knockout_ladder_meta.rounds[0];
    expect(r32).toBeDefined();
    expect(r32!.round).toBe("R32");
    expect(r32!.bracket_constrained).toBe(true);
    expect(r32!.fallback).toBe(false);
    expect(r32!.user_slot_id).not.toBeNull();
    expect(r32!.opposite_slot_id).not.toBeNull();
    expect(r32!.candidate_group_ids.length).toBeGreaterThan(0);
    // The R32 opponent is not a group opponent and not in the user's group.
    expect(scenario.group_opponent_team_ids).not.toContain(r32!.opponent_team_id);
    const opp = SCENARIO_2026_BUNDLE.teams.find((t) => t.team_id === r32!.opponent_team_id);
    expect(opp, `R32 opponent ${r32!.opponent_team_id} not in scenario teams`).toBeDefined();
    expect(opp!.group).not.toBe(scenario.user_group_id);
  });
});
