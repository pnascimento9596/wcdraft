// Public leaderboard name validation for usernames and per-entry aliases.
//
// Owner decision for this season:
//   - users.username and leaderboard_entries.display_alias share the same
//     public grammar: 3-20 chars, [a-z0-9_], normalized to lowercase.
//   - reserved platform words are exact matches.
//   - abuse/slur stems use the original local blocklist; no external package
//     or licensed list is pulled into the intake path.
//
// The legacy export names stay in place because the submit/board code already
// treats "display name" as the public rendered string. The DB column is now
// display_alias and serializers derive display_name from alias-or-username.

import {
  BLOCKED_IMPERSONATION_TERMS,
  BLOCKED_PROFANITY_TERMS,
  BLOCKED_SLUR_TERMS,
  DISPLAY_NAME_BLOCKLIST,
} from "./display-name-blocklist";

export { DISPLAY_NAME_BLOCKLIST };

/** Inclusive code-point length bounds — match the DB CHECK. */
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 20;

export const RESERVED_PUBLIC_NAMES: readonly string[] = [
  ...BLOCKED_IMPERSONATION_TERMS,
  "api",
  "mod",
];

const BLOCKED_PUBLIC_NAME_STEMS: readonly string[] = [
  ...BLOCKED_PROFANITY_TERMS,
  ...BLOCKED_SLUR_TERMS,
];

/** Why a public name was rejected — category only, safe to log and return. */
export type DisplayNameRejection =
  | "not_a_string"
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "blocked_term";

export type DisplayNameResult =
  | { ok: true; /** Trimmed + lowercased + NFC-normalized form. */ name: string }
  | { ok: false; reason: DisplayNameRejection };

const PUBLIC_NAME_RE = /^[a-z0-9_]+$/;

/** The persisted public form used for usernames and per-entry aliases. */
export function normalizePublicName(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

/** The folded form used for reserved/stem checks. */
export function foldForBlocklist(value: string): string {
  return normalizePublicName(value).replace(/_/g, "");
}

/**
 * Validate a raw (untrusted) username or alias. Returns the normalized public
 * name on success — callers MUST persist `result.name`, not the raw input.
 */
export function validateDisplayName(raw: unknown): DisplayNameResult {
  if (typeof raw !== "string") return { ok: false, reason: "not_a_string" };
  const name = normalizePublicName(raw);
  // Code points (not UTF-16 units) — matches Postgres char_length semantics.
  const length = [...name].length;
  if (length < DISPLAY_NAME_MIN) return { ok: false, reason: "too_short" };
  if (length > DISPLAY_NAME_MAX) return { ok: false, reason: "too_long" };
  if (!PUBLIC_NAME_RE.test(name)) return { ok: false, reason: "invalid_chars" };
  const folded = foldForBlocklist(name);
  if (RESERVED_PUBLIC_NAMES.includes(name) || RESERVED_PUBLIC_NAMES.includes(folded)) {
    return { ok: false, reason: "blocked_term" };
  }
  for (const term of BLOCKED_PUBLIC_NAME_STEMS) {
    if (folded.includes(term)) return { ok: false, reason: "blocked_term" };
  }
  return { ok: true, name };
}

export const validatePublicName = validateDisplayName;
export type PublicNameRejection = DisplayNameRejection;
export type PublicNameResult = DisplayNameResult;
