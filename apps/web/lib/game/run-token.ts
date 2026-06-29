// I3.7 fix-pass — versioned, self-contained `?run=` token.
//
// CONTRACT (PR #18 review BLOCKER #1):
//   The `?run=` URL param must reproduce a run in ANY browser, NOT just the
//   one that holds the originating localStorage RunRecord. The user's PICKS
//   are choices (not derivable from the seed), so the token must carry the
//   minimum reconstruction inputs: formation, seed, mode, team name, the
//   17-spin pick log, plus the version anchors so honest-state can fire on
//   skew.
//
// ENCODING:
//   `t<version>.<base64url(JSON)>`. The numeric prefix is the token VERSION
//   sentinel — distinguishes tokens from local `run-v1-*` ids (which never
//   contain `.`) and pins schema evolutions without ambiguity. Base64url
//   keeps the payload URL-safe without `encodeURIComponent` blow-up.
//
//   DC-1 (draft-config season, plan §A): `t2.` carries the THREE config axes
//   (`df` draft flow, `rb` rating basis, `ef` era preset WITH resolved
//   bounds) on top of everything `t1.` carried. New runs encode `t2.`
//   exclusively; `t1.` stays decode-compatible forever and decodes AS the
//   default config (`squad_first` / `career` / `all_time`). The `rb` field
//   admits `current` at the schema boundary (single token evolution — no
//   `t3.` needed for the MV2-12b basis season) but encode emits `career`
//   only and replay refuses `current` honestly until that season lands.
//
// REPLAY:
//   `reconstructDraftFromToken` replays the token's pick log through the same
//   `pickPlayer` / `pickManager` API the live draft uses, on a fresh
//   `createDraft` produced from the token's seed. Since `createDraft` is
//   deterministic on `(catalog, parent_seed, formation_id, ...)`, the spin
//   pool the picks reference is byte-identical to the originator's. The pick
//   log replays into a DraftState byte-equal to the source draft. Running
//   `runSimulationSync` on that DraftState reproduces the deterministic
//   subset of the persisted simulation byte-for-byte.
//
// HONEST-STATE:
//   `versionsAgree` cross-checks every anchor (schema/dataset/rating/engine/
//   ruleset/data_bundle_hash). The screens MUST refuse to render a divergent
//   replay when any anchor differs — they show a notice and do not silently
//   simulate against a different ruleset.

import {
  createDraft,
  ERA_PRESETS,
  isDraftComplete,
  pickManager,
  pickPlayer,
  selectDraftTarget,
  RunTokenError,
  encodeRunTokenBody,
  tokenDraftConfig,
  type CardId,
  type DraftFlow,
  type DraftState,
  type EraPresetId,
  type RatingBasis,
  type RunTokenBody,
  type RunTokenOgSummary,
  type RunTokenPickV2,
  type RunTokenV2Body,
} from "@wcdraft/core";

import type { GameData } from "./data";
import { getCatalogForEra } from "./data";
import type { RunRecordV1 } from "./run-record";

export {
  RUN_TOKEN_PREFIX,
  RUN_TOKEN_V2_PREFIX,
  RUN_TOKEN_MAX_LEN,
  RunTokenError,
  decodeRunToken,
  isNewerRunTokenVersion,
  tokenDraftConfig,
  versionsAgree,
} from "@wcdraft/core";

export type {
  RunTokenBody,
  RunTokenDailyChallenge,
  RunTokenOgSummary,
  RunTokenPick,
  RunTokenPickV2,
  RunTokenV1Body,
  RunTokenV2Body,
} from "@wcdraft/core";

/** Build the DC-1 `t2.` token body from a fully drafted `RunRecord`. */
export function buildRunTokenBody(record: RunRecordV1): RunTokenV2Body {
  const spins = [...record.draft.spins].sort((a, b) => a.index - b.index);
  if (spins.length !== 17) {
    throw new RunTokenError(`expected 17 spins in DraftState, got ${spins.length}`);
  }
  // Pre-DC-1 local records carry no config fields; they were created under
  // the only behavior that existed — the defaults. Normalizing here mirrors
  // the `t1.` decode-compatibility rule exactly.
  const draft_flow: DraftFlow = record.draft.draft_flow ?? "squad_first";
  const rating_basis: RatingBasis = record.draft.rating_basis ?? "career";
  const era_preset: EraPresetId = record.draft.era_preset ?? "all_time";
  const positionFirst = draft_flow === "position_first";
  const pl: RunTokenPickV2[] = spins.map((spin, i) => {
    if (spin.index !== i) {
      throw new RunTokenError(`spin index ${spin.index} out of order at position ${i}`);
    }
    if (spin.picked_kind === "manager") {
      if (spin.picked_manager_card_id === null) {
        throw new RunTokenError(`spin ${i}: manager pick missing manager_card_id`);
      }
      return positionFirst ? { k: "m", ts: "manager" } : { k: "m" };
    }
    if (spin.picked_kind === "player") {
      if (spin.picked_card_id === null || spin.assigned_slot_id === null) {
        throw new RunTokenError(`spin ${i}: player pick missing card_id or slot_id`);
      }
      const base = { k: "p" as const, c: spin.picked_card_id as string, s: spin.assigned_slot_id };
      // Under position-first the committed target IS the assigned slot
      // (`pickPlayer` enforces the match at pick time), so `ts === s` always.
      return positionFirst ? { ...base, ts: spin.assigned_slot_id } : base;
    }
    throw new RunTokenError(`spin ${i}: pick is unresolved (status=${spin.status ?? "?"})`);
  });
  const preset = ERA_PRESETS[era_preset];
  return {
    v: 2,
    rid: record.run_id,
    fid: record.draft.formation_id,
    ps: record.parent_seed,
    tn: record.draft.team_name,
    md: record.draft.mode,
    df: draft_flow,
    rb: rating_basis,
    ef: { id: preset.id, min: preset.min_year, max: preset.max_year },
    pl,
    sv: record.versions.schema_version,
    dv: record.versions.dataset_version,
    rv: record.versions.rating_version,
    ev: record.versions.engine_version,
    uv: record.versions.ruleset_version,
    hv: record.versions.data_bundle_hash,
    ...(record.challenge?.kind === "daily"
      ? { ch: { k: "daily" as const, d: record.challenge.date, s: record.challenge.seed } }
      : {}),
  };
}

/** Extract the completed-run OG summary, if the record has already simulated. */
export function buildRunTokenOgSummary(record: RunRecordV1): RunTokenOgSummary | null {
  if (!record.simulation) return null;
  const { run, matches } = record.simulation;
  return {
    w: run.wins,
    l: run.losses,
    mp: matches.length,
    gf: run.aggregate.goals_for,
    ga: run.aggregate.goals_against,
    rr: run.reached_round,
    ch: run.is_champion,
    sw: run.shootout_wins,
  };
}

/** Encode a `RunRecord` as a `t2.<base64url>` token string. */
export function encodeRunToken(record: RunRecordV1): string {
  return encodeRunTokenBody(buildRunTokenBody(record));
}

// ─── Replay ──────────────────────────────────────────────────────────────────

/**
 * Replay the token's pick log against a fresh `createDraft` derived from the
 * token's seed. Caller MUST verify version agreement first — `gameData`'s
 * catalog is the receiving site's, so the spin pool the picks reference is
 * only meaningful when versions agree.
 */
export function reconstructDraftFromToken(token: RunTokenBody, gameData: GameData): DraftState {
  const config = tokenDraftConfig(token);
  // Both rating bases now replay (runtime-data-2.0.0 dual basis). The basis is
  // carried on the reconstructed DraftState and resolved when the sim world /
  // display views are built (no fake fallback between bases). The era-preset
  // gate below still refuses an unfiltered catalog standing in for a preset.
  // DC-2: replay against the SAME era-bounded catalog the run was drafted
  // from (default all_time IS gameData.catalog by object identity).
  const catalog = getCatalogForEra(gameData, config.era_preset);
  const positionFirst = config.draft_flow === "position_first";
  let state = createDraft(catalog, {
    run_id: token.rid,
    parent_seed: token.ps,
    formation_id: token.fid,
    mode: token.md,
    team_name: token.tn,
    dataset_version: token.dv,
    rating_version: token.rv,
    engine_version: token.ev,
    draft_flow: config.draft_flow,
    rating_basis: config.rating_basis,
    era_preset: config.era_preset,
  });
  for (let i = 0; i < token.pl.length; i += 1) {
    const pick = token.pl[i]!;
    try {
      // DC-3 position-first: replay the COMMITTED target before each pick —
      // the same selectDraftTarget transition the live UI walks. Decode
      // guarantees `ts` is present and coherent on every position-first
      // entry; the engine then enforces target/assignment equality, so a
      // token whose `ts` and final slot diverge fails replay loudly.
      if (positionFirst) {
        const ts = (pick as { ts?: string }).ts;
        if (ts === undefined) {
          throw new RunTokenError(`spin ${i}: position_first pick is missing its target`);
        }
        state = selectDraftTarget(catalog, state, ts);
      }
      if (pick.k === "m") {
        state = pickManager(catalog, state);
      } else {
        // `pick.c` is a CardId by construction (token round-trips a real
        // DraftState.spins[i].picked_card_id, which is branded CardId). The
        // brand is structural and not preserved through JSON, so re-stamp it
        // here at the trust boundary.
        state = pickPlayer(catalog, state, pick.c as CardId, pick.s);
      }
    } catch (err) {
      throw new RunTokenError(
        `replay failed at spin ${i} (${pick.k === "m" ? "manager" : `player ${pick.c}→${pick.s}`}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  if (!isDraftComplete(state)) {
    throw new RunTokenError("replay completed all picks but draft is not complete");
  }
  return state;
}

/**
 * Wrap a reconstructed draft as an in-memory `RunRecordV1`. Callers use this
 * to render results / share screens without persisting the run locally
 * (token-loaded runs are ephemeral session state — the user receiving the
 * URL is a viewer, not the originator).
 */
export function virtualRecordFromToken(token: RunTokenBody, gameData: GameData): RunRecordV1 {
  const draft = reconstructDraftFromToken(token, gameData);
  const challenge =
    token.v === 2 && token.ch?.k === "daily"
      ? { kind: "daily" as const, date: token.ch.d, seed: token.ch.s }
      : undefined;
  return {
    record_version: 1,
    run_id: token.rid,
    parent_seed: token.ps,
    created_seq: 0,
    updated_seq: 0,
    versions: gameData.versions,
    draft,
    status: "ready",
    ...(challenge === undefined ? {} : { challenge }),
  };
}
