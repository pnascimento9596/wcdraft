// Share-token decode + replay — the pure token wire contract is imported from
// @wcdraft/core so apps/web and marketing/x stay byte-for-byte aligned:
//   - decodeRunToken (t1./t2., never throws on malformed input → null)
//   - isNewerRunTokenVersion (t3.+ → honest "older/newer build" angle)
//   - tokenDraftConfig / versionsAgree
//   - reconstructDraftFromToken (replays the pick log through core)
//
// The decode shape is the trust boundary for BOTH result-spotlight posts
// (Phase A) and inbound-reply stat extraction (Phase B): a foreign, tampered,
// or newer-version token must fail closed, never produce a fabricated stat.

import {
  createDraft,
  ERA_PRESETS,
  isDraftComplete,
  pickManager,
  pickPlayer,
  selectDraftTarget,
  encodeRunTokenBody,
  tokenDraftConfig,
  type CardId,
  type DraftFlow,
  type DraftState,
  type EraPresetId,
  type RatingBasis,
  type RunTokenBody,
  type RunTokenPickV2,
  type RunTokenV2Body,
} from "@wcdraft/core";

import { getCatalogForEra, type MarketingGameData } from "./game-data.ts";

export {
  RUN_TOKEN_PREFIX,
  RUN_TOKEN_V2_PREFIX,
  RUN_TOKEN_MAX_LEN,
  decodeRunToken,
  isNewerRunTokenVersion,
  tokenDraftConfig,
  versionsAgree,
} from "@wcdraft/core";

export type {
  RunTokenBody,
  RunTokenPick,
  RunTokenPickV2,
  RunTokenV1Body,
  RunTokenV2Body,
} from "@wcdraft/core";

/** Replay the token's pick log against a fresh createDraft. Throws on any incoherence. */
export function reconstructDraftFromToken(token: RunTokenBody, gd: MarketingGameData): DraftState {
  const config = tokenDraftConfig(token);
  if (config.rating_basis !== "career") {
    // The app supports a Current basis (#118), but this marketing composer
    // simulates on Career ratings only, so a Current-basis token is honest-
    // skipped from result-spotlights (run-from-token returns replay_failed)
    // rather than rendered against the wrong ratings. Never a fabricated stat.
    throw new Error(
      `token rating_basis "${config.rating_basis}" is not simulated by the marketing composer (Career only)`,
    );
  }
  const catalog = getCatalogForEra(gd, config.era_preset);
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
    if (positionFirst) {
      const ts = (pick as { ts?: string }).ts;
      if (ts === undefined) throw new Error(`spin ${i}: position_first pick missing target`);
      state = selectDraftTarget(catalog, state, ts);
    }
    if (pick.k === "m") {
      state = pickManager(catalog, state);
    } else {
      state = pickPlayer(catalog, state, pick.c as CardId, pick.s);
    }
  }
  if (!isDraftComplete(state)) throw new Error("replay completed picks but draft is not complete");
  return state;
}

/** Encode a completed DraftState back to a t2. token (used by the fixture generator + tests). */
export function encodeRunTokenV2(body: Omit<RunTokenV2Body, "v">): string {
  return encodeRunTokenBody({ v: 2, ...body });
}

/**
 * Build a t2. token body from a completed DraftState + the known master
 * parent_seed — mirrors apps/web/lib/game/run-token.ts buildRunTokenBody. The
 * DraftState carries only the DRAFT-substream seed, so the caller MUST pass
 * the master `parent_seed` the run was created from (token replay re-derives
 * every substream from it). Used to mint real, replay-checked tokens
 * (fixtures + the daily-challenge token generator).
 */
export function buildTokenBodyFromDraft(
  draft: DraftState,
  gd: MarketingGameData,
  parent_seed: string,
): Omit<RunTokenV2Body, "v"> {
  const spins = [...draft.spins].sort((a, b) => a.index - b.index);
  if (spins.length !== 17) throw new Error(`expected 17 spins, got ${spins.length}`);
  const draft_flow: DraftFlow = draft.draft_flow ?? "squad_first";
  const rating_basis: RatingBasis = draft.rating_basis ?? "career";
  const era_preset: EraPresetId = draft.era_preset ?? "all_time";
  const positionFirst = draft_flow === "position_first";
  const pl: RunTokenPickV2[] = spins.map((spin, i) => {
    if (spin.index !== i) throw new Error(`spin index ${spin.index} out of order at ${i}`);
    if (spin.picked_kind === "manager") {
      if (spin.picked_manager_card_id === null)
        throw new Error(`spin ${i}: manager pick missing id`);
      return positionFirst ? { k: "m", ts: "manager" } : { k: "m" };
    }
    if (spin.picked_kind === "player") {
      if (spin.picked_card_id === null || spin.assigned_slot_id === null) {
        throw new Error(`spin ${i}: player pick missing card_id or slot_id`);
      }
      const base = { k: "p" as const, c: spin.picked_card_id as string, s: spin.assigned_slot_id };
      return positionFirst ? { ...base, ts: spin.assigned_slot_id } : base;
    }
    throw new Error(`spin ${i}: unresolved pick`);
  });
  const preset = ERA_PRESETS[era_preset];
  return {
    rid: draft.run_id,
    fid: draft.formation_id,
    ps: parent_seed,
    tn: draft.team_name,
    md: draft.mode,
    df: draft_flow,
    rb: rating_basis,
    ef: { id: preset.id, min: preset.min_year, max: preset.max_year },
    pl,
    sv: gd.versions.schema_version,
    dv: gd.versions.dataset_version,
    rv: gd.versions.rating_version,
    ev: gd.versions.engine_version,
    uv: gd.versions.ruleset_version,
    hv: gd.versions.data_bundle_hash,
  };
}
