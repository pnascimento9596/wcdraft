// F-4 U2 — display-name validity rules (plan §5.1, pipeline step 5).
//
// Pure and deterministic: no I/O, no DB, no clock. Enforced server-side at
// submit time; the DB CHECK (char_length BETWEEN 3 AND 24, migration 0004)
// is the structural backstop, this module is the full rule set.
//
// Rule order (plan §5.1): trim → NFC-normalize → length 3–24 → allowlist
// `[\p{L}\p{N} _.\-]` (excludes URLs-with-scheme, control/zero-width chars) →
// no leading/trailing separators → case-folded blocklist check.
//
// The rejected value is NEVER echoed back in `reason` strings — callers log
// the category only (plan: no echo of the bad value beyond a hash).

import { DISPLAY_NAME_BLOCKLIST } from "./display-name-blocklist";

export { DISPLAY_NAME_BLOCKLIST };

/** Inclusive code-point length bounds — match the DB CHECK (char_length). */
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 24;

/** Why a display name was rejected — category only, safe to log and return. */
export type DisplayNameRejection =
  | "not_a_string"
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "edge_separator"
  | "blocked_term";

export type DisplayNameResult =
  | { ok: true; /** Trimmed + NFC-normalized form — what gets persisted. */ name: string }
  | { ok: false; reason: DisplayNameRejection };

const ALLOWED_CHARS = /^[\p{L}\p{N} _.-]+$/u;
const STARTS_ALNUM = /^[\p{L}\p{N}]/u;
const ENDS_ALNUM = /[\p{L}\p{N}]$/u;
const SEPARATORS = /[ _.-]/gu;

/**
 * The fold the blocklist is matched against: case-folded, separators
 * stripped (defeats `a.d.m.i.n` spacing tricks at the cost of rare false
 * positives — accepted v1 posture, see display-name-blocklist.ts). Exported
 * so the blocklist hygiene test can assert every term is already in this
 * form — a term that isn't can never match.
 */
export function foldForBlocklist(value: string): string {
  return value.toLowerCase().replace(SEPARATORS, "");
}

/**
 * Validate a raw (untrusted) display name. Returns the normalized name on
 * success — callers MUST persist `result.name`, not the raw input.
 */
export function validateDisplayName(raw: unknown): DisplayNameResult {
  if (typeof raw !== "string") return { ok: false, reason: "not_a_string" };
  const name = raw.trim().normalize("NFC");
  // Code points (not UTF-16 units) — matches Postgres char_length semantics.
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN) return { ok: false, reason: "too_short" };
  if (length > DISPLAY_NAME_MAX) return { ok: false, reason: "too_long" };
  if (!ALLOWED_CHARS.test(name)) return { ok: false, reason: "invalid_chars" };
  if (!STARTS_ALNUM.test(name) || !ENDS_ALNUM.test(name)) {
    return { ok: false, reason: "edge_separator" };
  }
  const folded = foldForBlocklist(name);
  for (const term of DISPLAY_NAME_BLOCKLIST) {
    if (folded.includes(term)) return { ok: false, reason: "blocked_term" };
  }
  return { ok: true, name };
}
