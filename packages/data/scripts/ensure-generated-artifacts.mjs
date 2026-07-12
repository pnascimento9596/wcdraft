#!/usr/bin/env node
// Ensures the large runtime data artifacts that are intentionally not tracked by
// normal git exist in the checkout and match the tracked fingerprints.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

import {
  assertManifestVersion,
  assertRetainedSchemaPolicy,
  deriveRuntimeArtifactSpecs,
  validateRuntimeArtifactBytes,
} from "./runtime-artifact-closure.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

const args = new Set(process.argv.slice(2));
const INPUTS_ONLY = args.has("--inputs-only");
const CHECK_MODE = args.has("--check");
const FORCE = args.has("--force") || INPUTS_ONLY || CHECK_MODE;

const RATINGS_PATH = path.join(REPO_ROOT, "etl", "output", "ratings.json");
const RATINGS_LOCK_PATH = path.join(REPO_ROOT, "etl", "output", "ratings.lock.json");
const CORE_DIST_ENTRY = path.join(REPO_ROOT, "packages", "core", "dist", "index.js");
const BUILD_COMPACT_SCRIPT = path.join(PACKAGE_DIR, "scripts", "build-compact-data.mjs");
const GENERATED_DIR = path.join(PACKAGE_DIR, "src", "generated");
const RUNTIME_MANIFEST_PATH = path.join(GENERATED_DIR, "manifest.json");
const SCENARIO_PATH = path.join(GENERATED_DIR, "scenario-2026.compact.json");
const SCORE_DISTRIBUTION_PATH = path.join(GENERATED_DIR, "score-distribution.compact.json");
const DAILY_SEED_SALT_MAP_PATH = path.join(GENERATED_DIR, "daily-seed-salt-map.compact.json");
const DRAFT_POOL_PATH = path.join(GENERATED_DIR, "draft-pool.compact.json");
const SIZE_REPORT_PATH = path.join(PACKAGE_DIR, "reports", "compact-size.json");
const RETAINED_RUNTIME_DATA_DIR = path.join(PACKAGE_DIR, "src", "retained-runtime-data");
const GENERATED_ARTIFACTS_LOCK_DIR = path.join(PACKAGE_DIR, ".generated-artifacts.lock");
const GENERATED_ARTIFACTS_LOCK_TIMEOUT_MS = 30 * 60 * 1000;
const GENERATED_ARTIFACTS_LOCK_SLEEP_MS = 250;

const TRACKED_FINGERPRINT_PATHS = [
  "etl/output/ratings.lock.json",
  "packages/data/src/generated/manifest.json",
  "packages/data/src/generated/manifest.json.br",
  "packages/data/src/generated/draft-pool.compact.json.br",
  "packages/data/src/generated/scenario-2026.compact.json",
  "packages/data/src/generated/scenario-2026.compact.json.br",
  "packages/data/src/generated/score-distribution.compact.json",
  "packages/data/src/generated/score-distribution.compact.json.br",
  "packages/data/src/generated/daily-seed-salt-map.compact.json",
  "packages/data/src/generated/daily-seed-salt-map.compact.json.br",
  "packages/data/reports/compact-size.json",
];
const UNTRACKED_LARGE_ARTIFACTS = [
  "etl/output/ratings.json",
  "packages/data/src/generated/draft-pool.compact.json",
];

function rel(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

function fail(message) {
  throw new Error(`ensure-generated-artifacts: ${message}`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireGeneratedArtifactsLock() {
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(GENERATED_ARTIFACTS_LOCK_DIR);
      return;
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;

      try {
        const ageMs = Date.now() - statSync(GENERATED_ARTIFACTS_LOCK_DIR).mtimeMs;
        if (ageMs > GENERATED_ARTIFACTS_LOCK_TIMEOUT_MS) {
          rmSync(GENERATED_ARTIFACTS_LOCK_DIR, { recursive: true, force: true });
          continue;
        }
      } catch (statErr) {
        if (!statErr || statErr.code !== "ENOENT") throw statErr;
        continue;
      }

      if (Date.now() - started > GENERATED_ARTIFACTS_LOCK_TIMEOUT_MS) {
        fail(`timed out waiting for ${rel(GENERATED_ARTIFACTS_LOCK_DIR)}`);
      }
      sleep(GENERATED_ARTIFACTS_LOCK_SLEEP_MS);
    }
  }
}

function withGeneratedArtifactsLock(fn) {
  acquireGeneratedArtifactsLock();
  try {
    return fn();
  } finally {
    rmSync(GENERATED_ARTIFACTS_LOCK_DIR, { recursive: true, force: true });
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    ...options,
  });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} exited ${result.status ?? "without a status"}`);
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function fileFingerprint(filePath) {
  const raw = readFileSync(filePath);
  return { bytes: raw.length, sha256: sha256(raw) };
}

function validateFingerprint(filePath, expected, label) {
  if (!existsSync(filePath)) fail(`${label} missing at ${rel(filePath)}`);
  const actual = fileFingerprint(filePath);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    fail(
      `${label} fingerprint mismatch: got ${actual.bytes} bytes / ${actual.sha256}, ` +
        `expected ${expected.bytes} bytes / ${expected.sha256}`,
    );
  }
}

function validateCanonicalBrotli(filePath, rawPath, expected, label) {
  if (!existsSync(filePath)) fail(`${label} missing at ${rel(filePath)}`);
  if (
    !expected ||
    expected.sha256 !== expected.raw_sha256 ||
    expected.bytes_brotli !== expected.compressed_bytes ||
    expected.options?.quality !== 11 ||
    expected.options?.mode !== "text" ||
    expected.options?.size_hint !== expected.bytes ||
    typeof expected.brotli_impl_version !== "string"
  ) {
    fail(`${label} manifest compression metadata is malformed`);
  }
  const compressed = readFileSync(filePath);
  const compressedSha = sha256(compressed);
  if (
    compressed.length !== expected.compressed_bytes ||
    compressedSha !== expected.compressed_sha256
  ) {
    fail(
      `${label} compressed fingerprint mismatch: got ${compressed.length} bytes / ` +
        `${compressedSha}, expected ${expected.compressed_bytes} bytes / ` +
        `${expected.compressed_sha256}`,
    );
  }
  const raw = readFileSync(rawPath);
  let decompressed;
  try {
    decompressed = brotliDecompressSync(compressed);
  } catch (err) {
    fail(`${label} cannot be decompressed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!decompressed.equals(raw)) fail(`${label} decompressed bytes differ from canonical raw file`);
}

function validateRatings() {
  if (!existsSync(RATINGS_LOCK_PATH)) fail(`${rel(RATINGS_LOCK_PATH)} is missing`);
  const lock = readJson(RATINGS_LOCK_PATH);
  validateFingerprint(RATINGS_PATH, lock, "ratings.json");
}

function runRatingGenerator() {
  const python = process.env.PYTHON ?? "python3";
  const pythonPath = path.join(REPO_ROOT, "etl", "src");
  const env = {
    ...process.env,
    PYTHONPATH: process.env.PYTHONPATH
      ? `${pythonPath}${path.delimiter}${process.env.PYTHONPATH}`
      : pythonPath,
  };
  run(python, ["-m", "wcdraft_etl.rating"], { env });
}

function ensureRatings() {
  if (!FORCE) {
    try {
      validateRatings();
      return;
    } catch {
      // Regenerate below, then validate with the tracked lockfile.
    }
  }
  runRatingGenerator();
  validateRatings();
}

function ensureCoreBuild({ force = false } = {}) {
  if (!force && existsSync(CORE_DIST_ENTRY)) return;
  run("pnpm", ["--filter", "@wcdraft/core", "build"]);
}

function validateCompactArtifacts() {
  if (!existsSync(RUNTIME_MANIFEST_PATH)) fail(`${rel(RUNTIME_MANIFEST_PATH)} is missing`);
  if (!existsSync(SIZE_REPORT_PATH)) fail(`${rel(SIZE_REPORT_PATH)} is missing`);

  const manifest = readJson(RUNTIME_MANIFEST_PATH);
  const report = readJson(SIZE_REPORT_PATH);

  validateFingerprint(DRAFT_POOL_PATH, manifest.bundles.draft_pool, "draft-pool.compact.json");
  validateCanonicalBrotli(
    `${DRAFT_POOL_PATH}.br`,
    DRAFT_POOL_PATH,
    manifest.bundles.draft_pool,
    "draft-pool.compact.json.br",
  );
  validateFingerprint(SCENARIO_PATH, manifest.bundles.scenario_2026, "scenario-2026.compact.json");
  validateCanonicalBrotli(
    `${SCENARIO_PATH}.br`,
    SCENARIO_PATH,
    manifest.bundles.scenario_2026,
    "scenario-2026.compact.json.br",
  );
  validateFingerprint(RUNTIME_MANIFEST_PATH, report.bundles.manifest, "manifest.json");
  validateCanonicalBrotli(
    `${RUNTIME_MANIFEST_PATH}.br`,
    RUNTIME_MANIFEST_PATH,
    report.bundles.manifest,
    "manifest.json.br",
  );
  if (manifest.bundles.score_distribution !== undefined) {
    validateFingerprint(
      SCORE_DISTRIBUTION_PATH,
      manifest.bundles.score_distribution,
      "score-distribution.compact.json",
    );
    validateCanonicalBrotli(
      `${SCORE_DISTRIBUTION_PATH}.br`,
      SCORE_DISTRIBUTION_PATH,
      manifest.bundles.score_distribution,
      "score-distribution.compact.json.br",
    );
  }
  if (manifest.bundles.daily_seed_salt_map !== undefined) {
    validateFingerprint(
      DAILY_SEED_SALT_MAP_PATH,
      manifest.bundles.daily_seed_salt_map,
      "daily-seed-salt-map.compact.json",
    );
    validateCanonicalBrotli(
      `${DAILY_SEED_SALT_MAP_PATH}.br`,
      DAILY_SEED_SALT_MAP_PATH,
      manifest.bundles.daily_seed_salt_map,
      "daily-seed-salt-map.compact.json.br",
    );
  }

  for (const [key, expected] of Object.entries(manifest.bundles)) {
    const reported = report.bundles[key];
    if (!reported) fail(`compact-size report missing ${key}`);
    for (const field of [
      "path",
      "bytes",
      "bytes_brotli",
      "bytes_gzip",
      "sha256",
      "raw_sha256",
      "compressed_sha256",
      "compressed_bytes",
      "brotli_impl_version",
    ]) {
      if (reported[field] !== expected[field]) {
        fail(
          `compact-size report ${key}.${field}=${reported[field]} does not match manifest ${expected[field]}`,
        );
      }
    }
    if (JSON.stringify(reported.options) !== JSON.stringify(expected.options)) {
      fail(`compact-size report ${key}.options does not match manifest`);
    }
  }
}

function validateRetainedRuntimeData() {
  const currentManifest = readJson(RUNTIME_MANIFEST_PATH);
  const entries = existsSync(RETAINED_RUNTIME_DATA_DIR)
    ? readdirSync(RETAINED_RUNTIME_DATA_DIR, { withFileTypes: true })
    : [];
  const retainedVersions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const expectedVersions = assertRetainedSchemaPolicy(
    assertManifestVersion(currentManifest),
    retainedVersions,
  );

  for (const version of expectedVersions) {
    const dir = path.join(RETAINED_RUNTIME_DATA_DIR, version);
    const manifestPath = path.join(dir, "manifest.json");
    if (!existsSync(manifestPath)) fail(`retained ${version}/manifest.json missing`);

    const manifest = readJson(manifestPath);
    if (assertManifestVersion(manifest) !== version) {
      fail(
        `retained ${version} directory does not match manifest schema_version ${manifest.schema_version}`,
      );
    }

    const specs = deriveRuntimeArtifactSpecs(manifest);
    const allowedFiles = new Set(["manifest.json", ...specs.map((spec) => spec.relativePath)]);
    for (const spec of specs) {
      const artifactPath = path.join(dir, spec.relativePath);
      if (!existsSync(artifactPath)) fail(`retained ${version}/${spec.relativePath} missing`);
      validateRuntimeArtifactBytes(
        spec,
        readFileSync(artifactPath),
        `retained ${version}/${spec.relativePath}`,
      );
    }

    const unexpected = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !allowedFiles.has(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (unexpected.length > 0) {
      fail(`retained ${version} contains unadvertised artifact(s): ${unexpected.join(", ")}`);
    }
  }
}

function runCompactBuilder({ forceRebuild = false } = {}) {
  ensureCoreBuild({ force: true });
  run(process.execPath, [BUILD_COMPACT_SCRIPT, ...(forceRebuild ? ["--force-rebuild"] : [])]);
}

function ensureCompactArtifacts() {
  if (!FORCE) {
    try {
      validateCompactArtifacts();
      return;
    } catch {
      // Regenerate below, then validate with the freshly emitted tracked fingerprints.
    }
  }
  runCompactBuilder({ forceRebuild: CHECK_MODE });
  validateCompactArtifacts();
}

function checkTrackedFingerprintsClean() {
  run("git", ["diff", "--exit-code", "--", ...TRACKED_FINGERPRINT_PATHS]);
}

function checkFingerprintPathsTracked() {
  for (const artifact of TRACKED_FINGERPRINT_PATHS) {
    const result = spawnSync("git", ["ls-files", "--error-unmatch", artifact], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    if (result.status !== 0) fail(`${artifact} is not tracked by normal git`);
  }
}

function checkLargeArtifactsNotTracked() {
  for (const artifact of UNTRACKED_LARGE_ARTIFACTS) {
    const result = spawnSync("git", ["ls-files", "--error-unmatch", artifact], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    if (result.status === 0) fail(`${artifact} is still tracked by normal git`);
  }
}

try {
  withGeneratedArtifactsLock(() => {
    ensureRatings();
    ensureCoreBuild({ force: INPUTS_ONLY });
    if (!INPUTS_ONLY) ensureCompactArtifacts();
    validateRetainedRuntimeData();
    if (CHECK_MODE) {
      checkFingerprintPathsTracked();
      checkTrackedFingerprintsClean();
      checkLargeArtifactsNotTracked();
    }
    process.stdout.write(
      `ensure-generated-artifacts: ok${INPUTS_ONLY ? " (inputs only)" : ""}${CHECK_MODE ? " (check)" : ""}\n`,
    );
  });
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
