import { describe, expect, it } from "vitest";

import { buildScenarioInputs } from "../../test/fixtures/sim-fixtures.js";
import { MatchResultSchema } from "../schemas/sim.js";
import { createRng, deriveSubseed } from "../rng.js";
import type { Position } from "../types/primitives.js";
import type { TeamStrength } from "../types/rating.js";
import type { MatchTeamFacts } from "../types/sim.js";
import { INJURY, MANAGER_TACTICAL } from "./calibration.js";
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
  function forgedBypassShape() {
    const inputs = buildScenarioInputs("group_elimination");
    const source = runTournamentFull(
      inputs.draft,
      inputs.scenario,
      "s2-forfeit-shape",
      inputs.world,
    ).matches[0]!;
    const sourceFacts = source.team_facts!;
    return {
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
      opp_goals: INJURY.FORFEIT_OPP_GOALS,
      user_goals_et: null,
      opp_goals_et: null,
      shootout: null,
      outcome: "L" as const,
      counts_as_run_win: false,
      advanced: false,
      // A real forfeit record contains only the available user lineup.
      lineup: source.lineup
        .filter((entry) => entry.side === "user")
        .map((entry) => ({ ...entry, minutes: 0 })),
      events: source.events.filter((event) => event.type === "availability"),
    };
  }

  function coherentBelowFloorForfeitShape() {
    const source = forgedBypassShape();
    const starters = source.lineup.filter((entry) => entry.started);
    const keptStarters = starters.slice(0, INJURY.FIELDABLE_FLOOR - 1);
    const keptIds = new Set(keptStarters.map((entry) => entry.card_id as string));
    const removedStarters = starters.filter((entry) => !keptIds.has(entry.card_id as string));
    const unavailable = removedStarters.map((entry) => ({
      card_id: entry.card_id,
      player_id: entry.player_id,
      slot_id: entry.slot_id,
      position: entry.position,
      reason: "tournament_injury" as const,
      duration_matches: null,
    }));
    const events = unavailable.map((fact, index) => ({
      event_id: `${source.match_id}.short.${index}`,
      minute: 0 as const,
      period: "1H" as const,
      side: "user" as const,
      type: "availability" as const,
      ...fact,
      replacement_card_id: null,
      replacement_player_id: null,
      short_handed: true,
    }));
    return {
      ...source,
      lineup: source.lineup.filter(
        (entry) => !entry.started || keptIds.has(entry.card_id as string),
      ),
      team_facts: {
        ...source.team_facts,
        unavailable,
        bench_activations: [],
        short_handed_slot_ids: removedStarters.map((entry) => entry.slot_id).sort(),
      },
      events,
    };
  }

  function replaceShortSlot(
    coherent: ReturnType<typeof coherentBelowFloorForfeitShape>,
    from: string,
    to: string,
  ) {
    return {
      ...coherent,
      team_facts: {
        ...coherent.team_facts,
        unavailable: coherent.team_facts.unavailable.map((fact) =>
          fact.slot_id === from ? { ...fact, slot_id: to } : fact,
        ),
        short_handed_slot_ids: coherent.team_facts.short_handed_slot_ids.map((slotId) =>
          slotId === from ? to : slotId,
        ),
      },
      events: coherent.events.map((event) =>
        event.slot_id === from ? { ...event, slot_id: to } : event,
      ),
    };
  }

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

  it("rejects false tactical facts on a forged full-XI forfeit shape", () => {
    const forged = forgedBypassShape();
    expect(forged.lineup.filter((entry) => entry.started)).toHaveLength(11);
    expect(MatchResultSchema.safeParse(forged).success).toBe(false);
  });

  it("accepts false/neutral facts only with a truly below-floor user lineup", () => {
    const bypassed = coherentBelowFloorForfeitShape();
    expect(bypassed.lineup.filter((entry) => entry.started)).toHaveLength(
      INJURY.FIELDABLE_FLOOR - 1,
    );
    expect(
      MatchResultSchema.safeParse({
        ...bypassed,
        lineup: [...bypassed.lineup, { ...bypassed.lineup[0]!, side: "opp" as const }],
      }).success,
    ).toBe(false);
    const parsed = MatchResultSchema.safeParse(bypassed);
    if (!parsed.success) {
      throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    }
    expect(parsed.success).toBe(true);
  });

  it("rejects noncanonical forfeit replacement facts and opponent availability noise", () => {
    const coherent = coherentBelowFloorForfeitShape();
    const occupied = coherent.lineup.find((entry) => entry.started)!;
    const bench = coherent.lineup.find((entry) => !entry.started)!;
    const spoofFact = {
      card_id: "spoof:14" as typeof occupied.card_id,
      player_id: "spoof",
      slot_id: occupied.slot_id,
      position: occupied.position,
      reason: "knock" as const,
      duration_matches: 1 as const,
    };
    const spoofActivation = {
      out_card_id: spoofFact.card_id,
      out_player_id: spoofFact.player_id,
      in_card_id: bench.card_id,
      in_player_id: bench.player_id,
      slot_id: occupied.slot_id,
      line: occupied.position,
      fit: 1,
      internal_score: 50,
      replacement_score: 50,
      outgoing_score: 50,
      line_contribution_delta: 0,
    };
    const spoofEvent = {
      event_id: `${coherent.match_id}.spoof-replacement`,
      minute: 0 as const,
      period: "1H" as const,
      side: "user" as const,
      type: "availability" as const,
      ...spoofFact,
      replacement_card_id: bench.card_id,
      replacement_player_id: bench.player_id,
      short_handed: false,
    };
    expect(
      MatchResultSchema.safeParse({
        ...coherent,
        team_facts: {
          ...coherent.team_facts,
          unavailable: [...coherent.team_facts.unavailable, spoofFact],
          bench_activations: [spoofActivation],
        },
        events: [...coherent.events, spoofEvent],
      }).success,
    ).toBe(false);

    expect(
      MatchResultSchema.safeParse({
        ...coherent,
        events: [
          ...coherent.events,
          {
            ...coherent.events[0]!,
            event_id: `${coherent.match_id}.opponent-availability-noise`,
            side: "opp" as const,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects deleted lineup rows without the exact short-handed slot set", () => {
    const coherent = coherentBelowFloorForfeitShape();
    const missingAll = {
      ...coherent,
      team_facts: {
        ...coherent.team_facts,
        unavailable: [],
        short_handed_slot_ids: [],
      },
      events: [],
    };
    expect(MatchResultSchema.safeParse(missingAll).success).toBe(false);

    const missingOne = {
      ...coherent,
      team_facts: {
        ...coherent.team_facts,
        unavailable: coherent.team_facts.unavailable.slice(1),
        short_handed_slot_ids: coherent.team_facts.short_handed_slot_ids.slice(1),
      },
      events: coherent.events.slice(1),
    };
    expect(MatchResultSchema.safeParse(missingOne).success).toBe(false);

    const extra = {
      ...coherent,
      team_facts: {
        ...coherent.team_facts,
        short_handed_slot_ids: [...coherent.team_facts.short_handed_slot_ids, "forged.extra"],
      },
    };
    expect(MatchResultSchema.safeParse(extra).success).toBe(false);
  });

  it("rejects occupied, invented, or duplicate slot identities despite conserved counts", () => {
    const coherent = coherentBelowFloorForfeitShape();
    const originalShortSlot = coherent.team_facts.short_handed_slot_ids[0]!;
    const keptStarters = coherent.lineup.filter((entry) => entry.started);
    const occupiedSlot = keptStarters[0]!.slot_id;

    const movedOntoOccupied = replaceShortSlot(coherent, originalShortSlot, occupiedSlot);
    expect(MatchResultSchema.safeParse(movedOntoOccupied).success).toBe(false);

    const invented = replaceShortSlot(coherent, originalShortSlot, "forged.formation.slot");
    expect(MatchResultSchema.safeParse(invented).success).toBe(false);

    const duplicateStarted = {
      ...coherent,
      lineup: coherent.lineup.map((entry) =>
        entry.card_id === keptStarters[1]!.card_id ? { ...entry, slot_id: occupiedSlot } : entry,
      ),
    };
    expect(MatchResultSchema.safeParse(duplicateStarted).success).toBe(false);

    const crossLinePair = coherent.team_facts.short_handed_slot_ids
      .map((slotId) => ({
        slotId,
        fact: coherent.team_facts.unavailable.find((entry) => entry.slot_id === slotId),
      }))
      .flatMap(({ slotId, fact }) =>
        fact
          ? keptStarters
              .filter((entry) => entry.position !== fact.position)
              .map((entry) => ({ slotId, entry }))
          : [],
      )[0];
    expect(crossLinePair).toBeDefined();
    const coordinatedSwapBase = replaceShortSlot(
      coherent,
      crossLinePair!.slotId,
      crossLinePair!.entry.slot_id,
    );
    const coordinatedOccupiedShortSwap = {
      ...coordinatedSwapBase,
      lineup: coordinatedSwapBase.lineup.map((entry) =>
        entry.card_id === crossLinePair!.entry.card_id
          ? { ...entry, slot_id: crossLinePair!.slotId }
          : entry,
      ),
    };
    expect(MatchResultSchema.safeParse(coordinatedOccupiedShortSwap).success).toBe(false);

    expect(MatchResultSchema.safeParse(coherent).success).toBe(true);
  });
});
