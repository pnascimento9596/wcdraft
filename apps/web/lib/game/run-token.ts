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
//   DC-1 (draft-config season, plan §A): `t2.` carried the THREE config axes
//   (`df` draft flow, `rb` rating basis, `ef` era preset WITH resolved
//   bounds) on top of everything `t1.` carried. Spin-agency `t3.` keeps those
//   config anchors and replaces player card ids with choice indices into the
//   re-derived choose-from-3 list. `t1.`/`t2.` stay decode-compatible for skew
//   notices, but replay is intentionally `t3.`-only.
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
  activeSpin,
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
  type ManagerCardId,
  type RatingBasis,
  type RunTokenBody,
  type RunTokenOgSummary,
  type RunTokenPickV3,
  type RunTokenPickV4,
  type RunTokenV3Body,
  type RunTokenV4Body,
} from "@wcdraft/core";

import type { GameData } from "./data";
import { getCatalogForEra } from "./data";
import { deriveDailySeed } from "./daily";
import type { RunRecordV1 } from "./run-record";

export {
  RUN_TOKEN_PREFIX,
  RUN_TOKEN_V2_PREFIX,
  RUN_TOKEN_V3_PREFIX,
  RUN_TOKEN_V4_PREFIX,
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
  RunTokenPickV3,
  RunTokenPickV4,
  RunTokenV1Body,
  RunTokenV2Body,
  RunTokenV3Body,
  RunTokenV4Body,
} from "@wcdraft/core";

/** Build a replay token body from a fully drafted `RunRecord`. */
export function buildRunTokenBody(record: RunRecordV1): RunTokenV3Body | RunTokenV4Body {
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
  const draftMode = record.draft.mode;
  const preset = ERA_PRESETS[era_preset];
  if (draftMode === "open") {
    const pl: RunTokenPickV4[] = spins.map((spin, i) => {
      if (spin.index !== i) {
        throw new RunTokenError(`spin index ${spin.index} out of order at position ${i}`);
      }
      if (spin.picked_kind === "manager") {
        if (spin.picked_manager_card_id === null) {
          throw new RunTokenError(`spin ${i}: manager pick missing manager_card_id`);
        }
        const base = { k: "m" as const, mc: spin.picked_manager_card_id };
        return positionFirst ? { ...base, ts: "manager" as const } : base;
      }
      if (spin.picked_kind === "player") {
        if (spin.picked_card_id === null || spin.assigned_slot_id === null) {
          throw new RunTokenError(`spin ${i}: player pick missing card_id or slot_id`);
        }
        if (!spin.rolled_card_ids.includes(spin.picked_card_id)) {
          throw new RunTokenError(`spin ${i}: picked card is not in the open roster`);
        }
        const base = { k: "p" as const, c: spin.picked_card_id, s: spin.assigned_slot_id };
        return positionFirst ? { ...base, ts: spin.assigned_slot_id } : base;
      }
      throw new RunTokenError(`spin ${i}: pick is unresolved (status=${spin.status ?? "?"})`);
    });
    return {
      v: 4,
      rid: record.run_id,
      fid: record.draft.formation_id,
      ps: record.parent_seed,
      tn: record.draft.team_name,
      md: "open",
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

  const pl: RunTokenPickV3[] = spins.map((spin, i) => {
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
      const choiceIndex = spin.rolled_card_ids.indexOf(spin.picked_card_id);
      if (choiceIndex < 0) {
        throw new RunTokenError(`spin ${i}: picked card is not in the materialized choice list`);
      }
      const base = { k: "p" as const, ci: choiceIndex, s: spin.assigned_slot_id };
      // Under position-first the committed target IS the assigned slot
      // (`pickPlayer` enforces the match at pick time), so `ts === s` always.
      return positionFirst ? { ...base, ts: spin.assigned_slot_id } : base;
    }
    throw new RunTokenError(`spin ${i}: pick is unresolved (status=${spin.status ?? "?"})`);
  });
  return {
    v: 3,
    rid: record.run_id,
    fid: record.draft.formation_id,
    ps: record.parent_seed,
    tn: record.draft.team_name,
    md: draftMode,
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

/** Encode a `RunRecord` as a `t3.<base64url>` token string. */
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
  if (token.v !== 3 && token.v !== 4) {
    throw new RunTokenError("legacy token version cannot replay under the current draft engine");
  }
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
    if (token.v === 4) {
      const pick = token.pl[i]!;
      try {
        // DC-3 position-first: replay the COMMITTED target before each pick —
        // the same selectDraftTarget transition the live UI walks.
        if (positionFirst) {
          if (pick.ts === undefined) {
            throw new RunTokenError(`spin ${i}: position_first pick is missing its target`);
          }
          state = selectDraftTarget(catalog, state, pick.ts);
        }
        if (pick.k === "m") {
          state = pickManager(catalog, state, pick.mc as ManagerCardId);
        } else {
          const active = activeSpin(state);
          if (!active || active.status !== "pending") {
            throw new RunTokenError(`spin ${i}: no materialized player choices are pending`);
          }
          state = pickPlayer(catalog, state, pick.c as CardId, pick.s);
        }
      } catch (err) {
        throw new RunTokenError(
          `replay failed at spin ${i} (${
            pick.k === "m" ? "manager" : `card ${pick.c}→${pick.s}`
          }): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

    const pick = token.pl[i]!;
    try {
      if (positionFirst) {
        if (pick.ts === undefined) {
          throw new RunTokenError(`spin ${i}: position_first pick is missing its target`);
        }
        state = selectDraftTarget(catalog, state, pick.ts);
      }
      if (pick.k === "m") {
        state = pickManager(catalog, state);
      } else {
        const active = activeSpin(state);
        if (!active || active.status !== "pending") {
          throw new RunTokenError(`spin ${i}: no materialized player choices are pending`);
        }
        const cardId = active.rolled_card_ids[pick.ci];
        if (cardId === undefined) {
          throw new RunTokenError(
            `spin ${i}: choice index ${pick.ci} is outside the materialized choices`,
          );
        }
        state = pickPlayer(catalog, state, cardId as CardId, pick.s);
      }
    } catch (err) {
      throw new RunTokenError(
        `replay failed at spin ${i} (${
          pick.k === "m" ? "manager" : `choice ${pick.ci}→${pick.s}`
        }): ${err instanceof Error ? err.message : String(err)}`,
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
    (token.v === 3 || token.v === 4) && token.ch?.k === "daily"
      ? token.ch.s === deriveDailySeed(token.ch.d)
        ? { kind: "daily" as const, date: token.ch.d, seed: token.ch.s }
        : undefined
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
