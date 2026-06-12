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
  selectDraftTarget,
  isDraftComplete,
  isDraftFlow,
  isEraPresetId,
  isRatingBasis,
  pickManager,
  pickPlayer,
  type CardId,
  type DraftConfig,
  type DraftFlow,
  type DraftState,
  type EraPresetId,
  type RatingBasis,
} from "@wcdraft/core";

import type { GameData, RunRecordVersions } from "./data";
import { getCatalogForEra } from "./data";
import type { RunRecordV1 } from "./run-record";

// ─── Token format ────────────────────────────────────────────────────────────

/** Legacy `t1.` prefix — decode-compatible forever; encode no longer emits it. */
export const RUN_TOKEN_PREFIX = "t1." as const;

/** DC-1 `t2.` prefix — the config-bearing token every new run encodes. */
export const RUN_TOKEN_V2_PREFIX = "t2." as const;

/** Upper bound on a well-formed `?run=` value (id OR token). */
export const RUN_TOKEN_MAX_LEN = 8192 as const;

/** Pick log entry. Manager picks have no card_id/slot_id; the manager goes to `DraftState.manager_card_id`. */
export type RunTokenPick = { k: "m" } | { k: "p"; c: string; s: string };

/** Versioned reconstruction payload carried by the token. */
export interface RunTokenV1Body {
  /** Token version sentinel. Always `1` for `t1.` prefix. */
  v: 1;
  /** Originating run_id — preserved verbatim so `MatchResult.match_id` stays stable. */
  rid: string;
  /** Formation template id (e.g. `"4-3-3"`). */
  fid: string;
  /** Master parent_seed for the run. */
  ps: string;
  /** Team name (carries through the draft / display). */
  tn: string;
  /** Draft mode. */
  md: "classic" | "hidden";
  /** 17 picks in spin-index order. */
  pl: RunTokenPick[];
  // Version anchors — every field MUST match the receiving site before replay.
  sv: string; // schema_version
  dv: string; // dataset_version
  rv: string; // rating_version
  ev: string; // engine_version
  uv: string; // ruleset_version
  hv: string; // data_bundle_hash
}

/**
 * `t2.` pick log entry (plan §A). `ts` is the TARGET SLOT the user committed
 * BEFORE the squad reveal — required on every entry when `df ===
 * "position_first"` (player picks: `ts === s`; manager picks: `ts ===
 * "manager"`), optional and replay-ignored under `squad_first`. When present
 * it must be coherent under either flow (decode rejects an incoherent `ts`).
 */
export type RunTokenPickV2 =
  | { k: "m"; ts?: "manager" }
  | { k: "p"; c: string; s: string; ts?: string };

/** DC-1 config-bearing token body. Anchor fields are identical to v1. */
export interface RunTokenV2Body {
  /** Token version sentinel. Always `2` for `t2.` prefix. */
  v: 2;
  rid: string;
  fid: string;
  ps: string;
  tn: string;
  /** Existing Classic / Memory visibility mode. */
  md: "classic" | "hidden";
  /** Draft flow axis. */
  df: DraftFlow;
  /** Rating basis axis (encode emits `career` only until MV2-12b). */
  rb: RatingBasis;
  /**
   * Era preset WITH resolved bounds, so a future label/bounds change cannot
   * silently reinterpret old tokens. Decode rejects bounds that disagree
   * with the receiving build's `ERA_PRESETS` table.
   */
  ef: { id: EraPresetId; min: number; max: number };
  /** 17 picks in spin-index order. */
  pl: RunTokenPickV2[];
  // Version anchors — identical semantics to v1.
  sv: string;
  dv: string;
  rv: string;
  ev: string;
  uv: string;
  hv: string;
}

/** Every decodable token body. All variants share md/anchor fields. */
export type RunTokenBody = RunTokenV1Body | RunTokenV2Body;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class RunTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunTokenError";
  }
}

// ─── Base64url ───────────────────────────────────────────────────────────────

/** Browser-and-Node base64url encoder. */
function base64UrlEncode(input: string): string {
  // 1. UTF-8 encode.
  const bytes = new TextEncoder().encode(input);
  // 2. Bytes → binary string for btoa / Buffer.
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  let b64: string;
  if (typeof btoa === "function") {
    b64 = btoa(bin);
  } else {
    // Node fallback. `Buffer` exists in node test envs.
    const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
    if (!BufferCtor) {
      throw new RunTokenError("base64UrlEncode: no btoa / Buffer available");
    }
    b64 = BufferCtor.from(bin, "binary").toString("base64");
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/** Browser-and-Node base64url decoder. Returns the decoded string. */
function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  // Add `=` padding so b64 length is a multiple of 4.
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const b64 = padded + pad;
  let bin: string;
  if (typeof atob === "function") {
    bin = atob(b64);
  } else {
    const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
    if (!BufferCtor) {
      throw new RunTokenError("base64UrlDecode: no atob / Buffer available");
    }
    bin = BufferCtor.from(b64, "base64").toString("binary");
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ─── Encode ──────────────────────────────────────────────────────────────────

/**
 * The config a token replays under, normalized across versions. `t1.` tokens
 * are canonical-by-compatibility: they decode AS the default config (plan §A).
 */
export function tokenDraftConfig(token: RunTokenBody): DraftConfig & { md: "classic" | "hidden" } {
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
  };
}

/** Encode a `RunRecord` as a `t2.<base64url>` token string. */
export function encodeRunToken(record: RunRecordV1): string {
  const body = buildRunTokenBody(record);
  const json = JSON.stringify(body);
  return RUN_TOKEN_V2_PREFIX + base64UrlEncode(json);
}

// ─── Decode ──────────────────────────────────────────────────────────────────

function isPick(x: unknown): x is RunTokenPick {
  if (!x || typeof x !== "object") return false;
  const o = x as { k?: unknown; c?: unknown; s?: unknown };
  if (o.k === "m") return true;
  if (o.k === "p") return typeof o.c === "string" && typeof o.s === "string";
  return false;
}

/**
 * Validate one `t2.` pick entry under the token's draft flow. `ts` is
 * REQUIRED under position-first; when present (either flow) it must be
 * coherent: `"manager"` on manager picks, `=== s` on player picks.
 */
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
  if (typeof o.tn !== "string") return false; // empty string allowed; max via JSON size cap.
  if (o.md !== "classic" && o.md !== "hidden") return false;
  if (!Array.isArray(o.pl) || o.pl.length !== 17) return false;
  for (const p of o.pl) if (!isPick(p)) return false;
  if (typeof o.sv !== "string") return false;
  if (typeof o.dv !== "string") return false;
  if (typeof o.rv !== "string") return false;
  if (typeof o.ev !== "string") return false;
  if (typeof o.uv !== "string") return false;
  if (typeof o.hv !== "string") return false;
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
  // Era preset: known id AND bounds that agree with this build's table —
  // non-canonical bounds are a tampered/foreign token, not a config choice.
  const ef = o.ef as { id?: unknown; min?: unknown; max?: unknown } | null | undefined;
  if (!ef || typeof ef !== "object") return false;
  if (!isEraPresetId(ef.id)) return false;
  const preset = ERA_PRESETS[ef.id];
  if (ef.min !== preset.min_year || ef.max !== preset.max_year) return false;
  const positionFirst = o.df === "position_first";
  if (!Array.isArray(o.pl) || o.pl.length !== 17) return false;
  for (const p of o.pl) if (!isPickV2(p, positionFirst)) return false;
  if (typeof o.sv !== "string") return false;
  if (typeof o.dv !== "string") return false;
  if (typeof o.rv !== "string") return false;
  if (typeof o.ev !== "string") return false;
  if (typeof o.uv !== "string") return false;
  if (typeof o.hv !== "string") return false;
  return true;
}

/**
 * True iff `value` looks like a run token from a NEWER schema than this build
 * understands (`t3.` and beyond). Lets the UI show an honest "made on a newer
 * version" notice instead of lumping such links in with malformed garbage.
 * A `true` here implies `decodeRunToken(value) === null`.
 */
export function isNewerRunTokenVersion(value: string): boolean {
  if (typeof value !== "string" || value.length > RUN_TOKEN_MAX_LEN) return false;
  const m = /^t(\d{1,4})\./.exec(value);
  if (!m) return false;
  return Number(m[1]) > 2;
}

/**
 * Decode a token string (`t1.` or `t2.`). Returns `null` if the string is
 * malformed at any stage (wrong/unknown prefix, invalid base64url, non-JSON,
 * wrong shape, non-canonical era bounds, incoherent `ts`, wrong size).
 * Never throws on malformed input — callers branch on null.
 */
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

/** True iff every version anchor on the token matches the current bundle. */
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
  return {
    record_version: 1,
    run_id: token.rid,
    parent_seed: token.ps,
    created_seq: 0,
    updated_seq: 0,
    versions: gameData.versions,
    draft,
    status: "ready",
  };
}
