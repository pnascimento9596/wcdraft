// ws-f4/formations-results-ux — validity proof for the two newly-shipped
// formation shapes (4-1-4-1 and 3-4-2-1).
//
// This is NOT a byte-pinned golden: it proves the GAMEPLAY CONTRACT for each
// new shape on REAL compact data — that the draft state machine, best-XI /
// squad assembly, schema, and the sim engine all accept the new formations and
// produce a valid, fieldable 11 + a completed run. Under spin-agency
// choose-from-3, canonical autoDraft can place an outfielder in GK; that is a
// soft sim penalty, not an invalid draft state.
//
// The locked end-to-end determinism golden (e2e-real-run) covers 4-3-3 only;
// adding a second per-formation pin there would be redundant. Here we assert
// INVARIANTS (valid XI, exactly one filled GK slot, schema-clean boundary
// objects, a finished run) that hold for any seed, so the test stays
// deterministic without embedding a fixture.

import { describe, expect, it } from "vitest";

import {
  autoDraft,
  buildRunScenario,
  runTournamentFull,
  validateSquad,
  slotPositionLine,
  FORMATION_TEMPLATES,
  DraftStateSchema,
  RunResultSchema,
  MatchResultSchema,
  type Bracket2026,
  type DraftDataset,
  type ManagerTournament,
  type SimWorld,
  type Team2026,
} from "@wcdraft/core";

import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST, SCENARIO_2026_BUNDLE } from "../src/index.js";

const NEW_FORMATIONS = ["4-1-4-1", "3-4-2-1"] as const;
const COMBINED_RATING_VERSION = `${RUNTIME_DATA_MANIFEST.rating_version_historical}+${RUNTIME_DATA_MANIFEST.rating_version_projected}`;

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
    tournaments: Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

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
  };
}

describe("new formations (4-1-4-1, 3-4-2-1) — draftable + simulatable on real data", () => {
  for (const formation_id of NEW_FORMATIONS) {
    const seed = `wcdraft:new-formation:${formation_id}:1`;
    const dataset = buildDataset();

    const draft = autoDraft({
      run_id: `new-formation-${formation_id}`,
      parent_seed: seed,
      formation_id,
      mode: "classic",
      team_name: "Shape Test XI",
      dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
      rating_version: COMBINED_RATING_VERSION,
      engine_version: RUNTIME_DATA_MANIFEST.engine_version,
      dataset,
    });

    it(`${formation_id}: template has 11 starter slots summing to 10 outfield + GK`, () => {
      const template = FORMATION_TEMPLATES[formation_id]!;
      expect(template.slots).toHaveLength(11);
      const gkSlots = template.slots.filter((s) => slotPositionLine(s.slot_position) === "GK");
      expect(gkSlots).toHaveLength(1);
      const outfield = template.slots.length - gkSlots.length;
      expect(outfield).toBe(10);
      expect(formation_id.split("-").reduce((a, b) => a + Number(b), 0)).toBe(10);
    });

    it(`${formation_id}: autoDraft yields a fieldable XI with an honest GK-slot state`, () => {
      const starters = draft.squad.filter((s) => s.is_starter);
      expect(starters).toHaveLength(11);
      const gkSlots = starters.filter((s) => slotPositionLine(s.slot_position) === "GK");
      expect(gkSlots).toHaveLength(1);
      expect(starters.every((s) => s.card_id !== null)).toBe(true);

      const v = validateSquad(draft);
      expect(v.is_fieldable).toBe(true);
      if (!v.has_goalkeeper) {
        expect(gkSlots[0]!.validation_warnings.some((w) => w.includes("outfielder in goal"))).toBe(
          true,
        );
      }
    });

    it(`${formation_id}: DraftState passes its zod boundary schema`, () => {
      const r = DraftStateSchema.safeParse(draft);
      if (!r.success) {
        throw new Error(`DraftState schema failed: ${JSON.stringify(r.error.issues, null, 2)}`);
      }
      expect(draft.formation_id).toBe(formation_id);
    });

    it(`${formation_id}: a full tournament simulates to a completed, schema-valid run`, () => {
      const scenarioBundle = buildRunScenario({
        parent_seed: seed,
        teams: SCENARIO_2026_BUNDLE.teams as readonly Team2026[],
        bracket: {
          groups: SCENARIO_2026_BUNDLE.groups,
          knockout_slots: SCENARIO_2026_BUNDLE.knockout_slots,
        },
        ruleset_version: RUNTIME_DATA_MANIFEST.ruleset_version,
      });
      const world = buildSimWorld();
      const { run, matches } = runTournamentFull(draft, scenarioBundle.scenario, seed, world);

      const rr = RunResultSchema.safeParse(run);
      if (!rr.success) {
        throw new Error(`RunResult schema failed: ${JSON.stringify(rr.error.issues, null, 2)}`);
      }
      expect(matches.length).toBeGreaterThan(0);
      for (const m of matches) {
        const mr = MatchResultSchema.safeParse(m);
        if (!mr.success) {
          throw new Error(`MatchResult schema failed: ${JSON.stringify(mr.error.issues, null, 2)}`);
        }
      }
    });
  }
});
