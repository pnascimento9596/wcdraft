// Selected rating-basis (Career / Current) — RED contract tests.
//
// REQUIRED OUTCOMES (selected-basis lane):
//   - SIM: a `current` run feeds the engine `basis_ratings.current` channels;
//     a `career` run is byte-identical to before the seam existed. The basis
//     genuinely changes sim INPUTS (not display-only) and is deterministic.
//   - DISPLAY: the adapter resolves each card from the run's basis on BOTH
//     bases, including per-basis provenance (an estimate on Current must badge
//     as an estimate, never as measured).
//   - CONTROL vs DATA: the setup control offers exactly the bases the served
//     runtime bundle carries — the UI can never silently lag the data.
//
// Leaderboard acceptance of `current` as a per-config board axis is pinned in
// lib/leaderboard/__tests__/validate.test.ts.

import { describe, expect, it } from "vitest";

import {
  autoDraft,
  buildDraftCatalog,
  type CardId,
  type DraftDataset,
  type DraftState,
} from "@wcdraft/core";
import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  SCENARIO_2026_BUNDLE,
  type RuntimeDataManifest,
} from "@wcdraft/data";

import type { GameData, RunRecordVersions } from "../data";
import { buildGameDataIndexes, composeVersions } from "../data";
import type { RunRecordV1 } from "../run-record";
import { buildSimWorldInputs, runSimulationSync } from "../simulate";
import { playerCardView } from "../adapters";
import { SETUP_RATING_BASES } from "@/components/game/draft-screen";

// ─── Harness (mirrors memory-hidden-mode.test.ts) ────────────────────────────

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

function buildGameData(): GameData {
  const manifest = RUNTIME_DATA_MANIFEST as RuntimeDataManifest;
  const versions: RunRecordVersions = composeVersions(manifest);
  const indexes = buildGameDataIndexes(DRAFT_POOL_BUNDLE);
  const draftDataset = buildDataset();
  return {
    manifest,
    draftPool: DRAFT_POOL_BUNDLE,
    versions,
    indexes,
    draftDataset,
    catalog: buildDraftCatalog(draftDataset),
    nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
  };
}

function recordFor(
  gameData: GameData,
  rating_basis: "career" | "current",
  seed = "wcdraft:basis:v1:7",
): RunRecordV1 {
  const draft = autoDraft({
    run_id: "basis-origin",
    parent_seed: seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Basis XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    rating_basis,
    dataset: gameData.draftDataset,
  });
  return {
    record_version: 1,
    run_id: "basis-origin",
    parent_seed: seed,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
  };
}

const gameData = buildGameData();

/** Cards whose Career and Current overalls genuinely diverge. */
const divergent = DRAFT_POOL_BUNDLE.ratings.filter(
  (r) =>
    typeof r.overall === "number" &&
    typeof r.basis_ratings.current.overall === "number" &&
    r.overall !== r.basis_ratings.current.overall,
);

// ─── Control vs data ─────────────────────────────────────────────────────────

describe("setup control offers exactly the bundle's bases", () => {
  it("the control set equals the manifest's rating_basis keys", () => {
    const bundleBases = Object.keys(RUNTIME_DATA_MANIFEST.counts.rating_basis).sort();
    expect([...SETUP_RATING_BASES].sort()).toEqual(bundleBases);
  });
});

// ─── Display seam ────────────────────────────────────────────────────────────

describe("display adapter resolves the selected basis", () => {
  it("has a non-trivial divergent cohort to sample (sanity)", () => {
    expect(divergent.length).toBeGreaterThanOrEqual(10);
  });

  it("career vs current differ for ≥10 sampled divergent cards", () => {
    const sample = divergent.slice(0, 12);
    for (const r of sample) {
      const career = playerCardView(gameData.indexes, r.card_id, { basis: "career" });
      const current = playerCardView(gameData.indexes, r.card_id, { basis: "current" });
      expect(career.rating.overall).toBe(r.overall);
      expect(current.rating.overall).toBe(r.basis_ratings.current.overall);
      expect(current.rating.overall).not.toBe(career.rating.overall);
    }
  });

  it("a Current-basis estimate badges as an estimate, never as measured", () => {
    const est = DRAFT_POOL_BUNDLE.ratings.find(
      (r) => r.basis_ratings.current.overall_basis === "baseline_anchor_estimate",
    );
    expect(est, "expected ≥1 current baseline_anchor_estimate card").toBeDefined();
    const view = playerCardView(gameData.indexes, est!.card_id, { basis: "current" });
    expect(view.rating.badge_kind).toBe("estimate");
    expect(view.rating.basis).toBe("current");
  });

  it("default (omitted basis) is the Career alias, unchanged", () => {
    const r = divergent[0]!;
    const def = playerCardView(gameData.indexes, r.card_id);
    expect(def.rating.overall).toBe(r.overall);
    expect(def.rating.basis).toBe("career");
  });
});

// ─── Sim seam ────────────────────────────────────────────────────────────────

/** Force a known divergent card into the first filled starter slot. */
function injectDivergent(draft: DraftState, cardId: CardId): DraftState {
  const squad = draft.squad.map((sl) => ({ ...sl }));
  const idx = squad.findIndex((sl) => sl.is_starter && sl.card_id !== null);
  squad[idx]!.card_id = cardId;
  return { ...draft, squad };
}

describe("sim world consumes the selected basis (not display-only)", () => {
  const career = recordFor(gameData, "career");
  const current = recordFor(gameData, "current");

  it("career build is byte-identical to the raw Career rating (unchanged path)", () => {
    const { world } = buildSimWorldInputs(gameData, SCENARIO_2026_BUNDLE, career);
    for (const slot of career.draft.squad) {
      if (!slot.card_id) continue;
      const raw = gameData.indexes.ratingByCardId.get(slot.card_id)!;
      expect(world.ratings[slot.card_id]).toBe(raw); // same object reference
    }
  });

  it("a divergent card feeds DIFFERENT channels per basis", () => {
    const div = divergent.find((r) => r.attack !== r.basis_ratings.current.attack) ?? divergent[0]!;
    const careerWorld = buildSimWorldInputs(gameData, SCENARIO_2026_BUNDLE, {
      ...career,
      draft: injectDivergent(career.draft, div.card_id as CardId),
    }).world;
    const currentWorld = buildSimWorldInputs(gameData, SCENARIO_2026_BUNDLE, {
      ...current,
      draft: injectDivergent(current.draft, div.card_id as CardId),
    }).world;
    expect(careerWorld.ratings[div.card_id]!.overall).toBe(div.overall);
    expect(currentWorld.ratings[div.card_id]!.overall).toBe(div.basis_ratings.current.overall);
    expect(currentWorld.ratings[div.card_id]).not.toEqual(careerWorld.ratings[div.card_id]);
  });

  it("a Current run is deterministic — same record simulates byte-identically twice", () => {
    const a = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, current).simulation;
    const b = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, current).simulation;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
