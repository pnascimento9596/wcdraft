import { describe, expect, it } from "vitest";

import { buildScenarioInputs } from "../../test/fixtures/sim-fixtures.js";
import { MatchResultSchema } from "../schemas/sim.js";
import { createRng, deriveSubseed } from "../rng.js";
import type { Position } from "../types/primitives.js";
import type { TeamStrength } from "../types/rating.js";
import type { MatchTeamFacts } from "../types/sim.js";
import { MANAGER_TACTICAL } from "./calibration.js";
import { applyManagerTacticalAdjustment, managerTacticalBand } from "./manager-tactics.js";
import { runTournamentFull } from "./tournament.js";
import { simulateMatchCore, type CoreMatchInput, type SimMember } from "./match.js";

const STRENGTH: TeamStrength = {
  attack: 60,
  midfield: 70,
  defense: 80,
  goalkeeping: 99,
  coverage: 0.75,
};

function members(side: "user" | "opp", strength: TeamStrength): SimMember[] {
  const positions: Position[] = ["GK", "DF", "DF", "DF", "DF", "MF", "MF", "MF", "FW", "FW", "FW"];
  return positions.map((position, index) => ({
    side,
    card_id: `${side}${index}_t1` as SimMember["card_id"],
    player_id: `${side}${index}`,
    tournament_id: 1,
    slot_id: `${side}.${index}`,
    position,
    started: true,
    attackWeight: position === "FW" ? strength.attack : 1,
    creativeWeight: position === "MF" ? strength.midfield : 1,
  }));
}

function facts(strength: TeamStrength, managerLink: number): MatchTeamFacts {
  const synergy = {
    overall: managerLink * 100,
    nation_clusters: [],
    linked_pairs: [],
    manager_link: managerLink,
    multiplier: 1,
  };
  return {
    base_strength: strength,
    active_strength: strength,
    ...applyManagerTacticalAdjustment(strength, managerLink, false),
    base_synergy: synergy,
    active_synergy: synergy,
    unavailable: [],
    bench_activations: [],
    short_handed_slot_ids: [],
  };
}

function coreInput(
  label: string,
  strength: TeamStrength,
  teamFacts?: MatchTeamFacts,
): CoreMatchInput {
  const opponent: TeamStrength = {
    attack: 60,
    midfield: 60,
    defense: 60,
    goalkeeping: 60,
    coverage: 1,
  };
  const seed = `s2-exact-once:${label}`;
  return {
    matchId: `s2.${label}`,
    matchIndex: 0,
    round: "G1",
    phase: "group",
    opponentTeamId: "opp",
    userMembers: members("user", strength),
    oppMembers: members("opp", opponent),
    userStrength: strength,
    oppStrength: opponent,
    teamFacts,
    structRng: createRng(deriveSubseed(seed, "match_sim", "match:0")),
    eventRng: createRng(deriveSubseed(seed, "event_gen", "match:0")),
  };
}

describe("S2 manager tactical tier", () => {
  it("maps the bounded manager-link channel to canonical +0/+1/+2 tiers", () => {
    expect(managerTacticalBand(0)).toBe(0);
    expect(managerTacticalBand(0.24)).toBe(0);
    expect(managerTacticalBand(0.25)).toBe(1);
    expect(managerTacticalBand(0.74)).toBe(1);
    expect(managerTacticalBand(0.75)).toBe(2);
    expect(managerTacticalBand(1)).toBe(2);
  });

  it("fails bounded and neutral for malformed or out-of-range helper inputs", () => {
    expect(managerTacticalBand(Number.NaN)).toBe(0);
    expect(managerTacticalBand(Number.POSITIVE_INFINITY)).toBe(0);
    expect(managerTacticalBand(-100)).toBe(0);
    expect(managerTacticalBand(100)).toBe(2);
  });

  it("applies one conservative bounded multiplier uniformly and deterministically", () => {
    const first = applyManagerTacticalAdjustment(STRENGTH, 1);
    const second = applyManagerTacticalAdjustment(STRENGTH, 1);

    expect(first).toEqual(second);
    expect(first.manager_tactical_band).toBe(2);
    expect(first.manager_tactical_multiplier).toBe(1 + MANAGER_TACTICAL.WIDTH);
    expect(first.manager_tactical_multiplier).toBeLessThanOrEqual(1 + MANAGER_TACTICAL.WIDTH);
    expect(first.post_tactical_strength).toEqual({
      attack: 61,
      midfield: 71,
      defense: 81,
      goalkeeping: 100,
      coverage: 0.75,
    });
    expect(first.tactical_applied_to_outcome).toBe(true);
  });

  it("records a fully neutral channel when the outcome bypasses simulation", () => {
    expect(applyManagerTacticalAdjustment(STRENGTH, 1, false)).toEqual({
      manager_tactical_band: 0,
      manager_tactical_multiplier: 1,
      post_tactical_strength: STRENGTH,
      tactical_applied_to_outcome: false,
    });
  });

  it("applies the tactical transform exactly once and to both lambda directions", () => {
    const base: TeamStrength = {
      attack: 60,
      midfield: 60,
      defense: 60,
      goalkeeping: 60,
      coverage: 1,
    };
    const post = applyManagerTacticalAdjustment(base, 1).post_tactical_strength;
    expect(post.attack).toBe(61);

    const linked = simulateMatchCore(coreInput("same-seed", base, facts(base, 1)));
    const alreadyAdjusted = simulateMatchCore(coreInput("same-seed", post));
    expect(linked.pre_match_win_probability).toBe(alreadyAdjusted.pre_match_win_probability);
    expect(linked.user_goals).toBe(alreadyAdjusted.user_goals);
    expect(linked.opp_goals).toBe(alreadyAdjusted.opp_goals);
    expect(linked.events).toEqual(alreadyAdjusted.events);
    expect(linked.team_facts!.post_tactical_strength).toEqual(post);
  });
});

describe("S2 tournament reachability and persisted facts", () => {
  it("keeps the reachable managerless ready/direct-engine path neutral", () => {
    const inputs = buildScenarioInputs("upset");
    expect(inputs.draft.status).toBe("ready");
    expect(inputs.draft.manager_card_id).toBeNull();

    const first = runTournamentFull(inputs.draft, inputs.scenario, "s2-managerless", inputs.world);
    const second = runTournamentFull(inputs.draft, inputs.scenario, "s2-managerless", inputs.world);
    expect(first).toEqual(second);
    for (const match of first.matches) {
      expect(match.team_facts).toMatchObject({
        manager_tactical_band: 0,
        manager_tactical_multiplier: 1,
        tactical_applied_to_outcome: true,
      });
      expect(match.team_facts!.post_tactical_strength).toEqual(match.team_facts!.active_strength);
      expect(MatchResultSchema.safeParse(match).success).toBe(true);
    }
  });

  it("persists the manager-linked tier, multiplier, and post-tactical arithmetic", () => {
    const inputs = buildScenarioInputs("blowout");
    const result = runTournamentFull(inputs.draft, inputs.scenario, "s2-linked", inputs.world);
    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      const facts = match.team_facts!;
      expect(facts.active_synergy.manager_link).toBe(1);
      expect(facts.manager_tactical_band).toBe(2);
      expect(facts.manager_tactical_multiplier).toBe(1 + MANAGER_TACTICAL.WIDTH);
      expect(facts.tactical_applied_to_outcome).toBe(true);
      expect(facts.post_tactical_strength.attack).toBe(
        Math.round(Math.min(100, facts.active_strength.attack * (1 + MANAGER_TACTICAL.WIDTH))),
      );
      expect(MatchResultSchema.safeParse(match).success).toBe(true);
    }
  });

  it("rejects forged tier, multiplier, post-strength, and application flag facts", () => {
    const inputs = buildScenarioInputs("blowout");
    const match = runTournamentFull(inputs.draft, inputs.scenario, "s2-schema", inputs.world)
      .matches[0]!;
    const facts = match.team_facts!;
    const mutations = [
      { ...facts, manager_tactical_band: 1 as const },
      { ...facts, manager_tactical_multiplier: 1 },
      {
        ...facts,
        post_tactical_strength: {
          ...facts.post_tactical_strength,
          attack: facts.post_tactical_strength.attack - 1,
        },
      },
      { ...facts, tactical_applied_to_outcome: false },
    ];
    for (const forged of mutations) {
      expect(MatchResultSchema.safeParse({ ...match, team_facts: forged }).success).toBe(false);
    }
  });

  it("accepts honest false/neutral facts when a forfeit bypasses the outcome sim", () => {
    const inputs = buildScenarioInputs("group_elimination");
    const source = runTournamentFull(
      inputs.draft,
      inputs.scenario,
      "s2-forfeit-shape",
      inputs.world,
    ).matches[0]!;
    const sourceFacts = source.team_facts!;
    const bypassed = {
      ...source,
      pre_match_win_probability: 0,
      team_facts: {
        ...sourceFacts,
        ...applyManagerTacticalAdjustment(
          sourceFacts.active_strength,
          sourceFacts.active_synergy.manager_link,
          false,
        ),
      },
      user_goals: 0,
      opp_goals: 3,
      user_goals_et: null,
      opp_goals_et: null,
      shootout: null,
      outcome: "L" as const,
      counts_as_run_win: false,
      advanced: false,
      lineup: source.lineup.map((entry) => ({ ...entry, minutes: 0 })),
      events: source.events.filter((event) => event.type === "availability"),
    };
    const parsed = MatchResultSchema.safeParse(bypassed);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });
});
