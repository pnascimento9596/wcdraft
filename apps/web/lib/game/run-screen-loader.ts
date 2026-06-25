import type { Scenario2026Bundle } from "@wcdraft/data";

import { loadGameData, type GameData } from "./data";
import type { RunParam } from "./navigation";
import { loadRunRecord, type RunRecordV1, type LoadRunRecordResult } from "./run-record";
import { loadScenarioBundle } from "./scenario-data";
import {
  decodeRunToken,
  isNewerRunTokenVersion,
  RunTokenError,
  type RunTokenBody,
  versionsAgree,
  virtualRecordFromToken,
} from "./run-token";
import { runSimulation } from "./simulate";

export type DisplayRunState =
  | { kind: "missing"; runId: string | null; localStatus?: "missing" | "invalid" }
  | { kind: "stale"; runId: string }
  | { kind: "invalidToken"; reason: string }
  | { kind: "newerToken" }
  | { kind: "versionSkew" }
  | { kind: "needsReview"; runId: string }
  | {
      kind: "ready";
      gameData: GameData;
      scenario: Scenario2026Bundle | null;
      record: RunRecordV1;
      isReplayedFromToken: boolean;
      linkRunValue: string;
    };

export interface ResolveDisplayRunOptions {
  /**
   * Results needs the scenario for both local and token-loaded runs. Share
   * only needs it to replay token-loaded runs, so keep local-id loads cheaper.
   */
  readonly requireScenarioForLocalRun?: boolean;
  /** Draft and Review can render editable pre-simulation records. */
  readonly allowUnsimulatedLocalRun?: boolean;
}

export interface ResolveDisplayRunDeps {
  readonly loadGameData: () => Promise<GameData>;
  readonly loadScenarioBundle: () => Promise<Scenario2026Bundle>;
  readonly loadRunRecord: (
    runId: string,
    currentVersions: GameData["versions"],
  ) => LoadRunRecordResult;
  readonly runSimulation: typeof runSimulation;
}

export const defaultResolveDisplayRunDeps: ResolveDisplayRunDeps = {
  loadGameData,
  loadScenarioBundle,
  loadRunRecord,
  runSimulation,
};

export async function resolveDisplayRun(
  parsed: RunParam | null,
  options: ResolveDisplayRunOptions = {},
  deps: Partial<ResolveDisplayRunDeps> = {},
): Promise<DisplayRunState> {
  if (parsed === null) return { kind: "missing", runId: null };

  const resolvedDeps = { ...defaultResolveDisplayRunDeps, ...deps };
  const gameData = await resolvedDeps.loadGameData();
  let scenario: Scenario2026Bundle | null = null;
  if (parsed.kind === "id" && options.requireScenarioForLocalRun) {
    scenario = await resolvedDeps.loadScenarioBundle();
  }

  if (parsed.kind === "id") {
    const loaded = resolvedDeps.loadRunRecord(parsed.run_id, gameData.versions);
    if (loaded.status === "stale") return { kind: "stale", runId: parsed.run_id };
    if (loaded.status !== "loaded" || !loaded.record) {
      return {
        kind: "missing",
        runId: parsed.run_id,
        localStatus: loaded.status === "invalid" ? "invalid" : "missing",
      };
    }
    if (!loaded.record.simulation && !options.allowUnsimulatedLocalRun) {
      return { kind: "needsReview", runId: parsed.run_id };
    }
    return {
      kind: "ready",
      gameData,
      scenario,
      record: loaded.record,
      isReplayedFromToken: false,
      linkRunValue: loaded.record.run_id,
    };
  }

  const decoded = decodeRunTokenForDisplay(parsed.token, gameData.versions);
  if (decoded.kind !== "ready") return decoded;

  scenario = scenario ?? (await resolvedDeps.loadScenarioBundle());
  try {
    const virtual = virtualRecordFromToken(decoded.token, gameData);
    const { simulation } = await resolvedDeps.runSimulation(gameData, scenario, virtual);
    return {
      kind: "ready",
      gameData,
      scenario,
      record: { ...virtual, status: "complete", simulation },
      isReplayedFromToken: true,
      linkRunValue: parsed.token,
    };
  } catch (err) {
    if (err instanceof RunTokenError) {
      return { kind: "invalidToken", reason: `Couldn't replay the shared run: ${err.message}` };
    }
    throw err;
  }
}

export type DisplayRunTokenState =
  | { kind: "ready"; token: RunTokenBody }
  | { kind: "invalidToken"; reason: "malformed" }
  | { kind: "newerToken" }
  | { kind: "versionSkew" };

export function decodeRunTokenForDisplay(
  value: string,
  currentVersions?: GameData["versions"],
): DisplayRunTokenState {
  const decoded = decodeRunToken(value);
  if (decoded === null) {
    return isNewerRunTokenVersion(value)
      ? { kind: "newerToken" }
      : { kind: "invalidToken", reason: "malformed" };
  }
  if (currentVersions && !versionsAgree(decoded, currentVersions)) return { kind: "versionSkew" };
  return { kind: "ready", token: decoded };
}
