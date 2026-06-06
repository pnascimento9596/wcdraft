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
//   `t1.<base64url(JSON)>`. The `t1.` prefix is the token VERSION sentinel —
//   distinguishes tokens from local `run-v1-*` ids (which never contain `.`)
//   and pins future schema evolutions (`t2.` etc) without ambiguity. Base64url
//   keeps the payload URL-safe without `encodeURIComponent` blow-up.
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
  isDraftComplete,
  pickManager,
  pickPlayer,
  type CardId,
  type DraftState,
} from "@wcdraft/core";

import type { GameData, RunRecordVersions } from "./data";
import type { RunRecordV1 } from "./run-record";

// ─── Token format ────────────────────────────────────────────────────────────

/** Prefix that marks a string as a run-token (NOT a `run-v1-*` local id). */
export const RUN_TOKEN_PREFIX = "t1." as const;

/** Upper bound on a well-formed `?run=` value (id OR token). */
export const RUN_TOKEN_MAX_LEN = 8192 as const;

/** Pick log entry. Manager picks have no card_id/slot_id; the manager goes to `DraftState.manager_card_id`. */
export type RunTokenPick =
  | { k: "m" }
  | { k: "p"; c: string; s: string };

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

/** Build the token body from a fully drafted `RunRecord`. */
export function buildRunTokenBody(record: RunRecordV1): RunTokenV1Body {
  const spins = [...record.draft.spins].sort((a, b) => a.index - b.index);
  if (spins.length !== 17) {
    throw new RunTokenError(`expected 17 spins in DraftState, got ${spins.length}`);
  }
  const pl: RunTokenPick[] = spins.map((spin, i) => {
    if (spin.index !== i) {
      throw new RunTokenError(`spin index ${spin.index} out of order at position ${i}`);
    }
    if (spin.picked_kind === "manager") {
      if (spin.picked_manager_card_id === null) {
        throw new RunTokenError(`spin ${i}: manager pick missing manager_card_id`);
      }
      return { k: "m" };
    }
    if (spin.picked_kind === "player") {
      if (spin.picked_card_id === null || spin.assigned_slot_id === null) {
        throw new RunTokenError(`spin ${i}: player pick missing card_id or slot_id`);
      }
      return { k: "p", c: spin.picked_card_id as string, s: spin.assigned_slot_id };
    }
    throw new RunTokenError(`spin ${i}: pick is unresolved (status=${spin.status ?? "?"})`);
  });
  return {
    v: 1,
    rid: record.run_id,
    fid: record.draft.formation_id,
    ps: record.parent_seed,
    tn: record.draft.team_name,
    md: record.draft.mode,
    pl,
    sv: record.versions.schema_version,
    dv: record.versions.dataset_version,
    rv: record.versions.rating_version,
    ev: record.versions.engine_version,
    uv: record.versions.ruleset_version,
    hv: record.versions.data_bundle_hash,
  };
}

/** Encode a `RunRecord` as a `t1.<base64url>` token string. */
export function encodeRunToken(record: RunRecordV1): string {
  const body = buildRunTokenBody(record);
  const json = JSON.stringify(body);
  return RUN_TOKEN_PREFIX + base64UrlEncode(json);
}

// ─── Decode ──────────────────────────────────────────────────────────────────

function isPick(x: unknown): x is RunTokenPick {
  if (!x || typeof x !== "object") return false;
  const o = x as { k?: unknown; c?: unknown; s?: unknown };
  if (o.k === "m") return true;
  if (o.k === "p") return typeof o.c === "string" && typeof o.s === "string";
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

/**
 * Decode a token string. Returns `null` if the string is malformed at any
 * stage (wrong prefix, invalid base64url, non-JSON, wrong shape, wrong size).
 * Never throws on malformed input — callers branch on null.
 */
export function decodeRunToken(value: string): RunTokenV1Body | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith(RUN_TOKEN_PREFIX)) return null;
  if (value.length > RUN_TOKEN_MAX_LEN) return null;
  const b64 = value.slice(RUN_TOKEN_PREFIX.length);
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
  return isRunTokenV1Body(parsed) ? parsed : null;
}

/** True iff every version anchor on the token matches the current bundle. */
export function versionsAgree(token: RunTokenV1Body, current: RunRecordVersions): boolean {
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
export function reconstructDraftFromToken(
  token: RunTokenV1Body,
  gameData: GameData,
): DraftState {
  let state = createDraft(gameData.catalog, {
    run_id: token.rid,
    parent_seed: token.ps,
    formation_id: token.fid,
    mode: token.md,
    team_name: token.tn,
    dataset_version: token.dv,
    rating_version: token.rv,
    engine_version: token.ev,
  });
  for (let i = 0; i < token.pl.length; i += 1) {
    const pick = token.pl[i]!;
    try {
      if (pick.k === "m") {
        state = pickManager(gameData.catalog, state);
      } else {
        // `pick.c` is a CardId by construction (token round-trips a real
        // DraftState.spins[i].picked_card_id, which is branded CardId). The
        // brand is structural and not preserved through JSON, so re-stamp it
        // here at the trust boundary.
        state = pickPlayer(gameData.catalog, state, pick.c as CardId, pick.s);
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
export function virtualRecordFromToken(
  token: RunTokenV1Body,
  gameData: GameData,
): RunRecordV1 {
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
