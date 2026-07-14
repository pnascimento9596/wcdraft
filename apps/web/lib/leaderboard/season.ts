// F-4 U2 — season-key policy.
//
// Historical/archive seasons used the full 6-anchor version tuple. Active
// aggregate boards now use an explicit season id so rating/runtime bumps do
// not silently reset Casual/Ranked standings. The version-hash derivation is
// kept as a readback/archive helper for pre-decoupling boards.
//
// Server-only module (node:crypto) — never import from client components.

import { createHash } from "node:crypto";

import type { RunRecordVersions } from "../game/data";

/** Canonical anchor order for the hash input. NEVER reorder — the suffix of
 *  every persisted season_key depends on it. */
export const SEASON_HASH_ANCHOR_ORDER = [
  "schema_version",
  "dataset_version",
  "rating_version",
  "engine_version",
  "ruleset_version",
  "data_bundle_hash",
] as const satisfies readonly (keyof RunRecordVersions)[];

/** Hex length of the collision-proof suffix. */
export const SEASON_KEY_HASH_LEN = 8;

export const DEFAULT_LEADERBOARD_SEASON_ID = "season-2026-squad-depth" as const;

/** Completed seasons remain readable, but current-anchor writes can never land in them. */
export const ARCHIVED_LEADERBOARD_SEASON_IDS = ["season-2026-manager-attrition"] as const;

/** Public read boundary: only the live season and explicitly retained archives are addressable. */
export function isReadableLeaderboardSeasonId(value: string, currentSeasonId: string): boolean {
  return (
    value === currentSeasonId ||
    (ARCHIVED_LEADERBOARD_SEASON_IDS as readonly string[]).includes(value)
  );
}

const MAX_EXPLICIT_SEASON_ID_CHARS = 160;
const EXPLICIT_SEASON_ID_RE = /^[A-Za-z0-9._:+-]+$/u;

export function explicitSeasonKey(raw = process.env.WCDRAFT_LEADERBOARD_SEASON_ID): string {
  const value = raw?.trim();
  if (value && value.length <= MAX_EXPLICIT_SEASON_ID_CHARS && EXPLICIT_SEASON_ID_RE.test(value)) {
    return value;
  }
  return DEFAULT_LEADERBOARD_SEASON_ID;
}

/**
 * Derive the season key for a version tuple:
 * `${engine}_${rating}_${dataset}_${ruleset}_${sha256(all-6-joined-by-\n).slice(0,8)}`
 */
export function deriveSeasonKey(versions: RunRecordVersions): string {
  const joined = SEASON_HASH_ANCHOR_ORDER.map((k) => versions[k]).join("\n");
  const suffix = createHash("sha256")
    .update(joined, "utf8")
    .digest("hex")
    .slice(0, SEASON_KEY_HASH_LEN);
  return [
    versions.engine_version,
    versions.rating_version,
    versions.dataset_version,
    versions.ruleset_version,
    suffix,
  ].join("_");
}
