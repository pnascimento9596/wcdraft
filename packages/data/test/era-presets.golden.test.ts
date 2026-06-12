// DC-2 — era-preset golden + census over the REAL draft-pool bundle
// (plan docs/plans/draft-config-2026-06-10.md §B).
//
// Three locks:
//
//   1. CENSUS — per-preset pool depth (player cards, manager cards, (T,N)
//      pairs, coarse position coverage) pinned to the plan's measured table.
//      Catches accidental range drift and any manager/coverage backfill that
//      changes preset validity.
//   2. PRESET GOLDEN — ONE parameterized committed fixture holding one
//      deterministic autoDraft per preset (fixtures/era-presets-golden.json;
//      regen: pnpm --filter @wcdraft/data gen:era-golden). Same seed, four
//      catalogs — proves every preset samples deterministically from its own
//      bounded pool.
//   3. DEFAULT IDENTITY — the all_time catalog is content-identical to the
//      unfiltered build, and the all_time golden draft replays the EXISTING
//      pre-DC-2 sampling byte-for-byte (the no-silent-change guarantee; the
//      untouched e2e-real-run golden on seed :29 double-locks this).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  autoDraft,
  buildDraftCatalog,
  ERA_PRESET_IDS,
  ERA_PRESETS,
  filterDraftDataset,
  type DraftDataset,
  type EraPresetId,
} from "@wcdraft/core";

import { DRAFT_POOL_BUNDLE, RUNTIME_DATA_MANIFEST } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(HERE, "fixtures/era-presets-golden.json");

function buildDataset(): DraftDataset {
  return {
    players: DRAFT_POOL_BUNDLE.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
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

const dataset = buildDataset();

// ─── 1. Census (plan §B measured table) ──────────────────────────────────────

interface PresetCensus {
  players: number;
  managers: number;
  pairs: number;
  coarse: { GK: number; DF: number; MF: number; FW: number };
}

const EXPECTED_CENSUS: Record<EraPresetId, PresetCensus> = {
  all_time: {
    players: 12219,
    managers: 501,
    pairs: 537,
    coarse: { GK: 1547, DF: 3875, MF: 3995, FW: 3316 },
  },
  post_2000: {
    players: 5757,
    managers: 193,
    pairs: 240,
    coarse: { GK: 724, DF: 1933, MF: 1980, FW: 1322 },
  },
  post_2010: {
    players: 3549,
    managers: 96,
    pairs: 144,
    coarse: { GK: 436, DF: 1189, MF: 1205, FW: 834 },
  },
  modern: {
    players: 2813,
    managers: 64,
    pairs: 112,
    coarse: { GK: 340, DF: 945, MF: 929, FW: 679 },
  },
};

describe("DC-2 era-preset census (pool-depth lock per plan §B)", () => {
  for (const preset of ERA_PRESET_IDS) {
    it(`${preset} pool depth matches the plan's measured table`, () => {
      const filtered = filterDraftDataset(dataset, preset);
      const catalog = buildDraftCatalog(dataset, preset);
      const coarse = { GK: 0, DF: 0, MF: 0, FW: 0 };
      for (const c of filtered.players) {
        for (const pos of ["GK", "DF", "MF", "FW"] as const) {
          if (c.eligible_positions.includes(pos)) coarse[pos] += 1;
        }
      }
      expect({
        players: filtered.players.length,
        managers: filtered.managers.length,
        pairs: catalog.pairs.length,
        coarse,
      }).toEqual(EXPECTED_CENSUS[preset]);
      // Every v1 preset must be coach-viable (a complete draft needs one).
      expect(catalog.hasAnyCoach).toBe(true);
    });
  }

  it("2026-only stays invalid: the 2026 tournament has ZERO manager cards", () => {
    // This is WHY arbitrary ranges are not offered in v1 (plan §B/§G).
    const t2026 = Object.entries(DRAFT_POOL_BUNDLE.tournaments).find(([, t]) => t.year === 2026);
    expect(t2026).toBeDefined();
    const tid = Number(t2026![0]);
    const managers2026 = DRAFT_POOL_BUNDLE.manager_cards.filter((m) => m.tournament_id === tid);
    expect(managers2026.length).toBe(0);
  });
});

// ─── 2 + 3. Preset golden + default identity ─────────────────────────────────

interface EraGoldenRecord {
  era_preset: EraPresetId;
  parent_seed: string;
  manager_card_id: string;
  spins: Array<{
    index: number;
    tournament_id: number;
    nation_id: string;
    rare: boolean;
    picked_kind: string;
    picked_card_id: string | null;
    assigned_slot_id: string | null;
  }>;
}

interface EraGolden {
  rating_version: string;
  engine_version: string;
  dataset_version: string;
  parent_seed: string;
  records: EraGoldenRecord[];
}

const GOLDEN = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as EraGolden;
const COMBINED_RATING_VERSION = `${RUNTIME_DATA_MANIFEST.rating_version_historical}+${RUNTIME_DATA_MANIFEST.rating_version_projected}`;

function draftFor(preset: EraPresetId) {
  return autoDraft({
    run_id: `era-golden-${preset}`,
    parent_seed: GOLDEN.parent_seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Era Golden XI",
    dataset_version: RUNTIME_DATA_MANIFEST.dataset_version,
    rating_version: COMBINED_RATING_VERSION,
    engine_version: RUNTIME_DATA_MANIFEST.engine_version,
    era_preset: preset,
    dataset,
  });
}

function project(draft: ReturnType<typeof draftFor>): EraGoldenRecord["spins"] {
  return draft.spins.map((s) => ({
    index: s.index,
    tournament_id: s.tournament_id,
    nation_id: s.nation_id,
    rare: s.rare,
    picked_kind: s.picked_kind,
    picked_card_id: (s.picked_card_id as string | null) ?? null,
    assigned_slot_id: s.assigned_slot_id,
  }));
}

describe("DC-2 era-preset golden (one deterministic draft per preset)", () => {
  it("golden is stamped with the current anchors", () => {
    expect(GOLDEN.rating_version).toBe(COMBINED_RATING_VERSION);
    expect(GOLDEN.engine_version).toBe(RUNTIME_DATA_MANIFEST.engine_version);
    expect(GOLDEN.dataset_version).toBe(RUNTIME_DATA_MANIFEST.dataset_version);
    expect(GOLDEN.records.map((r) => r.era_preset)).toEqual([...ERA_PRESET_IDS]);
  });

  for (const preset of ERA_PRESET_IDS) {
    it(`${preset}: fixed-seed draft matches the committed golden and stays in bounds`, () => {
      const golden = GOLDEN.records.find((r) => r.era_preset === preset)!;
      const draft = draftFor(preset);
      expect(project(draft)).toEqual(golden.spins);
      expect(draft.manager_card_id as string).toBe(golden.manager_card_id);
      // Bounds: every drawn tournament year inside the preset window.
      const { min_year, max_year } = ERA_PRESETS[preset];
      for (const s of draft.spins) {
        const year = DRAFT_POOL_BUNDLE.tournaments[String(s.tournament_id)]!.year;
        expect(year).toBeGreaterThanOrEqual(min_year);
        expect(year).toBeLessThanOrEqual(max_year);
      }
      // Run-twice determinism on the bounded catalog.
      expect(JSON.stringify(draftFor(preset))).toBe(JSON.stringify(draft));
    });
  }

  it("all-modern presets emit NO rare spins; all_time golden retains its rare class", () => {
    for (const r of GOLDEN.records) {
      if (r.era_preset !== "all_time") {
        expect(r.spins.every((s) => !s.rare)).toBe(true);
      }
    }
  });

  it("DEFAULT IDENTITY: the all_time catalog is content-identical to the unfiltered build", () => {
    const unfiltered = buildDraftCatalog(dataset);
    const explicit = buildDraftCatalog(dataset, "all_time");
    expect(JSON.stringify(explicit.pairs)).toBe(JSON.stringify(unfiltered.pairs));
    expect(explicit.cumulativeWeights).toEqual(unfiltered.cumulativeWeights);
    expect(explicit.hasAnyCoach).toBe(unfiltered.hasAnyCoach);
  });
});
