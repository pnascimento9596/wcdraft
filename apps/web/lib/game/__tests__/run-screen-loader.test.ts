import { describe, expect, it, vi } from "vitest";
import { encodeRunTokenBody } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import type { GameData } from "../data";
import type { RunRecordV1 } from "../run-record";
import { buildRunTokenBody, encodeRunToken } from "../run-token";
import { resolveDisplayRun, type ResolveDisplayRunDeps } from "../run-screen-loader";
import { runSimulation, runSimulationSync } from "../simulate";
import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";

const gameData = buildGameDataFromBundles();

function deps(overrides: Partial<ResolveDisplayRunDeps> = {}): ResolveDisplayRunDeps {
  return {
    loadGameData: async () => gameData,
    loadScenarioBundle: async () => SCENARIO_2026_BUNDLE,
    loadRunRecord: () => ({ status: "missing", record: null }),
    evictStaleRunRecords: async () => [],
    runSimulation,
    ...overrides,
  };
}

describe("resolveDisplayRun", () => {
  it("does not load game data when the run param is missing", async () => {
    const state = await resolveDisplayRun(null, {}, deps({ loadGameData: failLoadGameData }));
    expect(state).toEqual({ kind: "missing", runId: null });
  });

  it("maps local run lookup states to stale, missing, and needsReview", async () => {
    await expect(
      resolveDisplayRun(
        { kind: "id", run_id: "run-v1-stale" },
        {},
        deps({ loadRunRecord: () => ({ status: "stale", record: null }) }),
      ),
    ).resolves.toEqual({ kind: "stale", runId: "run-v1-stale" });

    await expect(
      resolveDisplayRun(
        { kind: "id", run_id: "run-v1-missing" },
        {},
        deps({ loadRunRecord: () => ({ status: "missing", record: null }) }),
      ),
    ).resolves.toEqual({
      kind: "missing",
      runId: "run-v1-missing",
      localStatus: "missing",
    });

    const record = buildOriginRecord(gameData, "wcdraft:screen-loader:needs-review");
    await expect(
      resolveDisplayRun(
        { kind: "id", run_id: record.run_id },
        {},
        deps({ loadRunRecord: () => ({ status: "loaded", record }) }),
      ),
    ).resolves.toEqual({ kind: "needsReview", runId: record.run_id });

    const editable = await resolveDisplayRun(
      { kind: "id", run_id: record.run_id },
      { allowUnsimulatedLocalRun: true },
      deps({ loadRunRecord: () => ({ status: "loaded", record }) }),
    );
    expect(editable.kind).toBe("ready");
    expect(editable.kind === "ready" ? editable.record : null).toBe(record);
  });

  it("resumes a valid pure-read record when unsupported cleanup defers without mutation", async () => {
    const record = buildOriginRecord(gameData, "wcdraft:run-screen:no-lock-resume");
    const cleanup = vi.fn(async () => ["browser coordination unavailable"]);

    const state = await resolveDisplayRun(
      { kind: "id", run_id: record.run_id },
      { allowUnsimulatedLocalRun: true },
      deps({
        loadRunRecord: () => ({ status: "loaded", record }),
        evictStaleRunRecords: cleanup,
      }),
    );
    expect(state).toMatchObject({ kind: "ready", record });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("returns ready for a local completed run and loads scenario only when requested", async () => {
    let scenarioLoads = 0;
    const record = completedRecord("wcdraft:screen-loader:local-ready");
    const state = await resolveDisplayRun(
      { kind: "id", run_id: record.run_id },
      { requireScenarioForLocalRun: true },
      deps({
        loadScenarioBundle: async () => {
          scenarioLoads += 1;
          return SCENARIO_2026_BUNDLE;
        },
        loadRunRecord: () => ({ status: "loaded", record }),
      }),
    );
    expect(state.kind).toBe("ready");
    expect(state.kind === "ready" ? state.scenario : null).toBe(SCENARIO_2026_BUNDLE);
    expect(state.kind === "ready" ? state.linkRunValue : null).toBe(record.run_id);
    expect(scenarioLoads).toBe(1);
  });

  it("keeps local completed share loads ready when optional scenario labels fail", async () => {
    const record = completedRecord("wcdraft:screen-loader:optional-scenario-fail");
    const state = await resolveDisplayRun(
      { kind: "id", run_id: record.run_id },
      { optionalScenarioForLocalRun: true },
      deps({
        loadScenarioBundle: async () => {
          throw new Error("scenario unavailable");
        },
        loadRunRecord: () => ({ status: "loaded", record }),
      }),
    );

    expect(state.kind).toBe("ready");
    expect(state.kind === "ready" ? state.scenario : "not-ready").toBeNull();
    expect(state.kind === "ready" ? state.record : null).toBe(record);
  });

  it("separates malformed, newer-version, and version-skewed tokens", async () => {
    await expect(
      resolveDisplayRun({ kind: "token", token: "t2.not-json" }, {}, deps()),
    ).resolves.toEqual({ kind: "invalidToken", reason: "malformed" });

    await expect(
      resolveDisplayRun({ kind: "token", token: "t5.abcd" }, {}, deps()),
    ).resolves.toEqual({
      kind: "newerToken",
    });

    const token = encodeRunToken(buildOriginRecord(gameData, "wcdraft:screen-loader:skew"));
    const skewedGameData: GameData = {
      ...gameData,
      versions: { ...gameData.versions, dataset_version: "different" },
    };
    await expect(
      resolveDisplayRun(
        { kind: "token", token },
        {},
        deps({ loadGameData: async () => skewedGameData }),
      ),
    ).resolves.toEqual({ kind: "versionSkew" });
  });

  it("replays a token into the same deterministic simulation payload", async () => {
    const origin = buildOriginRecord(gameData, "wcdraft:screen-loader:token-ready");
    const direct = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, origin).simulation;
    const token = encodeRunToken(origin);

    const state = await resolveDisplayRun({ kind: "token", token }, {}, deps());
    expect(state.kind).toBe("ready");
    if (state.kind !== "ready") return;
    expect(state.isReplayedFromToken).toBe(true);
    expect(state.linkRunValue).toBe(token);
    expect(JSON.stringify(state.record.simulation)).toBe(JSON.stringify(direct));
  });

  it("rejects forged manager presence on ordinary Results/Share replay", async () => {
    const origin = buildOriginRecord(gameData, "wcdraft:screen-loader:forged-mp");
    const token = encodeRunToken({ ...origin, manager_presence_band: 0 });

    const state = await resolveDisplayRun({ kind: "token", token }, {}, deps());
    expect(state).toMatchObject({ kind: "invalidToken" });
    expect(state.kind === "invalidToken" ? state.reason : "").toMatch(/manager tactical tier/u);
  });

  it("rejects an invalid arrangement as an ordinary replay token", async () => {
    const origin = buildOriginRecord(gameData, "wcdraft:screen-loader:invalid-arrangement");
    const body = buildRunTokenBody(origin);
    body.a = Array.from({ length: 15 }, (_, index) => index);

    const state = await resolveDisplayRun(
      { kind: "token", token: encodeRunTokenBody(body) },
      {},
      deps(),
    );
    expect(state).toMatchObject({ kind: "invalidToken" });
    expect(state.kind === "invalidToken" ? state.reason : "").toMatch(
      /team sheet reconciliation failed/u,
    );
  });
});

async function failLoadGameData(): Promise<GameData> {
  throw new Error("loadGameData should not run");
}

function completedRecord(seed: string): RunRecordV1 {
  const record = buildOriginRecord(gameData, seed);
  const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record);
  return { ...record, status: "complete", simulation };
}
