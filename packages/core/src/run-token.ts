import {
  ERA_PRESETS,
  isDraftFlow,
  isEraPresetId,
  isRatingBasis,
  type DraftConfig,
  type DraftFlow,
  type EraPresetId,
  type RatingBasis,
} from "./types/draft-config.js";
import type { MatchRound } from "./types/index.js";

/** Legacy `t1.` prefix - decode-compatible forever; encode no longer emits it. */
export const RUN_TOKEN_PREFIX = "t1." as const;

/** DC-1 `t2.` prefix - the config-bearing token every new run encodes. */
export const RUN_TOKEN_V2_PREFIX = "t2." as const;

/** Upper bound on a well-formed `?run=` value. */
export const RUN_TOKEN_MAX_LEN = 8192 as const;

/** Pick log entry. Manager picks have no card_id/slot_id. */
export type RunTokenPick = { k: "m" } | { k: "p"; c: string; s: string };

/** Versioned reconstruction payload carried by legacy `t1.` tokens. */
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

/** `t2.` pick log entry. */
export type RunTokenPickV2 =
  | { k: "m"; ts?: "manager" }
  | { k: "p"; c: string; s: string; ts?: string };

/** Compact result summary carried by newer `t2.` tokens for signed OG rendering. */
export interface RunTokenOgSummary {
  w: number;
  l: number;
  mp: number;
  gf: number;
  ga: number;
  rr: MatchRound;
  ch: boolean;
  sw: number;
}

/** DC-1 config-bearing token body. */
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

/** Every decodable token body. */
export type RunTokenBody = RunTokenV1Body | RunTokenV2Body;

export interface RunTokenVersions {
  schema_version: string;
  dataset_version: string;
  rating_version: string;
  engine_version: string;
  ruleset_version: string;
  data_bundle_hash: string;
}

export class RunTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunTokenError";
  }
}

/** Browser-and-Node base64url encoder. */
export function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  let b64: string;
  if (typeof btoa === "function") {
    b64 = btoa(bin);
  } else {
    const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
    if (!BufferCtor) throw new RunTokenError("base64UrlEncode: no btoa / Buffer available");
    b64 = BufferCtor.from(bin, "binary").toString("base64");
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/** Browser-and-Node base64url decoder. */
export function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const b64 = padded + pad;
  let bin: string;
  if (typeof atob === "function") {
    bin = atob(b64);
  } else {
    const BufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
    if (!BufferCtor) throw new RunTokenError("base64UrlDecode: no atob / Buffer available");
    bin = BufferCtor.from(b64, "base64").toString("binary");
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeRunTokenBody(body: RunTokenBody): string {
  const prefix = body.v === 1 ? RUN_TOKEN_PREFIX : RUN_TOKEN_V2_PREFIX;
  return prefix + base64UrlEncode(JSON.stringify(body));
}

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

export function versionsAgree(token: RunTokenBody, current: RunTokenVersions): boolean {
  return (
    token.sv === current.schema_version &&
    token.dv === current.dataset_version &&
    token.rv === current.rating_version &&
    token.ev === current.engine_version &&
    token.uv === current.ruleset_version &&
    token.hv === current.data_bundle_hash
  );
}
