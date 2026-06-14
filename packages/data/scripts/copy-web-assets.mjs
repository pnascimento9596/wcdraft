#!/usr/bin/env node
// Copies the compact bundles into `apps/web/public/data/wcdraft/` so Next.js
// serves them as static assets. Runs as a pre-build step from
// `apps/web/package.json`; the default source is generated on demand from the
// tracked fingerprints because the largest bundle is intentionally not tracked
// by normal git.

import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

const DEFAULT_SOURCE_DIR = path.join(PACKAGE_DIR, "src", "generated");
const DEFAULT_TARGET_DIR = path.join(REPO_ROOT, "apps", "web", "public", "data", "wcdraft");

const EXPECTED_FILES = ["manifest.json", "draft-pool.compact.json", "scenario-2026.compact.json"];

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
  const out = { sourceDir: DEFAULT_SOURCE_DIR, targetDir: DEFAULT_TARGET_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--source-dir" && typeof next === "string") {
      out.sourceDir = path.resolve(next);
      i += 1;
    } else if (arg === "--target-dir" && typeof next === "string") {
      out.targetDir = path.resolve(next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write("usage: copy-web-assets [--source-dir DIR] [--target-dir DIR]\n");
      process.exit(0);
    } else {
      throw new Error(`copy-web-assets: unrecognised argument: ${arg}`);
    }
  }
  return out;
}

async function main() {
  const { sourceDir, targetDir } = parseArgs(process.argv.slice(2));
  ensureDefaultSourceGenerated(sourceDir);

  const present = new Set(await readdir(sourceDir));
  const missing = EXPECTED_FILES.filter((f) => !present.has(f));
  if (missing.length > 0) {
    throw new Error(
      `copy-web-assets: missing generated bundles in ${sourceDir}: ${missing.join(", ")}. ` +
        `Run \`pnpm --filter @wcdraft/data run build:compact\` to regenerate.`,
    );
  }

  await mkdir(targetDir, { recursive: true });
  for (const file of EXPECTED_FILES) {
    await copyFile(path.join(sourceDir, file), path.join(targetDir, file));
  }
  process.stdout.write(
    `copy-web-assets: ok — copied ${EXPECTED_FILES.length} file(s) to ${targetDir}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`copy-web-assets: FATAL — ${err.message}\n`);
  process.exit(1);
});
