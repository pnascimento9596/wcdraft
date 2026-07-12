import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  deriveCacheNames,
  deriveDataRevision,
  derivePrecacheDataEntries,
  renderSwVersionScript,
  resolveDeployRevisionFromEnv,
  run,
} from "../../../scripts/generate-sw-version.mjs";

const REPO_ROOT = new URL("../../../../../", import.meta.url);
const SW_PATH = fileURLToPath(new URL("apps/web/public/sw.js", REPO_ROOT));
const SW_REGISTER_PATH = fileURLToPath(new URL("apps/web/components/sw-register.tsx", REPO_ROOT));
const SW_COORDINATOR_PATH = fileURLToPath(new URL("apps/web/lib/service-worker.ts", REPO_ROOT));
const MANIFEST_PATH = fileURLToPath(
  new URL("packages/data/src/generated/manifest.json", REPO_ROOT),
);

function fingerprint(path: string, rawHex: string, compressedHex: string) {
  return {
    path,
    sha256: rawHex.repeat(64),
    raw_sha256: rawHex.repeat(64),
    bytes: 100,
    compressed_sha256: compressedHex.repeat(64),
    compressed_bytes: 50,
    bytes_brotli: 50,
    brotli_impl_version: "1.1.0",
    options: { quality: 11 as const, mode: "text" as const, size_hint: 100 },
  };
}

const baseManifest = {
  schema_version: "runtime-data-1.0.0",
  dataset_version: "2026-06-04",
  bundles: {
    daily_seed_salt_map: fingerprint("daily-seed-salt-map.compact.json", "1", "2"),
    draft_pool: fingerprint("draft-pool.compact.json", "3", "4"),
    scenario_2026: fingerprint("scenario-2026.compact.json", "5", "6"),
    score_distribution: fingerprint("score-distribution.compact.json", "7", "8"),
  },
};

describe("manifest-derived service-worker data config", () => {
  it("derives manifest plus every current bundle, with the draft pool using canonical Brotli", () => {
    const entries = derivePrecacheDataEntries(baseManifest);
    expect(entries.map((entry) => entry.key)).toEqual([
      "manifest",
      "daily_seed_salt_map",
      "draft_pool",
      "scenario_2026",
      "score_distribution",
    ]);
    expect(entries.find((entry) => entry.key === "draft_pool")).toMatchObject({
      url: "/data/wcdraft/runtime-data-1.0.0/draft-pool.compact.json.br",
      encoding: "brotli",
      expected_bytes: 100,
      expected_sha256: "3".repeat(64),
      transport_bytes: 50,
      transport_sha256: "4".repeat(64),
    });
    expect(entries.find((entry) => entry.key === "daily_seed_salt_map")?.url).toBe(
      "/data/wcdraft/runtime-data-1.0.0/daily-seed-salt-map.compact.json",
    );
    expect(entries.find((entry) => entry.key === "score_distribution")?.url).toBe(
      "/data/wcdraft/runtime-data-1.0.0/score-distribution.compact.json",
    );
  });

  it("automatically includes a future manifest bundle instead of relying on a URL list", () => {
    const manifest = {
      ...baseManifest,
      bundles: {
        ...baseManifest.bundles,
        tournament_labels: fingerprint("tournament-labels.compact.json", "9", "a"),
      },
    };
    const entry = derivePrecacheDataEntries(manifest).find(
      (candidate) => candidate.key === "tournament_labels",
    );
    expect(entry).toMatchObject({
      url: "/data/wcdraft/runtime-data-1.0.0/tournament-labels.compact.json",
      encoding: "identity",
      expected_sha256: "9".repeat(64),
      transport_sha256: "9".repeat(64),
    });
  });

  it("fails closed on missing required bundles, unsafe paths, or malformed compressed metadata", () => {
    const missingBundle = {
      daily_seed_salt_map: baseManifest.bundles.daily_seed_salt_map,
      draft_pool: baseManifest.bundles.draft_pool,
      scenario_2026: baseManifest.bundles.scenario_2026,
    };
    expect(() => derivePrecacheDataEntries({ ...baseManifest, bundles: missingBundle })).toThrow(
      /score_distribution is missing/u,
    );

    expect(() =>
      derivePrecacheDataEntries({
        ...baseManifest,
        bundles: {
          ...baseManifest.bundles,
          scenario_2026: {
            ...baseManifest.bundles.scenario_2026,
            path: "../scenario-2026.compact.json",
          },
        },
      }),
    ).toThrow(/scenario_2026 must use/u);

    expect(() =>
      derivePrecacheDataEntries({
        ...baseManifest,
        bundles: {
          ...baseManifest.bundles,
          draft_pool: {
            ...baseManifest.bundles.draft_pool,
            compressed_sha256: "not-a-sha",
          },
        },
      }),
    ).toThrow(/compressed_sha256/u);
  });

  it("rejects manifest bytes that do not describe the supplied object", () => {
    expect(() =>
      derivePrecacheDataEntries(baseManifest, {
        manifestBytes: JSON.stringify({ ...baseManifest, dataset_version: "different" }),
      }),
    ).toThrow(/do not describe/u);
  });
});

describe("service-worker generator manifest path", () => {
  it("binds the current source manifest to its exact versioned copied bytes", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "wcdraft-sw-version-path-"));
    const webRoot = join(repoRoot, "apps", "web");
    const sourceDir = join(repoRoot, "packages", "data", "src", "generated");
    const copiedDir = join(webRoot, "public", "data", "wcdraft", baseManifest.schema_version);
    const legacyRoot = join(webRoot, "public", "data", "wcdraft");
    const manifestBytes = `${JSON.stringify(baseManifest, null, 2)}\n`;
    await mkdir(sourceDir, { recursive: true });
    await mkdir(copiedDir, { recursive: true });
    await writeFile(join(sourceDir, "manifest.json"), manifestBytes);
    await writeFile(join(copiedDir, "manifest.json"), manifestBytes);
    await writeFile(join(legacyRoot, "manifest.json"), "legacy root must not be read");

    const generated = run({
      webRoot,
      repoRoot,
      env: { WCDRAFT_DEPLOY_REVISION: "c5-versioned-manifest-test" },
    });
    expect(generated.config.schema_version).toBe(baseManifest.schema_version);
    const firstOutput = await readFile(generated.outPath, "utf8");
    expect(firstOutput).toContain(`/data/wcdraft/${baseManifest.schema_version}/manifest.json`);

    await writeFile(
      join(copiedDir, "manifest.json"),
      JSON.stringify({ ...baseManifest, dataset_version: "copied-drift" }),
    );
    expect(() =>
      run({
        webRoot,
        repoRoot,
        env: { WCDRAFT_DEPLOY_REVISION: "c5-versioned-manifest-test" },
      }),
    ).toThrow(/copied manifest .* differs from current source/u);
    await expect(readFile(generated.outPath, "utf8")).resolves.toBe(firstOutput);
  });
});

describe("deriveDataRevision", () => {
  it("is deterministic and independent of object key order", () => {
    const reordered = {
      bundles: {
        score_distribution: baseManifest.bundles.score_distribution,
        scenario_2026: baseManifest.bundles.scenario_2026,
        draft_pool: baseManifest.bundles.draft_pool,
        daily_seed_salt_map: baseManifest.bundles.daily_seed_salt_map,
      },
      dataset_version: baseManifest.dataset_version,
      schema_version: baseManifest.schema_version,
    };
    expect(deriveDataRevision(reordered)).toBe(deriveDataRevision(baseManifest));
    expect(deriveDataRevision(baseManifest)).toMatch(/^[0-9a-f]{16}$/u);
  });

  it("rotates when the served compressed draft bytes change", () => {
    const changed = {
      ...baseManifest,
      bundles: {
        ...baseManifest.bundles,
        draft_pool: {
          ...baseManifest.bundles.draft_pool,
          compressed_sha256: "f".repeat(64),
        },
      },
    };
    expect(deriveDataRevision(changed)).not.toBe(deriveDataRevision(baseManifest));
  });

  it("rotates when exact manifest bytes change even if parsed data is equivalent", () => {
    const compact = JSON.stringify(baseManifest);
    const pretty = `${JSON.stringify(baseManifest, null, 2)}\n`;
    expect(deriveDataRevision(baseManifest, { manifestBytes: compact })).not.toBe(
      deriveDataRevision(baseManifest, { manifestBytes: pretty }),
    );
  });
});

describe("deriveCacheNames", () => {
  it("keeps the data cache stable for UI-only deploys and rotates only the shell", () => {
    const before = deriveCacheNames({
      deployRevision: "a".repeat(16),
      dataRevision: "b".repeat(16),
    });
    const after = deriveCacheNames({
      deployRevision: "c".repeat(16),
      dataRevision: "b".repeat(16),
    });
    expect(before.data).toBe("wcdraft-data-b:" + "b".repeat(16));
    expect(after.data).toBe(before.data);
    expect(after.shell).not.toBe(before.shell);
  });

  it("rotates only the data cache when manifest-derived data changes", () => {
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

describe("version source and script rendering", () => {
  it("prefers the explicit deploy revision and falls back through Vercel inputs", () => {
    expect(
      resolveDeployRevisionFromEnv({
        WCDRAFT_DEPLOY_REVISION: "explicit",
        VERCEL_URL: "x.vercel.app",
      }),
    ).toEqual({ source: "WCDRAFT_DEPLOY_REVISION", raw: "explicit" });
    expect(resolveDeployRevisionFromEnv({ VERCEL_GIT_COMMIT_SHA: "abc" })).toEqual({
      source: "VERCEL_GIT_COMMIT_SHA",
      raw: "abc",
    });
    expect(resolveDeployRevisionFromEnv({})).toBeNull();
  });

  it("renders the complete config as a frozen worker global", () => {
    const entries = derivePrecacheDataEntries(baseManifest);
    const script = renderSwVersionScript({
      deploy_revision: "a".repeat(16),
      data_revision: "b".repeat(16),
      schema_version: baseManifest.schema_version,
      dataset_version: baseManifest.dataset_version,
      runtime_data_base_path: "/data/wcdraft/runtime-data-1.0.0",
      required_bundle_keys: Object.keys(baseManifest.bundles).sort(),
      precache_data_entries: entries,
      bundle_hashes: Object.fromEntries(
        Object.entries(baseManifest.bundles).map(([key, value]) => [
          key,
          {
            raw_sha256: value.raw_sha256,
            raw_bytes: value.bytes,
            compressed_sha256: value.compressed_sha256,
            compressed_bytes: value.compressed_bytes,
          },
        ]),
      ),
      cache_names: {
        data: "wcdraft-data-b:bbbbbbbbbbbbbbbb",
        shell: "wcdraft-shell-d:aaaaaaaaaaaaaaaa",
      },
    });
    expect(script).toContain("self.__WCDRAFT_SW_CONFIG__");
    expect(script).toContain("Object.freeze(");
    expect(script).toContain("daily-seed-salt-map.compact.json");
    expect(script).toContain("score-distribution.compact.json");
    expect(script).toContain("draft-pool.compact.json.br");
  });
});

describe("committed service-worker source contract", () => {
  const swSource = readFileSync(SW_PATH, "utf8");
  const registerSource = readFileSync(SW_REGISTER_PATH, "utf8");
  const coordinatorSource = readFileSync(SW_COORDINATOR_PATH, "utf8");

  it("imports generated config and has no hard-coded cache revision", () => {
    expect(swSource).toContain('importScripts("/sw-version.js")');
    expect(swSource).toContain("self.__WCDRAFT_SW_CONFIG__");
    expect(swSource).not.toMatch(/wcdraft-shell-v1/u);
    expect(swSource).not.toMatch(/const\s+SCHEMA_VERSION\s*=/u);
  });

  it("uses manifest-derived entries, strict install settlement, and pre-delete activation proof", () => {
    expect(swSource).toContain("config.precache_data_entries");
    expect(swSource).toContain("Promise.allSettled");
    expect(swSource).toContain("await verifyRequiredCache();");
    expect(
      swSource.indexOf("await verifyRequiredCache();", swSource.indexOf('"activate"')),
    ).toBeLessThan(
      swSource.indexOf("const names = await caches.keys();", swSource.indexOf('"activate"')),
    );
    expect(swSource).toContain("IN_FLIGHT_REQUIRED_FILLS");
  });

  it('preserves `updateViaCache: "none"`', () => {
    expect(`${registerSource}\n${coordinatorSource}`).toMatch(/updateViaCache:\s*"none"/u);
  });

  it("defers an uncontrolled page's pool request until controller handoff with a timeout", () => {
    expect(coordinatorSource).toContain('addEventListener("controllerchange"');
    expect(coordinatorSource).toContain('finish("timed-out")');
    expect(swSource).toContain("await self.clients.claim()");
  });
});

describe("live manifest integration", () => {
  it("derives the exact five current required resources from C1 fingerprint metadata", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    const entries = derivePrecacheDataEntries(manifest);
    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry.key)).toEqual([
      "manifest",
      "daily_seed_salt_map",
      "draft_pool",
      "scenario_2026",
      "score_distribution",
    ]);
    expect(entries.find((entry) => entry.key === "draft_pool")?.expected_sha256).toBe(
      manifest.bundles.draft_pool.raw_sha256,
    );
    expect(entries.find((entry) => entry.key === "draft_pool")?.transport_sha256).toBe(
      manifest.bundles.draft_pool.compressed_sha256,
    );
    expect(deriveDataRevision(manifest)).toMatch(/^[0-9a-f]{16}$/u);
  });
});
