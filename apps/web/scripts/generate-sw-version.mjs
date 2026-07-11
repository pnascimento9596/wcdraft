/*
 * Generates `apps/web/public/sw-version.js`, the fail-closed configuration
 * consumed by the committed service worker.
 *
 * Cache identity is intentionally split:
 *   - `wcdraft-shell-d:<deployRev>` rotates for every deploy.
 *   - `wcdraft-data-b:<dataRev>` depends only on the manifest and the exact
 *     runtime bytes the browser consumes. A UI-only deploy therefore reuses
 *     the complete data cache, while any runtime-data change rotates it.
 *
 * The precache set is derived by iterating every manifest bundle. The four
 * runtime-critical bundles are also pinned by key/path so a malformed or
 * partially generated manifest fails the build instead of silently shipping
 * an incomplete offline worker. `draft_pool` is delivered as its canonical
 * Brotli artifact; the other bundles use the raw paths consumed by the client
 * loaders. All raw and compressed fingerprints are validated before output.
 */

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SHORT_HEX_LEN = 16;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const SAFE_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]*$/u;
const SAFE_BUNDLE_KEY_RE = /^[a-z0-9][a-z0-9_]*$/u;

export const REQUIRED_RUNTIME_BUNDLE_PATHS = Object.freeze({
  daily_seed_salt_map: "daily-seed-salt-map.compact.json",
  draft_pool: "draft-pool.compact.json",
  scenario_2026: "scenario-2026.compact.json",
  score_distribution: "score-distribution.compact.json",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** SHA-256 of `value`, lowercase hex, truncated to `SHORT_HEX_LEN` chars. */
function shortHash(value) {
  return sha256(String(value)).slice(0, SHORT_HEX_LEN);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeManifestBytes(manifest, manifestBytes) {
  if (manifestBytes === undefined) return Buffer.from(stableJson(manifest), "utf8");
  const bytes = Buffer.isBuffer(manifestBytes)
    ? manifestBytes
    : Buffer.from(manifestBytes instanceof Uint8Array ? manifestBytes : String(manifestBytes));
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    throw new TypeError("derivePrecacheDataEntries: manifestBytes must contain valid JSON", {
      cause: err,
    });
  }
  if (stableJson(parsed) !== stableJson(manifest)) {
    throw new TypeError(
      "derivePrecacheDataEntries: manifestBytes do not describe the supplied manifest",
    );
  }
  return bytes;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new TypeError(`${label} must be a lowercase 64-char SHA-256`);
  }
}

function validateBundleFingerprint(key, bundle) {
  const label = `manifest.bundles.${key}`;
  if (!SAFE_BUNDLE_KEY_RE.test(key) || !isRecord(bundle)) {
    throw new TypeError(`${label} must be a safely named fingerprint object`);
  }
  if (
    typeof bundle.path !== "string" ||
    !bundle.path.endsWith(".compact.json") ||
    bundle.path.split("/").some((segment) => !SAFE_SEGMENT_RE.test(segment)) ||
    bundle.path.includes("..") ||
    bundle.path.includes("\\") ||
    bundle.path.includes("?") ||
    bundle.path.includes("#")
  ) {
    throw new TypeError(`${label}.path must be a safe relative *.compact.json path`);
  }
  requireSha256(bundle.sha256, `${label}.sha256`);
  requireSha256(bundle.raw_sha256, `${label}.raw_sha256`);
  if (bundle.sha256 !== bundle.raw_sha256) {
    throw new TypeError(`${label}.sha256 must equal raw_sha256`);
  }
  requirePositiveInteger(bundle.bytes, `${label}.bytes`);
  requireSha256(bundle.compressed_sha256, `${label}.compressed_sha256`);
  requirePositiveInteger(bundle.compressed_bytes, `${label}.compressed_bytes`);
  if (bundle.bytes_brotli !== bundle.compressed_bytes) {
    throw new TypeError(`${label}.bytes_brotli must equal compressed_bytes`);
  }
  if (typeof bundle.brotli_impl_version !== "string" || bundle.brotli_impl_version.length === 0) {
    throw new TypeError(`${label}.brotli_impl_version must be a non-empty string`);
  }
  if (
    !isRecord(bundle.options) ||
    bundle.options.quality !== 11 ||
    bundle.options.mode !== "text" ||
    bundle.options.size_hint !== bundle.bytes
  ) {
    throw new TypeError(`${label}.options must describe the canonical q11 text Brotli artifact`);
  }
}

/**
 * Pure: validate the manifest and derive the complete list of bytes required
 * for an offline-capable current runtime. Every manifest bundle is included;
 * the explicit required map only prevents removal/renaming of known consumers.
 */
export function derivePrecacheDataEntries(manifest, { manifestBytes } = {}) {
  if (!isRecord(manifest)) {
    throw new TypeError("derivePrecacheDataEntries: manifest must be an object");
  }
  const schema = manifest.schema_version;
  const dataset = manifest.dataset_version;
  if (typeof schema !== "string" || !SAFE_SEGMENT_RE.test(schema)) {
    throw new TypeError(
      "derivePrecacheDataEntries: manifest.schema_version must be a safe non-empty segment",
    );
  }
  if (typeof dataset !== "string" || dataset.trim().length === 0) {
    throw new TypeError(
      "derivePrecacheDataEntries: manifest.dataset_version must be a non-empty string",
    );
  }
  if (!isRecord(manifest.bundles)) {
    throw new TypeError("derivePrecacheDataEntries: manifest.bundles must be an object");
  }

  for (const [key, expectedPath] of Object.entries(REQUIRED_RUNTIME_BUNDLE_PATHS)) {
    if (!isRecord(manifest.bundles[key])) {
      throw new TypeError(`derivePrecacheDataEntries: required manifest bundle ${key} is missing`);
    }
    if (manifest.bundles[key].path !== expectedPath) {
      throw new TypeError(
        `derivePrecacheDataEntries: required bundle ${key} must use ${expectedPath}`,
      );
    }
  }

  const sortedBundles = Object.entries(manifest.bundles).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (sortedBundles.length === 0) {
    throw new TypeError("derivePrecacheDataEntries: manifest.bundles must not be empty");
  }
  const seenPaths = new Set();
  for (const [key, bundle] of sortedBundles) {
    validateBundleFingerprint(key, bundle);
    if (seenPaths.has(bundle.path)) {
      throw new TypeError(`derivePrecacheDataEntries: duplicate bundle path ${bundle.path}`);
    }
    seenPaths.add(bundle.path);
  }

  const rawManifest = normalizeManifestBytes(manifest, manifestBytes);
  const basePath = `/data/wcdraft/${schema}`;
  const entries = [
    {
      key: "manifest",
      kind: "manifest",
      url: `${basePath}/manifest.json`,
      encoding: "identity",
      expected_bytes: rawManifest.byteLength,
      expected_sha256: sha256(rawManifest),
      transport_bytes: rawManifest.byteLength,
      transport_sha256: sha256(rawManifest),
    },
  ];

  for (const [key, bundle] of sortedBundles) {
    const useCompressedDelivery = key === "draft_pool";
    entries.push({
      key,
      kind: "bundle",
      url: `${basePath}/${bundle.path}${useCompressedDelivery ? ".br" : ""}`,
      encoding: useCompressedDelivery ? "brotli" : "identity",
      // Fetch exposes a Content-Encoding: br response as decoded bytes. The
      // body proof therefore always uses the raw fingerprint, while the wire
      // artifact metadata remains part of config validation and data identity.
      expected_bytes: bundle.bytes,
      expected_sha256: bundle.raw_sha256,
      transport_bytes: useCompressedDelivery ? bundle.compressed_bytes : bundle.bytes,
      transport_sha256: useCompressedDelivery ? bundle.compressed_sha256 : bundle.raw_sha256,
    });
  }

  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

/**
 * Pure: derive the data cache revision from the complete manifest-derived
 * delivery set, including the compressed draft-pool fingerprint.
 */
export function deriveDataRevision(manifest, options) {
  const entries = derivePrecacheDataEntries(manifest, options);
  const payload = [
    `schema:${manifest.schema_version}`,
    `dataset:${manifest.dataset_version}`,
    ...entries.map(
      (entry) =>
        `${entry.key}:${entry.url}:${entry.encoding}:${entry.expected_bytes}:${entry.expected_sha256}:` +
        `${entry.transport_bytes}:${entry.transport_sha256}`,
    ),
  ].join("|");
  return shortHash(payload);
}

/** Pure: build split shell/data cache identities. */
export function deriveCacheNames({ deployRevision, dataRevision }) {
  if (typeof deployRevision !== "string" || !/^[0-9a-f]+$/u.test(deployRevision)) {
    throw new TypeError("deriveCacheNames: deployRevision must be a lowercase hex string");
  }
  if (typeof dataRevision !== "string" || !/^[0-9a-f]+$/u.test(dataRevision)) {
    throw new TypeError("deriveCacheNames: dataRevision must be a lowercase hex string");
  }
  return Object.freeze({
    data: `wcdraft-data-b:${dataRevision}`,
    shell: `wcdraft-shell-d:${deployRevision}`,
  });
}

/** Pure: render the `/sw-version.js` script body. */
export function renderSwVersionScript(config) {
  const json = JSON.stringify(config, null, 2);
  return `/* AUTOGENERATED by apps/web/scripts/generate-sw-version.mjs - do not edit by hand.
 * Loaded by /sw.js via importScripts(). The committed sw.js depends on this
 * contract; if you rename fields, update sw.js in the same change. */
self.__WCDRAFT_SW_CONFIG__ = Object.freeze(${json});
`;
}

/** Pure: choose the per-deploy revision source from an env-like object. */
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
    if (fromEnv.source === "VERCEL_GIT_COMMIT_SHA") {
      return shortHash(`${fromEnv.source}:${fromEnv.raw}:${Date.now()}`);
    }
    return shortHash(`${fromEnv.source}:${fromEnv.raw}`);
  }
  try {
    const commit = execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (commit) return shortHash(`git:${commit}:${Date.now()}`);
  } catch {
    // Fall through for source archives and other non-Git builds.
  }
  return shortHash(`local-dev:${Date.now()}`);
}

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `generate-sw-version: data manifest not found at ${manifestPath}. ` +
        "Run `packages/data/scripts/copy-web-assets.mjs` first.",
    );
  }
  const raw = readFileSync(manifestPath);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    throw new Error(`generate-sw-version: manifest at ${manifestPath} is not valid JSON`, {
      cause: err,
    });
  }
  return { parsed, raw };
}

function readCurrentCopiedManifest(webRoot, repoRoot) {
  const sourcePath = join(repoRoot, "packages", "data", "src", "generated", "manifest.json");
  const source = readManifest(sourcePath);
  const schema = source.parsed?.schema_version;
  if (typeof schema !== "string" || !SAFE_SEGMENT_RE.test(schema)) {
    throw new Error(
      `generate-sw-version: source manifest at ${sourcePath} has an unsafe schema_version`,
    );
  }

  const copiedPath = join(webRoot, "public", "data", "wcdraft", schema, "manifest.json");
  const copied = readManifest(copiedPath);
  if (!copied.raw.equals(source.raw)) {
    throw new Error(
      `generate-sw-version: copied manifest at ${copiedPath} differs from current source ${sourcePath}`,
    );
  }
  return copied;
}

/** CLI entrypoint. Writes apps/web/public/sw-version.js. */
export function run({
  webRoot,
  env = process.env,
  repoRoot,
  manifestOverride,
  manifestBytesOverride,
} = {}) {
  const here = dirname(fileURLToPath(import.meta.url));
  const resolvedWebRoot = webRoot ?? join(here, "..");
  const resolvedRepoRoot = repoRoot ?? join(resolvedWebRoot, "..", "..");
  const loaded =
    manifestOverride === undefined
      ? readCurrentCopiedManifest(resolvedWebRoot, resolvedRepoRoot)
      : null;
  const manifest = manifestOverride ?? loaded.parsed;
  const manifestBytes =
    manifestBytesOverride ?? loaded?.raw ?? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

  const precacheDataEntries = derivePrecacheDataEntries(manifest, { manifestBytes });
  const dataRevision = deriveDataRevision(manifest, { manifestBytes });
  const deployRevision = resolveDeployRevisionForCli(env, resolvedRepoRoot);
  const cacheNames = deriveCacheNames({ deployRevision, dataRevision });
  const requiredBundleKeys = Object.keys(manifest.bundles).sort();

  const config = {
    deploy_revision: deployRevision,
    data_revision: dataRevision,
    schema_version: manifest.schema_version,
    dataset_version: manifest.dataset_version,
    runtime_data_base_path: `/data/wcdraft/${manifest.schema_version}`,
    required_bundle_keys: requiredBundleKeys,
    precache_data_entries: precacheDataEntries,
    bundle_hashes: Object.fromEntries(
      requiredBundleKeys.map((key) => [
        key,
        {
          raw_sha256: manifest.bundles[key].raw_sha256,
          raw_bytes: manifest.bundles[key].bytes,
          compressed_sha256: manifest.bundles[key].compressed_sha256,
          compressed_bytes: manifest.bundles[key].compressed_bytes,
        },
      ]),
    ),
    cache_names: { ...cacheNames },
  };

  const outPath = join(resolvedWebRoot, "public", "sw-version.js");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderSwVersionScript(config), "utf8");
  console.log(
    `generate-sw-version: wrote ${outPath} ` +
      `(data=${dataRevision}, deploy=${deployRevision}, required=${precacheDataEntries.length})`,
  );
  return { outPath, config };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    run();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
