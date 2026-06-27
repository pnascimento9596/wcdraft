#!/usr/bin/env node
// Ensures the large runtime data artifacts that are intentionally not tracked by
// normal git exist in the checkout and match the tracked fingerprints.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";

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
const DRAFT_POOL_PATH = path.join(GENERATED_DIR, "draft-pool.compact.json");
const SIZE_REPORT_PATH = path.join(PACKAGE_DIR, "reports", "compact-size.json");
const RETAINED_RUNTIME_DATA_DIR = path.join(PACKAGE_DIR, "src", "retained-runtime-data");
const GENERATED_ARTIFACTS_LOCK_DIR = path.join(PACKAGE_DIR, ".generated-artifacts.lock");
const GENERATED_ARTIFACTS_LOCK_TIMEOUT_MS = 30 * 60 * 1000;
const GENERATED_ARTIFACTS_LOCK_SLEEP_MS = 250;

const TRACKED_FINGERPRINT_PATHS = [
  "etl/output/ratings.lock.json",
  "packages/data/src/generated/manifest.json",
  "packages/data/src/generated/scenario-2026.compact.json",
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
  validateFingerprint(SCENARIO_PATH, manifest.bundles.scenario_2026, "scenario-2026.compact.json");
  validateFingerprint(RUNTIME_MANIFEST_PATH, report.bundles.manifest, "manifest.json");

  for (const [key, expected] of Object.entries(manifest.bundles)) {
    const reported = report.bundles[key];
    if (!reported) fail(`compact-size report missing ${key}`);
    for (const field of ["path", "bytes", "bytes_brotli", "bytes_gzip", "sha256"]) {
      if (reported[field] !== expected[field]) {
        fail(
          `compact-size report ${key}.${field}=${reported[field]} does not match manifest ${expected[field]}`,
        );
      }
    }
  }
}

function validateRetainedRuntimeData() {
  if (!existsSync(RETAINED_RUNTIME_DATA_DIR)) return;
  for (const entry of readdirSync(RETAINED_RUNTIME_DATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const version = entry.name;
    const dir = path.join(RETAINED_RUNTIME_DATA_DIR, version);
    const manifestPath = path.join(dir, "manifest.json");
    const scenarioPath = path.join(dir, "scenario-2026.compact.json");
    const draftBrPath = path.join(dir, "draft-pool.compact.json.br");
    if (!existsSync(manifestPath)) fail(`retained ${version}/manifest.json missing`);
    if (!existsSync(scenarioPath)) fail(`retained ${version}/scenario-2026.compact.json missing`);
    if (!existsSync(draftBrPath)) fail(`retained ${version}/draft-pool.compact.json.br missing`);

    const manifest = readJson(manifestPath);
    if (manifest.schema_version !== version) {
      fail(
        `retained ${version} directory does not match manifest schema_version ${manifest.schema_version}`,
      );
    }
    validateFingerprint(scenarioPath, manifest.bundles.scenario_2026, `${version} scenario`);

    const decompressed = brotliDecompressSync(readFileSync(draftBrPath));
    const actual = { bytes: decompressed.length, sha256: sha256(decompressed) };
    const expected = manifest.bundles.draft_pool;
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
      fail(
        `retained ${version} draft-pool.compact.json.br fingerprint mismatch: ` +
          `got ${actual.bytes} bytes / ${actual.sha256}, ` +
          `expected ${expected.bytes} bytes / ${expected.sha256}`,
      );
    }
  }
}

function runCompactBuilder() {
  ensureCoreBuild({ force: true });
  run(process.execPath, [BUILD_COMPACT_SCRIPT]);
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
  runCompactBuilder();
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
