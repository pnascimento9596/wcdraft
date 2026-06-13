// Share-token decode + replay — a faithful port of the parts of
// apps/web/lib/game/run-token.ts the marketing poster needs:
//   - decodeRunToken (t1./t2., never throws on malformed input → null)
//   - isNewerRunTokenVersion (t3.+ → honest "older/newer build" angle)
//   - tokenDraftConfig / versionsAgree
//   - reconstructDraftFromToken (replays the pick log through core)
//
// Reproduced rather than imported to keep marketing decoupled from the app.
// The decode shape is the trust boundary for BOTH result-spotlight posts
// (Phase A) and inbound-reply stat extraction (Phase B): a foreign, tampered,
// or newer-version token must fail closed, never produce a fabricated stat.

import {
  createDraft,
  ERA_PRESETS,
  isDraftComplete,
  isDraftFlow,
  isEraPresetId,
  isRatingBasis,
  pickManager,
  pickPlayer,
  selectDraftTarget,
  type CardId,
  type DraftFlow,
  type DraftState,
  type EraPresetId,
  type RatingBasis,
} from "@wcdraft/core";

import { getCatalogForEra, type MarketingGameData, type RunRecordVersions } from "./game-data.ts";

export const RUN_TOKEN_PREFIX = "t1." as const;
export const RUN_TOKEN_V2_PREFIX = "t2." as const;
export const RUN_TOKEN_MAX_LEN = 8192 as const;

export type RunTokenPick = { k: "m" } | { k: "p"; c: string; s: string };
export type RunTokenPickV2 =
  | { k: "m"; ts?: "manager" }
  | { k: "p"; c: string; s: string; ts?: string };

export interface RunTokenV1Body {
  v: 1;
  rid: string;
  fid: string;
  ps: string;
  tn: string;
  md: "classic" | "hidden";
  pl: RunTokenPick[];
  sv: string;
  dv: string;
  rv: string;
  ev: string;
  uv: string;
  hv: string;
}

export interface RunTokenV2Body {
  v: 2;
  rid: string;
  fid: string;
  ps: string;
  tn: string;
  md: "classic" | "hidden";
  df: DraftFlow;
  rb: RatingBasis;
  ef: { id: EraPresetId; min: number; max: number };
  pl: RunTokenPickV2[];
  sv: string;
  dv: string;
  rv: string;
  ev: string;
  uv: string;
  hv: string;
}

export type RunTokenBody = RunTokenV1Body | RunTokenV2Body;

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64").toString("utf8");
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function isPick(x: unknown): x is RunTokenPick {
  if (!x || typeof x !== "object") return false;
  const o = x as { k?: unknown; c?: unknown; s?: unknown };
  if (o.k === "m") return true;
  if (o.k === "p") return typeof o.c === "string" && typeof o.s === "string";
  return false;
}

function isPickV2(x: unknown, positionFirst: boolean): x is RunTokenPickV2 {
  if (!x || typeof x !== "object") return false;
  const o = x as { k?: unknown; c?: unknown; s?: unknown; ts?: unknown };
  if (o.k === "m") {
    if (positionFirst && o.ts === undefined) return false;
    if (o.ts !== undefined && o.ts !== "manager") return false;
    return true;
  }
  if (o.k === "p") {
    if (typeof o.c !== "string" || typeof o.s !== "string") return false;
    if (positionFirst && o.ts === undefined) return false;
    if (o.ts !== undefined && o.ts !== o.s) return false;
    return true;
  }
  return false;
}

function isRunTokenV1Body(x: unknown): x is RunTokenV1Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (typeof o.rid !== "string" || o.rid.length === 0 || o.rid.length > 128) return false;
  if (typeof o.fid !== "string" || o.fid.length === 0 || o.fid.length > 64) return false;
  if (typeof o.ps !== "string" || o.ps.length === 0 || o.ps.length > 256) return false;
  if (typeof o.tn !== "string") return false;
  if (o.md !== "classic" && o.md !== "hidden") return false;
  if (!Array.isArray(o.pl) || o.pl.length !== 17) return false;
  for (const p of o.pl) if (!isPick(p)) return false;
  for (const k of ["sv", "dv", "rv", "ev", "uv", "hv"]) if (typeof o[k] !== "string") return false;
  return true;
}

function isRunTokenV2Body(x: unknown): x is RunTokenV2Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 2) return false;
  if (typeof o.rid !== "string" || o.rid.length === 0 || o.rid.length > 128) return false;
  if (typeof o.fid !== "string" || o.fid.length === 0 || o.fid.length > 64) return false;
  if (typeof o.ps !== "string" || o.ps.length === 0 || o.ps.length > 256) return false;
  if (typeof o.tn !== "string") return false;
  if (o.md !== "classic" && o.md !== "hidden") return false;
  if (!isDraftFlow(o.df)) return false;
  if (!isRatingBasis(o.rb)) return false;
  const ef = o.ef as { id?: unknown; min?: unknown; max?: unknown } | null | undefined;
  if (!ef || typeof ef !== "object") return false;
  if (!isEraPresetId(ef.id)) return false;
  const preset = ERA_PRESETS[ef.id];
  if (ef.min !== preset.min_year || ef.max !== preset.max_year) return false;
  const positionFirst = o.df === "position_first";
  if (!Array.isArray(o.pl) || o.pl.length !== 17) return false;
  for (const p of o.pl) if (!isPickV2(p, positionFirst)) return false;
  for (const k of ["sv", "dv", "rv", "ev", "uv", "hv"]) if (typeof o[k] !== "string") return false;
  return true;
}

export function isNewerRunTokenVersion(value: string): boolean {
  if (typeof value !== "string" || value.length > RUN_TOKEN_MAX_LEN) return false;
  const m = /^t(\d{1,4})\./.exec(value);
  if (!m) return false;
  return Number(m[1]) > 2;
}

export function decodeRunToken(value: string): RunTokenBody | null {
  if (typeof value !== "string") return null;
  if (value.length > RUN_TOKEN_MAX_LEN) return null;
  let prefix: string;
  let v: 1 | 2;
  if (value.startsWith(RUN_TOKEN_PREFIX)) {
    prefix = RUN_TOKEN_PREFIX;
    v = 1;
  } else if (value.startsWith(RUN_TOKEN_V2_PREFIX)) {
    prefix = RUN_TOKEN_V2_PREFIX;
    v = 2;
  } else {
    return null;
  }
  const b64 = value.slice(prefix.length);
  if (b64.length === 0) return null;
  let json: string;
  try {
    json = base64UrlDecode(b64);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (v === 1) return isRunTokenV1Body(parsed) ? parsed : null;
  return isRunTokenV2Body(parsed) ? parsed : null;
}

export function tokenDraftConfig(token: RunTokenBody): {
  md: "classic" | "hidden";
  draft_flow: DraftFlow;
  rating_basis: RatingBasis;
  era_preset: EraPresetId;
} {
  if (token.v === 1) {
    return {
      md: token.md,
      draft_flow: "squad_first",
      rating_basis: "career",
      era_preset: "all_time",
    };
  }
  return { md: token.md, draft_flow: token.df, rating_basis: token.rb, era_preset: token.ef.id };
}

export function versionsAgree(token: RunTokenBody, current: RunRecordVersions): boolean {
  return (
    token.sv === current.schema_version &&
    token.dv === current.dataset_version &&
    token.rv === current.rating_version &&
    token.ev === current.engine_version &&
    token.uv === current.ruleset_version &&
    token.hv === current.data_bundle_hash
  );
}

/** Replay the token's pick log against a fresh createDraft. Throws on any incoherence. */
export function reconstructDraftFromToken(token: RunTokenBody, gd: MarketingGameData): DraftState {
  const config = tokenDraftConfig(token);
  if (config.rating_basis !== "career") {
    // The app supports a Current basis (#118), but this marketing composer
    // simulates on Career ratings only, so a Current-basis token is honest-
    // skipped from result-spotlights (run-from-token returns replay_failed)
    // rather than rendered against the wrong ratings. Never a fabricated stat.
    throw new Error(`token rating_basis "${config.rating_basis}" is not simulated by the marketing composer (Career only)`);
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
  const full: RunTokenV2Body = { v: 2, ...body };
  return RUN_TOKEN_V2_PREFIX + base64UrlEncode(JSON.stringify(full));
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
