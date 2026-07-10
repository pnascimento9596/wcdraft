#!/usr/bin/env node
// Copies the compact bundles into `apps/web/public/data/wcdraft/` so Next.js
// serves them as static assets. Runs as a pre-build step from
// `apps/web/package.json`. Current Brotli artifacts are canonical outputs of
// build-compact-data: this script verifies their raw + compressed fingerprints
// and copies the exact bytes. It never pays the q11 compression tax.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

const DEFAULT_SOURCE_DIR = path.join(PACKAGE_DIR, "src", "generated");
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, "apps", "web", "public", "data", "wcdraft");
const DEFAULT_RETAINED_DIR = path.join(PACKAGE_DIR, "src", "retained-runtime-data");

const REQUIRED_SOURCE_FILES = ["manifest.json", "scenario-2026.compact.json"];
const COMPRESSED_DRAFT_FILE = "draft-pool.compact.json.br";
const RETAINED_FILES = ["manifest.json", "scenario-2026.compact.json", COMPRESSED_DRAFT_FILE];
const REQUIRED_BUNDLE_KEYS = ["draft_pool", "scenario_2026"];
const BROTLI_QUALITY = 11;
const BROTLI_MODE = "text";

function parseArgs(argv) {
  const out = {
    sourceDir: DEFAULT_SOURCE_DIR,
    targetDir: DEFAULT_TARGET_DIR,
    retainedDir: DEFAULT_RETAINED_DIR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--source-dir" && typeof next === "string") {
      out.sourceDir = path.resolve(next);
      i += 1;
    } else if (arg === "--target-dir" && typeof next === "string") {
      out.targetDir = path.resolve(next);
      i += 1;
    } else if (arg === "--retained-dir" && typeof next === "string") {
      out.retainedDir = path.resolve(next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: copy-web-assets [--source-dir DIR] [--target-dir DIR] [--retained-dir DIR]\n",
      );
      process.exit(0);
    } else {
      throw new Error(`copy-web-assets: unrecognised argument: ${arg}`);
    }
  }
  return out;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function assertManifestVersion(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("manifest.json is not an object");
  }
  if (typeof manifest.schema_version !== "string" || manifest.schema_version.length === 0) {
    throw new Error("manifest.json missing schema_version");
  }
  return manifest.schema_version;
}

function assertRawFingerprint(label, buf, expected) {
  if (!expected || typeof expected !== "object") {
    throw new Error(`retained ${label}: manifest fingerprint is missing`);
  }
  const expectedRawSha = expected.raw_sha256 ?? expected.sha256;
  if (buf.length !== expected.bytes || sha256(buf) !== expectedRawSha) {
    throw new Error(
      `retained ${label}: fingerprint mismatch; got ${buf.length} bytes / ${sha256(buf)}, ` +
        `expected ${expected.bytes} bytes / ${expectedRawSha}`,
    );
  }
}

function assertCurrentFingerprint(label, raw, compressed, expected) {
  if (!expected || typeof expected !== "object") {
    throw new Error(`copy-web-assets: ${label}: manifest fingerprint is missing`);
  }
  if (
    typeof expected.raw_sha256 !== "string" ||
    expected.raw_sha256 !== expected.sha256 ||
    typeof expected.compressed_sha256 !== "string" ||
    typeof expected.brotli_impl_version !== "string" ||
    expected.brotli_impl_version.length === 0 ||
    !expected.options ||
    expected.options.quality !== BROTLI_QUALITY ||
    expected.options.mode !== BROTLI_MODE ||
    expected.options.size_hint !== expected.bytes
  ) {
    throw new Error(`copy-web-assets: ${label}: canonical Brotli metadata is malformed`);
  }
  if (expected.bytes_brotli !== expected.compressed_bytes) {
    throw new Error(`copy-web-assets: ${label}: bytes_brotli must equal compressed_bytes exactly`);
  }
  assertRawFingerprint(label, raw, expected);
  const compressedSha = sha256(compressed);
  if (
    compressed.length !== expected.compressed_bytes ||
    compressedSha !== expected.compressed_sha256
  ) {
    throw new Error(
      `copy-web-assets: ${label}: compressed fingerprint mismatch; got ` +
        `${compressed.length} bytes / ${compressedSha}, expected ` +
        `${expected.compressed_bytes} bytes / ${expected.compressed_sha256}`,
    );
  }
}

async function readCurrentBundle(sourceDir, key, expected) {
  if (!expected || typeof expected.path !== "string") {
    throw new Error(`copy-web-assets: manifest bundle ${key} is missing a path`);
  }
  const compressedPath = path.join(sourceDir, `${expected.path}.br`);
  const compressed = await readFile(compressedPath);
  let raw;
  try {
    raw = brotliDecompressSync(compressed);
  } catch (err) {
    throw new Error(
      `copy-web-assets: ${key}: canonical Brotli artifact cannot be decompressed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
  assertCurrentFingerprint(key, raw, compressed, expected);

  const rawPath = path.join(sourceDir, expected.path);
  if (existsSync(rawPath)) {
    const sourceRaw = await readFile(rawPath);
    if (!sourceRaw.equals(raw)) {
      throw new Error(
        `copy-web-assets: ${key}: raw source bytes differ from canonical Brotli content`,
      );
    }
  }
  return { key, expected, raw, compressed, compressedPath };
}

async function validateRetainedVersion(versionDir, version) {
  const present = new Set(await readdir(versionDir));
  const missing = RETAINED_FILES.filter((f) => !present.has(f));
  if (missing.length > 0) {
    throw new Error(`retained ${version}: missing ${missing.join(", ")}`);
  }

  const manifestPath = path.join(versionDir, "manifest.json");
  const manifest = await readJson(manifestPath);
  const schemaVersion = assertManifestVersion(manifest);
  if (schemaVersion !== version) {
    throw new Error(
      `retained ${version}: directory name does not match manifest schema_version ${schemaVersion}`,
    );
  }

  const scenario = await readFile(path.join(versionDir, "scenario-2026.compact.json"));
  assertRawFingerprint(
    `${version}/scenario-2026.compact.json`,
    scenario,
    manifest.bundles?.scenario_2026,
  );

  const compressedDraft = await readFile(path.join(versionDir, COMPRESSED_DRAFT_FILE));
  const draft = brotliDecompressSync(compressedDraft);
  assertRawFingerprint(
    `${version}/draft-pool.compact.json.br`,
    draft,
    manifest.bundles?.draft_pool,
  );
}

async function copyRetainedVersions(retainedDir, targetDir, currentVersion) {
  let entries;
  try {
    entries = await readdir(retainedDir, { withFileTypes: true });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return 0;
    }
    throw err;
  }

  let copied = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const version = entry.name;
    const versionDir = path.join(retainedDir, version);
    await validateRetainedVersion(versionDir, version);
    if (version === currentVersion) continue;
    const targetVersionDir = path.join(targetDir, version);
    await mkdir(targetVersionDir, { recursive: true });
    for (const file of RETAINED_FILES) {
      await copyFile(path.join(versionDir, file), path.join(targetVersionDir, file));
    }
    copied += 1;
  }
  return copied;
}

async function main() {
  const { sourceDir, targetDir, retainedDir } = parseArgs(process.argv.slice(2));

  const present = new Set(await readdir(sourceDir));
  const missing = REQUIRED_SOURCE_FILES.filter((f) => !present.has(f));
  if (missing.length > 0) {
    throw new Error(
      `copy-web-assets: missing generated bundles in ${sourceDir}: ${missing.join(", ")}. ` +
        `Run \`pnpm --filter @wcdraft/data run build:compact -- --force-rebuild\` to regenerate.`,
    );
  }

  const manifest = await readJson(path.join(sourceDir, "manifest.json"));
  const currentVersion = assertManifestVersion(manifest);
  for (const key of REQUIRED_BUNDLE_KEYS) {
    if (!manifest.bundles?.[key]) {
      throw new Error(`copy-web-assets: manifest is missing required bundle ${key}`);
    }
  }
  const currentBundles = await Promise.all(
    Object.entries(manifest.bundles).map(([key, expected]) =>
      readCurrentBundle(sourceDir, key, expected),
    ),
  );

  await mkdir(targetDir, { recursive: true });
  // Transitional compatibility: keep the fixed unversioned paths available for
  // old clients and for server-side filesystem readers. New browser clients
  // fetch the versioned path below.
  await copyFile(path.join(sourceDir, "manifest.json"), path.join(targetDir, "manifest.json"));

  const currentTargetDir = path.join(targetDir, currentVersion);
  await mkdir(currentTargetDir, { recursive: true });
  await copyFile(
    path.join(sourceDir, "manifest.json"),
    path.join(currentTargetDir, "manifest.json"),
  );
  for (const bundle of currentBundles) {
    const rawTarget = path.join(targetDir, bundle.expected.path);
    await mkdir(path.dirname(rawTarget), { recursive: true });
    await writeFile(rawTarget, bundle.raw);

    // Keep the 130 MiB draft pool out of the versioned raw tree. The current
    // browser path is the canonical .br; the legacy unversioned raw path above
    // remains for existing server-side readers until C5 removes it.
    if (bundle.key !== "draft_pool") {
      const versionedRawTarget = path.join(currentTargetDir, bundle.expected.path);
      await mkdir(path.dirname(versionedRawTarget), { recursive: true });
      await writeFile(versionedRawTarget, bundle.raw);
    }

    const compressedTarget = path.join(currentTargetDir, `${bundle.expected.path}.br`);
    await mkdir(path.dirname(compressedTarget), { recursive: true });
    await copyFile(bundle.compressedPath, compressedTarget);
  }

  const retainedCount = await copyRetainedVersions(retainedDir, targetDir, currentVersion);
  const draft = currentBundles.find((bundle) => bundle.key === "draft_pool");
  if (!draft) throw new Error("copy-web-assets: verified draft pool unexpectedly missing");
  process.stdout.write(
    `copy-web-assets: ok — verified ${currentBundles.length} canonical Brotli artifact(s); copied ` +
      `${currentVersion}/${COMPRESSED_DRAFT_FILE} byte-for-byte ` +
      `(${draft.compressed.length} bytes / ${draft.expected.compressed_sha256}) to ${targetDir}` +
      (retainedCount > 0 ? `; retained ${retainedCount} prior version(s)` : "") +
      "\n",
  );
}

main().catch((err) => {
  process.stderr.write(`copy-web-assets: FATAL — ${err.message}\n`);
  process.exit(1);
});
