import { describe, it, expect } from "vitest";

import { simulateMatch } from "./api/sim.js";
import type { UserXiSimView } from "./api/sim.js";
import { buildScenarioInputs } from "../test/fixtures/sim-fixtures.js";
import { MatchResultSchema } from "./schemas/index.js";
import type { Rating } from "./types/rating.js";
import type { Team2026 } from "./types/tournament.js";

// The PUBLIC `simulateMatch(userTeam: UserXiSimView, opponent, round, seed)` —
// the distilled-view path consumed directly by WS-C/WS-D. Positions are
// inferred from each rating's dominant channel; the determinism + schema
// contract still holds.

function buildView(): { view: UserXiSimView; opponent: Team2026 } {
  const inputs = buildScenarioInputs("draw_into_pens");
  const ratings = Object.values(inputs.world.ratings) as Rating[];
  const view: UserXiSimView = {
    draft_id: "view-test",
    squad_ratings: ratings,
    aggregate: { attack: 62, midfield: 60, defense: 61, goalkeeping: 58, coverage: 1 },
  };
  const opponent = Object.values(inputs.world.opponents)[0]!;
  return { view, opponent };
}

describe("public simulateMatch (UserXiSimView path)", () => {
  it("is deterministic for the same (userTeam, opponent, round, seed)", () => {
    const { view, opponent } = buildView();
    const a = simulateMatch(view, opponent, "R32", "view-seed-1");
    const b = simulateMatch(view, opponent, "R32", "view-seed-1");
    expect(a).toEqual(b);
  });

  it("a different seed generally yields a different match", () => {
    const { view, opponent } = buildView();
    const a = simulateMatch(view, opponent, "R32", "view-seed-1");
    const b = simulateMatch(view, opponent, "R32", "view-seed-2");
    // Not a hard guarantee, but these two seeds differ in output.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("produces a schema-valid MatchResult (group + knockout rounds)", () => {
    const { view, opponent } = buildView();
    for (const round of ["G1", "R32"] as const) {
      const m = simulateMatch(view, opponent, round, `view-seed-${round}`);
      const parsed = MatchResultSchema.safeParse(m);
      if (!parsed.success) {
        throw new Error(
          `schema failed for ${round}: ${JSON.stringify(parsed.error.issues, null, 2)}`,
        );
      }
      expect(parsed.success).toBe(true);
    }
  });

  it("the stripped result carries no internal injury stash", () => {
    const { view, opponent } = buildView();
    const m = simulateMatch(view, opponent, "G1", "view-seed-strip");
    expect("__injuredTournamentEnding" in (m as object)).toBe(false);
  });

  it("never assigns open-play goal scorers to goalkeepers across a seeded sample", () => {
    const { view, opponent } = buildView();
    let openPlayGoals = 0;
    for (let i = 0; i < 500; i += 1) {
      const m = simulateMatch(view, opponent, i % 2 === 0 ? "G1" : "R32", `view-gk-goal-${i}`);
      const lineupByPlayerId = new Map(m.lineup.map((entry) => [entry.player_id, entry]));
      for (const event of m.events) {
        if (event.type !== "goal") continue;
        openPlayGoals += 1;
        const scorer = lineupByPlayerId.get(event.scorer_player_id);
        expect(scorer, `${event.scorer_player_id} missing from ${m.match_id}`).toBeDefined();
        expect(scorer?.position, `${event.scorer_player_id} scored ${m.match_id}`).not.toBe("GK");
      }
    }
    expect(openPlayGoals).toBeGreaterThan(0);
  });
});
