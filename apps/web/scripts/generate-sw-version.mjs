/*
 * Generates `apps/web/public/sw-version.js` from build-time inputs so that the
 * service worker's cache names rotate automatically on every deploy.
 *
 * Why this exists (root-cause cure for "I deploy and don't see it"):
 *   The legacy `public/sw.js` carried two hand-bumped constants
 *   (`DATASET_VERSION`, hardcoded `CACHE_NAME_SHELL`). UI-only deploys
 *   (mobile-compaction CSS, copy edits) never changed those constants,
 *   so installed PWAs kept serving the prior shell+data caches until a
 *   human remembered to bump. Data-only deploys had the same trap.
 *
 *   v3 keeps `/sw.js` stable and committed (so the worker logic is
 *   reviewable in one place) and lifts ALL version anchors into a
 *   generated `/sw-version.js` that the worker loads via
 *   `importScripts("/sw-version.js")`. Because `sw.js` registers with
 *   `updateViaCache: "none"`, browsers refetch the imported script on
 *   every SW update check — any change to `sw-version.js` produces a
 *   byte-different worker graph, triggers install + activation, and the
 *   activation handler evicts every cache outside the new
 *   `KNOWN_CACHE_NAMES` set.
 *
 * Cache-name contract (consumed by sw.js):
 *   wcdraft-data-d:<deployRev>-b:<dataRev>
 *   wcdraft-shell-d:<deployRev>
 *
 *   - deployRev rotates EVERY deploy (so UI-only edits invalidate the
 *     shell cache AND the data cache; the small extra data download is
 *     a deliberate trade for stale-cache elimination).
 *   - dataRev rotates whenever the compact bundles change (manifest
 *     `schema_version`, `dataset_version`, or any bundle sha256). It
 *     keeps the data-cache contract observable independently of the
 *     deploy revision.
 *
 * Pure helpers (deriveDataRevision, deriveCacheNames,
 * renderSwVersionScript, resolveDeployRevisionFromEnv) are exported for
 * unit tests. The CLI entrypoint (`run()`) resolves the deploy revision
 * from env/git, reads the copied manifest, and writes the version file.
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHORT_HEX_LEN = 16;

/** SHA-256 of `value`, lowercase hex, truncated to `SHORT_HEX_LEN` chars. */
function shortHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, SHORT_HEX_LEN);
}

/**
 * Pure: derive a cache-safe data revision from manifest anchors. The
 * inputs are the only things that legitimately change the bytes shipped
 * to clients, so hashing them together gives a stable, observable token
 * that rotates exactly when the data does.
 */
export function deriveDataRevision(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new TypeError("deriveDataRevision: manifest must be an object");
  }
  const schema = manifest.schema_version;
  const dataset = manifest.dataset_version;
  const bundles = manifest.bundles;
  if (typeof schema !== "string" || !schema) {
    throw new TypeError("deriveDataRevision: manifest.schema_version must be a non-empty string");
  }
  if (typeof dataset !== "string" || !dataset) {
    throw new TypeError("deriveDataRevision: manifest.dataset_version must be a non-empty string");
  }
  if (!bundles || typeof bundles !== "object") {
    throw new TypeError("deriveDataRevision: manifest.bundles must be an object");
  }
  // Iterate bundles in sorted-key order so the hash is independent of
  // manifest property order.
  const bundleEntries = Object.keys(bundles)
    .sort()
    .map((key) => {
      const sha = bundles[key]?.sha256;
      if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) {
        throw new TypeError(
          `deriveDataRevision: manifest.bundles.${key}.sha256 must be a 64-char hex SHA-256`,
        );
      }
      return `${key}:${sha}`;
    });
  const payload = [`schema:${schema}`, `dataset:${dataset}`, ...bundleEntries].join("|");
  return shortHash(payload);
}

/**
 * Pure: build the two cache names from a deploy + data revision. The
 * `d:` / `b:` prefixes make eviction logs human-readable; the
 * `wcdraft-` prefix is required by the activate-handler eviction guard.
 */
export function deriveCacheNames({ deployRevision, dataRevision }) {
  if (typeof deployRevision !== "string" || !/^[0-9a-f]+$/.test(deployRevision)) {
    throw new TypeError("deriveCacheNames: deployRevision must be a lowercase hex string");
  }
  if (typeof dataRevision !== "string" || !/^[0-9a-f]+$/.test(dataRevision)) {
    throw new TypeError("deriveCacheNames: dataRevision must be a lowercase hex string");
  }
  return Object.freeze({
    data: `wcdraft-data-d:${deployRevision}-b:${dataRevision}`,
    shell: `wcdraft-shell-d:${deployRevision}`,
  });
}

/**
 * Pure: render the `/sw-version.js` script body. Frozen object on
 * `self` so the worker can read it without copying.
 */
export function renderSwVersionScript(config) {
  const json = JSON.stringify(config, null, 2);
  return `/* AUTOGENERATED by apps/web/scripts/generate-sw-version.mjs - do not edit by hand.
 * Loaded by /sw.js via importScripts(). The committed sw.js depends on this
 * contract; if you rename fields, update sw.js in the same change. */
self.__WCDRAFT_SW_CONFIG__ = Object.freeze(${json});
`;
}

/**
 * Pure: choose the deploy revision source from an env-like object,
 * returning {raw, source}. Callers hash the raw value so the on-disk
 * cache name is always a short hex token.
 *
 * Priority:
 *   1. WCDRAFT_DEPLOY_REVISION - operator override (e.g. CI per-deploy).
 *   2. VERCEL_URL              - build-time, unique per deployment.
 *   3. VERCEL_DEPLOYMENT_ID    - usually runtime, fallback if exposed.
 *   4. VERCEL_GIT_COMMIT_SHA   - same per commit; only safe when the
 *                                CLI combines it with a build-time
 *                                epoch suffix (handled below).
 */
export function resolveDeployRevisionFromEnv(env) {
  const candidates = [
    ["WCDRAFT_DEPLOY_REVISION", env.WCDRAFT_DEPLOY_REVISION],
    ["VERCEL_URL", env.VERCEL_URL],
    ["VERCEL_DEPLOYMENT_ID", env.VERCEL_DEPLOYMENT_ID],
    ["VERCEL_GIT_COMMIT_SHA", env.VERCEL_GIT_COMMIT_SHA],
  ];
  for (const [source, raw] of candidates) {
    if (typeof raw === "string" && raw.trim().length > 0) {
      return { source, raw: raw.trim() };
    }
  }
  return null;
}

function resolveDeployRevisionForCli(env, repoRoot) {
  const fromEnv = resolveDeployRevisionFromEnv(env);
  if (fromEnv) {
    // VERCEL_GIT_COMMIT_SHA alone repeats across redeploys of the same
    // commit - combine with a build-time epoch so each build still
    // rotates. Other sources are deploy-unique on Vercel.
    if (fromEnv.source === "VERCEL_GIT_COMMIT_SHA") {
      return shortHash(`${fromEnv.source}:${fromEnv.raw}:${Date.now()}`);
    }
    return shortHash(`${fromEnv.source}:${fromEnv.raw}`);
  }
  // Local dev / CI without Vercel: prefer git HEAD + epoch so any rebuild
  // produces a fresh cache name. Falls back to a pure-epoch sentinel if
  // git is unavailable (e.g. shallow CI containers).
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (sha) return shortHash(`git:${sha}:${Date.now()}`);
  } catch {
    /* ignore - fall through to epoch sentinel */
  }
  return shortHash(`local-dev:${Date.now()}`);
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `generate-sw-version: data manifest not found at ${manifestPath}. ` +
        `Run \`packages/data/scripts/copy-web-assets.mjs\` first.`,
    );
  }
  const raw = readFileSync(manifestPath, "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`generate-sw-version: manifest at ${manifestPath} is not valid JSON`, { cause: err });
  }
  return parsed;
}

/** CLI entrypoint. Writes apps/web/public/sw-version.js. */
export function run({ webRoot, env = process.env, repoRoot, manifestOverride } = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const resolvedWebRoot = webRoot ?? join(here, "..");
  const resolvedRepoRoot = repoRoot ?? join(resolvedWebRoot, "..", "..");
  const manifestPath = join(resolvedWebRoot, "public", "data", "wcdraft", "manifest.json");
  const manifest = manifestOverride ?? readManifest(manifestPath);

  const dataRevision = deriveDataRevision(manifest);
  const deployRevision = resolveDeployRevisionForCli(env, resolvedRepoRoot);
  const cacheNames = deriveCacheNames({ deployRevision, dataRevision });

  const config = {
    deploy_revision: deployRevision,
    data_revision: dataRevision,
    schema_version: manifest.schema_version,
    dataset_version: manifest.dataset_version,
    bundle_hashes: Object.fromEntries(
      Object.keys(manifest.bundles)
        .sort()
        .map((key) => [key, manifest.bundles[key].sha256]),
    ),
    cache_names: { ...cacheNames },
  };

  const outPath = join(resolvedWebRoot, "public", "sw-version.js");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderSwVersionScript(config), "utf-8");

  console.log(
    `generate-sw-version: wrote ${outPath} ` +
      `(data=${dataRevision}, deploy=${deployRevision})`,
  );

  return { outPath, config };
}

// CLI guard: only run when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    run();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
