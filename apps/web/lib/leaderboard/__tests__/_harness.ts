// F-4 U2 — shared test/dev harness for the validation core.
//
// The server-shaped inputs (`GameData` + scenario bundle) are single-sourced
// from `lib/leaderboard/server-data.ts` since U3 — the SAME construction the
// submit route uses in production, re-exported here so existing U2 test and
// fixture-generator imports keep working. Underscore-prefixed so the vitest
// `*.test.ts` glob skips it.

import {
  activeSpin,
  autoDraft,
  buildRunScenario,
  createDraft,
  isDraftComplete,
  pickManager,
  pickPlayer,
  runTournamentFull,
  selectDraftTarget,
  type DraftFlow,
  type DraftMode,
  type EraPresetId,
  type RatingBasis,
  type ScoreComponent,
} from "@wcdraft/core";
import type { Scenario2026Bundle } from "@wcdraft/data";

import type { GameData } from "../../game/data";
import { getCatalogForEra } from "../../game/data";
import type { RunRecordV1 } from "../../game/run-record";
import { buildRunTokenBody } from "../../game/run-token";
import { buildSimWorldInputs } from "../../game/simulate";
import { buildServerGameData, serverScenarioBundle } from "../server-data";
import type { SubmissionBody } from "../validate";

export { buildServerGameData, serverScenarioBundle };
export type { Scenario2026Bundle };

/** Deterministic origin run: autoDraft over the real catalog at `seed`. */
export function buildOriginRecord(
  gameData: GameData,
  seed: string,
  mode: DraftMode = "classic",
  teamName = "Origin XI",
  config: {
    readonly draftFlow?: DraftFlow;
    readonly ratingBasis?: RatingBasis;
    readonly eraPreset?: EraPresetId;
    readonly formationId?: string;
  } = {},
): RunRecordV1 {
  const draftFlow = config.draftFlow ?? "squad_first";
  const ratingBasis = config.ratingBasis ?? "career";
  const eraPreset = config.eraPreset ?? "all_time";
  const formationId = config.formationId ?? "4-3-3";
  const params = {
    run_id: `f4-u2-${mode}`,
    parent_seed: seed,
    formation_id: formationId,
    mode,
    team_name: teamName,
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    draft_flow: draftFlow,
    rating_basis: ratingBasis,
    era_preset: eraPreset,
  } as const;
  const draft =
    draftFlow === "position_first"
      ? completePositionFirstDraft(gameData, params)
      : autoDraft({ ...params, dataset: gameData.draftDataset });
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

function completePositionFirstDraft(gameData: GameData, params: Parameters<typeof createDraft>[1]) {
  const catalog = getCatalogForEra(gameData, params.era_preset ?? "all_time");
  let draft = createDraft(catalog, params);
  while (!isDraftComplete(draft)) {
    const targets: string[] = [];
    if (draft.manager_card_id === null) targets.push("manager");
    for (const slot of draft.squad) {
      if (slot.card_id === null) targets.push(slot.slot_id);
    }
    let advanced = false;
    for (const target of targets) {
      let rolled;
      try {
        rolled = selectDraftTarget(catalog, draft, target);
      } catch {
        continue;
      }
      const spin = activeSpin(rolled);
      if (spin === null) continue;
      draft =
        target === "manager"
          ? pickManager(catalog, rolled)
          : pickPlayer(catalog, rolled, spin.rolled_card_ids[0]!);
      advanced = true;
      break;
    }
    if (!advanced) throw new Error("position-first harness could not advance");
  }
  return draft;
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

/** Public test/dev builder for the exact validator/route submission shape. */
export function buildSubmissionBody(
  gameData: GameData,
  scenarioBundle: Scenario2026Bundle,
  record: RunRecordV1,
  over: Record<string, unknown> = {},
): SubmissionBody & Record<string, unknown> {
  return {
    token: encodeBody(buildRunTokenBody(record)),
    claimed_score: expectedRunFor(gameData, scenarioBundle, record).score,
    draft_mode: record.draft.mode,
    display_alias: "route_tester",
    ...over,
  } as SubmissionBody & Record<string, unknown>;
}

/** Re-encode a (possibly tampered) token body — trust-boundary test helper.
 *  Picks the wire prefix from the body's `v` so tampering at the JSON layer
 *  round-trips through the same decoder the attacker would hit. */
export function encodeBody(body: unknown): string {
  const v = (body as { v?: unknown } | null)?.v;
  const prefix = v === 1 ? "t1." : v === 2 ? "t2." : v === 4 ? "t4." : "t3.";
  return prefix + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}
