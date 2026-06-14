#!/usr/bin/env node
// Copies the compact bundles into `apps/web/public/data/wcdraft/` so Next.js
// serves them as static assets. Runs as a pre-build step from
// `apps/web/package.json`; the default source is generated on demand from the
// tracked fingerprints because the largest bundle is intentionally not tracked
// by normal git.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { brotliCompress, brotliDecompress, constants as zlibConstants } from "node:zlib";
import { promisify } from "node:util";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

const DEFAULT_SOURCE_DIR = path.join(PACKAGE_DIR, "src", "generated");
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, "apps", "web", "public", "data", "wcdraft");
const DEFAULT_RETAINED_DIR = path.join(PACKAGE_DIR, "src", "retained-runtime-data");

const EXPECTED_FILES = ["manifest.json", "draft-pool.compact.json", "scenario-2026.compact.json"];
const VERSIONED_JSON_FILES = ["manifest.json", "scenario-2026.compact.json"];
const COMPRESSED_DRAFT_FILE = "draft-pool.compact.json.br";
const RETAINED_FILES = ["manifest.json", "scenario-2026.compact.json", COMPRESSED_DRAFT_FILE];

const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

function ensureDefaultSourceGenerated(sourceDir) {
  if (path.resolve(sourceDir) !== DEFAULT_SOURCE_DIR) return;
  const result = spawnSync(
    process.execPath,
    [path.join(SCRIPT_DIR, "ensure-generated-artifacts.mjs")],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
    },
  );
  if (result.error) {
    throw new Error(`failed to start generated-artifact check: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`generated-artifact check exited ${result.status ?? "without a status"}`);
  }
}

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

async function writeBrotliJson(sourcePath, targetPath) {
  const raw = await readFile(sourcePath);
  const compressed = await brotliCompressAsync(raw, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  await writeFile(targetPath, compressed);
  return { rawBytes: raw.length, rawSha256: sha256(raw), compressedBytes: compressed.length };
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

function assertFingerprint(label, buf, expected) {
  if (!expected || typeof expected !== "object") {
    throw new Error(`retained ${label}: manifest fingerprint is missing`);
  }
  if (buf.length !== expected.bytes || sha256(buf) !== expected.sha256) {
    throw new Error(
      `retained ${label}: fingerprint mismatch; got ${buf.length} bytes / ${sha256(buf)}, ` +
        `expected ${expected.bytes} bytes / ${expected.sha256}`,
    );
  }
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
  assertFingerprint(
    `${version}/scenario-2026.compact.json`,
    scenario,
    manifest.bundles?.scenario_2026,
  );

  const compressedDraft = await readFile(path.join(versionDir, COMPRESSED_DRAFT_FILE));
  const draft = await brotliDecompressAsync(compressedDraft);
  assertFingerprint(`${version}/draft-pool.compact.json.br`, draft, manifest.bundles?.draft_pool);
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
  ensureDefaultSourceGenerated(sourceDir);

  const present = new Set(await readdir(sourceDir));
  const missing = EXPECTED_FILES.filter((f) => !present.has(f));
  if (missing.length > 0) {
    throw new Error(
      `copy-web-assets: missing generated bundles in ${sourceDir}: ${missing.join(", ")}. ` +
        `Run \`pnpm --filter @wcdraft/data run build:compact\` to regenerate.`,
    );
  }

  const manifest = await readJson(path.join(sourceDir, "manifest.json"));
  const currentVersion = assertManifestVersion(manifest);

  await mkdir(targetDir, { recursive: true });
  // Transitional compatibility: keep the fixed unversioned paths available for
  // old clients and for server-side filesystem readers. New browser clients
  // fetch the versioned path below.
  for (const file of EXPECTED_FILES) {
    await copyFile(path.join(sourceDir, file), path.join(targetDir, file));
  }

  const currentTargetDir = path.join(targetDir, currentVersion);
  await mkdir(currentTargetDir, { recursive: true });
  for (const file of VERSIONED_JSON_FILES) {
    await copyFile(path.join(sourceDir, file), path.join(currentTargetDir, file));
  }
  const compressed = await writeBrotliJson(
    path.join(sourceDir, "draft-pool.compact.json"),
    path.join(currentTargetDir, COMPRESSED_DRAFT_FILE),
  );
  if (
    compressed.rawBytes !== manifest.bundles?.draft_pool?.bytes ||
    compressed.rawSha256 !== manifest.bundles?.draft_pool?.sha256
  ) {
    throw new Error(
      `copy-web-assets: compressed draft source does not match manifest fingerprint ` +
        `(${compressed.rawBytes} bytes / ${compressed.rawSha256})`,
    );
  }

  const retainedCount = await copyRetainedVersions(retainedDir, targetDir, currentVersion);
  process.stdout.write(
    `copy-web-assets: ok — copied legacy assets plus ${currentVersion}/${COMPRESSED_DRAFT_FILE} ` +
      `(${compressed.compressedBytes} bytes) to ${targetDir}` +
      (retainedCount > 0 ? `; retained ${retainedCount} prior version(s)` : "") +
      "\n",
  );
}

main().catch((err) => {
  process.stderr.write(`copy-web-assets: FATAL — ${err.message}\n`);
  process.exit(1);
});
