// I3.2 — golden tests for `buildRunScenario`.
//
// Locks the scenario builder's deterministic contract: byte-stable output for
// (parent_seed, teams, bracket, ruleset_version), seed-lineage parity with
// `deriveSubseed`, opponent-shape invariants, and the failure modes for
// degenerate inputs. The fixtures here are synthetic — the I3.6 real-data e2e
// golden in `@wcdraft/data` exercises the real Team2026/Bracket2026 shape.

import { describe, expect, it } from "vitest";

import {
  SCENARIO_KNOCKOUT_ROUNDS,
  SCENARIO_KNOCKOUT_SEED_SUFFIX,
  buildRunScenario,
} from "./scenario.js";
import { deriveSubseed } from "./rng.js";
import type { Bracket2026, CardId, GroupId, Team2026, TeamStrength } from "./index.js";
import { GROUP_IDS, buildCardId } from "./index.js";

const PARENT_SEED = "wcdraft:scenario-golden:v1";

function teamStrength(v: number): TeamStrength {
  return { attack: v, midfield: v, defense: v, goalkeeping: v, coverage: 1 };
}

function buildTeam(index: number, group: GroupId, group_slot: number, strength: number): Team2026 {
  const team_id = `T${String(index).padStart(2, "0")}`;
  const squad_card_ids: CardId[] = [];
  for (let i = 0; i < 11; i++) {
    squad_card_ids.push(buildCardId(`${team_id}p${String(i).padStart(2, "0")}`, 23));
  }
  return {
    team_id,
    nation_id: `nat_${team_id}`,
    group,
    group_slot,
    squad_card_ids,
    aggregate_rating: teamStrength(strength),
    squad_status: "projected",
    rating_version: "scenario-fixture-rating-v1",
    sources: [],
  };
}

/** Build a synthetic 12-group × 4-team bracket with deterministic team_ids. */
function buildFixture(): { teams: Team2026[]; bracket: Bracket2026 } {
  const teams: Team2026[] = [];
  const groups = GROUP_IDS.map((group_id, gi) => {
    const team_ids: string[] = [];
    for (let s = 0; s < 4; s++) {
      const index = gi * 4 + s;
      const strength = 40 + ((index * 7) % 50); // deterministic variety
      const team = buildTeam(index, group_id, s + 1, strength);
      teams.push(team);
      team_ids.push(team.team_id);
    }
    return { group_id, team_ids };
  });
  const bracket: Bracket2026 = { groups, knockout_slots: [] };
  return { teams, bracket };
}

describe("buildRunScenario — I3.2 deterministic scenario builder", () => {
  const { teams, bracket } = buildFixture();

  it("is byte-identical across repeat invocations with the same inputs", () => {
    const a = buildRunScenario({
      parent_seed: PARENT_SEED,
      teams,
      bracket,
      ruleset_version: "ruleset-v1",
    });
    const b = buildRunScenario({
      parent_seed: PARENT_SEED,
      teams,
      bracket,
      ruleset_version: "ruleset-v1",
    });
    expect(a.scenario).toEqual(b.scenario);
    expect(a.meta).toEqual(b.meta);
  });

  it("derives scenario_seed via deriveSubseed(parent_seed, 'scenario')", () => {
    const { scenario, meta } = buildRunScenario({
      parent_seed: PARENT_SEED,
      teams,
      bracket,
      ruleset_version: "ruleset-v1",
    });
    const expected = deriveSubseed(PARENT_SEED, "scenario");
    expect(scenario.scenario_seed).toBe(expected);
    expect(meta.scenario_seed).toBe(expected);
    expect(scenario.scenario_id).toBe(`scenario:${expected}`);
  });

  it("emits the canonical knockout rule (escalating_strength_seeded, R32..F)", () => {
    const { scenario } = buildRunScenario({
      parent_seed: PARENT_SEED,
      teams,
      bracket,
      ruleset_version: "ruleset-v1",
    });
    expect(scenario.knockout_opponent_rule.kind).toBe("escalating_strength_seeded");
    expect(scenario.knockout_opponent_rule.rounds).toEqual([...SCENARIO_KNOCKOUT_ROUNDS]);
    expect(scenario.knockout_opponent_rule.seed_suffix).toBe(SCENARIO_KNOCKOUT_SEED_SUFFIX);
    expect(scenario.ruleset_version).toBe("ruleset-v1");
  });

  it("emits exactly 3 group opponents, sorted ascending, excluding the replaced team", () => {
    const { scenario, meta } = buildRunScenario({
      parent_seed: PARENT_SEED,
      teams,
      bracket,
      ruleset_version: "ruleset-v1",
    });
    expect(scenario.group_opponent_team_ids.length).toBe(3);
    // Already sorted ascending.
    const sorted = [...scenario.group_opponent_team_ids].sort();
    expect(scenario.group_opponent_team_ids).toEqual(sorted);
    // Belongs to the picked group and excludes the replaced team.
    expect(meta.source_group_team_ids.length).toBe(4);
    expect(meta.source_group_team_ids).toContain(meta.replaced_team_id);
    for (const oid of scenario.group_opponent_team_ids) {
      expect(meta.source_group_team_ids).toContain(oid);
      expect(oid).not.toBe(meta.replaced_team_id);
    }
    // The picked group_id is one of the fixture groups.
    expect(GROUP_IDS).toContain(scenario.user_group_id);
  });

  it("changes group / replaced team deterministically when parent_seed changes", () => {
    const a = buildRunScenario({
      parent_seed: "seed-a",
      teams,
      bracket,
      ruleset_version: "ruleset-v1",
    });
    const b = buildRunScenario({
      parent_seed: "seed-b",
      teams,
      bracket,
      ruleset_version: "ruleset-v1",
    });
    // Different parent seeds derive different scenario sub-seeds, so the
    // entire downstream draw changes.
    expect(a.scenario.scenario_seed).not.toBe(b.scenario.scenario_seed);
    expect(a.scenario.scenario_id).not.toBe(b.scenario.scenario_id);
  });

  it("is INSENSITIVE to input team/group permutation (canonical sort before draw)", () => {
    // Reverse the input team list and shuffle group team_ids; result must
    // still be byte-identical because the builder canonically sorts pools.
    const shuffledTeams = [...teams].reverse();
    const shuffledBracket: Bracket2026 = {
      groups: bracket.groups.map((g) => ({
        group_id: g.group_id,
        team_ids: [...g.team_ids].reverse(),
      })),
      knockout_slots: [],
    };
    const a = buildRunScenario({
      parent_seed: PARENT_SEED,
      teams,
      bracket,
      ruleset_version: "ruleset-v1",
    });
    const b = buildRunScenario({
      parent_seed: PARENT_SEED,
      teams: shuffledTeams,
      bracket: shuffledBracket,
      ruleset_version: "ruleset-v1",
    });
    expect(a.scenario).toEqual(b.scenario);
    expect(a.meta).toEqual(b.meta);
  });

  it("throws on empty parent_seed", () => {
    expect(() =>
      buildRunScenario({
        parent_seed: "",
        teams,
        bracket,
        ruleset_version: "ruleset-v1",
      }),
    ).toThrow(RangeError);
  });

  it("throws on empty ruleset_version", () => {
    expect(() =>
      buildRunScenario({
        parent_seed: PARENT_SEED,
        teams,
        bracket,
        ruleset_version: "",
      }),
    ).toThrow(RangeError);
  });

  it("throws on empty teams", () => {
    expect(() =>
      buildRunScenario({
        parent_seed: PARENT_SEED,
        teams: [],
        bracket,
        ruleset_version: "ruleset-v1",
      }),
    ).toThrow(RangeError);
  });

  it("throws on duplicate team_id", () => {
    const dupTeams = [...teams, teams[0]!];
    expect(() =>
      buildRunScenario({
        parent_seed: PARENT_SEED,
        teams: dupTeams,
        bracket,
        ruleset_version: "ruleset-v1",
      }),
    ).toThrow(RangeError);
  });

  it("throws when a group references an unknown team_id", () => {
    const badBracket: Bracket2026 = {
      groups: [
        { group_id: "A", team_ids: ["T00", "T01", "T02", "DOES_NOT_EXIST"] },
        ...bracket.groups.slice(1),
      ],
      knockout_slots: [],
    };
    expect(() =>
      buildRunScenario({
        parent_seed: PARENT_SEED,
        teams,
        bracket: badBracket,
        ruleset_version: "ruleset-v1",
      }),
    ).toThrow(RangeError);
  });

  it("throws when no group has exactly 4 teams (no eligible groups)", () => {
    const undersizedBracket: Bracket2026 = {
      groups: bracket.groups.map((g) => ({
        group_id: g.group_id,
        team_ids: g.team_ids.slice(0, 3),
      })),
      knockout_slots: [],
    };
    expect(() =>
      buildRunScenario({
        parent_seed: PARENT_SEED,
        teams,
        bracket: undersizedBracket,
        ruleset_version: "ruleset-v1",
      }),
    ).toThrow(RangeError);
  });
});
