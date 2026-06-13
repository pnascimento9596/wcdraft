// Feature manifest loader + the feature-truth gate.
//
// `features.json` is the committed TRUTH SOURCE for every published claim.
// A template references features by `id`; `assertFeatureTruth` rejects any
// template that names a feature which is absent from the manifest or not yet
// `live`. This is the mechanism that keeps marketing honest: a feature that
// has not shipped (or was rolled back) cannot be claimed in a post, and the
// fresh-context reviewer separately cross-checks each `live` entry against the
// production site.

import { readFileSync } from "node:fs";
import { FEATURES_PATH } from "./paths.ts";

export type FeatureStatus = "live" | "planned";

export interface Feature {
  id: string;
  status: FeatureStatus;
  headline: string;
  claim: string;
  /** Short rotating phrases for result/factoid hooks. Empty for non-live. */
  hooks: string[];
  /** How a reviewer verifies this claim against the live product. */
  verify: string;
  source: string;
}

export interface FeatureManifest {
  manifest_version: string;
  updated: string;
  site_url: string;
  note: string;
  features: Feature[];
}

let cached: FeatureManifest | null = null;

export function loadFeatureManifest(): FeatureManifest {
  if (cached) return cached;
  const raw = readFileSync(FEATURES_PATH, "utf8");
  const parsed = JSON.parse(raw) as FeatureManifest;
  validateManifest(parsed);
  cached = parsed;
  return parsed;
}

/** Test seam — drop the memo so a test can load a mutated manifest. */
export function clearFeatureManifestCache(): void {
  cached = null;
}

function validateManifest(m: FeatureManifest): void {
  if (!Array.isArray(m.features) || m.features.length === 0) {
    throw new Error("features.json: `features` must be a non-empty array");
  }
  const seen = new Set<string>();
  for (const f of m.features) {
    if (!f.id || typeof f.id !== "string") {
      throw new Error("features.json: every feature needs a string `id`");
    }
    if (seen.has(f.id)) throw new Error(`features.json: duplicate feature id "${f.id}"`);
    seen.add(f.id);
    if (f.status !== "live" && f.status !== "planned") {
      throw new Error(`features.json: feature "${f.id}" has invalid status "${f.status}"`);
    }
    if (typeof f.claim !== "string" || f.claim.length === 0) {
      throw new Error(`features.json: feature "${f.id}" needs a non-empty claim`);
    }
    if (f.status === "live" && (!Array.isArray(f.hooks) || f.hooks.length === 0)) {
      throw new Error(`features.json: live feature "${f.id}" needs at least one hook`);
    }
  }
}

export function liveFeatures(): Feature[] {
  return loadFeatureManifest().features.filter((f) => f.status === "live");
}

export function featureById(id: string): Feature | undefined {
  return loadFeatureManifest().features.find((f) => f.id === id);
}

export function isLiveFeature(id: string): boolean {
  return featureById(id)?.status === "live";
}

/**
 * The feature-truth gate. Throws if `referencedFeatureIds` names a feature the
 * manifest does not list as `live`. Called by the composer on every rendered
 * post and asserted by the template test-suite for every template family.
 */
export function assertFeatureTruth(referencedFeatureIds: readonly string[], context: string): void {
  for (const id of referencedFeatureIds) {
    const f = featureById(id);
    if (!f) {
      throw new Error(
        `feature-truth violation in ${context}: unknown feature "${id}" (not in features.json)`,
      );
    }
    if (f.status !== "live") {
      throw new Error(
        `feature-truth violation in ${context}: feature "${id}" is not live (status=${f.status}); it must not be claimed in a post`,
      );
    }
  }
}
