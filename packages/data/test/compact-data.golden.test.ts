// Determinism + size-budget gate for the compact runtime bundles.
//
// Re-runs the deterministic builder into a temp directory and asserts:
//   1. byte-identical output vs the generated `src/generated/*.json` artifacts
//      (the largest blob is regenerated on demand and locked by manifest/report
//      fingerprints, so drift in the builder, inputs, or sort logic fails CI);
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
import { brotliDecompressSync } from "node:zlib";

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { MaterializedRuntimeBundleFingerprint, RuntimeDataManifest } from "../src/types.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(TEST_DIR, "..");
const GENERATED_DIR = path.join(PACKAGE_DIR, "src", "generated");
const SCRIPT_PATH = path.join(PACKAGE_DIR, "scripts", "build-compact-data.mjs");
const BUDGET_PATH = path.join(PACKAGE_DIR, "size-budget.json");
const SIZE_REPORT_PATH = path.join(PACKAGE_DIR, "reports", "compact-size.json");
const BUNDLE_FILES = ["manifest.json", "draft-pool.compact.json", "scenario-2026.compact.json"];
const FINGERPRINT_FILES = [
  ...BUNDLE_FILES,
  "score-distribution.compact.json",
  "daily-seed-salt-map.compact.json",
];
const MATERIALIZED_FILES = [...BUNDLE_FILES, ...FINGERPRINT_FILES.map((file) => `${file}.br`)];
const GENERATED_FILES = [...new Set([...MATERIALIZED_FILES, ...FINGERPRINT_FILES])];
// Cold shared CI runners can spend more than ten minutes re-running the full
// compact-data builder when package tests contend for CPU. Keep this timeout
// scoped to the golden rebuild rather than relaxing unrelated data tests.
const COMPACT_GOLDEN_REBUILD_TIMEOUT_MS = 1_200_000;

interface SizeBudget {
  bundles: Record<string, { max_bytes_brotli: number; path: string }>;
  total_max_bytes_brotli: number;
}

interface SizeReport {
  bundles: Record<string, MaterializedRuntimeBundleFingerprint>;
  total_brotli_bytes: number;
  total_gzip_bytes: number;
  total_raw_bytes: number;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

interface MeasuredFingerprint {
  path: string;
  bytes: number;
  raw_sha256: string;
  compressed_bytes: number;
  compressed_sha256: string;
}

function measuredFingerprint(
  fps: Record<string, MeasuredFingerprint>,
  key: string,
): MeasuredFingerprint {
  const fp = fps[key];
  if (!fp) throw new Error(`missing cached fingerprint for ${key}`);
  return fp;
}

describe("compact-data golden", () => {
  let tmpDir: string;
  let rebuilt: Record<string, Buffer>;
  let generated: Record<string, Buffer>;
  let generatedFingerprints: Record<string, MeasuredFingerprint>;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "wcdraft-data-golden-"));
    const result = spawnSync(process.execPath, [SCRIPT_PATH, "--out-dir", tmpDir], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `build-compact-data exited ${result.status}. stderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
      );
    }
    rebuilt = Object.fromEntries(
      MATERIALIZED_FILES.map((f) => [f, readFileSync(path.join(tmpDir, f))]),
    );
    generated = Object.fromEntries(
      GENERATED_FILES.map((f) => [f, readFileSync(path.join(GENERATED_DIR, f))]),
    );
    generatedFingerprints = Object.fromEntries(
      FINGERPRINT_FILES.map((f) => [
        f === "draft-pool.compact.json"
          ? "draft_pool"
          : f === "scenario-2026.compact.json"
            ? "scenario_2026"
            : f === "score-distribution.compact.json"
              ? "score_distribution"
              : f === "daily-seed-salt-map.compact.json"
                ? "daily_seed_salt_map"
                : "manifest",
        {
          path: f,
          bytes: generated[f]!.length,
          raw_sha256: sha256Hex(generated[f]!),
          compressed_bytes: generated[`${f}.br`]!.length,
          compressed_sha256: sha256Hex(generated[`${f}.br`]!),
        },
      ]),
    );
  }, COMPACT_GOLDEN_REBUILD_TIMEOUT_MS);

  afterAll(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(MATERIALIZED_FILES)(
    "rebuilds %s byte-identical to the generated locked artifact (two-build hash stability)",
    (file) => {
      const a = sha256Hex(generated[file]!);
      const b = sha256Hex(rebuilt[file]!);
      expect(b, `${file} rebuild diverged from the generated locked bytes`).toBe(a);
    },
  );

  it.each(FINGERPRINT_FILES)(
    "emits %s as canonical minified JSON with parsed equality to readable JSON",
    (file) => {
      const minified = generated[file]!.toString("utf8");
      const parsedMinified = JSON.parse(minified) as unknown;
      const readable = `${JSON.stringify(parsedMinified, null, 2)}\n`;
      const parsedReadable = JSON.parse(readable) as unknown;

      expect(parsedMinified).toEqual(parsedReadable);
      expect(minified).toBe(JSON.stringify(parsedMinified));
      expect(minified.endsWith("\n")).toBe(false);
    },
  );

  it("manifest fingerprints match the on-disk bundle bytes (no manifest-vs-bundle skew)", () => {
    const manifest = JSON.parse(
      generated["manifest.json"]!.toString("utf8"),
    ) as RuntimeDataManifest;
    for (const [key, bundlePath] of [
      ["draft_pool", "draft-pool.compact.json"] as const,
      ["scenario_2026", "scenario-2026.compact.json"] as const,
      ["score_distribution", "score-distribution.compact.json"] as const,
      ["daily_seed_salt_map", "daily-seed-salt-map.compact.json"] as const,
    ]) {
      const fp = manifest.bundles[key];
      expect(fp, `${key} manifest fingerprint`).toBeDefined();
      if (!fp) continue;
      const onDisk = generated[bundlePath]!;
      const measured = measuredFingerprint(generatedFingerprints, key);
      expect(fp.path).toBe(bundlePath);
      expect(fp.bytes, `${key} bytes`).toBe(onDisk.length);
      expect(fp.sha256, `${key} sha256`).toBe(measured.raw_sha256);
      expect(fp.raw_sha256, `${key} raw sha256`).toBe(measured.raw_sha256);
      expect(fp.compressed_sha256, `${key} compressed sha256`).toBe(measured.compressed_sha256);
      expect(fp.compressed_bytes, `${key} compressed bytes`).toBe(measured.compressed_bytes);
      expect(fp.bytes_brotli, `${key} brotli alias`).toBe(measured.compressed_bytes);
      expect(fp.brotli_impl_version).toBe(process.versions.brotli);
      expect(fp.options).toEqual({ quality: 11, mode: "text", size_hint: onDisk.length });
      expect(brotliDecompressSync(generated[`${bundlePath}.br`]!).equals(onDisk)).toBe(true);
    }
  });

  it("each bundle is within the committed brotli size budget", () => {
    const budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8")) as SizeBudget;
    let totalMeasured = 0;
    for (const [key, { max_bytes_brotli }] of Object.entries(budget.bundles)) {
      const measured = measuredFingerprint(generatedFingerprints, key).compressed_bytes;
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

  it("tracked reports/compact-size.json matches the live measurement", () => {
    const report = JSON.parse(readFileSync(SIZE_REPORT_PATH, "utf8")) as SizeReport;
    for (const [key, bundlePath] of [
      ["draft_pool", "draft-pool.compact.json"] as const,
      ["scenario_2026", "scenario-2026.compact.json"] as const,
      ["manifest", "manifest.json"] as const,
    ]) {
      const bytes = generated[bundlePath]!;
      const fp = report.bundles[key];
      const measured = measuredFingerprint(generatedFingerprints, key);
      expect(fp).toBeDefined();
      expect(fp!.path).toBe(bundlePath);
      expect(fp!.bytes, `${key} report bytes`).toBe(bytes.length);
      expect(fp!.sha256, `${key} report sha256`).toBe(measured.raw_sha256);
      expect(fp!.raw_sha256, `${key} report raw sha256`).toBe(measured.raw_sha256);
      expect(fp!.compressed_sha256, `${key} report compressed sha256`).toBe(
        measured.compressed_sha256,
      );
      expect(fp!.compressed_bytes, `${key} report compressed bytes`).toBe(
        measured.compressed_bytes,
      );
      expect(fp!.bytes_brotli, `${key} report brotli alias`).toBe(measured.compressed_bytes);
      expect(fp!.options).toEqual({ quality: 11, mode: "text", size_hint: bytes.length });
    }
  });
});
