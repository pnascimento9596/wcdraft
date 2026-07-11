#!/usr/bin/env node
// Materializes the current runtime bundle plus the two retained prior schemas
// under `apps/web/public/data/wcdraft/<schema>/`. Every output path is derived
// from that version's own manifest and every bundle is fingerprint-verified
// before this script changes the target tree.

import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertManifestVersion,
  assertRetainedSchemaPolicy,
  deriveRuntimeArtifactSpecs,
  validateRuntimeArtifactBytes,
} from "./runtime-artifact-closure.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

const DEFAULT_SOURCE_DIR = path.join(PACKAGE_DIR, "src", "generated");
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, "apps", "web", "public", "data", "wcdraft");
const DEFAULT_RETAINED_DIR = path.join(PACKAGE_DIR, "src", "retained-runtime-data");

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

async function readManifest(versionDir, label) {
  const manifestPath = path.join(versionDir, "manifest.json");
  let bytes;
  try {
    bytes = await readFile(manifestPath);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      throw new Error(`${label}: missing manifest.json`, { cause: err });
    }
    throw err;
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (err) {
    throw new Error(
      `${label}: manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return { bytes, manifest };
}

async function readArtifact(versionDir, spec, label) {
  const artifactPath = path.join(versionDir, spec.relativePath);
  let bytes;
  try {
    bytes = await readFile(artifactPath);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      throw new Error(`${label}: missing ${spec.relativePath}`, { cause: err });
    }
    throw err;
  }
  validateRuntimeArtifactBytes(spec, bytes, `${label}/${spec.relativePath}`);
  return { ...spec, bytes };
}

async function validateVersionDirectory(versionDir, expectedVersion, label) {
  const { bytes: manifestBytes, manifest } = await readManifest(versionDir, label);
  const version = assertManifestVersion(manifest);
  if (expectedVersion !== undefined && version !== expectedVersion) {
    throw new Error(`${label}: directory version ${expectedVersion} contains manifest ${version}`);
  }

  const specs = deriveRuntimeArtifactSpecs(manifest);
  const artifacts = [];
  // Validate sequentially so only one ~130 MiB decompressed draft is live at a
  // time. Keep the small served bytes in memory, ensuring the copied bytes are
  // exactly the bytes that passed validation.
  for (const spec of specs) {
    artifacts.push(await readArtifact(versionDir, spec, label));
  }

  // The generated raw draft is intentionally optional. When present, bind it
  // to the same manifest before output so a stale local artifact cannot hide.
  const draft = manifest.bundles.draft_pool;
  try {
    const rawDraft = await readFile(path.join(versionDir, draft.path));
    validateRuntimeArtifactBytes(
      {
        bundleKey: "draft_pool",
        relativePath: draft.path,
        encoding: "raw",
        fingerprint: draft,
        canonicalCompressed: false,
      },
      rawDraft,
      `${label}/${draft.path}`,
    );
  } catch (err) {
    if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) throw err;
  }

  return { version, manifestBytes, artifacts };
}

async function retainedDirectoryNames(retainedDir) {
  let entries;
  try {
    entries = await readdir(retainedDir, { withFileTypes: true });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return [];
    throw err;
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function writeValidatedVersion(targetDir, validated) {
  const versionDir = path.join(targetDir, validated.version);
  await mkdir(versionDir, { recursive: true });
  await writeFile(path.join(versionDir, "manifest.json"), validated.manifestBytes);
  for (const artifact of validated.artifacts) {
    const outputPath = path.join(versionDir, artifact.relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, artifact.bytes);
  }
}

async function main() {
  const { sourceDir, targetDir, retainedDir } = parseArgs(process.argv.slice(2));

  // Complete closure validation happens before mkdir/rm/write. A missing or
  // corrupt retained asset therefore leaves an existing good target untouched.
  const current = await validateVersionDirectory(sourceDir, undefined, "current");
  const retainedNames = await retainedDirectoryNames(retainedDir);
  const retainedVersions = assertRetainedSchemaPolicy(current.version, retainedNames);
  const retained = [];
  for (const version of retainedVersions) {
    retained.push(
      await validateVersionDirectory(
        path.join(retainedDir, version),
        version,
        `retained ${version}`,
      ),
    );
  }

  // This directory is generated output. Rebuild it from the validated closure
  // so stale schemas and fixed unversioned legacy files cannot survive a bump.
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await writeValidatedVersion(targetDir, current);
  for (const version of retained) await writeValidatedVersion(targetDir, version);

  const draft = current.artifacts.find((artifact) => artifact.bundleKey === "draft_pool");
  if (!draft) throw new Error("copy-web-assets: validated current draft pool is missing");
  const fileCount = [current, ...retained].reduce(
    (count, version) => count + 1 + version.artifacts.length,
    0,
  );
  process.stdout.write(
    `copy-web-assets: ok — verified and copied ${fileCount} manifest-derived file(s) across ` +
      `${current.version} + ${retained.length} retained prior schema(s); current draft ` +
      `${draft.bytes.length} bytes to ${targetDir}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`copy-web-assets: FATAL — ${err.message}\n`);
  process.exit(1);
});
