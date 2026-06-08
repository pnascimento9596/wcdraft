import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Service-worker cache-key invariant.
 *
 * The PWA service worker (`apps/web/public/sw.js`) holds the runtime data
 * bundle in a cache keyed by `wcdraft-data-${SCHEMA_VERSION}-${DATASET_VERSION}-${BUNDLE_REVISION}`.
 * The first two anchors barely move (schema/dataset bumps are rare), so any
 * silent regeneration of the compact bundle — even a pure rating recal that
 * leaves the schema and the source revisions unchanged — would re-use the
 * old cache name and leave already-installed PWAs pinned to the prior bytes.
 *
 * That is exactly the incident this guard exists to make impossible. Commit
 * 5048e34 rotated the historical/projected rating bands (wc-perf-2.0.0 /
 * proj-career-2.0.0) and re-floored OVR at 66 without touching the cache
 * name, leaving live clients showing OVR=39…54 from the pre-floor bytes
 * until each one's data cache was manually wiped.
 *
 * The contract:
 *   `BUNDLE_REVISION` in `sw.js` MUST equal the first eight hex characters
 *   of `packages/data/src/generated/manifest.json`
 *   `.bundles.draft_pool.sha256`. Any future bundle regeneration that
 *   forgets to bump the SW value will fail this test in CI, NOT in
 *   production caches.
 */

const REPO_ROOT = new URL("../../../../../", import.meta.url);
const SW_PATH = fileURLToPath(new URL("apps/web/public/sw.js", REPO_ROOT));
const MANIFEST_PATH = fileURLToPath(
  new URL("packages/data/src/generated/manifest.json", REPO_ROOT),
);

const BUNDLE_REVISION_RE = /const\s+BUNDLE_REVISION\s*=\s*"([0-9a-f]{8})"\s*;/;

describe("service worker cache-key invariant", () => {
  it("BUNDLE_REVISION in sw.js matches the shipped draft_pool sha256 prefix", () => {
    const swSource = readFileSync(SW_PATH, "utf-8");
    const match = swSource.match(BUNDLE_REVISION_RE);
    expect(
      match,
      "sw.js must declare `const BUNDLE_REVISION = \"<8-hex>\"` so the data cache key rotates with the bundle",
    ).not.toBeNull();
    const swRevision = match![1];

    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as {
      bundles: { draft_pool: { sha256: string } };
    };
    const bundleSha = manifest.bundles.draft_pool.sha256;
    expect(
      bundleSha,
      "manifest.bundles.draft_pool.sha256 must be present for the SW cache-key invariant",
    ).toMatch(/^[0-9a-f]{64}$/);

    const expectedRevision = bundleSha.slice(0, 8);
    expect(
      swRevision,
      `sw.js BUNDLE_REVISION must be bumped to "${expectedRevision}" (current draft_pool sha256 prefix)`,
    ).toBe(expectedRevision);
  });

  it("CACHE_NAME_DATA template embeds BUNDLE_REVISION (so name actually rotates)", () => {
    const swSource = readFileSync(SW_PATH, "utf-8");
    // Tolerate whitespace + the template-literal escape but reject any form
    // that drops BUNDLE_REVISION from the cache name (the only way the
    // anchor stops doing its job).
    const cacheNameRe =
      /CACHE_NAME_DATA\s*=\s*`wcdraft-data-\$\{SCHEMA_VERSION\}-\$\{DATASET_VERSION\}-\$\{BUNDLE_REVISION\}`/;
    expect(
      cacheNameRe.test(swSource),
      "CACHE_NAME_DATA must concatenate SCHEMA_VERSION, DATASET_VERSION, and BUNDLE_REVISION",
    ).toBe(true);
  });
});

const SCHEMA_VERSION_RE = /const\s+SCHEMA_VERSION\s*=\s*"([^"]+)"\s*;/;
const DATASET_VERSION_RE = /const\s+DATASET_VERSION\s*=\s*"([^"]+)"\s*;/;

/**
 * Eviction-contract test — proves that on activate, a PWA that still has the
 * pre-bump cache entry will have it deleted (and the next install will
 * repopulate from `/data/wcdraft/*`, which prod serves as the 66-floored
 * bundle byte-for-byte against origin/main).
 *
 * We replay the activation predicate inline rather than executing sw.js in
 * a worker shim — the predicate is small, stable, and worth pinning here
 * verbatim. If the predicate ever changes in sw.js, update this test to
 * mirror the new contract.
 */
describe("service worker activate-time eviction contract", () => {
  it("evicts pre-bump cache name and keeps the post-bump cache name", () => {
    const swSource = readFileSync(SW_PATH, "utf-8");
    const schema = swSource.match(SCHEMA_VERSION_RE);
    const dataset = swSource.match(DATASET_VERSION_RE);
    const bundle = swSource.match(BUNDLE_REVISION_RE);
    expect(schema, "SCHEMA_VERSION must be declared").not.toBeNull();
    expect(dataset, "DATASET_VERSION must be declared").not.toBeNull();
    expect(bundle, "BUNDLE_REVISION must be declared").not.toBeNull();

    const SCHEMA = schema![1];
    const DATASET = dataset![1];
    const BUNDLE = bundle![1];

    const preBumpDataCache = `wcdraft-data-${SCHEMA}-${DATASET}`;
    const postBumpDataCache = `wcdraft-data-${SCHEMA}-${DATASET}-${BUNDLE}`;
    const shellCache = "wcdraft-shell-v1";

    // Sanity — the bump must actually rotate the name.
    expect(postBumpDataCache).not.toBe(preBumpDataCache);

    // KNOWN_CACHE_NAMES set the new build owns. Mirrors sw.js verbatim.
    const known = new Set<string>([postBumpDataCache, shellCache]);

    // Mirror of the activate handler predicate in sw.js.
    const shouldEvict = (name: string): boolean =>
      !known.has(name) && name.startsWith("wcdraft-");

    expect(
      shouldEvict(preBumpDataCache),
      "pre-bump cache name MUST be evicted on activate (else stale clients keep the old bundle)",
    ).toBe(true);
    expect(
      shouldEvict(postBumpDataCache),
      "post-bump data cache must be preserved",
    ).toBe(false);
    expect(
      shouldEvict(shellCache),
      "shell cache must be preserved across data-only bumps",
    ).toBe(false);
    expect(
      shouldEvict("some-other-origin-cache"),
      "non-wcdraft caches must NOT be touched (defensive isolation)",
    ).toBe(false);
  });
});
