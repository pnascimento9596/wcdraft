// F-4 U2 — shared test/dev harness for the validation core.
//
// Builds the SAME server-shaped inputs the submit route (U3) will construct
// once per process: `GameData` from the committed static bundles (mirrors
// `run-token.test.ts` / `e2e-real-run.golden.test.ts`) plus the scenario
// bundle. Underscore-prefixed so the vitest `*.test.ts` glob skips it; the
// golden-fixture generator script imports it too.

import {
  autoDraft,
  buildDraftCatalog,
  buildRunScenario,
  runTournamentFull,
  type DraftDataset,
  type ScoreComponent,
} from "@wcdraft/core";
import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  SCENARIO_2026_BUNDLE,
  type RuntimeDataManifest,
  type Scenario2026Bundle,
} from "@wcdraft/data";

import {
  buildGameDataIndexes,
  composeVersions,
  type GameData,
  type RunRecordVersions,
} from "../../game/data";
import type { RunRecordV1 } from "../../game/run-record";
import { buildSimWorldInputs } from "../../game/simulate";

/** Build the `DraftDataset` consumed by `autoDraft` / `buildDraftCatalog`. */
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

/** Server-shaped `GameData` over the committed compact bundles. */
export function buildServerGameData(): GameData {
  const manifest = RUNTIME_DATA_MANIFEST as RuntimeDataManifest;
  const versions: RunRecordVersions = composeVersions(manifest);
  const draftDataset = buildDataset();
  return {
    manifest,
    draftPool: DRAFT_POOL_BUNDLE,
    versions,
    indexes: buildGameDataIndexes(DRAFT_POOL_BUNDLE),
    draftDataset,
    catalog: buildDraftCatalog(draftDataset),
    nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
  };
}

/** The committed 2026 scenario bundle (teams + bracket). */
export function serverScenarioBundle(): Scenario2026Bundle {
  return SCENARIO_2026_BUNDLE as Scenario2026Bundle;
}

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
