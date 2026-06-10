// F-4 U2 — shared test/dev harness for the validation core.
//
// The server-shaped inputs (`GameData` + scenario bundle) are single-sourced
// from `lib/leaderboard/server-data.ts` since U3 — the SAME construction the
// submit route uses in production, re-exported here so existing U2 test and
// fixture-generator imports keep working. Underscore-prefixed so the vitest
// `*.test.ts` glob skips it.

import {
  autoDraft,
  buildRunScenario,
  runTournamentFull,
  type ScoreComponent,
} from "@wcdraft/core";
import type { Scenario2026Bundle } from "@wcdraft/data";

import type { GameData } from "../../game/data";
import type { RunRecordV1 } from "../../game/run-record";
import { buildSimWorldInputs } from "../../game/simulate";
import { buildServerGameData, serverScenarioBundle } from "../server-data";

export { buildServerGameData, serverScenarioBundle };
export type { Scenario2026Bundle };

/** Deterministic origin run: autoDraft over the real catalog at `seed`. */
export function buildOriginRecord(
  gameData: GameData,
  seed: string,
  mode: "classic" | "hidden" = "classic",
  teamName = "Origin XI",
): RunRecordV1 {
  const draft = autoDraft({
    run_id: `f4-u2-${mode}`,
    parent_seed: seed,
    formation_id: "4-3-3",
    mode,
    team_name: teamName,
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    dataset: gameData.draftDataset,
  });
  return {
    record_version: 1,
    run_id: draft.run_id,
    parent_seed: seed,
    created_seq: 0,
    updated_seq: 0,
    versions: gameData.versions,
    draft,
    status: "ready",
  };
}

/**
 * Ground-truth score for an origin record, computed via the engine directly
 * (the same pipeline the validator re-runs — used to set `claimed_score`).
 */
export function expectedRunFor(
  gameData: GameData,
  scenarioBundle: Scenario2026Bundle,
  record: RunRecordV1,
): { score: number; score_breakdown: ScoreComponent[] } {
  const { world, teams, bracket } = buildSimWorldInputs(gameData, scenarioBundle, record);
  const { scenario } = buildRunScenario({
    parent_seed: record.parent_seed,
    teams,
    bracket,
    ruleset_version: record.versions.ruleset_version,
  });
  const result = runTournamentFull(record.draft, scenario, record.parent_seed, world);
  return { score: result.run.score, score_breakdown: result.run.score_breakdown };
}

/** Re-encode a (possibly tampered) token body — trust-boundary test helper. */
export function encodeBody(body: unknown): string {
  return "t1." + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}
