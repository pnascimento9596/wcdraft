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

function buildSquad(opts: SquadOpts): {
  squad: SquadSlot[];
  nationByCardId: Record<string, string>;
} {
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
    const a = buildSquad({
      starterNations: ALL("BRA"),
      benchNations: ["ARG", "ARG", "ARG", "ARG", "ARG"],
    });
    const b = buildSquad({
      starterNations: ALL("BRA"),
      benchNations: ["BRA", "BRA", "BRA", "BRA", "BRA"],
    });
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
    // A: mediocre (50) all-BRA + Brazilian manager → maximal Synergy + manager-link band.
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
    expect(() => aggregateUserXiStrength(starters(50).slice(0, 10), synergy, null)).toThrow(
      RangeError,
    );
  });

  it("zero manager_link folds as a 1.0 modifier (no implicit zero)", () => {
    const { squad, nationByCardId } = buildSquad({ starterNations: ALL("BRA") });
    const synergy = computeSynergy(squad, TEMPLATE, null, nationByCardId);
    const withNull = aggregateUserXiStrength(starters(60), synergy, null);
    const withNeutral = aggregateUserXiStrength(starters(60), synergy, managerRating(50));
    // ManagerRating.overall is display-only; manager_link is 0 when no manager is drafted.
    expect(withNull).toEqual(withNeutral);
  });
});

// ─── ENGINE-V2 E-2 NATION-ONLY (cross-year) ──────────────────────────────────

interface MixedSquadOpts {
  starterNations: string[]; // length 11
  starterTournamentIds: number[]; // length 11
  benchNations?: string[];
  benchTournamentIds?: number[];
}

function buildMixedSquad(opts: MixedSquadOpts): {
  squad: SquadSlot[];
  nationByCardId: Record<string, string>;
} {
  const squad: SquadSlot[] = [];
  const nationByCardId: Record<string, string> = {};
  TEMPLATE.slots.forEach((slot, i) => {
    const nation = opts.starterNations[i] ?? "";
    const yearTid = opts.starterTournamentIds[i] ?? TID;
    if (nation === "") {
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
    const player_id = `s${i}-${yearTid}`;
    const card_id = buildCardId(player_id, yearTid);
    nationByCardId[card_id as string] = nation;
    squad.push({
      slot_id: slot.slot_id,
      is_starter: true,
      slot_position: slot.slot_position,
      card_id,
      player_id,
      tournament_id: yearTid,
      position_compatibility: 1,
      validation_warnings: [],
    });
  });
  const bench = opts.benchNations ?? [];
  const benchTids = opts.benchTournamentIds ?? [];
  bench.forEach((nation, i) => {
    const yearTid = benchTids[i] ?? TID;
    const player_id = `b${i}-${yearTid}`;
    const card_id = buildCardId(player_id, yearTid);
    nationByCardId[card_id as string] = nation;
    squad.push({
      slot_id: `bench.${i}`,
      is_starter: false,
      slot_position: "CM",
      card_id,
      player_id,
      tournament_id: yearTid,
      position_compatibility: 1,
      validation_warnings: [],
    });
  });
  return { squad, nationByCardId };
}

function managerTournamentAt(nation: string, yearTid: number): ManagerTournament {
  const manager_card_id = buildManagerCardId("mgr1", yearTid);
  return {
    manager_card_id,
    manager_id: "mgr1",
    tournament_id: yearTid,
    nation_id: nation,
    matches: 7,
    final_placement: 1,
    sources: [],
  };
}

describe("synergy — ENGINE-V2 E-2 NATION-ONLY (year-agnostic)", () => {
  it("same-nation starters link across different tournament years", () => {
    // 11 Brazilian starters spanning historical years 1958–2026.
    const years = [1958, 1962, 1970, 1982, 1994, 2002, 2006, 2010, 2014, 2018, 2026];
    const { squad, nationByCardId } = buildMixedSquad({
      starterNations: ALL("BRA"),
      starterTournamentIds: years,
    });
    const r = computeSynergy(squad, TEMPLATE, null, nationByCardId);
    // Every adjacency edge between occupied starters must link as same-nation.
    for (const p of r.linked_pairs) {
      expect(p.linked).toBe(true);
      expect(p.nation_id).toBe("BRA");
    }
    // And the cluster is a single BRA cluster of size 11.
    expect(r.nation_clusters.length).toBe(1);
    expect(r.nation_clusters[0]!.nation_id).toBe("BRA");
    expect(r.nation_clusters[0]!.size).toBe(11);
  });

  it("different nations do NOT link even when tournament year matches", () => {
    // All starters at 2002, but split BRA / GER 5/6.
    const nations = ["BRA", "BRA", "BRA", "BRA", "BRA", "GER", "GER", "GER", "GER", "GER", "GER"];
    const years = Array.from({ length: 11 }, () => 2002);
    const { squad, nationByCardId } = buildMixedSquad({
      starterNations: nations,
      starterTournamentIds: years,
    });
    const r = computeSynergy(squad, TEMPLATE, null, nationByCardId);
    // Any edge whose endpoints span different nations must NOT link.
    for (const p of r.linked_pairs) {
      const slotsById = new Map(squad.filter((s) => s.is_starter).map((s) => [s.slot_id, s]));
      const cidA = slotsById.get(p.slot_id_a)!.card_id!;
      const cidB = slotsById.get(p.slot_id_b)!.card_id!;
      const na = nationByCardId[cidA as string];
      const nb = nationByCardId[cidB as string];
      if (na !== nb) {
        expect(p.linked).toBe(false);
        expect(p.nation_id).toBeNull();
      } else {
        expect(p.linked).toBe(true);
        expect(p.nation_id).toBe(na);
      }
    }
  });

  it("manager_link is count-based and year-agnostic", () => {
    // Scenario A: 5 BRA starters mixed across years; 6 non-BRA starters.
    // 5/11 ≈ 0.4545, divided by MANAGER_LINK_FULL_AT (0.6) → ≈ 0.757 ∈ (0, 1).
    const yearsA = [1958, 1962, 1970, 1982, 1994, 2002, 2002, 2002, 2002, 2002, 2002];
    const nationsA = ["BRA", "BRA", "BRA", "BRA", "BRA", "GER", "ITA", "ARG", "FRA", "ENG", "ESP"];
    const a = buildMixedSquad({
      starterNations: nationsA,
      starterTournamentIds: yearsA,
    });
    const mgrA = managerTournamentAt("BRA", 2026); // mgr year ≠ any starter year for most.

    // Scenario B: same 7 BRA / 4 non-BRA but all on a SINGLE year (2002).
    const nationsB = nationsA.slice();
    const yearsB = Array.from({ length: 11 }, () => 2002);
    const b = buildMixedSquad({
      starterNations: nationsB,
      starterTournamentIds: yearsB,
    });
    const mgrB = managerTournamentAt("BRA", 2002);

    const ra = computeSynergy(a.squad, TEMPLATE, mgrA, a.nationByCardId);
    const rb = computeSynergy(b.squad, TEMPLATE, mgrB, b.nationByCardId);

    // Same-nation starter count drives manager_link; both scenarios share count.
    expect(ra.manager_link).toBe(rb.manager_link);
    // And both are strictly between 0 and 1 (partial share).
    expect(ra.manager_link).toBeGreaterThan(0);
    expect(ra.manager_link).toBeLessThan(1);
  });

  it("manager tournament year is irrelevant — all-BRA XI yields manager_link === 1", () => {
    const years = [1958, 1970, 1982, 1994, 2002, 2006, 2010, 2014, 2018, 2022, 2026];
    const { squad, nationByCardId } = buildMixedSquad({
      starterNations: ALL("BRA"),
      starterTournamentIds: years,
    });
    // Manager card from 2026 still links fully against pre-1998 BRA starters.
    const mgr = managerTournamentAt("BRA", 2026);
    const r = computeSynergy(squad, TEMPLATE, mgr, nationByCardId);
    expect(r.manager_link).toBe(1);
  });

  it("bench composition (incl. bench years) does not affect manager_link", () => {
    const starterYears = [1970, 1970, 1970, 1970, 1970, 1970, 1970, 1970, 1970, 1970, 1970];
    const a = buildMixedSquad({
      starterNations: ALL("BRA"),
      starterTournamentIds: starterYears,
      benchNations: ["ARG", "ARG", "ARG", "ARG", "ARG"],
      benchTournamentIds: [1970, 1970, 1970, 1970, 1970],
    });
    const b = buildMixedSquad({
      starterNations: ALL("BRA"),
      starterTournamentIds: starterYears,
      benchNations: ["ARG", "ARG", "ARG", "ARG", "ARG"],
      benchTournamentIds: [2026, 2026, 2026, 2026, 2026],
    });
    const mgr = managerTournamentAt("BRA", 2002);
    const ra = computeSynergy(a.squad, TEMPLATE, mgr, a.nationByCardId);
    const rb = computeSynergy(b.squad, TEMPLATE, mgr, b.nationByCardId);
    expect(ra.manager_link).toBe(rb.manager_link);
    expect(ra.nation_clusters).toEqual(rb.nation_clusters);
    expect(ra.linked_pairs).toEqual(rb.linked_pairs);
  });
});
