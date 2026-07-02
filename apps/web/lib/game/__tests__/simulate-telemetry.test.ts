// Tests the determinism contract on PersistedSimulation: two runs from the
// same parent_seed produce a byte-identical deterministic subset, while
// telemetry (duration_ms) is excluded from that guarantee and is allowed to
// vary.
//
// Background — review on PR #18 caught wall-clock `duration_ms` living
// INSIDE the persisted payload, which broke byte-identity (PersistedSimulation
// pairs compared via deepEqual returned false even though the deterministic
// subset was identical). The fix moves telemetry into a sibling
// `SimulationTelemetry` field returned alongside the payload.

import { describe, expect, it } from "vitest";

import { autoDraft, buildDraftCatalog, type DraftDataset } from "@wcdraft/core";
import {
  DAILY_SEED_SALT_MAP_BUNDLE,
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  SCENARIO_2026_BUNDLE,
  type RuntimeDataManifest,
} from "@wcdraft/data";

import type { GameData, RunRecordVersions } from "../data";
import { buildGameDataIndexes, composeVersions } from "../data";
import type { RunRecordV1 } from "../run-record";
import {
  buildWorkerSimInputs,
  handleWorkerInput,
  runSimulationSync,
  type SyncSimulationResult,
} from "../simulate";

// ─── Test harness ────────────────────────────────────────────────────────────

const PARENT_SEED = "wcdraft:e2e-real-run:v1:14";

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
    // ENGINE-V2 E-1: era-weighted sampling needs tournament years.
    tournaments: Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

function buildGameDataFromBundles(): GameData {
  const manifest = RUNTIME_DATA_MANIFEST as RuntimeDataManifest;
  const versions: RunRecordVersions = composeVersions(manifest);
  const indexes = buildGameDataIndexes(DRAFT_POOL_BUNDLE);
  const draftDataset = buildDataset();
  const catalog = buildDraftCatalog(draftDataset);
  return {
    manifest,
    draftPool: DRAFT_POOL_BUNDLE,
    versions,
    indexes,
    draftDataset,
    catalog,
    nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
    dailySeedSaltMap: DAILY_SEED_SALT_MAP_BUNDLE,
  };
}

function buildRecord(gameData: GameData, seed: string): RunRecordV1 {
  const draft = autoDraft({
    run_id: "telemetry-spec",
    parent_seed: seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Telemetry XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    dataset: gameData.draftDataset,
  });
  return {
    record_version: 1,
    run_id: "telemetry-spec",
    parent_seed: seed,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
  };
}

function asPlain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("simulate.ts — determinism / telemetry separation", () => {
  const gameData = buildGameDataFromBundles();
  const record = buildRecord(gameData, PARENT_SEED);

  it("two runs from the same parent_seed yield a byte-identical deterministic subset", () => {
    // Use a clock that returns wildly different values between runs to PROVE
    // the deterministic subset doesn't depend on it. A counter clock + a
    // null clock cover both branches of `t0/t1 → duration_ms`.
    let tick = 0;
    const a: SyncSimulationResult = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record, {
      clock: () => (tick += 1.5),
    });
    const b: SyncSimulationResult = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record, {
      clock: () => 0,
    });

    // Plain JSON to defeat any incidental class-prototype / frozen-array
    // differences. Byte-identity is what we contractually claim.
    expect(JSON.stringify(a.simulation)).toBe(JSON.stringify(b.simulation));
    expect(asPlain(a.simulation)).toEqual(asPlain(b.simulation));
  });

  it("the simulation payload has NO duration_ms field (telemetry lives elsewhere)", () => {
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record);
    // The cast pins the property absence at the runtime level: if a future
    // refactor accidentally re-introduces duration_ms inside the payload,
    // this test breaks loudly instead of silently.
    expect((simulation as unknown as Record<string, unknown>).duration_ms).toBeUndefined();
    expect(Object.keys(simulation).sort()).toEqual([
      "group_stage",
      "knockout_ladder_meta",
      "matches",
      "run",
      "scenario",
    ]);
  });

  it("telemetry is reported separately and is allowed to differ across runs", () => {
    // Same record, real performance.now() (or null in node) — telemetry is
    // explicitly NOT part of the determinism guarantee.
    const a = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record);
    const b = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record);
    expect(a.telemetry).toBeDefined();
    expect(b.telemetry).toBeDefined();
    // The deterministic subset still matches even though telemetry can vary.
    expect(JSON.stringify(a.simulation)).toBe(JSON.stringify(b.simulation));
  });

  it("an injected clock produces the expected duration_ms in telemetry only", () => {
    let tick = 100;
    const { simulation, telemetry } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record, {
      clock: () => (tick += 50),
    });
    expect(telemetry.duration_ms).toBe(50);
    // Re-run with the SAME deterministic inputs and a DIFFERENT clock: the
    // simulation must still be byte-identical.
    let tick2 = 0;
    const second = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record, {
      clock: () => (tick2 += 0.1),
    });
    expect(second.telemetry.duration_ms).toBeCloseTo(0.1, 5);
    expect(JSON.stringify(second.simulation)).toBe(JSON.stringify(simulation));
  });

  it("worker payload pruning preserves byte-identical simulation output", () => {
    const workerInputs = buildWorkerSimInputs(gameData, SCENARIO_2026_BUNDLE, record);
    const workerOutput = handleWorkerInput({
      kind: "run",
      draft: record.draft,
      parent_seed: record.parent_seed,
      world: workerInputs.world,
      scenario: workerInputs.scenario,
    });
    const sync = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record).simulation;

    expect(workerOutput.kind).toBe("done");
    if (workerOutput.kind !== "done") return;
    expect(JSON.stringify(workerOutput.simulation)).toBe(JSON.stringify(sync));
  });

  it("worker payload only carries drafted-card nations, not the full pool map", () => {
    const workerInputs = buildWorkerSimInputs(gameData, SCENARIO_2026_BUNDLE, record);
    const draftedCardIds = new Set(
      record.draft.squad
        .map((slot) => slot.card_id)
        .filter((cardId): cardId is NonNullable<typeof cardId> => cardId !== null)
        .map(String),
    );

    expect(Object.keys(workerInputs.world.nationByCardId ?? {}).sort()).toEqual(
      [...draftedCardIds].sort(),
    );
    expect(Object.keys(workerInputs.world.nationByCardId ?? {}).length).toBeLessThan(
      Object.keys(gameData.nationByCardId).length,
    );
  });
});
