/*
 * Service-worker cache-key invariants for ws-ux/mobile-compact-v3.
 *
 * v3 contract (root-cause cure for "I deploy and don't see it"):
 *   - Both the data cache AND the navigation/shell cache include a
 *     per-deploy revision, so EVERY deploy rotates both layers.
 *   - The data cache also includes a content-derived bundle revision,
 *     so a data-only regen rotates the data cache independently of
 *     the deploy revision.
 *   - The committed `apps/web/public/sw.js` carries NO version
 *     literals; it imports them from build-generated `/sw-version.js`.
 *
 * The pre-v3 incidents this guard makes impossible:
 *   - PR #38 (mobile-compact-v2) shipped UI-only changes; CACHE_NAME_SHELL
 *     stayed at "wcdraft-shell-v1" so installed PWAs kept serving the
 *     pre-compaction shell cache.
 *   - commit 5048e34 shipped the wc-perf-2.0.0 / 66-floor recal, but
 *     DATASET_VERSION did not move so the data cache stayed pinned to
 *     the pre-floor bytes.
 *   - PR #40 attempted a hand-bumped BUNDLE_REVISION on the data cache
 *     only - still left the shell cache hardcoded.
 *
 * These tests assert all three failure modes are structurally impossible
 * in v3.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  deriveCacheNames,
  deriveDataRevision,
  renderSwVersionScript,
  resolveDeployRevisionFromEnv,
} from "../../../scripts/generate-sw-version.mjs";

const REPO_ROOT = new URL("../../../../../", import.meta.url);
const SW_PATH = fileURLToPath(new URL("apps/web/public/sw.js", REPO_ROOT));
const SW_REGISTER_PATH = fileURLToPath(new URL("apps/web/components/sw-register.tsx", REPO_ROOT));
const MANIFEST_PATH = fileURLToPath(
  new URL("packages/data/src/generated/manifest.json", REPO_ROOT),
);

/* ------------------------------------------------------------------ */
/* Pure-helper invariants                                              */
/* ------------------------------------------------------------------ */

describe("deriveDataRevision", () => {
  const baseManifest = {
    schema_version: "runtime-data-1.0.0",
    dataset_version: "2026-06-04",
    bundles: {
      draft_pool: { sha256: "a".repeat(64) },
      scenario_2026: { sha256: "b".repeat(64) },
    },
  };

  it("returns a 16-hex token", () => {
    const rev = deriveDataRevision(baseManifest);
    expect(rev).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for identical inputs (independent of key order)", () => {
    const reordered = {
      bundles: {
        scenario_2026: { sha256: "b".repeat(64) },
        draft_pool: { sha256: "a".repeat(64) },
      },
      dataset_version: baseManifest.dataset_version,
      schema_version: baseManifest.schema_version,
    };
    expect(deriveDataRevision(reordered)).toBe(deriveDataRevision(baseManifest));
  });

  it("rotates when any bundle sha changes", () => {
    const mutated = {
      ...baseManifest,
      bundles: {
        ...baseManifest.bundles,
        draft_pool: { sha256: "c".repeat(64) },
      },
    };
    expect(deriveDataRevision(mutated)).not.toBe(deriveDataRevision(baseManifest));
  });

  it("rotates when schema_version or dataset_version changes", () => {
    const schemaBump = { ...baseManifest, schema_version: "runtime-data-1.0.1" };
    const datasetBump = { ...baseManifest, dataset_version: "2026-06-08" };
    expect(deriveDataRevision(schemaBump)).not.toBe(deriveDataRevision(baseManifest));
    expect(deriveDataRevision(datasetBump)).not.toBe(deriveDataRevision(baseManifest));
  });

  it("rejects malformed manifests", () => {
    expect(() =>
      deriveDataRevision(null as unknown as Parameters<typeof deriveDataRevision>[0]),
    ).toThrow();
    expect(() => deriveDataRevision({ ...baseManifest, schema_version: "" })).toThrow();
    expect(() =>
      deriveDataRevision({
        ...baseManifest,
        bundles: { draft_pool: { sha256: "not-hex" } },
      }),
    ).toThrow();
  });
});

describe("deriveCacheNames", () => {
  it("embeds BOTH the deploy and data revisions in the data cache name", () => {
    const names = deriveCacheNames({
      deployRevision: "0123456789abcdef",
      dataRevision: "fedcba9876543210",
    });
    expect(names.data).toBe("wcdraft-data-d:0123456789abcdef-b:fedcba9876543210");
  });

  it("embeds ONLY the deploy revision in the shell cache name", () => {
    const names = deriveCacheNames({
      deployRevision: "0123456789abcdef",
      dataRevision: "fedcba9876543210",
    });
    expect(names.shell).toBe("wcdraft-shell-d:0123456789abcdef");
  });

  it("rotates BOTH names when deploy revision rotates (UI-only deploy invariant)", () => {
    const before = deriveCacheNames({
      deployRevision: "a".repeat(16),
      dataRevision: "b".repeat(16),
    });
    const after = deriveCacheNames({
      deployRevision: "c".repeat(16),
      dataRevision: "b".repeat(16),
    });
    expect(after.data).not.toBe(before.data);
    expect(after.shell).not.toBe(before.shell);
  });

  it("rotates ONLY the data name when data revision rotates (data-only invariant)", () => {
    const before = deriveCacheNames({
      deployRevision: "a".repeat(16),
      dataRevision: "b".repeat(16),
    });
    const after = deriveCacheNames({
      deployRevision: "a".repeat(16),
      dataRevision: "c".repeat(16),
    });
    expect(after.data).not.toBe(before.data);
    expect(after.shell).toBe(before.shell);
  });

  it("rejects non-hex revisions", () => {
    expect(() =>
      deriveCacheNames({ deployRevision: "NOT-HEX", dataRevision: "b".repeat(16) }),
    ).toThrow();
  });
});

describe("resolveDeployRevisionFromEnv priority", () => {
  it("prefers WCDRAFT_DEPLOY_REVISION over Vercel values", () => {
    expect(
      resolveDeployRevisionFromEnv({
        WCDRAFT_DEPLOY_REVISION: "explicit",
        VERCEL_URL: "x.vercel.app",
        VERCEL_DEPLOYMENT_ID: "dep_x",
        VERCEL_GIT_COMMIT_SHA: "abc",
      }),
    ).toEqual({ source: "WCDRAFT_DEPLOY_REVISION", raw: "explicit" });
  });

  it("falls back through VERCEL_URL, VERCEL_DEPLOYMENT_ID, VERCEL_GIT_COMMIT_SHA", () => {
    expect(
      resolveDeployRevisionFromEnv({
        VERCEL_URL: "x.vercel.app",
        VERCEL_GIT_COMMIT_SHA: "abc",
      }),
    ).toEqual({ source: "VERCEL_URL", raw: "x.vercel.app" });
    expect(resolveDeployRevisionFromEnv({ VERCEL_GIT_COMMIT_SHA: "abc" })).toEqual({
      source: "VERCEL_GIT_COMMIT_SHA",
      raw: "abc",
    });
  });

  it("returns null when no source is set (CLI then uses git/epoch)", () => {
    expect(resolveDeployRevisionFromEnv({})).toBeNull();
  });
});

describe("renderSwVersionScript", () => {
  it("assigns a frozen config object on self", () => {
    const script = renderSwVersionScript({
      deploy_revision: "a".repeat(16),
      data_revision: "b".repeat(16),
      schema_version: "runtime-data-1.0.0",
      dataset_version: "2026-06-04",
      runtime_data_base_path: "/data/wcdraft/runtime-data-1.0.0",
      precache_data_urls: [
        "/data/wcdraft/runtime-data-1.0.0/manifest.json",
        "/data/wcdraft/runtime-data-1.0.0/draft-pool.compact.json.br",
        "/data/wcdraft/runtime-data-1.0.0/scenario-2026.compact.json",
      ],
      bundle_hashes: { draft_pool: "a".repeat(64), scenario_2026: "b".repeat(64) },
      cache_names: {
        data: "wcdraft-data-d:aaaaaaaaaaaaaaaa-b:bbbbbbbbbbbbbbbb",
        shell: "wcdraft-shell-d:aaaaaaaaaaaaaaaa",
      },
    });
    expect(script).toContain("self.__WCDRAFT_SW_CONFIG__");
    expect(script).toContain("Object.freeze(");
    expect(script).toContain("wcdraft-data-d:aaaaaaaaaaaaaaaa-b:bbbbbbbbbbbbbbbb");
    expect(script).toContain("wcdraft-shell-d:aaaaaaaaaaaaaaaa");
    expect(script).toContain("/data/wcdraft/runtime-data-1.0.0/draft-pool.compact.json.br");
  });
});

/* ------------------------------------------------------------------ */
/* Committed-source invariants (sw.js & sw-register.tsx)               */
/* ------------------------------------------------------------------ */

describe("committed sw.js source contract", () => {
  const swSource = readFileSync(SW_PATH, "utf-8");

  it("imports its cache-name config from /sw-version.js", () => {
    expect(swSource).toContain('importScripts("/sw-version.js")');
    expect(swSource).toContain("self.__WCDRAFT_SW_CONFIG__");
  });

  it("declares NO hardcoded cache-version literals", () => {
    // Hardcoded shell cache from v1/v2 - the exact bug v3 cures.
    expect(swSource).not.toMatch(/wcdraft-shell-v1/);
    // Hand-bumped data anchors from the legacy pattern.
    expect(swSource).not.toMatch(/const\s+SCHEMA_VERSION\s*=/);
    expect(swSource).not.toMatch(/const\s+DATASET_VERSION\s*=/);
    expect(swSource).not.toMatch(/const\s+BUNDLE_REVISION\s*=/);
    // Legacy manual data-cache name template.
    expect(swSource).not.toMatch(/`wcdraft-data-\$\{SCHEMA_VERSION\}/);
  });

  it("derives the live cache names from SW_CONFIG (not literals)", () => {
    expect(swSource).toContain("SW_CONFIG.cache_names.data");
    expect(swSource).toContain("SW_CONFIG.cache_names.shell");
  });

  it("pre-caches generated versioned data URLs and not the raw draft-pool path", () => {
    expect(swSource).toContain("SW_CONFIG.precache_data_urls");
    expect(swSource).toContain("const PRECACHE_DATA_URLS = SW_CONFIG.precache_data_urls");
    expect(swSource).not.toContain("`${DATA_PREFIX}draft-pool.compact.json`");
    expect(swSource).not.toContain('"/data/wcdraft/draft-pool.compact.json"');
  });

  it("throws on missing/malformed config so a bad worker never installs", () => {
    expect(swSource).toMatch(/throw new Error\([^)]*WCDRAFT_SW_CONFIG/);
  });
});

describe("committed sw-register.tsx source contract", () => {
  const registerSource = readFileSync(SW_REGISTER_PATH, "utf-8");

  it('registers with `updateViaCache: "none"` so /sw-version.js bypasses HTTP cache', () => {
    // Required for importScripts() update checks to refetch the version
    // file on every SW update. Without this, browsers may serve the
    // imported script from HTTP cache and never trigger a new install.
    expect(registerSource).toMatch(/updateViaCache:\s*"none"/);
  });
});

/* ------------------------------------------------------------------ */
/* Live manifest integration                                           */
/* ------------------------------------------------------------------ */

describe("live manifest derivation", () => {
  it("derives a 16-hex data revision from the current generated manifest", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const rev = deriveDataRevision(manifest);
    expect(rev).toMatch(/^[0-9a-f]{16}$/);
    const names = deriveCacheNames({ deployRevision: "f".repeat(16), dataRevision: rev });
    expect(names.data).toMatch(/^wcdraft-data-d:f{16}-b:[0-9a-f]{16}$/);
    expect(names.shell).toBe("wcdraft-shell-d:" + "f".repeat(16));
  });
});
