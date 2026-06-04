import { describe, it, expect } from "vitest";

import { computeSynergy } from "./engine/synergy.js";
import { aggregateUserXiStrength } from "./engine/team-strength.js";
import type { StarterContribution } from "./api/team-strength.js";
import { FORMATION_TEMPLATES } from "./types/formation.js";
import { buildCardId } from "./types/identity.js";
import { buildManagerCardId } from "./types/manager.js";
import type { ManagerRating, ManagerTournament } from "./types/manager.js";
import type { Rating } from "./types/rating.js";
import type { SquadSlot } from "./types/draft.js";

// GOLDEN INVARIANT (WS-0c contract; calibration WS-B):
//   computeSynergy is PURE — identical (squad, formation, manager) → byte-equal
//   SynergyResult. Components: nation_clusters (starters only), linked_pairs
//   (1:1 with adjacency edges), manager_link (0 when no manager), bounded
//   multiplier. team-strength bounded invariant via aggregateUserXiStrength.

const TID = 14;
const TEMPLATE = FORMATION_TEMPLATES["4-3-3"]!;

interface SquadOpts {
  starterNations: string[]; // length 11, one per template starter slot (or "" = vacant)
  benchNations?: string[];
}

function buildSquad(opts: SquadOpts): { squad: SquadSlot[]; nationByCardId: Record<string, string> } {
  const squad: SquadSlot[] = [];
  const nationByCardId: Record<string, string> = {};
  TEMPLATE.slots.forEach((slot, i) => {
    const nation = opts.starterNations[i] ?? "";
    if (nation === "") {
      // Vacant starter slot.
      squad.push({
        slot_id: slot.slot_id,
        is_starter: true,
        slot_position: slot.slot_position,
        card_id: null,
        player_id: null,
        tournament_id: null,
        position_compatibility: 0,
        validation_warnings: [],
      });
      return;
    }
    const player_id = `s${i}`;
    const card_id = buildCardId(player_id, TID);
    nationByCardId[card_id as string] = nation;
    squad.push({
      slot_id: slot.slot_id,
      is_starter: true,
      slot_position: slot.slot_position,
      card_id,
      player_id,
      tournament_id: TID,
      position_compatibility: 1,
      validation_warnings: [],
    });
  });
  const bench = opts.benchNations ?? [];
  bench.forEach((nation, i) => {
    const player_id = `b${i}`;
    const card_id = buildCardId(player_id, TID);
    nationByCardId[card_id as string] = nation;
    squad.push({
      slot_id: `bench.${i}`,
      is_starter: false,
      slot_position: "CM",
      card_id,
      player_id,
      tournament_id: TID,
      position_compatibility: 1,
      validation_warnings: [],
    });
  });
  return { squad, nationByCardId };
}

function managerTournament(nation: string): ManagerTournament {
  const manager_card_id = buildManagerCardId("mgr1", TID);
  return {
    manager_card_id,
    manager_id: "mgr1",
    tournament_id: TID,
    nation_id: nation,
    matches: 7,
    final_placement: 1,
    sources: [],
  };
}

const ALL = (nation: string): string[] => Array.from({ length: 11 }, () => nation);

describe("synergy — identical (squad, formation, manager) yields identical SynergyResult", () => {
  it("computeSynergy twice with the same inputs is byte-equal", () => {
    const { squad, nationByCardId } = buildSquad({ starterNations: ALL("BRA") });
    const mgr = managerTournament("BRA");
    const a = computeSynergy(squad, TEMPLATE, mgr, nationByCardId);
    const b = computeSynergy(squad, TEMPLATE, mgr, nationByCardId);
    expect(a).toEqual(b);
  });

  it("invariant under starter slot-array order permutations (keyed on slot_id)", () => {
    const { squad, nationByCardId } = buildSquad({ starterNations: ALL("BRA") });
    const shuffled = [...squad].reverse();
    const a = computeSynergy(squad, TEMPLATE, null, nationByCardId);
    const b = computeSynergy(shuffled, TEMPLATE, null, nationByCardId);
    expect(a).toEqual(b);
  });

  it("linked_pairs is 1:1 with the formation adjacency edges, in order", () => {
    const { squad, nationByCardId } = buildSquad({ starterNations: ALL("BRA") });
    const r = computeSynergy(squad, TEMPLATE, null, nationByCardId);
    expect(r.linked_pairs.length).toBe(TEMPLATE.adjacency.length);
    r.linked_pairs.forEach((p, i) => {
      expect([p.slot_id_a, p.slot_id_b]).toEqual([...TEMPLATE.adjacency[i]!]);
      expect(p.linked).toBe(true); // all-BRA → every occupied edge links
      expect(p.nation_id).toBe("BRA");
    });
  });

  it("bench cards do NOT contribute to nation_clusters or linked_pairs", () => {
    const a = buildSquad({ starterNations: ALL("BRA"), benchNations: ["ARG", "ARG", "ARG", "ARG", "ARG"] });
    const b = buildSquad({ starterNations: ALL("BRA"), benchNations: ["BRA", "BRA", "BRA", "BRA", "BRA"] });
    const ra = computeSynergy(a.squad, TEMPLATE, null, a.nationByCardId);
    const rb = computeSynergy(b.squad, TEMPLATE, null, b.nationByCardId);
    // Bench composition is invisible (clusters + links identical; multiplier identical).
    expect(ra.nation_clusters).toEqual(rb.nation_clusters);
    expect(ra.linked_pairs).toEqual(rb.linked_pairs);
    expect(ra.multiplier).toBe(rb.multiplier);
  });

  it("manager_link === 0 when manager is null (no implicit positive)", () => {
    const { squad, nationByCardId } = buildSquad({ starterNations: ALL("BRA") });
    const r = computeSynergy(squad, TEMPLATE, null, nationByCardId);
    expect(r.manager_link).toBe(0);
  });

  it("manager sharing the XI nation drives manager_link to 1", () => {
    const { squad, nationByCardId } = buildSquad({ starterNations: ALL("BRA") });
    const r = computeSynergy(squad, TEMPLATE, managerTournament("BRA"), nationByCardId);
    expect(r.manager_link).toBe(1);
  });

  it("a vacant slot adjacent to occupied slots yields linked=false; BRA cluster size 10", () => {
    // Vacate the GK slot (index 0).
    const nations = ALL("BRA");
    nations[0] = "";
    const { squad, nationByCardId } = buildSquad({ starterNations: nations });
    const r = computeSynergy(squad, TEMPLATE, null, nationByCardId);
    const vacantId = TEMPLATE.slots[0]!.slot_id;
    for (const p of r.linked_pairs) {
      if (p.slot_id_a === vacantId || p.slot_id_b === vacantId) {
        expect(p.linked).toBe(false);
        expect(p.nation_id).toBeNull();
      }
    }
    const bra = r.nation_clusters.find((c) => c.nation_id === "BRA");
    expect(bra?.size).toBe(10);
  });

  it("unknown nations (no nationByCardId) produce no clusters / no links", () => {
    const { squad } = buildSquad({ starterNations: ALL("BRA") });
    const r = computeSynergy(squad, TEMPLATE, null /* no nation map */);
    expect(r.nation_clusters).toEqual([]);
    expect(r.linked_pairs.every((p) => !p.linked)).toBe(true);
    expect(r.manager_link).toBe(0);
  });
});

// ─── TEAM-STRENGTH BOUNDED INVARIANT ─────────────────────────────────────────

function rating(player_id: string, channel: number): Rating {
  const card_id = buildCardId(player_id, TID);
  return {
    card_id,
    player_id,
    tournament_id: TID,
    overall: channel,
    attack: channel,
    midfield: channel,
    defense: channel,
    goalkeeping: channel,
    components: [],
    coverage: 1,
    coverage_basis: "wc_signals",
    provenance: "projected_career",
    rating_version: "v1",
  };
}

function starters(channel: number): StarterContribution[] {
  return TEMPLATE.slots.map((s, i) => ({
    slot_id: s.slot_id,
    rating: rating(`x${i}`, channel),
    position_compatibility: 1,
  }));
}

function managerRating(overall: number): ManagerRating {
  const manager_card_id = buildManagerCardId("mgr1", TID);
  return {
    manager_card_id,
    manager_id: "mgr1",
    tournament_id: TID,
    overall,
    dimensions: { pedigree: overall, experience: overall },
    components: [],
    coverage: 1,
    coverage_basis: "wc_signals",
    provenance: "wc_performance",
    rating_version: "v1",
  };
}

describe("team-strength — bounded multiplier (Synergy amplifies, never replaces talent)", () => {
  it("a high-Synergy weak XI cannot out-aggregate a low-Synergy superstar XI", () => {
    // A: mediocre (50) all-BRA + Brazilian manager → maximal Synergy + manager modifier.
    const a = buildSquad({ starterNations: ALL("BRA") });
    const synergyA = computeSynergy(a.squad, TEMPLATE, managerTournament("BRA"), a.nationByCardId);
    const aggA = aggregateUserXiStrength(starters(50), synergyA, managerRating(85));

    // B: superstar (92) of 11 distinct nations + no manager → minimal Synergy.
    const distinct = ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10"];
    const b = buildSquad({ starterNations: distinct });
    const synergyB = computeSynergy(b.squad, TEMPLATE, null, b.nationByCardId);
    const aggB = aggregateUserXiStrength(starters(92), synergyB, null);

    expect(aggB.attack).toBeGreaterThan(aggA.attack);
    expect(aggB.defense).toBeGreaterThan(aggA.defense);
    expect(aggB.midfield).toBeGreaterThan(aggA.midfield);
    // And the multiplier really was higher for A (so the guarantee is non-trivial).
    expect(synergyA.multiplier).toBeGreaterThan(synergyB.multiplier);
  });

  it("aggregateUserXiStrength throws unless exactly 11 starters are supplied", () => {
    const { squad, nationByCardId } = buildSquad({ starterNations: ALL("BRA") });
    const synergy = computeSynergy(squad, TEMPLATE, null, nationByCardId);
    expect(() => aggregateUserXiStrength(starters(50).slice(0, 10), synergy, null)).toThrow(RangeError);
  });

  it("null manager folds as a 1.0 modifier (no implicit zero)", () => {
    const { squad, nationByCardId } = buildSquad({ starterNations: ALL("BRA") });
    const synergy = computeSynergy(squad, TEMPLATE, null, nationByCardId);
    const withNull = aggregateUserXiStrength(starters(60), synergy, null);
    const withNeutral = aggregateUserXiStrength(starters(60), synergy, managerRating(50));
    // A manager rated exactly at the pivot (50) is also a 1.0 modifier → equal.
    expect(withNull).toEqual(withNeutral);
  });
});
