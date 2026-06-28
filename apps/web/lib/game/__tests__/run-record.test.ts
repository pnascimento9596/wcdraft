import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoDraft, type DraftState } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import {
  _resetVolatileStorageForTests,
  createNewRunRecord,
  loadRunRecord,
  RUN_RECORD_PREFIX,
  saveRunRecord,
  setRunSimulation,
  type RunRecordV1,
} from "../run-record";
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
});

function firstDraw(draft: DraftState): { nation_id: string; tournament_id: number } {
  const spin = draft.spins[0];
  if (!spin || spin.status === "awaiting_slot") {
    throw new Error("expected a resolved first spin");
  }
  return { nation_id: spin.nation_id, tournament_id: spin.tournament_id };
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
