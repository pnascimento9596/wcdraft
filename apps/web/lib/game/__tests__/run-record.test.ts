import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDraft, type DraftState } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import {
  _resetVolatileStorageForTests,
  createNewRunRecord,
  listRunRecords,
  loadRunRecord,
  RUN_RECORD_CAP,
  RUN_RECORD_PREFIX,
  saveRunRecord,
  setRunPinned,
  setRunSimulation,
  type RunRecordV1,
} from "../run-record";
import { DAILY_DRAFT_CONFIG, dailyChallengeForDate } from "../daily";
import { runSimulationSync } from "../simulate";
import { decodeRunToken, encodeRunToken, reconstructDraftFromToken } from "../run-token";
import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";

const gameData = buildGameDataFromBundles();

let restoreWindow: (() => void) | null = null;

beforeEach(() => {
  _resetVolatileStorageForTests();
  restoreWindow = installLocalStorage();
});

afterEach(() => {
  restoreWindow?.();
  restoreWindow = null;
  vi.unstubAllGlobals();
  _resetVolatileStorageForTests();
});

describe("run-record persisted boundary", () => {
  it("mixes a per-run creation nonce into first-run seeds and rolled draws", () => {
    stubRandomUuids("35502f44-95e8-418e-bfea-80dcfe96c74a", "ffbad4c1-1875-4d4f-ae3c-427c6851d616");

    localStorage.clear();
    const left = createNewRunRecord(gameData, { formation_id: "4-3-3" }).record;

    localStorage.clear();
    const right = createNewRunRecord(gameData, { formation_id: "4-3-3" }).record;

    expect(left.parent_seed).toContain("rn-35502f4495e8418ebfea80dcfe96c74a");
    expect(right.parent_seed).toContain("rn-ffbad4c118754d4fae3c427c6851d616");
    expect(left.parent_seed).not.toBe(right.parent_seed);
    expect(firstDraw(left.draft)).not.toEqual(firstDraw(right.draft));
  });

  it("uses the shared daily seed without the per-device nonce", () => {
    const challenge = dailyChallengeForDate("2026-06-29");

    stubRandomUuids("35502f44-95e8-418e-bfea-80dcfe96c74a", "ffbad4c1-1875-4d4f-ae3c-427c6851d616");
    localStorage.clear();
    const left = createNewRunRecord(gameData, {
      formation_id: DAILY_DRAFT_CONFIG.formationId,
      mode: DAILY_DRAFT_CONFIG.mode,
      team_name: DAILY_DRAFT_CONFIG.teamName,
      parent_seed: challenge.seed,
      challenge,
      draft_flow: DAILY_DRAFT_CONFIG.draftFlow,
      era_preset: DAILY_DRAFT_CONFIG.eraPreset,
      rating_basis: DAILY_DRAFT_CONFIG.ratingBasis,
    }).record;

    localStorage.clear();
    const right = createNewRunRecord(gameData, {
      formation_id: DAILY_DRAFT_CONFIG.formationId,
      mode: DAILY_DRAFT_CONFIG.mode,
      team_name: DAILY_DRAFT_CONFIG.teamName,
      parent_seed: challenge.seed,
      challenge,
      draft_flow: DAILY_DRAFT_CONFIG.draftFlow,
      era_preset: DAILY_DRAFT_CONFIG.eraPreset,
      rating_basis: DAILY_DRAFT_CONFIG.ratingBasis,
    }).record;

    expect(left.parent_seed).toBe("wcdraft:daily:v1:2026-06-29");
    expect(right.parent_seed).toBe(left.parent_seed);
    expect(drawPairs(left.draft)).toEqual(drawPairs(right.draft));
    expect(left.challenge).toEqual(challenge);
  });

  it("persists server-issued ranked attempt metadata with the issued seed", () => {
    const rankedSeed = "wcdraft:ranked:v1:test-seed";
    const created = createNewRunRecord(gameData, {
      formation_id: "4-3-3",
      parent_seed: rankedSeed,
      ranked_attempt: {
        attempt_id: "ranked-attempt-test",
        season_key: "season-2026-summer",
        parent_seed: rankedSeed,
        expires_at: "2026-06-29T13:00:00.000Z",
      },
    }).record;

    const loaded = loadRunRecord(created.run_id, gameData.versions);
    expect(loaded.status).toBe("loaded");
    expect(loaded.record?.parent_seed).toBe(rankedSeed);
    expect(loaded.record?.ranked_attempt).toEqual({
      attempt_id: "ranked-attempt-test",
      season_key: "season-2026-summer",
      parent_seed: rankedSeed,
      expires_at: "2026-06-29T13:00:00.000Z",
    });
  });

  it("keeps generated-token replay byte-identical from token.ps", () => {
    localStorage.clear();
    const created = createNewRunRecord(gameData, { formation_id: "4-3-3" }).record;
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

  it("evicts structurally invalid persisted drafts through the invalid path", () => {
    const created = createNewRunRecord(gameData, { formation_id: "4-3-3" }).record;
    const key = recordKey(created.run_id);
    const raw = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    raw.draft = { ...(raw.draft as Record<string, unknown>), spins: [] };
    localStorage.setItem(key, JSON.stringify(raw));

    expect(loadRunRecord(created.run_id, gameData.versions)).toEqual({
      status: "invalid",
      record: null,
    });
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("evicts impossible complete records that do not carry simulation", () => {
    const created = createNewRunRecord(gameData, { formation_id: "4-3-3" }).record;
    const key = recordKey(created.run_id);
    const raw = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    raw.status = "complete";
    delete raw.simulation;
    localStorage.setItem(key, JSON.stringify(raw));

    expect(loadRunRecord(created.run_id, gameData.versions).status).toBe("invalid");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("evicts non-complete records that carry simulation", () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record-schema:non-complete-sim");
    saveRunRecord(created);
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, created);
    const persisted = setRunSimulation(created.run_id, gameData.versions, simulation);
    expect(persisted.status).toBe("updated");

    const key = recordKey(created.run_id);
    const raw = JSON.parse(localStorage.getItem(key)!) as Record<string, unknown>;
    raw.status = "ready";
    localStorage.setItem(key, JSON.stringify(raw));

    expect(loadRunRecord(created.run_id, gameData.versions).status).toBe("invalid");
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("loads a complete record with a real persisted simulation payload", () => {
    const created = buildOriginRecord(gameData, "wcdraft:run-record-schema:test");
    saveRunRecord(created);
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, created);
    const persisted = setRunSimulation(created.run_id, gameData.versions, simulation);
    expect(persisted.status).toBe("updated");

    const loaded = loadRunRecord(created.run_id, gameData.versions);
    expect(loaded.status).toBe("loaded");
    expect(loaded.record?.status).toBe("complete");
    expect(loaded.record?.simulation?.matches).toHaveLength(simulation.matches.length);
  });

  it("keeps pinned runs past the five-record recent cap", () => {
    const pinned = createNewRunRecord(gameData, { formation_id: "4-3-3" }).record;
    expect(setRunPinned(pinned.run_id, gameData.versions, true).status).toBe("updated");

    for (let i = 0; i < RUN_RECORD_CAP + 2; i += 1) {
      createNewRunRecord(gameData, { formation_id: "4-3-3" });
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
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
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
