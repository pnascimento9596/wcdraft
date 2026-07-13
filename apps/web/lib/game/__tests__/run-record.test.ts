import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDraft, type DraftState } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import {
  _resetVolatileStorageForTests,
  _setRunMutationLockManagerForTests,
  beginRunSimulation,
  createNewRunRecord,
  evictStaleRunRecords,
  listRunRecords,
  loadRunRecord,
  RUN_COUNTER_KEY,
  RUN_INDEX_KEY,
  RUN_MUTATION_LOCK_UNAVAILABLE_WARNING,
  RUN_RECORD_CAP,
  RUN_RECORD_PREFIX,
  saveNewRunRecord,
  setRunArrangement,
  setRunPinned,
  setRunSimulation,
  setRunStatus,
  setRunTeamName,
  updateRunRecord,
  type RunRecordV1,
} from "../run-record";
import { asDraftedTeamSheet } from "../team-sheet";
import { DAILY_DRAFT_CONFIG, type DailyChallenge } from "../daily";
import { runSimulationSync } from "../simulate";
import { decodeRunToken, encodeRunToken, reconstructDraftFromToken } from "../run-token";
import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";

const gameData = buildGameDataFromBundles();

function historicalDailyChallenge(date: string, salt = 0): DailyChallenge {
  return {
    kind: "daily",
    date,
    seed: `wcdraft:daily:v1:${date}${salt === 0 ? "" : `#${salt.toString()}`}`,
  };
}

let restoreWindow: (() => void) | null = null;
let injectOnCounterRead: (() => void) | null = null;
const storageReadHooks = new Map<string, () => void>();
let lockDepth = 0;
let requireStoreLockForMutation = false;
let forceQuotaOnRecordWrite = false;

beforeEach(() => {
  _resetVolatileStorageForTests();
  restoreWindow = installLocalStorage();
  _setRunMutationLockManagerForTests(createSerializedLockManager());
});

function swappedArrangement(record: RunRecordV1): string[] {
  const arrangement = [...asDraftedTeamSheet(record.draft)];
  [arrangement[0], arrangement[11]] = [arrangement[11]!, arrangement[0]!];
  return arrangement;
}

function recordWithId(runId: string, seed: string): RunRecordV1 {
  const base = buildOriginRecord(gameData, seed);
  return {
    ...base,
    run_id: runId,
    draft: { ...base.draft, run_id: runId },
  };
}

function storageSnapshot(): string {
  const entries: Array<[string, string]> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null) entries.push([key, localStorage.getItem(key)!]);
  }
  return JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right)));
}

async function lockedSimulation(seed: string): Promise<{
  created: RunRecordV1;
  locked: RunRecordV1;
  simulation: ReturnType<typeof runSimulationSync>["simulation"];
}> {
  const created = buildOriginRecord(gameData, seed);
  await saveNewRunRecord(created);
  const lock = await beginRunSimulation(created.run_id, gameData.versions, created);
  if (lock.status !== "updated" || !lock.record) throw new Error("expected simulation lock");
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, lock.record);
  return { created, locked: lock.record, simulation };
}

afterEach(() => {
  restoreWindow?.();
  restoreWindow = null;
  injectOnCounterRead = null;
  storageReadHooks.clear();
  lockDepth = 0;
  requireStoreLockForMutation = false;
  forceQuotaOnRecordWrite = false;
  vi.unstubAllGlobals();
  _resetVolatileStorageForTests();
});

describe("run-record persisted boundary", () => {
  it("mixes a per-run creation nonce into first-run seeds and rolled draws", async () => {
    stubRandomUuids("35502f44-95e8-418e-bfea-80dcfe96c74a", "ffbad4c1-1875-4d4f-ae3c-427c6851d616");

    localStorage.clear();
    const left = (await createNewRunRecord(gameData, { formation_id: "4-3-3" })).record;

    localStorage.clear();
    const right = (await createNewRunRecord(gameData, { formation_id: "4-3-3" })).record;

    expect(left.parent_seed).toContain("rn-35502f4495e8418ebfea80dcfe96c74a");
    expect(right.parent_seed).toContain("rn-ffbad4c118754d4fae3c427c6851d616");
    expect(left.parent_seed).not.toBe(right.parent_seed);
    expect(firstDraw(left.draft)).not.toEqual(firstDraw(right.draft));
  });

  it("uses the shared daily seed without the per-device nonce", async () => {
    const challenge = historicalDailyChallenge("2026-06-29");

    stubRandomUuids("35502f44-95e8-418e-bfea-80dcfe96c74a", "ffbad4c1-1875-4d4f-ae3c-427c6851d616");
    localStorage.clear();
    const left = (
      await createNewRunRecord(gameData, {
        formation_id: DAILY_DRAFT_CONFIG.formationId,
        mode: DAILY_DRAFT_CONFIG.mode,
        team_name: DAILY_DRAFT_CONFIG.teamName,
        parent_seed: challenge.seed,
        challenge,
        draft_flow: DAILY_DRAFT_CONFIG.draftFlow,
        era_preset: DAILY_DRAFT_CONFIG.eraPreset,
        rating_basis: DAILY_DRAFT_CONFIG.ratingBasis,
      })
    ).record;

    localStorage.clear();
    const right = (
      await createNewRunRecord(gameData, {
        formation_id: DAILY_DRAFT_CONFIG.formationId,
        mode: DAILY_DRAFT_CONFIG.mode,
        team_name: DAILY_DRAFT_CONFIG.teamName,
        parent_seed: challenge.seed,
        challenge,
        draft_flow: DAILY_DRAFT_CONFIG.draftFlow,
        era_preset: DAILY_DRAFT_CONFIG.eraPreset,
        rating_basis: DAILY_DRAFT_CONFIG.ratingBasis,
      })
    ).record;

    expect(left.parent_seed).toBe("wcdraft:daily:v1:2026-06-29");
    expect(right.parent_seed).toBe(left.parent_seed);
    expect(drawPairs(left.draft)).toEqual(drawPairs(right.draft));
    expect(left.challenge).toEqual(challenge);
  });

  it("rejects persisted daily challenge metadata when seed/date derivation disagrees", async () => {
    const challenge = historicalDailyChallenge("2026-06-29");
    const created = (
      await createNewRunRecord(gameData, {
        formation_id: DAILY_DRAFT_CONFIG.formationId,
        mode: DAILY_DRAFT_CONFIG.mode,
        team_name: DAILY_DRAFT_CONFIG.teamName,
        parent_seed: challenge.seed,
        challenge,
        draft_flow: DAILY_DRAFT_CONFIG.draftFlow,
        era_preset: DAILY_DRAFT_CONFIG.eraPreset,
        rating_basis: DAILY_DRAFT_CONFIG.ratingBasis,
      })
    ).record;
    const key = recordKey(created.run_id);
    const raw = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    raw.challenge = { kind: "daily", date: "2026-06-30", seed: challenge.seed };
    localStorage.setItem(key, JSON.stringify(raw));

    expect(loadRunRecord(created.run_id, gameData.versions)).toEqual({
      status: "invalid",
      record: null,
    });
    await evictStaleRunRecords(gameData.versions);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("keeps builder-valid historical salted runs but evicts impossible suffixes", async () => {
    const challenge = historicalDailyChallenge("2026-06-29", 8);
    const created = (
      await createNewRunRecord(gameData, {
        formation_id: DAILY_DRAFT_CONFIG.formationId,
        mode: DAILY_DRAFT_CONFIG.mode,
        team_name: DAILY_DRAFT_CONFIG.teamName,
        parent_seed: challenge.seed,
        challenge,
        draft_flow: DAILY_DRAFT_CONFIG.draftFlow,
        era_preset: DAILY_DRAFT_CONFIG.eraPreset,
        rating_basis: DAILY_DRAFT_CONFIG.ratingBasis,
      })
    ).record;

    expect(loadRunRecord(created.run_id, gameData.versions).status).toBe("loaded");

    const key = recordKey(created.run_id);
    const raw = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    raw.parent_seed = "wcdraft:daily:v1:2026-06-29#9";
    raw.challenge = {
      kind: "daily",
      date: "2026-06-29",
      seed: "wcdraft:daily:v1:2026-06-29#9",
    };
    localStorage.setItem(key, JSON.stringify(raw));

    expect(loadRunRecord(created.run_id, gameData.versions)).toEqual({
      status: "invalid",
      record: null,
    });
    await evictStaleRunRecords(gameData.versions);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("persists server-issued ranked attempt metadata with the issued seed", async () => {
    const rankedSeed = "wcdraft:ranked:v1:test-seed";
    const created = (
      await createNewRunRecord(gameData, {
        formation_id: "4-3-3",
        parent_seed: rankedSeed,
        ranked_attempt: {
          attempt_id: "ranked-attempt-test",
          season_key: "season-2026-manager-attrition",
          parent_seed: rankedSeed,
          expires_at: "2026-06-29T13:00:00.000Z",
        },
      })
    ).record;

    const loaded = loadRunRecord(created.run_id, gameData.versions);
    expect(loaded.status).toBe("loaded");
    expect(loaded.record?.parent_seed).toBe(rankedSeed);
    expect(loaded.record?.ranked_attempt).toEqual({
      attempt_id: "ranked-attempt-test",
      season_key: "season-2026-manager-attrition",
      parent_seed: rankedSeed,
      expires_at: "2026-06-29T13:00:00.000Z",
    });
  });

  it("keeps generated-token replay byte-identical from token.ps", async () => {
    localStorage.clear();
    const created = (await createNewRunRecord(gameData, { formation_id: "4-3-3" })).record;
    const completed: RunRecordV1 = {
      ...created,
      draft: autoDraft({
        run_id: created.run_id,
        parent_seed: created.parent_seed,
        formation_id: created.draft.formation_id,
        mode: created.draft.mode,
        team_name: created.draft.team_name,
        dataset_version: gameData.versions.dataset_version,
        rating_version: gameData.versions.rating_version,
        engine_version: gameData.versions.engine_version,
        dataset: gameData.draftDataset,
      }),
    };

    const decoded = decodeRunToken(encodeRunToken(completed));
    expect(decoded).not.toBeNull();
    const replayed = reconstructDraftFromToken(decoded!, gameData);
    expect(replayed).toEqual(completed.draft);
  });

  it("evicts structurally invalid persisted drafts through the invalid path", async () => {
    const created = (await createNewRunRecord(gameData, { formation_id: "4-3-3" })).record;
    const key = recordKey(created.run_id);
    const raw = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    raw.draft = { ...(raw.draft as Record<string, unknown>), spins: [] };
    localStorage.setItem(key, JSON.stringify(raw));

    expect(loadRunRecord(created.run_id, gameData.versions)).toEqual({
      status: "invalid",
      record: null,
    });
    await evictStaleRunRecords(gameData.versions);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("evicts impossible complete records that do not carry simulation", async () => {
    const created = (await createNewRunRecord(gameData, { formation_id: "4-3-3" })).record;
    const key = recordKey(created.run_id);
    const raw = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    raw.status = "complete";
    delete raw.simulation;
    localStorage.setItem(key, JSON.stringify(raw));

    expect(loadRunRecord(created.run_id, gameData.versions).status).toBe("invalid");
    await evictStaleRunRecords(gameData.versions);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("evicts non-complete records that carry simulation", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record-schema:non-complete-sim");
    await saveNewRunRecord(created);
    const locked = await beginRunSimulation(created.run_id, gameData.versions, created);
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, locked.record!);
    const persisted = await setRunSimulation(created.run_id, gameData.versions, simulation, {
      status: "simulating",
      updated_seq: locked.record!.updated_seq,
    });
    expect(persisted.record?.manager_presence_band).toBe(1);
    expect(persisted.status).toBe("updated");

    const key = recordKey(created.run_id);
    const raw = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    raw.status = "ready";
    localStorage.setItem(key, JSON.stringify(raw));

    expect(loadRunRecord(created.run_id, gameData.versions).status).toBe("invalid");
    await evictStaleRunRecords(gameData.versions);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("loads a complete record with a real persisted simulation payload", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record-schema:test");
    await saveNewRunRecord(created);
    const locked = await beginRunSimulation(created.run_id, gameData.versions, created);
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, locked.record!);
    const persisted = await setRunSimulation(created.run_id, gameData.versions, simulation, {
      status: "simulating",
      updated_seq: locked.record!.updated_seq,
    });
    expect(persisted.status).toBe("updated");

    const loaded = loadRunRecord(created.run_id, gameData.versions);
    expect(loaded.status).toBe("loaded");
    expect(loaded.record?.status).toBe("complete");
    expect(loaded.record?.simulation?.matches).toHaveLength(simulation.matches.length);
  });

  it("rejects omitted or undefined simulation ownership at the runtime boundary", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:missing-sim-ownership");
    await saveNewRunRecord(created);
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, created);

    const omitted = (await Reflect.apply(setRunSimulation, undefined, [
      created.run_id,
      gameData.versions,
      simulation,
    ])) as Awaited<ReturnType<typeof setRunSimulation>>;
    expect(omitted).toMatchObject({ status: "conflict", persistence: "none" });

    const explicitUndefined = (await Reflect.apply(setRunSimulation, undefined, [
      created.run_id,
      gameData.versions,
      simulation,
      undefined,
    ])) as Awaited<ReturnType<typeof setRunSimulation>>;
    expect(explicitUndefined).toMatchObject({ status: "conflict", persistence: "none" });

    const readyOwnership = (await Reflect.apply(setRunSimulation, undefined, [
      created.run_id,
      gameData.versions,
      simulation,
      { status: "ready", updated_seq: created.updated_seq },
    ])) as Awaited<ReturnType<typeof setRunSimulation>>;
    expect(readyOwnership).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(created);
  });

  it("keeps a concurrently completed run when an older simulation attempts cleanup", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:owned-cleanup");
    await saveNewRunRecord(created);
    const operationA = await beginRunSimulation(created.run_id, gameData.versions, created);
    expect(operationA).toMatchObject({ status: "updated", persistence: "durable" });
    const operationB = await beginRunSimulation(
      created.run_id,
      gameData.versions,
      operationA.record!,
    );
    expect(operationB).toMatchObject({ status: "updated", persistence: "durable" });

    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, created);
    const completed = await setRunSimulation(created.run_id, gameData.versions, simulation, {
      status: "simulating",
      updated_seq: operationB.record!.updated_seq,
    });
    expect(completed.status).toBe("updated");

    const staleCleanup = await setRunStatus(created.run_id, gameData.versions, "ready", {
      status: "simulating",
      updated_seq: operationA.record!.updated_seq,
    });
    expect(staleCleanup.status).toBe("conflict");
    const loaded = loadRunRecord(created.run_id, gameData.versions);
    expect(loaded.status).toBe("loaded");
    expect(loaded.record).toMatchObject({
      status: "complete",
      updated_seq: completed.record!.updated_seq,
    });
    expect(loaded.record?.simulation).toEqual(simulation);
  });

  it("locks arrangement mutation once a simulation exists, including stale Review tabs", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:arrangement-lock");
    await saveNewRunRecord(created);
    const arranged = [...asDraftedTeamSheet(created.draft)];
    [arranged[0], arranged[11]] = [arranged[11]!, arranged[0]!];
    const savedArrangement = await setRunArrangement(created.run_id, gameData.versions, arranged);
    expect(savedArrangement).toMatchObject({ status: "updated", persistence: "durable" });

    const simulating = await beginRunSimulation(
      created.run_id,
      gameData.versions,
      savedArrangement.record!,
    );
    expect(simulating.status).toBe("updated");
    const midSimulationArrangement = [...arranged];
    [midSimulationArrangement[1], midSimulationArrangement[12]] = [
      midSimulationArrangement[12]!,
      midSimulationArrangement[1]!,
    ];
    expect(
      await setRunArrangement(created.run_id, gameData.versions, midSimulationArrangement),
    ).toMatchObject({ status: "conflict", persistence: "none" });

    const { simulation } = runSimulationSync(
      gameData,
      SCENARIO_2026_BUNDLE,
      savedArrangement.record!,
    );
    const completed = await setRunSimulation(created.run_id, gameData.versions, simulation, {
      status: "simulating",
      updated_seq: simulating.record!.updated_seq,
    });
    expect(completed.status).toBe("updated");

    const staleTabArrangement = [...arranged];
    [staleTabArrangement[1], staleTabArrangement[12]] = [
      staleTabArrangement[12]!,
      staleTabArrangement[1]!,
    ];
    const rejected = await setRunArrangement(
      created.run_id,
      gameData.versions,
      staleTabArrangement,
    );
    expect(rejected).toMatchObject({ status: "conflict", persistence: "none" });
    expect(rejected.record?.arrangement).toEqual(arranged);
    expect(rejected.record?.simulation).toEqual(simulation);
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(completed.record);
  });

  it("merges a stale Review name into the authoritative ready arrangement only", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:team-name-ready-merge");
    await saveNewRunRecord(created);
    const staleReview = loadRunRecord(created.run_id, gameData.versions).record!;
    const arrangementB = [...asDraftedTeamSheet(created.draft)];
    [arrangementB[0], arrangementB[11]] = [arrangementB[11]!, arrangementB[0]!];
    const tabB = await setRunArrangement(created.run_id, gameData.versions, arrangementB);
    expect(tabB.status).toBe("updated");

    const renamed = await setRunTeamName(staleReview.run_id, gameData.versions, "  Current XI  ");
    expect(renamed).toMatchObject({ status: "updated", persistence: "durable" });
    expect(renamed.record?.draft).toEqual({ ...tabB.record!.draft, team_name: "Current XI" });
    expect(renamed.record?.arrangement).toEqual(arrangementB);
    expect(renamed.record?.updated_seq).toBeGreaterThan(tabB.record!.updated_seq);
  });

  it("rejects delayed stale team-name writes during and after simulation", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:team-name-lock");
    await saveNewRunRecord(created);
    const staleReview = loadRunRecord(created.run_id, gameData.versions).record!;
    const locked = await beginRunSimulation(created.run_id, gameData.versions, staleReview);
    expect(locked.status).toBe("updated");

    const delayedDuring = await setRunTeamName(
      staleReview.run_id,
      gameData.versions,
      "Stale timer",
    );
    expect(delayedDuring).toMatchObject({ status: "conflict", persistence: "none" });
    expect(delayedDuring.record).toEqual(locked.record);

    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, locked.record!);
    const completed = await setRunSimulation(created.run_id, gameData.versions, simulation, {
      status: "simulating",
      updated_seq: locked.record!.updated_seq,
    });
    expect(completed.status).toBe("updated");
    const delayedAfter = await setRunTeamName(staleReview.run_id, gameData.versions, "Still stale");
    expect(delayedAfter).toMatchObject({ status: "conflict", persistence: "none" });
    expect(delayedAfter.record).toEqual(completed.record);
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(completed.record);
  });

  it("serializes a stale rendered arrangement and simulates only the locked revision", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:atomic-sim-begin");
    await saveNewRunRecord(created);
    const rendered = loadRunRecord(created.run_id, gameData.versions).record!;

    const arrangementB = [...asDraftedTeamSheet(created.draft)];
    [arrangementB[0], arrangementB[11]] = [arrangementB[11]!, arrangementB[0]!];
    const tabB = await setRunArrangement(created.run_id, gameData.versions, arrangementB);
    expect(tabB.status).toBe("updated");

    const staleBegin = await beginRunSimulation(created.run_id, gameData.versions, rendered);
    expect(staleBegin).toMatchObject({ status: "conflict", persistence: "none" });
    expect(staleBegin.record?.arrangement).toEqual(arrangementB);
    expect(staleBegin.record?.status).not.toBe("simulating");
    expect(staleBegin.record?.simulation).toBeUndefined();

    const locked = await beginRunSimulation(created.run_id, gameData.versions, tabB.record!);
    expect(locked).toMatchObject({ status: "updated", persistence: "durable" });
    expect(locked.record?.status).toBe("simulating");
    expect(locked.record?.arrangement).toEqual(arrangementB);
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, locked.record!);
    const persisted = await setRunSimulation(created.run_id, gameData.versions, simulation, {
      status: "simulating",
      updated_seq: locked.record!.updated_seq,
    });
    expect(persisted.status).toBe("updated");
    expect(persisted.record?.arrangement).toEqual(arrangementB);
    expect(persisted.record?.simulation).toEqual(simulation);
  });

  it("keeps serialized simulation ownership in volatile storage", async () => {
    restoreWindow?.();
    restoreWindow = null;
    _resetVolatileStorageForTests();
    const created = buildOriginRecord(gameData, "wcdraft:run-record:volatile-sim-begin");
    expect((await saveNewRunRecord(created)).persistence).toBe("volatile");

    const locked = await beginRunSimulation(created.run_id, gameData.versions, created);
    expect(locked).toMatchObject({ status: "updated", persistence: "volatile" });
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, locked.record!);
    const omittedOwnership = (await Reflect.apply(setRunSimulation, undefined, [
      created.run_id,
      gameData.versions,
      simulation,
    ])) as Awaited<ReturnType<typeof setRunSimulation>>;
    expect(omittedOwnership).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(locked.record);
    const persisted = await setRunSimulation(created.run_id, gameData.versions, simulation, {
      status: "simulating",
      updated_seq: locked.record!.updated_seq,
    });
    expect(persisted).toMatchObject({ status: "updated", persistence: "volatile" });
    expect(persisted.record?.simulation).toEqual(simulation);
  });

  it("preserves authoritative arrangement and team-name locks in volatile storage", async () => {
    restoreWindow?.();
    restoreWindow = null;
    _resetVolatileStorageForTests();
    const created = buildOriginRecord(gameData, "wcdraft:run-record:volatile-team-name");
    expect((await saveNewRunRecord(created)).persistence).toBe("volatile");
    const arrangementB = [...asDraftedTeamSheet(created.draft)];
    [arrangementB[0], arrangementB[11]] = [arrangementB[11]!, arrangementB[0]!];
    const arranged = await setRunArrangement(created.run_id, gameData.versions, arrangementB);
    expect(arranged.persistence).toBe("volatile");

    const renamed = await setRunTeamName(created.run_id, gameData.versions, "Volatile XI");
    expect(renamed).toMatchObject({ status: "updated", persistence: "volatile" });
    expect(renamed.record?.arrangement).toEqual(arrangementB);
    const locked = await beginRunSimulation(created.run_id, gameData.versions, renamed.record!);
    expect(await setRunTeamName(created.run_id, gameData.versions, "Late XI")).toMatchObject({
      status: "conflict",
      persistence: "none",
      record: locked.record,
    });
  });

  it("fails closed without Web Locks when durable storage is active", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:no-web-locks");
    await saveNewRunRecord(created);
    _setRunMutationLockManagerForTests(null);

    const result = await beginRunSimulation(created.run_id, gameData.versions, created);
    expect(result).toEqual({
      status: "conflict",
      record: null,
      persistence: "none",
      warnings: [RUN_MUTATION_LOCK_UNAVAILABLE_WARNING],
    });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(created);
  });

  it("fails closed before durable creation or raw creation mutates any store key", async () => {
    _setRunMutationLockManagerForTests(null);
    const before = storageSnapshot();

    await expect(createNewRunRecord(gameData, { formation_id: "4-3-3" })).rejects.toThrow(
      RUN_MUTATION_LOCK_UNAVAILABLE_WARNING,
    );
    await expect(
      saveNewRunRecord(recordWithId("no-lock-raw", "wcdraft:run-record:no-lock-raw")),
    ).rejects.toThrow(RUN_MUTATION_LOCK_UNAVAILABLE_WARNING);
    expect(storageSnapshot()).toBe(before);
  });

  it("keeps pure durable reads usable without Web Locks and defers cleanup without mutation", async () => {
    const created = recordWithId("no-lock-read", "wcdraft:run-record:no-lock-read");
    await saveNewRunRecord(created);
    _setRunMutationLockManagerForTests(null);
    const before = storageSnapshot();

    expect(loadRunRecord(created.run_id, gameData.versions)).toEqual({
      status: "loaded",
      record: created,
    });
    expect(listRunRecords(gameData.versions).records).toEqual([created]);
    expect(await evictStaleRunRecords(gameData.versions)).toEqual([
      RUN_MUTATION_LOCK_UNAVAILABLE_WARNING,
    ]);
    expect(storageSnapshot()).toBe(before);
  });

  it("serializes simultaneous durable creation into distinct IDs without overwrite", async () => {
    let competing: ReturnType<typeof createNewRunRecord> | null = null;
    injectOnCounterRead = () => {
      competing = createNewRunRecord(gameData, { formation_id: "4-3-3" });
    };

    const primary = await createNewRunRecord(gameData, { formation_id: "4-3-3" });
    const secondary = await competing!;
    expect(primary.record.run_id).not.toBe(secondary.record.run_id);
    expect(loadRunRecord(primary.record.run_id, gameData.versions).record).toEqual(primary.record);
    expect(loadRunRecord(secondary.record.run_id, gameData.versions).record).toEqual(
      secondary.record,
    );
  });

  it("allows only one serialized raw creation check/write to succeed", async () => {
    const primary = recordWithId("raw-race", "wcdraft:run-record:raw-primary");
    const competing = recordWithId("raw-race", "wcdraft:run-record:raw-competing");
    let queued: Promise<{ ok: true } | { ok: false; error: unknown }> | null = null;
    storageReadHooks.set(recordKey(primary.run_id), () => {
      queued = saveNewRunRecord(competing).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
    });

    await expect(saveNewRunRecord(primary)).resolves.toMatchObject({ persistence: "durable" });
    const queuedResult = await queued!;
    expect(queuedResult.ok).toBe(false);
    if (queuedResult.ok) throw new Error("competing raw creation unexpectedly succeeded");
    expect(queuedResult.error).toMatchObject({ name: "RunRecordError" });
    expect(loadRunRecord(primary.run_id, gameData.versions).record).toEqual(primary);
  });

  it("serializes volatile creation through one store queue", async () => {
    restoreWindow?.();
    restoreWindow = null;
    _resetVolatileStorageForTests();

    const [left, right] = await Promise.all([
      createNewRunRecord(gameData, { formation_id: "4-3-3" }),
      createNewRunRecord(gameData, { formation_id: "4-3-3" }),
    ]);
    expect(left.persistence).toBe("volatile");
    expect(right.persistence).toBe("volatile");
    expect(left.record.run_id).not.toBe(right.record.run_id);
    expect(listRunRecords(gameData.versions).records.map((record) => record.run_id)).toEqual([
      right.record.run_id,
      left.record.run_id,
    ]);
  });

  it("keeps quota fallback record/index writes inside the store lock", async () => {
    requireStoreLockForMutation = true;
    forceQuotaOnRecordWrite = true;

    const created = await createNewRunRecord(gameData, { formation_id: "4-3-3" });
    expect(created.persistence).toBe("volatile");
    expect(localStorage.getItem(recordKey(created.record.run_id))).toBeNull();
    expect(localStorage.getItem(RUN_INDEX_KEY)).toBeNull();
    expect(loadRunRecord(created.record.run_id, gameData.versions).record).toEqual(created.record);

    const next = await createNewRunRecord(gameData, { formation_id: "4-3-3" });
    expect(next.record.run_id).not.toBe(created.record.run_id);
  });

  it("does not mutate when lock acquisition is cancelled", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:cancelled-lock-wait");
    await saveNewRunRecord(created);
    const controller = new AbortController();
    controller.abort();

    const result = await beginRunSimulation(
      created.run_id,
      gameData.versions,
      created,
      controller.signal,
    );
    expect(result).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(created);
  });

  it("cancels a queued durable mutation without poisoning later lock acquisition", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:queued-cancel-recovery");
    await saveNewRunRecord(created);

    const serialized = createSerializedLockManager();
    let releaseFirstLock!: () => void;
    let markFirstLockEntered!: () => void;
    const firstLockEntered = new Promise<void>((resolve) => {
      markFirstLockEntered = resolve;
    });
    const firstLockRelease = new Promise<void>((resolve) => {
      releaseFirstLock = resolve;
    });
    let holdNextLock = true;
    _setRunMutationLockManagerForTests({
      request<T>(
        name: string,
        options: { mode: "exclusive"; signal?: AbortSignal },
        callback: () => T | PromiseLike<T>,
      ): Promise<T> {
        return serialized.request(name, options, async () => {
          if (holdNextLock) {
            holdNextLock = false;
            markFirstLockEntered();
            await firstLockRelease;
          }
          return callback();
        });
      },
    });

    const renamedPromise = setRunTeamName(created.run_id, gameData.versions, "Queued XI");
    await firstLockEntered;

    const controller = new AbortController();
    const cancelledPromise = beginRunSimulation(
      created.run_id,
      gameData.versions,
      created,
      controller.signal,
    );
    controller.abort();
    releaseFirstLock();

    const renamed = await renamedPromise;
    expect(renamed.status).toBe("updated");
    await expect(cancelledPromise).resolves.toMatchObject({
      status: "conflict",
      persistence: "none",
    });

    const recovered = await beginRunSimulation(created.run_id, gameData.versions, renamed.record!);
    expect(recovered.status).toBe("updated");
  });

  it("releases the store queue after a mutation callback throws", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:callback-failure-recovery");
    await saveNewRunRecord(created);

    await expect(
      updateRunRecord(created.run_id, gameData.versions, created, () => {
        throw new Error("injected updater failure");
      }),
    ).rejects.toThrow("injected updater failure");
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(created);

    const recovered = await setRunTeamName(created.run_id, gameData.versions, "Recovered XI");
    expect(recovered).toMatchObject({ status: "updated", persistence: "durable" });
    expect(recovered.record?.draft.team_name).toBe("Recovered XI");
  });

  it("does not mutate a volatile run when acquisition is already cancelled", async () => {
    restoreWindow?.();
    restoreWindow = null;
    _resetVolatileStorageForTests();
    const created = buildOriginRecord(gameData, "wcdraft:run-record:cancelled-volatile-lock-wait");
    await saveNewRunRecord(created);
    const controller = new AbortController();
    controller.abort();

    const result = await beginRunSimulation(
      created.run_id,
      gameData.versions,
      created,
      controller.signal,
    );
    expect(result).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(created);
  });

  it("refuses the raw new-record boundary for an existing authority", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:no-raw-overwrite");
    await saveNewRunRecord(created);
    await expect(
      saveNewRunRecord({
        ...created,
        draft: { ...created.draft, team_name: "Stale overwrite" },
      }),
    ).rejects.toThrow(/already exists; use a locked mutation boundary/u);
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(created);
  });

  it("serializes a delayed team-name write behind simulation begin", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:race-name-after-lock");
    await saveNewRunRecord(created);
    let rename: ReturnType<typeof setRunTeamName> | null = null;
    injectOnCounterRead = () => {
      rename = setRunTeamName(created.run_id, gameData.versions, "Stale tab name");
    };

    const locked = await beginRunSimulation(created.run_id, gameData.versions, created);
    const renameResult = await rename!;
    expect(locked.status).toBe("updated");
    expect(renameResult).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(locked.record);
  });

  it("serializes a delayed arrangement write behind simulation begin", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:race-arrangement-after-lock");
    await saveNewRunRecord(created);
    const arrangementB = swappedArrangement(created);
    let arrangement: ReturnType<typeof setRunArrangement> | null = null;
    injectOnCounterRead = () => {
      arrangement = setRunArrangement(created.run_id, gameData.versions, arrangementB);
    };

    const locked = await beginRunSimulation(created.run_id, gameData.versions, created);
    const arrangementResult = await arrangement!;
    expect(locked.status).toBe("updated");
    expect(arrangementResult).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(locked.record);
  });

  it("serializes stale simulation begin behind arrangement B", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:race-lock-after-arrangement");
    await saveNewRunRecord(created);
    const arrangementB = swappedArrangement(created);
    let begin: ReturnType<typeof beginRunSimulation> | null = null;
    injectOnCounterRead = () => {
      begin = beginRunSimulation(created.run_id, gameData.versions, created);
    };

    const arranged = await setRunArrangement(created.run_id, gameData.versions, arrangementB);
    const beginResult = await begin!;
    expect(arranged.status).toBe("updated");
    expect(beginResult).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(arranged.record);
  });

  it("rejects a result queued after ownership cleanup", async () => {
    const { created, locked, simulation } = await lockedSimulation(
      "wcdraft:run-record:race-result-after-cleanup",
    );
    let result: ReturnType<typeof setRunSimulation> | null = null;
    injectOnCounterRead = () => {
      result = setRunSimulation(created.run_id, gameData.versions, simulation, {
        status: "simulating",
        updated_seq: locked.updated_seq,
      });
    };

    const cleanup = await setRunStatus(created.run_id, gameData.versions, "ready", {
      status: "simulating",
      updated_seq: locked.updated_seq,
    });
    const resultCommit = await result!;
    expect(cleanup.status).toBe("updated");
    expect(resultCommit).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(cleanup.record);
  });

  it("rejects cleanup queued after a completed result", async () => {
    const { created, locked, simulation } = await lockedSimulation(
      "wcdraft:run-record:race-cleanup-after-result",
    );
    let cleanup: ReturnType<typeof setRunStatus> | null = null;
    injectOnCounterRead = () => {
      cleanup = setRunStatus(created.run_id, gameData.versions, "ready", {
        status: "simulating",
        updated_seq: locked.updated_seq,
      });
    };

    const completed = await setRunSimulation(created.run_id, gameData.versions, simulation, {
      status: "simulating",
      updated_seq: locked.updated_seq,
    });
    const cleanupResult = await cleanup!;
    expect(completed.status).toBe("updated");
    expect(cleanupResult).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(completed.record);
  });

  it("preserves a completed result when pin is queued behind it", async () => {
    const { created, locked, simulation } = await lockedSimulation(
      "wcdraft:run-record:race-pin-after-result",
    );
    let pin: ReturnType<typeof setRunPinned> | null = null;
    injectOnCounterRead = () => {
      pin = setRunPinned(created.run_id, gameData.versions, true);
    };

    const completed = await setRunSimulation(created.run_id, gameData.versions, simulation, {
      status: "simulating",
      updated_seq: locked.updated_seq,
    });
    const pinned = await pin!;
    expect(completed.status).toBe("updated");
    expect(pinned).toMatchObject({ status: "updated", persistence: "durable" });
    expect(pinned.record?.status).toBe("complete");
    expect(pinned.record?.simulation).toEqual(simulation);
    expect(pinned.record?.pinned).toBe(true);
    expect(pinned.record!.updated_seq).toBeGreaterThan(completed.record!.updated_seq);
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(pinned.record);
  });

  it("rejects a stale DraftScreen whole-record transition queued after Review lock", async () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record:race-draft-after-lock");
    await saveNewRunRecord(created);
    let draftWrite: ReturnType<typeof updateRunRecord> | null = null;
    injectOnCounterRead = () => {
      draftWrite = updateRunRecord(created.run_id, gameData.versions, created, (current) => ({
        ...current.draft,
        team_name: "Stale draft tab",
      }));
    };

    const locked = await beginRunSimulation(created.run_id, gameData.versions, created);
    const draftResult = await draftWrite!;
    expect(locked.status).toBe("updated");
    expect(draftResult).toMatchObject({ status: "conflict", persistence: "none" });
    expect(loadRunRecord(created.run_id, gameData.versions).record).toEqual(locked.record);
  });

  it("serializes distinct-run index writes and preserves a queued pin past the cap", async () => {
    const indexA = recordWithId("index-a", "wcdraft:run-record:index-a");
    const indexB = recordWithId("index-b", "wcdraft:run-record:index-b");
    await saveNewRunRecord(indexA);
    await saveNewRunRecord(indexB);
    let pinB: ReturnType<typeof setRunPinned> | null = null;
    storageReadHooks.set(RUN_INDEX_KEY, () => {
      pinB = setRunPinned(indexB.run_id, gameData.versions, true);
    });

    const updatedA = await setRunTeamName(indexA.run_id, gameData.versions, "Index A updated");
    const pinnedB = await pinB!;
    expect(updatedA.status).toBe("updated");
    expect(pinnedB).toMatchObject({ status: "updated", persistence: "durable" });
    const index = JSON.parse(localStorage.getItem(RUN_INDEX_KEY)!) as {
      entries: Array<{ run_id: string; updated_seq: number; pinned?: boolean }>;
    };
    expect(index.entries.find((entry) => entry.run_id === indexB.run_id)).toMatchObject({
      updated_seq: pinnedB.record!.updated_seq,
      pinned: true,
    });

    for (let count = 0; count < RUN_RECORD_CAP - 1; count += 1) {
      await createNewRunRecord(gameData, { formation_id: "4-3-3" });
    }
    expect(loadRunRecord(indexB.run_id, gameData.versions).record).toEqual(pinnedB.record);
    expect(
      listRunRecords(gameData.versions).records.some((record) => record.run_id === indexB.run_id),
    ).toBe(true);
  });

  it("keeps list pure and lets locked cleanup remove malformed warnings once", async () => {
    const created = recordWithId("cleanup-owner", "wcdraft:run-record:cleanup-owner");
    await saveNewRunRecord(created);
    const key = recordKey(created.run_id);
    localStorage.setItem(key, "{malformed");
    const beforeCleanup = storageSnapshot();

    expect(listRunRecords(gameData.versions).warnings).toEqual([
      `history: ignored malformed record '${created.run_id}' pending cleanup`,
    ]);
    expect(storageSnapshot()).toBe(beforeCleanup);
    expect(await evictStaleRunRecords(gameData.versions)).toEqual([
      `history: evicted malformed record '${created.run_id}'`,
    ]);
    expect(listRunRecords(gameData.versions).warnings).toEqual([]);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("keeps pinned runs past the five-record recent cap", async () => {
    const pinned = (await createNewRunRecord(gameData, { formation_id: "4-3-3" })).record;
    expect((await setRunPinned(pinned.run_id, gameData.versions, true)).status).toBe("updated");

    for (let i = 0; i < RUN_RECORD_CAP + 2; i += 1) {
      await createNewRunRecord(gameData, { formation_id: "4-3-3" });
    }

    expect(loadRunRecord(pinned.run_id, gameData.versions).status).toBe("loaded");
    const listed = listRunRecords(gameData.versions, { limit: RUN_RECORD_CAP }).records;
    expect(listed.some((record) => record.run_id === pinned.run_id && record.pinned)).toBe(true);
    expect(listed.filter((record) => !record.pinned)).toHaveLength(RUN_RECORD_CAP);
  });
});

function firstDraw(draft: DraftState): { nation_id: string; tournament_id: number } {
  const spin = draft.spins[0];
  if (!spin || spin.status === "awaiting_slot") {
    throw new Error("expected a resolved first spin");
  }
  return { nation_id: spin.nation_id, tournament_id: spin.tournament_id };
}

function drawPairs(draft: DraftState): { nation_id: string; tournament_id: number }[] {
  return draft.spins.map((spin) => {
    if (spin.status === "awaiting_slot") {
      throw new Error("expected resolved spin");
    }
    return { nation_id: spin.nation_id, tournament_id: spin.tournament_id };
  });
}

function recordKey(runId: string): string {
  return `${RUN_RECORD_PREFIX}${runId}`;
}

function stubRandomUuids(...values: string[]): void {
  const randomUUID = vi.fn<Crypto["randomUUID"]>();
  for (const value of values) {
    randomUUID.mockReturnValueOnce(value as ReturnType<Crypto["randomUUID"]>);
  }
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID });
}

function installLocalStorage(): () => void {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => {
      const captured = store.get(key) ?? null;
      if (key === RUN_COUNTER_KEY && injectOnCounterRead) {
        const inject = injectOnCounterRead;
        injectOnCounterRead = null;
        inject();
      }
      const hook = storageReadHooks.get(key);
      if (hook) {
        storageReadHooks.delete(key);
        hook();
      }
      return captured;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      assertStoreMutationLocked(key);
      store.delete(key);
    },
    setItem: (key, value) => {
      assertStoreMutationLocked(key);
      if (forceQuotaOnRecordWrite && key.startsWith(RUN_RECORD_PREFIX)) {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return () => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
    if (originalLocalStorage === undefined) {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalLocalStorage,
      });
    }
  };
}

function assertStoreMutationLocked(key: string): void {
  if (
    requireStoreLockForMutation &&
    (key === RUN_COUNTER_KEY || key === RUN_INDEX_KEY || key.startsWith(RUN_RECORD_PREFIX)) &&
    lockDepth === 0
  ) {
    throw new Error(`store mutation escaped the global lock: ${key}`);
  }
}

function createSerializedLockManager() {
  const tails = new Map<string, Promise<void>>();
  return {
    request<T>(
      name: string,
      options: { mode: "exclusive"; signal?: AbortSignal },
      callback: () => T | PromiseLike<T>,
    ): Promise<T> {
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(async () => {
        if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        lockDepth += 1;
        try {
          return await callback();
        } finally {
          lockDepth -= 1;
        }
      });
      const tail = run.then(
        () => undefined,
        () => undefined,
      );
      tails.set(name, tail);
      return run.finally(() => {
        if (tails.get(name) === tail) tails.delete(name);
      });
    },
  };
}
