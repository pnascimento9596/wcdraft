import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import {
  _resetVolatileStorageForTests,
  createNewRunRecord,
  loadRunRecord,
  RUN_RECORD_PREFIX,
  saveRunRecord,
  setRunSimulation,
} from "../run-record";
import { runSimulationSync } from "../simulate";
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
  _resetVolatileStorageForTests();
});

describe("run-record persisted boundary", () => {
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

function recordKey(runId: string): string {
  return `${RUN_RECORD_PREFIX}${runId}`;
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
