import { describe, expect, it } from "vitest";
import availabilityGolden from "../../test/fixtures/availability-event-golden.json" with { type: "json" };

import { buildScenarioInputs } from "../../test/fixtures/sim-fixtures.js";
import type { SquadSlot } from "../types/draft.js";
import type { Position } from "../types/primitives.js";
import type { SimWorld } from "../types/sim.js";
import { FORMATION_TEMPLATES, slotPositionLine } from "../types/formation.js";
import { MatchResultSchema } from "../schemas/sim.js";
import { computeSynergy } from "./synergy.js";
import { aggregateUserXiStrength, projectSlotContribution } from "./team-strength.js";
import {
  createAvailabilityState,
  drawAvailabilityForMatch,
  isHardFamilyEligible,
  resolveActiveTeam,
  selectBestBenchReplacement,
  type AvailabilityState,
} from "./availability.js";
import { runTournamentFull } from "./tournament.js";

function context(worldOverride?: SimWorld) {
  const inputs = buildScenarioInputs("upset");
  const world = worldOverride ?? inputs.world;
  const formation = FORMATION_TEMPLATES[inputs.draft.formation_id]!;
  const managerTournament = inputs.draft.manager_card_id
    ? (world.managerTournaments?.[inputs.draft.manager_card_id as string] ?? null)
    : null;
  const managerRating = inputs.draft.manager_card_id
    ? (world.managerRatings?.[inputs.draft.manager_card_id as string] ?? null)
    : null;
  const baseSynergy = computeSynergy(
    inputs.draft.squad,
    formation,
    managerTournament,
    world.nationByCardId,
  );
  const contributions = inputs.draft.squad
    .filter((slot) => slot.is_starter && slot.card_id !== null)
    .map((slot) => ({
      slot_id: slot.slot_id,
      rating: world.ratings[slot.card_id as string]!,
      position_compatibility: slot.position_compatibility,
    }));
  const baseStrength = aggregateUserXiStrength(contributions, baseSynergy, managerRating);
  return {
    ...inputs,
    world,
    formation,
    managerTournament,
    managerRating,
    baseSynergy,
    baseStrength,
  };
}

function forcedAbsence(slot: SquadSlot): AvailabilityState {
  return forcedAbsences([slot]);
}

function forcedAbsences(slots: readonly SquadSlot[]): AvailabilityState {
  const state = createAvailabilityState();
  for (const slot of slots) {
    state.absences.set(slot.player_id!, {
      card_id: slot.card_id!,
      player_id: slot.player_id!,
      slot_id: slot.slot_id,
      position: slotPositionLine(slot.slot_position),
      reason: "knock",
      duration_matches: 1,
      unavailable_through: 0,
    });
  }
  state.minorEventCount = slots.length;
  return state;
}

function resolveForced(target: Position, worldOverride?: SimWorld) {
  const c = context(worldOverride);
  const slot = c.draft.squad.find(
    (candidate) => candidate.is_starter && slotPositionLine(candidate.slot_position) === target,
  )!;
  return {
    c,
    slot,
    result: resolveActiveTeam({
      draft: c.draft,
      formation: c.formation,
      world: c.world,
      state: forcedAbsence(slot),
      managerTournament: c.managerTournament,
      managerRating: c.managerRating,
      baseSynergy: c.baseSynergy,
      baseStrength: c.baseStrength,
    }),
  };
}

describe("S1 hard family eligibility", () => {
  it("isolates GK and accepts only same/adjacent outfield lines from the canonical matrix", () => {
    expect(isHardFamilyEligible(["GK"], "GK")).toBe(true);
    expect(isHardFamilyEligible(["DF"], "GK")).toBe(false);
    expect(isHardFamilyEligible(["GK"], "DF")).toBe(false);
    expect(isHardFamilyEligible(["DF"], "DF")).toBe(true);
    expect(isHardFamilyEligible(["MF"], "DF")).toBe(true);
    expect(isHardFamilyEligible(["FW"], "DF")).toBe(false);
    expect(isHardFamilyEligible(["DF"], "MF")).toBe(true);
    expect(isHardFamilyEligible(["FW"], "MF")).toBe(true);
    expect(isHardFamilyEligible(["DF"], "FW")).toBe(false);
    expect(isHardFamilyEligible(["MF"], "FW")).toBe(true);
  });

  it("fails closed when authoritative eligibility is missing", () => {
    const c = context();
    const target = c.draft.squad.find((slot) => slot.is_starter && slot.slot_position === "GK")!;
    const bench = c.draft.squad.filter((slot) => !slot.is_starter);
    expect(
      selectBestBenchReplacement(bench, target.slot_position, {
        ...c.world,
        eligiblePositionsByCardId: {},
      }),
    ).toBeNull();
  });
});

describe("S1 active-XI mechanics", () => {
  it("is byte-equal to the canonical XI fold when nobody is unavailable", () => {
    const c = context();
    const resolved = resolveActiveTeam({
      draft: c.draft,
      formation: c.formation,
      world: c.world,
      state: createAvailabilityState(),
      managerTournament: c.managerTournament,
      managerRating: c.managerRating,
      baseSynergy: c.baseSynergy,
      baseStrength: c.baseStrength,
    });
    expect(resolved.facts.active_strength).toEqual(c.baseStrength);
    expect(resolved.facts.active_synergy).toEqual(c.baseSynergy);
  });

  it("uses the shared line projection to rank the best eligible replacement", () => {
    const c = context();
    const target = c.draft.squad.find(
      (slot) => slot.is_starter && slotPositionLine(slot.slot_position) === "MF",
    )!;
    const bench = c.draft.squad.filter((slot) => !slot.is_starter);
    const picked = selectBestBenchReplacement(bench, target.slot_position, c.world)!;
    const eligible = c.world.eligiblePositionsByCardId?.[picked.slot.card_id as string];
    if (!eligible) throw new Error("fixture eligibility missing");
    const projected = projectSlotContribution({
      rating: c.world.ratings[picked.slot.card_id as string]!,
      eligible_positions: eligible,
      slot_position: target.slot_position,
    });
    expect(picked.replacementScore).toBe(projected.weighted_channel);
    expect(picked.fit).toBe(projected.compatibility);
    const resolved = resolveForced("MF").result.facts.bench_activations[0]!;
    expect(resolved.line_contribution_delta).toBe(
      resolved.replacement_score - resolved.outgoing_score,
    );
  });

  it("recomputes synergy over the mechanical active XI", () => {
    const initial = context();
    const mfBench = initial.draft.squad.find((slot) => slot.slot_id === "bench.2")!;
    const world: SimWorld = {
      ...initial.world,
      nationByCardId: {
        ...initial.world.nationByCardId,
        [mfBench.card_id as string]: "otherland",
      },
    };
    const { result } = resolveForced("MF", world);
    expect(result.facts.bench_activations.length).toBe(1);
    expect(result.facts.active_synergy.multiplier).toBeLessThan(
      result.facts.base_synergy.multiplier,
    );
  });

  it("short-handed is strictly weaker than every eligible replacement fixture", () => {
    const initial = context();
    const withoutEligibility: SimWorld = { ...initial.world, eligiblePositionsByCardId: {} };
    const shortHanded = resolveForced("MF", withoutEligibility).result.facts.active_strength;
    const withReplacement = resolveForced("MF", initial.world).result.facts.active_strength;
    for (const channel of ["attack", "midfield", "defense", "goalkeeping"] as const) {
      expect(shortHanded[channel]).toBeLessThan(withReplacement[channel]);
    }
  });

  it("resolves the GK edge only through the drafted GK bench card", () => {
    const { result } = resolveForced("GK");
    expect(result.facts.short_handed_slot_ids).toEqual([]);
    expect(result.facts.bench_activations).toHaveLength(1);
    expect(result.facts.bench_activations[0]!.in_player_id).toBe("u12");
    expect(
      result.activeSquad.find((slot) => slot.slot_id === "4-3-3.GK" && slot.is_starter)?.player_id,
    ).toBe("u12");
  });

  it("takes the explicit short-handed path when no bench card is family-eligible", () => {
    const initial = context();
    const world: SimWorld = { ...initial.world, eligiblePositionsByCardId: {} };
    const { slot, result } = resolveForced("GK", world);
    expect(result.facts.bench_activations).toEqual([]);
    expect(result.facts.short_handed_slot_ids).toEqual([slot.slot_id]);
    expect(result.activeSquad.filter((candidate) => candidate.is_starter)).toHaveLength(10);
  });

  it("a strictly better bench never lowers active strength for the same absence", () => {
    const initial = context();
    const mfBench = initial.draft.squad.find((slot) => slot.slot_id === "bench.2")!;
    const makeWorld = (midfield: number): SimWorld => ({
      ...initial.world,
      ratings: {
        ...initial.world.ratings,
        [mfBench.card_id as string]: {
          ...initial.world.ratings[mfBench.card_id as string]!,
          midfield,
        },
      },
    });
    const weaker = resolveForced("MF", makeWorld(30)).result.facts.active_strength;
    const stronger = resolveForced("MF", makeWorld(95)).result.facts.active_strength;
    for (const channel of ["attack", "midfield", "defense", "goalkeeping"] as const) {
      expect(stronger[channel]).toBeGreaterThanOrEqual(weaker[channel]);
    }
    expect(stronger.midfield).toBeGreaterThan(weaker.midfield);
  });

  it("completely assigns overlapping DF/FW absences before maximizing replacement score", () => {
    const c = context();
    const absent = c.draft.squad.filter(
      (slot) => slot.slot_id === "4-3-3.LB" || slot.slot_id === "4-3-3.LW",
    );
    const bench = c.draft.squad.filter((slot) => !slot.is_starter && slot.card_id !== null);
    const world: SimWorld = {
      ...c.world,
      eligiblePositionsByCardId: {
        ...c.world.eligiblePositionsByCardId,
        ...Object.fromEntries(bench.map((slot) => [slot.card_id as string, []])),
        [c.draft.squad.find((slot) => slot.player_id === "u13")!.card_id as string]: ["DF"],
        [c.draft.squad.find((slot) => slot.player_id === "u14")!.card_id as string]: ["MF"],
      },
    };
    const result = resolveActiveTeam({
      draft: c.draft,
      formation: c.formation,
      world,
      state: forcedAbsences(absent),
      managerTournament: c.managerTournament,
      managerRating: c.managerRating,
      baseSynergy: c.baseSynergy,
      baseStrength: c.baseStrength,
    });

    expect(result.facts.short_handed_slot_ids).toEqual([]);
    expect(result.facts.bench_activations).toMatchObject([
      { slot_id: "4-3-3.LB", in_player_id: "u13" },
      { slot_id: "4-3-3.LW", in_player_id: "u14" },
    ]);
  });

  it("produces zero short-handed slots whenever a complete eligible assignment exists", () => {
    const c = context();
    const starters = c.draft.squad.filter((slot) => slot.is_starter && slot.card_id !== null);
    const bench = c.draft.squad.filter((slot) => !slot.is_starter && slot.card_id !== null);
    const combinations: SquadSlot[][] = [];
    const collect = (start: number, picked: SquadSlot[]): void => {
      if (picked.length > 0) combinations.push(picked.slice());
      if (picked.length === 3) return;
      for (let index = start; index < starters.length; index++) {
        picked.push(starters[index]!);
        collect(index + 1, picked);
        picked.pop();
      }
    };
    collect(0, []);

    const hasCompleteEligibleAssignment = (absent: readonly SquadSlot[]): boolean => {
      const visit = (index: number, usedCardIds: Set<string>): boolean => {
        if (index === absent.length) return true;
        const starter = absent[index]!;
        const target = slotPositionLine(starter.slot_position);
        for (const replacement of bench) {
          const replacementCardId = replacement.card_id as string;
          const eligible = c.world.eligiblePositionsByCardId?.[replacementCardId];
          if (
            usedCardIds.has(replacementCardId) ||
            !eligible ||
            !isHardFamilyEligible(eligible, target)
          ) {
            continue;
          }
          usedCardIds.add(replacementCardId);
          if (visit(index + 1, usedCardIds)) return true;
          usedCardIds.delete(replacementCardId);
        }
        return false;
      };
      return visit(0, new Set());
    };

    for (const absent of combinations) {
      if (!hasCompleteEligibleAssignment(absent)) continue;
      const result = resolveActiveTeam({
        draft: c.draft,
        formation: c.formation,
        world: c.world,
        state: forcedAbsences(absent),
        managerTournament: c.managerTournament,
        managerRating: c.managerRating,
        baseSynergy: c.baseSynergy,
        baseStrength: c.baseStrength,
      });
      expect(
        result.facts.short_handed_slot_ids,
        absent.map((slot) => slot.slot_id).join(","),
      ).toEqual([]);
    }
  });
});

describe("S1 deterministic availability lifecycle and persisted facts", () => {
  it("minor absences expire and the starter returns on the next eligible match", () => {
    const { draft } = context();
    let found: { seed: string; player: string } | null = null;
    for (let i = 0; i < 20_000 && found === null; i++) {
      const seed = `return-${i}`;
      const state = createAvailabilityState();
      drawAvailabilityForMatch(draft, seed, 0, state);
      const absence = [...state.absences.values()][0];
      if (absence?.duration_matches !== 1) continue;
      const player = absence.player_id;
      drawAvailabilityForMatch(draft, seed, 1, state);
      if (!state.absences.has(player)) found = { seed, player };
    }
    expect(found).not.toBeNull();
  });

  it("matches the committed event-log golden and its persisted mechanics", () => {
    const c = context();
    const first = runTournamentFull(c.draft, c.scenario, availabilityGolden.seed, c.world);
    const second = runTournamentFull(c.draft, c.scenario, availabilityGolden.seed, c.world);
    expect(second).toEqual(first);
    const match = first.matches[availabilityGolden.match_index]!;
    const events = match.events.filter((event) => event.type === "availability");
    expect(events).toEqual(availabilityGolden.events);
    expect(match.team_facts!.bench_activations[0]).toMatchObject({
      out_player_id: availabilityGolden.events[0]!.player_id,
      in_player_id: availabilityGolden.events[0]!.replacement_player_id,
    });
  });

  it("accepts only the exact persisted line-contribution arithmetic", () => {
    const c = context();
    const match = runTournamentFull(c.draft, c.scenario, availabilityGolden.seed, c.world).matches[
      availabilityGolden.match_index
    ]!;
    const activation = match.team_facts!.bench_activations[0]!;
    expect(activation.line_contribution_delta).toBe(
      activation.replacement_score - activation.outgoing_score,
    );
    expect(MatchResultSchema.safeParse(match).success).toBe(true);
    for (const delta of [-100, 0, 100]) {
      const candidate = {
        ...match,
        team_facts: {
          ...match.team_facts!,
          bench_activations: match.team_facts!.bench_activations.map((fact, index) =>
            index === 0
              ? {
                  ...fact,
                  replacement_score: 75,
                  outgoing_score: 50,
                  line_contribution_delta: delta,
                }
              : fact,
          ),
        },
      };
      expect(MatchResultSchema.safeParse(candidate).success).toBe(false);
    }

    const validZero = {
      ...match,
      team_facts: {
        ...match.team_facts!,
        bench_activations: match.team_facts!.bench_activations.map((fact, index) =>
          index === 0
            ? {
                ...fact,
                replacement_score: 75,
                outgoing_score: 50,
                line_contribution_delta: 25,
              }
            : fact,
        ),
      },
    };
    expect(MatchResultSchema.safeParse(validZero).success).toBe(true);
  });

  it("rejects contradictions between an activation and its availability event", () => {
    const c = context();
    const match = runTournamentFull(c.draft, c.scenario, availabilityGolden.seed, c.world).matches[
      availabilityGolden.match_index
    ]!;
    const activation = match.team_facts!.bench_activations[0]!;
    const eventIndex = match.events.findIndex(
      (event) => event.type === "availability" && event.player_id === activation.out_player_id,
    );
    const event = match.events[eventIndex]!;
    if (event.type !== "availability") throw new Error("fixture availability event missing");

    const contradictions = [
      { card_id: activation.in_card_id },
      { player_id: activation.in_player_id },
      { slot_id: "4-3-3.RB" },
      { position: event.position === "DF" ? "MF" : "DF" },
      { reason: event.reason === "knock" ? "suspension" : "knock" },
      { duration_matches: event.duration_matches === 1 ? 2 : 1 },
      { replacement_card_id: activation.out_card_id },
      { replacement_player_id: activation.out_player_id },
      { short_handed: true },
    ] as const;
    for (const contradiction of contradictions) {
      const candidate = {
        ...match,
        events: match.events.map((item, index) =>
          index === eventIndex ? { ...item, ...contradiction } : item,
        ),
      };
      expect(MatchResultSchema.safeParse(candidate).success).toBe(false);
    }

    const missingActivation = {
      ...match,
      team_facts: { ...match.team_facts!, bench_activations: [] },
    };
    expect(MatchResultSchema.safeParse(missingActivation).success).toBe(false);

    const spoofedShortHanded = {
      ...match,
      team_facts: {
        ...match.team_facts!,
        bench_activations: match.team_facts!.bench_activations.filter(
          (fact) => fact.out_player_id !== activation.out_player_id,
        ),
      },
      events: match.events.map((item, index) =>
        index === eventIndex
          ? {
              ...item,
              replacement_card_id: null,
              replacement_player_id: null,
              short_handed: true,
            }
          : item,
      ),
    };
    expect(MatchResultSchema.safeParse(spoofedShortHanded).success).toBe(false);

    const falseShortHandedSlot = {
      ...match,
      team_facts: {
        ...match.team_facts!,
        short_handed_slot_ids: [event.slot_id],
      },
    };
    expect(MatchResultSchema.safeParse(falseShortHandedSlot).success).toBe(false);
  });

  it("caps the fixed eight-match draw sequence at three minor events", () => {
    const { draft } = context();
    const state = createAvailabilityState();
    for (let matchIndex = 0; matchIndex < 8; matchIndex++) {
      drawAvailabilityForMatch(draft, "cap-28", matchIndex, state);
    }
    expect(state.minorEventCount).toBe(3);
  });

  it("accepts a legacy persisted match with no team_facts", () => {
    const c = context();
    const match = runTournamentFull(c.draft, c.scenario, "legacy-record", c.world).matches[0]!;
    const { team_facts: _facts, ...legacy } = match;
    expect(_facts).toBeDefined();
    expect(MatchResultSchema.safeParse(legacy).success).toBe(true);
  });
});
