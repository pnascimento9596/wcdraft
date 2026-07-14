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
import type { DraftMode, OpenDraftMode } from "./types/draft.js";
import type { ManagerPresenceBand, MatchRound } from "./types/index.js";

/** Legacy `t1.` prefix - decode-compatible forever; encode no longer emits it. */
export const RUN_TOKEN_PREFIX = "t1." as const;

/** DC-1 `t2.` prefix - config-bearing legacy tokens. */
export const RUN_TOKEN_V2_PREFIX = "t2." as const;

/** Spin-agency `t3.` prefix - player picks carry choice indices, not card IDs. */
export const RUN_TOKEN_V3_PREFIX = "t3." as const;

/** Open-pick-space `t4.` prefix - full-roster player picks carry picked card IDs. */
export const RUN_TOKEN_V4_PREFIX = "t4." as const;

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
  /** Vestigial untrusted summary retained for wire compatibility; never authoritative. */
  og?: unknown;
}

/** `t2.` pick log entry. */
export type RunTokenPickV2 =
  | { k: "m"; ts?: "manager" }
  | { k: "p"; c: string; s: string; ts?: string };

/** `t3.` pick log entry. Player `ci` indexes the re-derived choose-from-3 list. */
export type RunTokenPickV3 =
  | { k: "m"; ts?: "manager" }
  | { k: "p"; ci: number; s: string; ts?: string };

/** `t4.` pick log entry. Open-pick-space players/managers carry picked card IDs. */
export type RunTokenPickV4 =
  | { k: "m"; mc: string; ts?: "manager" }
  | { k: "p"; c: string; s: string; ts?: string };

/** Compact result summary carried by newer tokens for signed OG rendering. */
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

export interface RunTokenDailyChallenge {
  k: "daily";
  /** UTC date in YYYY-MM-DD form. */
  d: string;
  /** Must match `ps`; repeated so the daily seed/date pair is explicit. */
  s: string;
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
  ch?: RunTokenDailyChallenge;
  /** Vestigial untrusted summary retained for wire compatibility; never authoritative. */
  og?: unknown;
}

/** Spin-agency config-bearing token body. */
export interface RunTokenV3Body {
  v: 3;
  rid: string;
  fid: string;
  ps: string;
  tn: string;
  md: "classic" | "hidden";
  df: DraftFlow;
  rb: RatingBasis;
  ef: { id: EraPresetId; min: number; max: number };
  pl: RunTokenPickV3[];
  sv: string;
  dv: string;
  rv: string;
  ev: string;
  uv: string;
  hv: string;
  /** Stable drafted-manager presence tier; absent on legacy tokens and derived on replay. */
  mp?: ManagerPresenceBand;
  /** Optional team-sheet permutation. Destinations are canonical; values index drafted cards. */
  a?: number[];
  ch?: RunTokenDailyChallenge;
  /** Vestigial untrusted summary retained for wire compatibility; never authoritative. */
  og?: unknown;
}

/** Open-pick-space config-bearing token body. */
export interface RunTokenV4Body {
  v: 4;
  rid: string;
  fid: string;
  ps: string;
  tn: string;
  md: OpenDraftMode;
  df: DraftFlow;
  rb: RatingBasis;
  ef: { id: EraPresetId; min: number; max: number };
  pl: RunTokenPickV4[];
  sv: string;
  dv: string;
  rv: string;
  ev: string;
  uv: string;
  hv: string;
  /** Stable drafted-manager presence tier; absent on legacy tokens and derived on replay. */
  mp?: ManagerPresenceBand;
  /** Optional team-sheet permutation. Destinations are canonical; values index drafted cards. */
  a?: number[];
  ch?: RunTokenDailyChallenge;
  /** Vestigial untrusted summary retained for wire compatibility; never authoritative. */
  og?: unknown;
}

/** Every decodable token body. */
export type RunTokenBody = RunTokenV1Body | RunTokenV2Body | RunTokenV3Body | RunTokenV4Body;

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
  const prefix =
    body.v === 1
      ? RUN_TOKEN_PREFIX
      : body.v === 2
        ? RUN_TOKEN_V2_PREFIX
        : body.v === 3
          ? RUN_TOKEN_V3_PREFIX
          : RUN_TOKEN_V4_PREFIX;
  return prefix + base64UrlEncode(JSON.stringify(canonicalRunTokenBody(body)));
}

/**
 * Rebuild every supported body in one stable property order before encoding.
 * Callers may construct objects through spreads/insertion orders that differ;
 * token bytes must not. Keep the established pre-S4 order, with the two
 * optional replay facts adjacent as `mp`, then `a`, then `ch`.
 */
function canonicalRunTokenBody(body: RunTokenBody): RunTokenBody {
  if (body.v === 1) {
    return {
      v: 1,
      rid: body.rid,
      fid: body.fid,
      ps: body.ps,
      tn: body.tn,
      md: body.md,
      pl: body.pl.map(canonicalPickV1),
      sv: body.sv,
      dv: body.dv,
      rv: body.rv,
      ev: body.ev,
      uv: body.uv,
      hv: body.hv,
      ...(body.og === undefined ? {} : { og: body.og }),
    };
  }
  if (body.v === 2) {
    return {
      v: 2,
      rid: body.rid,
      fid: body.fid,
      ps: body.ps,
      tn: body.tn,
      md: body.md,
      df: body.df,
      rb: body.rb,
      ef: { id: body.ef.id, min: body.ef.min, max: body.ef.max },
      pl: body.pl.map(canonicalPickV2),
      sv: body.sv,
      dv: body.dv,
      rv: body.rv,
      ev: body.ev,
      uv: body.uv,
      hv: body.hv,
      ...(body.ch === undefined ? {} : { ch: canonicalDailyChallenge(body.ch) }),
      ...(body.og === undefined ? {} : { og: body.og }),
    };
  }
  if (body.v === 3) {
    return {
      v: 3,
      rid: body.rid,
      fid: body.fid,
      ps: body.ps,
      tn: body.tn,
      md: body.md,
      df: body.df,
      rb: body.rb,
      ef: { id: body.ef.id, min: body.ef.min, max: body.ef.max },
      pl: body.pl.map(canonicalPickV3),
      sv: body.sv,
      dv: body.dv,
      rv: body.rv,
      ev: body.ev,
      uv: body.uv,
      hv: body.hv,
      ...(body.mp === undefined ? {} : { mp: body.mp }),
      ...(body.a === undefined ? {} : { a: [...body.a] }),
      ...(body.ch === undefined ? {} : { ch: canonicalDailyChallenge(body.ch) }),
      ...(body.og === undefined ? {} : { og: body.og }),
    };
  }
  return {
    v: 4,
    rid: body.rid,
    fid: body.fid,
    ps: body.ps,
    tn: body.tn,
    md: body.md,
    df: body.df,
    rb: body.rb,
    ef: { id: body.ef.id, min: body.ef.min, max: body.ef.max },
    pl: body.pl.map(canonicalPickV4),
    sv: body.sv,
    dv: body.dv,
    rv: body.rv,
    ev: body.ev,
    uv: body.uv,
    hv: body.hv,
    ...(body.mp === undefined ? {} : { mp: body.mp }),
    ...(body.a === undefined ? {} : { a: [...body.a] }),
    ...(body.ch === undefined ? {} : { ch: canonicalDailyChallenge(body.ch) }),
    ...(body.og === undefined ? {} : { og: body.og }),
  };
}

function canonicalPickV1(pick: RunTokenPick): RunTokenPick {
  return pick.k === "m" ? { k: "m" } : { k: "p", c: pick.c, s: pick.s };
}

function canonicalPickV2(pick: RunTokenPickV2): RunTokenPickV2 {
  if (pick.k === "m") return pick.ts === undefined ? { k: "m" } : { k: "m", ts: pick.ts };
  return pick.ts === undefined
    ? { k: "p", c: pick.c, s: pick.s }
    : { k: "p", c: pick.c, s: pick.s, ts: pick.ts };
}

function canonicalPickV3(pick: RunTokenPickV3): RunTokenPickV3 {
  if (pick.k === "m") return pick.ts === undefined ? { k: "m" } : { k: "m", ts: pick.ts };
  return pick.ts === undefined
    ? { k: "p", ci: pick.ci, s: pick.s }
    : { k: "p", ci: pick.ci, s: pick.s, ts: pick.ts };
}

function canonicalPickV4(pick: RunTokenPickV4): RunTokenPickV4 {
  if (pick.k === "m") {
    return pick.ts === undefined ? { k: "m", mc: pick.mc } : { k: "m", mc: pick.mc, ts: pick.ts };
  }
  return pick.ts === undefined
    ? { k: "p", c: pick.c, s: pick.s }
    : { k: "p", c: pick.c, s: pick.s, ts: pick.ts };
}

function canonicalDailyChallenge(challenge: RunTokenDailyChallenge): RunTokenDailyChallenge {
  return { k: "daily", d: challenge.d, s: challenge.s };
}

export function tokenDraftConfig(token: RunTokenBody): DraftConfig & { md: DraftMode } {
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

function isPickV3(x: unknown, positionFirst: boolean): x is RunTokenPickV3 {
  if (!x || typeof x !== "object") return false;
  const o = x as { k?: unknown; ci?: unknown; s?: unknown; ts?: unknown };
  if (o.k === "m") {
    if (positionFirst && o.ts === undefined) return false;
    if (o.ts !== undefined && o.ts !== "manager") return false;
    return true;
  }
  if (o.k === "p") {
    if (!Number.isSafeInteger(o.ci) || (o.ci as number) < 0) return false;
    if (typeof o.s !== "string") return false;
    if (positionFirst && o.ts === undefined) return false;
    if (o.ts !== undefined && o.ts !== o.s) return false;
    return true;
  }
  return false;
}

function isPickV4(x: unknown, positionFirst: boolean): x is RunTokenPickV4 {
  if (!x || typeof x !== "object") return false;
  const o = x as { k?: unknown; c?: unknown; mc?: unknown; s?: unknown; ts?: unknown };
  if (o.k === "m") {
    if (typeof o.mc !== "string" || o.mc.length === 0) return false;
    if (positionFirst && o.ts === undefined) return false;
    if (o.ts !== undefined && o.ts !== "manager") return false;
    return true;
  }
  if (o.k === "p") {
    if (typeof o.c !== "string" || o.c.length === 0) return false;
    if (typeof o.s !== "string") return false;
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
  if (!isDailyChallenge(o.ch, o.ps)) return false;
  return true;
}

function isRunTokenV3Body(x: unknown): x is RunTokenV3Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 3) return false;
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
  for (const p of o.pl) if (!isPickV3(p, positionFirst)) return false;
  if (typeof o.sv !== "string") return false;
  if (typeof o.dv !== "string") return false;
  if (typeof o.rv !== "string") return false;
  if (typeof o.ev !== "string") return false;
  if (typeof o.uv !== "string") return false;
  if (typeof o.hv !== "string") return false;
  if (o.mp !== undefined && o.mp !== 0 && o.mp !== 1) return false;
  if (!isEncodedArrangement(o.a)) return false;
  if (!isDailyChallenge(o.ch, o.ps)) return false;
  return true;
}

function isRunTokenV4Body(x: unknown): x is RunTokenV4Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.v !== 4) return false;
  if (typeof o.rid !== "string" || o.rid.length === 0 || o.rid.length > 128) return false;
  if (typeof o.fid !== "string" || o.fid.length === 0 || o.fid.length > 64) return false;
  if (typeof o.ps !== "string" || o.ps.length === 0 || o.ps.length > 256) return false;
  if (typeof o.tn !== "string") return false;
  if (o.md !== "open" && o.md !== "open_hidden") return false;
  if (!isDraftFlow(o.df)) return false;
  if (!isRatingBasis(o.rb)) return false;
  const ef = o.ef as { id?: unknown; min?: unknown; max?: unknown } | null | undefined;
  if (!ef || typeof ef !== "object") return false;
  if (!isEraPresetId(ef.id)) return false;
  const preset = ERA_PRESETS[ef.id];
  if (ef.min !== preset.min_year || ef.max !== preset.max_year) return false;
  const positionFirst = o.df === "position_first";
  if (!Array.isArray(o.pl) || o.pl.length !== 17) return false;
  for (const p of o.pl) if (!isPickV4(p, positionFirst)) return false;
  if (typeof o.sv !== "string") return false;
  if (typeof o.dv !== "string") return false;
  if (typeof o.rv !== "string") return false;
  if (typeof o.ev !== "string") return false;
  if (typeof o.uv !== "string") return false;
  if (typeof o.hv !== "string") return false;
  if (o.mp !== undefined && o.mp !== 0 && o.mp !== 1) return false;
  if (!isEncodedArrangement(o.a)) return false;
  if (!isDailyChallenge(o.ch, o.ps)) return false;
  return true;
}

function isEncodedArrangement(value: unknown): value is number[] | undefined {
  if (value === undefined) return true;
  // Count, uniqueness and range depend on the reconstructed legal pick log.
  // Keep them in replay reconciliation so semantic defects map to typed 422
  // ILLEGAL_PICK instead of being blurred into malformed-token transport.
  return Array.isArray(value) && value.every((entry) => Number.isSafeInteger(entry));
}

const DAILY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

function isDailyChallenge(
  value: unknown,
  parentSeed: unknown,
): value is RunTokenDailyChallenge | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  if (o.k !== "daily") return false;
  if (typeof o.d !== "string" || !DAILY_DATE_RE.test(o.d)) return false;
  const parsed = new Date(`${o.d}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== o.d) return false;
  return typeof o.s === "string" && o.s === parentSeed;
}

export function isNewerRunTokenVersion(value: string): boolean {
  if (typeof value !== "string" || value.length > RUN_TOKEN_MAX_LEN) return false;
  const m = /^t(\d{1,4})\./.exec(value);
  if (!m) return false;
  return Number(m[1]) > 4;
}

export function decodeRunToken(value: string): RunTokenBody | null {
  if (typeof value !== "string") return null;
  if (value.length > RUN_TOKEN_MAX_LEN) return null;
  let prefix: string;
  let v: 1 | 2 | 3 | 4;
  if (value.startsWith(RUN_TOKEN_PREFIX)) {
    prefix = RUN_TOKEN_PREFIX;
    v = 1;
  } else if (value.startsWith(RUN_TOKEN_V2_PREFIX)) {
    prefix = RUN_TOKEN_V2_PREFIX;
    v = 2;
  } else if (value.startsWith(RUN_TOKEN_V3_PREFIX)) {
    prefix = RUN_TOKEN_V3_PREFIX;
    v = 3;
  } else if (value.startsWith(RUN_TOKEN_V4_PREFIX)) {
    prefix = RUN_TOKEN_V4_PREFIX;
    v = 4;
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
  if (v === 2) return isRunTokenV2Body(parsed) ? parsed : null;
  if (v === 3) return isRunTokenV3Body(parsed) ? parsed : null;
  return isRunTokenV4Body(parsed) ? parsed : null;
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
