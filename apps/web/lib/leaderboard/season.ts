// F-4 U2 — season-key derivation (plan §3).
//
// A season IS the equivalence class of the full 6-anchor version tuple — the
// exact `versionsAgree` conjunction. The key is a pure function of the
// manifest-composed `RunRecordVersions`: human-readable prefix (four of the
// six anchors) + a collision-proof sha256 suffix over ALL six. Any anchor
// bump (including schema_version / data_bundle_hash, which are not in the
// readable prefix) changes the suffix and therefore rolls the season.
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
