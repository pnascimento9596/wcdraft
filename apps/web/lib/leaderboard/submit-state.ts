// F-4 U4 — submit-affordance state (pure mapping + best-effort local memory).
//
// `outcomeFromResponse` is the single place a wire response becomes a UI
// phase: every phase string maps 1:1 to a server response (plan §6) — no
// invented intermediate states, no optimistic insertion. The localStorage
// helpers are best-effort conveniences (last-used name, submitted-token
// memory); when storage is unavailable they silently no-op — the server's
// duplicate handling stays the source of truth.

import { submitStatusCopy, NAME_HINT, type SubmitStatusCopy } from "./submit-copy";
import type { DisplayNameRejection } from "./display-name";

// ─── Phases ──────────────────────────────────────────────────────────────────

export type SubmitPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  /** 201 — inserted; rank is the identity's board rank from the same DB snapshot. */
  | { readonly kind: "accepted"; readonly rank: number | null; readonly score: number }
  /** 200 — this exact run is already on the board for this identity. */
  | { readonly kind: "duplicate"; readonly rank: number | null; readonly score: number }
  /** Typed server rejection — copy via the single-sourced status table. */
  | {
      readonly kind: "rejected";
      readonly code: string;
      readonly copy: SubmitStatusCopy;
      readonly nameHint: string | null;
      /** Set iff code === RATE_LIMITED and the header parsed. */
      readonly retryAfterSeconds: number | null;
    }
  /** Transport failure — the request never produced a server verdict. */
  | { readonly kind: "unreachable" }
  /** Local memory: this token was submitted earlier from this device. */
  | { readonly kind: "submitted-earlier" };

export const IDLE: SubmitPhase = { kind: "idle" };

// ─── Wire → phase ────────────────────────────────────────────────────────────

interface SuccessBodyShape {
  readonly duplicate?: unknown;
  readonly rank?: unknown;
  readonly entry?: { readonly verified_score?: unknown };
}

interface ErrorBodyShape {
  readonly error?: unknown;
  readonly name_reason?: unknown;
}

function rankOf(body: SuccessBodyShape): number | null {
  return typeof body.rank === "number" ? body.rank : null;
}

function scoreOf(body: SuccessBodyShape): number {
  const s = body.entry?.verified_score;
  return typeof s === "number" ? s : Number.NaN;
}

/**
 * Map one settled submit response to a phase. `body` is the parsed JSON
 * (null when the body wasn't JSON); `retryAfterHeader` is the raw
 * Retry-After value, if any.
 */
export function outcomeFromResponse(
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
): SubmitPhase {
  const obj =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as SuccessBodyShape & ErrorBodyShape)
      : null;

  if (status === 201 && obj) {
    return { kind: "accepted", rank: rankOf(obj), score: scoreOf(obj) };
  }
  if (status === 200 && obj) {
    return { kind: "duplicate", rank: rankOf(obj), score: scoreOf(obj) };
  }

  const code = obj && typeof obj.error === "string" ? obj.error : "INTERNAL_ERROR";
  const nameHint =
    code === "INVALID_NAME" && obj && typeof obj.name_reason === "string"
      ? (NAME_HINT[obj.name_reason as DisplayNameRejection] ?? null)
      : null;
  let retryAfterSeconds: number | null = null;
  if (code === "RATE_LIMITED" && retryAfterHeader !== null) {
    const n = Number(retryAfterHeader);
    if (Number.isFinite(n) && n >= 0) retryAfterSeconds = Math.ceil(n);
  }
  return { kind: "rejected", code, copy: submitStatusCopy(code), nameHint, retryAfterSeconds };
}

// ─── Local memory (best-effort; never load-bearing) ──────────────────────────

export const LAST_NAME_KEY = "wcdraft:leaderboard:name:v1";
export const SUBMITTED_TOKENS_KEY = "wcdraft:leaderboard:submitted:v1";
const SUBMITTED_CAP = 50;

/** FNV-1a over the token string — a compact local dedupe key (the full
 *  token is ≤8 KB; storing 50 of those would bloat localStorage). */
export function tokenMemoryKey(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${token.length.toString(36)}`;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const s = window.localStorage;
    const probe = "wcdraft:leaderboard:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function loadLastDisplayName(): string {
  const s = storage();
  return s?.getItem(LAST_NAME_KEY) ?? "";
}

export function saveLastDisplayName(name: string): void {
  storage()?.setItem(LAST_NAME_KEY, name);
}

function loadSubmittedKeys(s: Storage): string[] {
  try {
    const raw = s.getItem(SUBMITTED_TOKENS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function wasTokenSubmitted(token: string): boolean {
  const s = storage();
  if (s === null) return false;
  return loadSubmittedKeys(s).includes(tokenMemoryKey(token));
}

export function rememberTokenSubmitted(token: string): void {
  const s = storage();
  if (s === null) return;
  const key = tokenMemoryKey(token);
  const keys = loadSubmittedKeys(s).filter((k) => k !== key);
  keys.push(key);
  s.setItem(SUBMITTED_TOKENS_KEY, JSON.stringify(keys.slice(-SUBMITTED_CAP)));
}
