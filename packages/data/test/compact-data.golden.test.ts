// Determinism + size-budget gate for the compact runtime bundles.
//
// Re-runs the deterministic builder into a temp directory and asserts:
//   1. byte-identical output vs the committed `src/generated/*.json` (so a
//      drift in the builder, the input data, or the sort logic fails CI);
//   2. each bundle's normalized brotli-compressed size stays under the budget
//      committed in `size-budget.json` (measured-then-committed brotli + 15%
//      headroom);
//   3. the manifest's per-bundle sha256/bytes/bytes_brotli match the on-disk
//      files (no manifest-vs-bundle skew);
//   4. the size report shipped at `reports/compact-size.json` matches the
//      live measurement (so the committed report stays in sync).
//
// This test is the test:golden:data root and is registered in turbo.json.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { RuntimeDataManifest } from "../src/types.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIR, "..");
const COMMITTED_DIR = path.join(PACKAGE_DIR, "src", "generated");
const SCRIPT_PATH = path.join(PACKAGE_DIR, "scripts", "build-compact-data.mjs");
const BUDGET_PATH = path.join(PACKAGE_DIR, "size-budget.json");
const SIZE_REPORT_PATH = path.join(PACKAGE_DIR, "reports", "compact-size.json");
const BUNDLE_FILES = ["manifest.json", "draft-pool.compact.json", "scenario-2026.compact.json"];
const BROTLI_METADATA_BUCKET_BYTES = 128;
// Cold CI runners can spend several minutes re-running the full compact-data
// builder before these assertions execute; keep this timeout scoped to the
// golden rebuild rather than relaxing unrelated data tests.
const COMPACT_GOLDEN_REBUILD_TIMEOUT_MS = 600_000;

interface SizeBudget {
  bundles: Record<string, { max_bytes_brotli: number; path: string }>;
  total_max_bytes_brotli: number;
}

interface SizeReport {
  bundles: Record<
    string,
    { bytes: number; bytes_brotli: number; bytes_gzip: number; path: string; sha256: string }
  >;
  total_brotli_bytes: number;
  total_gzip_bytes: number;
  total_raw_bytes: number;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function brotliLen(buf: Buffer): number {
  const measured = brotliCompressSync(buf, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
    },
  }).length;
  return Math.ceil(measured / BROTLI_METADATA_BUCKET_BYTES) * BROTLI_METADATA_BUCKET_BYTES;
}

function measuredFingerprint(
  fps: SizeReport["bundles"],
  key: keyof SizeReport["bundles"],
): SizeReport["bundles"][keyof SizeReport["bundles"]] {
  const fp = fps[key];
  if (!fp) throw new Error(`missing cached fingerprint for ${key}`);
  return fp;
}

describe("compact-data golden", () => {
  let tmpDir: string;
  let rebuilt: Record<string, Buffer>;
  let committed: Record<string, Buffer>;
  let committedFingerprints: SizeReport["bundles"];

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "wcdraft-data-golden-"));
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--out-dir", tmpDir],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(
        `build-compact-data exited ${result.status}. stderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
      );
    }
    rebuilt = Object.fromEntries(BUNDLE_FILES.map((f) => [f, readFileSync(path.join(tmpDir, f))]));
    committed = Object.fromEntries(
      BUNDLE_FILES.map((f) => [f, readFileSync(path.join(COMMITTED_DIR, f))]),
    );
    committedFingerprints = Object.fromEntries(
      BUNDLE_FILES.map((f) => [
        f === "draft-pool.compact.json"
          ? "draft_pool"
          : f === "scenario-2026.compact.json"
            ? "scenario_2026"
            : "manifest",
        {
          path: f,
          bytes: committed[f]!.length,
          sha256: sha256Hex(committed[f]!),
          bytes_brotli: brotliLen(committed[f]!),
          bytes_gzip: 0,
        },
      ]),
    ) as SizeReport["bundles"];
  }, COMPACT_GOLDEN_REBUILD_TIMEOUT_MS);

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(BUNDLE_FILES)(
    "rebuilds %s byte-identical to the committed artifact (two-build hash stability)",
    (file) => {
      const a = sha256Hex(committed[file]!);
      const b = sha256Hex(rebuilt[file]!);
      expect(b, `${file} rebuild diverged from the committed bytes`).toBe(a);
    },
  );

  it("manifest fingerprints match the on-disk bundle bytes (no manifest-vs-bundle skew)", () => {
    const manifest = JSON.parse(committed["manifest.json"]!.toString("utf8")) as RuntimeDataManifest;
    for (const [key, bundlePath] of [
      ["draft_pool", "draft-pool.compact.json"] as const,
      ["scenario_2026", "scenario-2026.compact.json"] as const,
    ]) {
      const fp = manifest.bundles[key];
      const onDisk = committed[bundlePath]!;
      const measured = measuredFingerprint(committedFingerprints, key);
      expect(fp.path).toBe(bundlePath);
      expect(fp.bytes, `${key} bytes`).toBe(onDisk.length);
      expect(fp.sha256, `${key} sha256`).toBe(measured.sha256);
      expect(fp.bytes_brotli, `${key} brotli`).toBe(measured.bytes_brotli);
    }
  });

  it("each bundle is within the committed brotli size budget", () => {
    const budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8")) as SizeBudget;
    let totalMeasured = 0;
    for (const [key, { max_bytes_brotli }] of Object.entries(budget.bundles)) {
      const measured = measuredFingerprint(
        committedFingerprints,
        key as keyof SizeReport["bundles"],
      ).bytes_brotli;
      totalMeasured += measured;
      expect(
        measured,
        `${key}: brotli ${measured} bytes exceeds committed budget ${max_bytes_brotli} bytes. Re-measure and bump size-budget.json with explicit justification.`,
      ).toBeLessThanOrEqual(max_bytes_brotli);
    }
    expect(
      totalMeasured,
      `total brotli ${totalMeasured} exceeds budget ${budget.total_max_bytes_brotli}.`,
    ).toBeLessThanOrEqual(budget.total_max_bytes_brotli);
  });

  it("committed reports/compact-size.json matches the live measurement", () => {
    const report = JSON.parse(readFileSync(SIZE_REPORT_PATH, "utf8")) as SizeReport;
    for (const [key, bundlePath] of [
      ["draft_pool", "draft-pool.compact.json"] as const,
      ["scenario_2026", "scenario-2026.compact.json"] as const,
      ["manifest", "manifest.json"] as const,
    ]) {
      const bytes = committed[bundlePath]!;
      const fp = report.bundles[key];
      const measured = measuredFingerprint(committedFingerprints, key);
      expect(fp).toBeDefined();
      expect(fp!.path).toBe(bundlePath);
      expect(fp!.bytes, `${key} report bytes`).toBe(bytes.length);
      expect(fp!.sha256, `${key} report sha256`).toBe(measured.sha256);
      expect(fp!.bytes_brotli, `${key} report brotli`).toBe(measured.bytes_brotli);
    }
  });
});
