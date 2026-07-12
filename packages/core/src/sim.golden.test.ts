import { describe, it, expect } from "vitest";

import goldenJson from "../test/fixtures/sim-golden.json" with { type: "json" };
import { buildScenarioInputs, type ScenarioName } from "../test/fixtures/sim-fixtures.js";
import { runTournamentFull } from "./engine/tournament.js";
import { deriveSubseed } from "./rng.js";
import { MatchResultSchema, RunResultSchema } from "./schemas/index.js";
import type { RunResult } from "./types/run.js";

// GOLDEN INVARIANT (WS-0b/WS-0c contract, WS-B implementation):
//   A fixed (draft, scenario, seed, version anchors) reproduces a byte-identical
//   RunResult — INCLUDING seed, round_results, aggregate.clean_sheets,
//   narrative.narrative_seed, score, score_breakdown, and player_stats.
//
// Four characteristic scenarios are locked in `sim-golden.json` (regenerate via
// `pnpm --filter @wcdraft/core run gen:sim-golden`): blowout, upset,
// draw-into-pens, injury-cascade. The generator searched a seed exhibiting each
// shape; the tests below re-run the SAME inputs + recorded seed and assert
// determinism, schema validity, the score-sum invariant, stat-aggregation
// coherence, and the narrative-seed lineage.

interface GoldenEntry {
  name: ScenarioName;
  seed: string;
  run: RunResult;
}
const GOLDEN = (goldenJson as unknown as { scenarios: GoldenEntry[] }).scenarios;

function runFor(name: ScenarioName, seed: string) {
  const inputs = buildScenarioInputs(name);
  return runTournamentFull(inputs.draft, inputs.scenario, seed, inputs.world);
}

describe("sim+score golden — fixed inputs reproduce byte-identical RunResult", () => {
  it("the five characteristic scenarios are all present", () => {
    expect(GOLDEN.map((g) => g.name).sort()).toEqual(
      ["blowout", "draw_into_pens", "group_elimination", "injury_cascade", "upset"].sort(),
    );
  });

  for (const entry of GOLDEN) {
    describe(entry.name, () => {
      it("re-running the same (draft, scenario, seed) deep-equals the locked golden", () => {
        const { run } = runFor(entry.name, entry.seed);
        expect(run).toEqual(entry.run);
      });

      it("is deterministic — two runs are deep-equal to each other", () => {
        const a = runFor(entry.name, entry.seed);
        const b = runFor(entry.name, entry.seed);
        expect(a.run).toEqual(b.run);
        expect(a.matches).toEqual(b.matches);
      });

      it("the RunResult passes the boundary schema", () => {
        const { run } = runFor(entry.name, entry.seed);
        const parsed = RunResultSchema.safeParse(run);
        if (!parsed.success) {
          throw new Error(
            `RunResult schema failed: ${JSON.stringify(parsed.error.issues, null, 2)}`,
          );
        }
        expect(parsed.success).toBe(true);
      });

      it("every MatchResult passes the boundary schema", () => {
        const { matches } = runFor(entry.name, entry.seed);
        for (const m of matches) {
          const parsed = MatchResultSchema.safeParse(m);
          if (!parsed.success) {
            throw new Error(
              `MatchResult ${m.match_id} schema failed: ${JSON.stringify(parsed.error.issues, null, 2)}`,
            );
          }
        }
      });

      it("score === sum(score_breakdown.points)", () => {
        const { run } = runFor(entry.name, entry.seed);
        const summed = run.score_breakdown.reduce((a, c) => a + c.points, 0);
        expect(run.score).toBe(summed);
        // `===` (not Object.is) — the contract's equality, which treats -0 === 0.
        for (const c of run.score_breakdown) expect(c.points === c.raw * c.weight).toBe(true);
      });

      it("player_stats totals equal the per-match sums", () => {
        const { run } = runFor(entry.name, entry.seed);
        for (const ps of run.player_stats) {
          const fields = Object.keys(ps.totals) as Array<keyof typeof ps.totals>;
          for (const f of fields) {
            const sum = ps.per_match.reduce((a, pm) => a + (pm[f] as number), 0);
            expect(ps.totals[f]).toBe(sum);
          }
        }
      });

      it("narrative.narrative_seed === deriveSubseed(seed, 'narrative')", () => {
        const { run } = runFor(entry.name, entry.seed);
        expect(run.narrative.narrative_seed).toBe(deriveSubseed(run.seed, "narrative"));
        expect(run.seed).toBe(entry.seed);
      });

      it("narrative is filled (template_id !== 'pending', filled_text non-empty)", () => {
        const { run } = runFor(entry.name, entry.seed);
        expect(run.narrative.template_id).not.toBe("pending");
        expect(run.narrative.template_id.length).toBeGreaterThan(0);
        expect(run.narrative.filled_text.trim().length).toBeGreaterThan(0);
      });

      it("aggregate top_scorer (if any) is a user-side player with a counting goal", () => {
        const { run } = runFor(entry.name, entry.seed);
        const ts = run.aggregate.top_scorer_player_id;
        if (ts === null) return;
        const ps = run.player_stats.find((p) => p.player_id === ts);
        expect(ps).toBeDefined();
        expect(ps!.totals.goals).toBeGreaterThan(0);
      });
    });
  }
});

describe("sim golden — scenario shapes are what the names claim", () => {
  it("blowout: a win by a 4+ goal margin occurred", () => {
    const { run } = runFor("blowout", GOLDEN.find((g) => g.name === "blowout")!.seed);
    expect(
      run.round_results.some((r) => r.outcome === "W" && r.goals_for - r.goals_against >= 4),
    ).toBe(true);
  });

  it("upset: the (weak) user XI won at least one knockout match", () => {
    const { matches } = runFor("upset", GOLDEN.find((g) => g.name === "upset")!.seed);
    expect(matches.some((m) => m.phase === "knockout" && m.outcome === "W")).toBe(true);
  });

  it("group_elimination: user eliminated in group, no knockouts played", () => {
    const entry = GOLDEN.find((g) => g.name === "group_elimination")!;
    const { run, matches, group_stage } = runFor("group_elimination", entry.seed);
    expect(run.reached_round).toBe("G3");
    expect(run.is_champion).toBe(false);
    expect(matches.length).toBe(3);
    expect(matches.every((m) => m.phase === "group")).toBe(true);
    expect(group_stage.user_qualified).toBe(false);
    expect(group_stage.qualification).toBe("eliminated");
    // The last match's id must match `eliminated_in_match_id`.
    expect(run.eliminated_in_match_id).toBe(matches[2]!.match_id);
  });

  it("injury-cascade: ≥2 tournament-ending absences, each persisting out of later lineups", () => {
    const { matches } = runFor(
      "injury_cascade",
      GOLDEN.find((g) => g.name === "injury_cascade")!.seed,
    );
    const ended: Array<{ player_id: string; matchIndex: number }> = [];
    matches.forEach((m, idx) => {
      for (const e of m.events) {
        if (e.type === "availability" && e.reason === "tournament_injury") {
          ended.push({ player_id: e.player_id, matchIndex: idx });
        }
      }
    });
    const firstByPlayer = new Map<string, number>();
    for (const injury of ended) {
      if (!firstByPlayer.has(injury.player_id)) {
        firstByPlayer.set(injury.player_id, injury.matchIndex);
      }
    }
    expect(firstByPlayer.size).toBeGreaterThanOrEqual(2);
    for (const [player_id, matchIndex] of firstByPlayer) {
      for (let later = matchIndex + 1; later < matches.length; later++) {
        const present = matches[later]!.lineup.some(
          (l) => l.side === "user" && l.player_id === player_id,
        );
        expect(present).toBe(false);
      }
    }
  });
});

describe("sim golden — regulation/ET/shootout fields are mutually exclusive as documented", () => {
  const pensSeed = () => GOLDEN.find((g) => g.name === "draw_into_pens")!.seed;

  it("a shootout match has ET non-null, shootout non-null, and a matching kick projection", () => {
    const { matches } = runFor("draw_into_pens", pensSeed());
    const so = matches.find((m) => m.shootout !== null);
    expect(so).toBeDefined();
    expect(so!.phase).toBe("knockout");
    expect(so!.user_goals_et).not.toBeNull();
    expect(so!.opp_goals_et).not.toBeNull();
    const kicks = so!.events.filter((e) => e.type === "shootout_kick");
    expect(kicks.length).toBe(so!.shootout!.sequence.length);
  });

  it("group-stage matches never carry ET or shootout", () => {
    const { matches } = runFor("draw_into_pens", pensSeed());
    for (const m of matches.filter((x) => x.phase === "group")) {
      expect(m.user_goals_et).toBeNull();
      expect(m.opp_goals_et).toBeNull();
      expect(m.shootout).toBeNull();
    }
  });

  it("undefeated_regulation is FALSE when any knockout match required a shootout", () => {
    const { run, matches } = runFor("draw_into_pens", pensSeed());
    expect(matches.some((m) => m.shootout !== null)).toBe(true);
    expect(run.undefeated_regulation).toBe(false);
  });
});
