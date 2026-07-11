import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import { describe, expect, it } from "vitest";

const SCRIPT_PATH = new URL("../scripts/copy-web-assets.mjs", import.meta.url);
const POLICY_SCRIPT_PATH = new URL("../scripts/runtime-artifact-closure.mjs", import.meta.url);
const WEB_PACKAGE_PATH = new URL("../../../apps/web/package.json", import.meta.url);
const CURRENT_VERSION = "runtime-data-2.9.0";
const RETAINED_VERSIONS = ["runtime-data-2.7.0", "runtime-data-2.8.0"] as const;

type FixtureBundleKey =
  | "draft_pool"
  | "scenario_2026"
  | "daily_seed_salt_map"
  | "score_distribution";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function brotli(buf: Buffer): Buffer {
  return brotliCompressSync(buf, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
}

function fixturePayloads(version: string): Record<FixtureBundleKey, Buffer> {
  return {
    draft_pool: Buffer.from(JSON.stringify({ schema_version: version, cards: ["P-1-2026"] })),
    scenario_2026: Buffer.from(JSON.stringify({ schema_version: version, teams: ["T-1"] })),
    daily_seed_salt_map: Buffer.from(
      JSON.stringify({ schema_version: version, salts: { "2026-07-11": "fixture" } }),
    ),
    score_distribution: Buffer.from(
      JSON.stringify({ schema_version: version, distributions: { classic: [1, 2, 3] } }),
    ),
  };
}

const BUNDLE_PATHS: Record<FixtureBundleKey, string> = {
  draft_pool: "draft-pool.compact.json",
  scenario_2026: "scenario-2026.compact.json",
  daily_seed_salt_map: "daily-seed-salt-map.compact.json",
  score_distribution: "score-distribution.compact.json",
};

async function writeVersionFixture(
  dir: string,
  version: string,
  {
    canonical,
    bundleKeys,
    includeRawDraft = false,
  }: {
    canonical: boolean;
    bundleKeys: readonly FixtureBundleKey[];
    includeRawDraft?: boolean;
  },
): Promise<Record<FixtureBundleKey, { raw: Buffer; compressed: Buffer }>> {
  await mkdir(dir, { recursive: true });
  const payloads = fixturePayloads(version);
  const artifacts = {} as Record<FixtureBundleKey, { raw: Buffer; compressed: Buffer }>;
  const bundles: Record<string, Record<string, unknown>> = {};

  for (const key of bundleKeys) {
    const raw = payloads[key];
    const compressed = brotli(raw);
    artifacts[key] = { raw, compressed };
    const base = {
      path: BUNDLE_PATHS[key],
      bytes: raw.length,
      bytes_gzip: 0,
      bytes_brotli: compressed.length,
      sha256: sha256(raw),
    };
    bundles[key] = canonical
      ? {
          ...base,
          raw_sha256: sha256(raw),
          compressed_sha256: sha256(compressed),
          compressed_bytes: compressed.length,
          brotli_impl_version: process.versions.brotli ?? "unknown",
          options: { quality: 11, mode: "text", size_hint: raw.length },
        }
      : base;

    if (key === "draft_pool") {
      await writeFile(path.join(dir, `${BUNDLE_PATHS[key]}.br`), compressed);
      if (includeRawDraft) await writeFile(path.join(dir, BUNDLE_PATHS[key]), raw);
    } else {
      await writeFile(path.join(dir, BUNDLE_PATHS[key]), raw);
      if (canonical) await writeFile(path.join(dir, `${BUNDLE_PATHS[key]}.br`), compressed);
    }
  }

  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({ schema_version: version, dataset_version: "fixture", bundles }),
  );
  return artifacts;
}

async function writeCompleteClosure(root: string): Promise<{
  sourceDir: string;
  retainedDir: string;
  currentDraft: Buffer;
  currentDraftBr: Buffer;
}> {
  const sourceDir = path.join(root, "source");
  const retainedDir = path.join(root, "retained");
  const current = await writeVersionFixture(sourceDir, CURRENT_VERSION, {
    canonical: true,
    bundleKeys: ["draft_pool", "scenario_2026", "daily_seed_salt_map", "score_distribution"],
    includeRawDraft: true,
  });
  await writeVersionFixture(path.join(retainedDir, RETAINED_VERSIONS[0]), RETAINED_VERSIONS[0], {
    canonical: false,
    bundleKeys: ["draft_pool", "scenario_2026"],
  });
  // A legacy retained manifest that advertises Daily + score distribution must
  // carry those raw files, but must not gain invented `.br` variants.
  await writeVersionFixture(path.join(retainedDir, RETAINED_VERSIONS[1]), RETAINED_VERSIONS[1], {
    canonical: false,
    bundleKeys: ["draft_pool", "scenario_2026", "daily_seed_salt_map", "score_distribution"],
  });
  return {
    sourceDir,
    retainedDir,
    currentDraft: current.draft_pool.raw,
    currentDraftBr: current.draft_pool.compressed,
  };
}

function copyArgs(sourceDir: string, targetDir: string, retainedDir: string): string[] {
  return [
    fileURLToPath(SCRIPT_PATH),
    "--source-dir",
    sourceDir,
    "--target-dir",
    targetDir,
    "--retained-dir",
    retainedDir,
  ];
}

function runCopy(sourceDir: string, targetDir: string, retainedDir: string): string {
  return execFileSync(process.execPath, copyArgs(sourceDir, targetDir, retainedDir), {
    encoding: "utf8",
  });
}

function runCopyFailure(sourceDir: string, targetDir: string, retainedDir: string): string {
  const result = spawnSync(process.execPath, copyArgs(sourceDir, targetDir, retainedDir), {
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  return result.stderr;
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, relative)));
    else files.push(relative);
  }
  return files.sort();
}

describe("copy-web-assets", () => {
  it("routes every web prehook through the fingerprint verifier/copier", async () => {
    const packageJson = JSON.parse(await readFile(WEB_PACKAGE_PATH, "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["runtime:materialize"]).toBe(
      "node ../../packages/data/scripts/copy-web-assets.mjs",
    );
    for (const hook of ["predev", "prebuild", "pretypecheck", "pretest"]) {
      expect(packageJson.scripts[hook], hook).toMatch(/^pnpm run runtime:materialize(?: &&|$)/u);
    }
  });

  it("materializes the manifest-derived N+1 current plus N=2 retained closure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-closure-"));
    const targetDir = path.join(root, "target");
    const { sourceDir, retainedDir, currentDraft, currentDraftBr } =
      await writeCompleteClosure(root);
    await mkdir(path.join(targetDir, "runtime-data-2.6.0"), { recursive: true });
    await writeFile(path.join(targetDir, "manifest.json"), "stale legacy root");
    await writeFile(path.join(targetDir, "runtime-data-2.6.0", "stale.json"), "stale");

    const output = runCopy(sourceDir, targetDir, retainedDir);
    expect(output).toContain("+ 2 retained prior schema(s)");
    expect(await readFile(POLICY_SCRIPT_PATH, "utf8")).toContain(
      "export const RETAINED_PRIOR_SCHEMA_COUNT = 2",
    );
    expect(await listFiles(targetDir)).toEqual([
      "runtime-data-2.7.0/draft-pool.compact.json.br",
      "runtime-data-2.7.0/manifest.json",
      "runtime-data-2.7.0/scenario-2026.compact.json",
      "runtime-data-2.8.0/daily-seed-salt-map.compact.json",
      "runtime-data-2.8.0/draft-pool.compact.json.br",
      "runtime-data-2.8.0/manifest.json",
      "runtime-data-2.8.0/scenario-2026.compact.json",
      "runtime-data-2.8.0/score-distribution.compact.json",
      "runtime-data-2.9.0/daily-seed-salt-map.compact.json",
      "runtime-data-2.9.0/daily-seed-salt-map.compact.json.br",
      "runtime-data-2.9.0/draft-pool.compact.json.br",
      "runtime-data-2.9.0/manifest.json",
      "runtime-data-2.9.0/scenario-2026.compact.json",
      "runtime-data-2.9.0/scenario-2026.compact.json.br",
      "runtime-data-2.9.0/score-distribution.compact.json",
      "runtime-data-2.9.0/score-distribution.compact.json.br",
    ]);

    const copiedDraft = await readFile(
      path.join(targetDir, CURRENT_VERSION, "draft-pool.compact.json.br"),
    );
    expect(copiedDraft.equals(currentDraftBr)).toBe(true);
    expect(brotliDecompressSync(copiedDraft).equals(currentDraft)).toBe(true);
    await expect(stat(path.join(targetDir, "manifest.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reuses every canonical current artifact byte-for-byte", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-reuse-"));
    const targetDir = path.join(root, "target");
    const { sourceDir, retainedDir } = await writeCompleteClosure(root);

    runCopy(sourceDir, targetDir, retainedDir);
    const first = await readFile(
      path.join(targetDir, CURRENT_VERSION, "draft-pool.compact.json.br"),
    );
    runCopy(sourceDir, targetDir, retainedDir);
    const second = await readFile(
      path.join(targetDir, CURRENT_VERSION, "draft-pool.compact.json.br"),
    );
    expect(second.equals(first)).toBe(true);
  });

  it("fails closed before output mutation when a current compressed fingerprint mismatches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-current-mismatch-"));
    const targetDir = path.join(root, "target");
    const { sourceDir, retainedDir } = await writeCompleteClosure(root);
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "sentinel"), "known-good-output");
    await writeFile(path.join(sourceDir, "draft-pool.compact.json.br"), Buffer.from("corrupt"));

    expect(runCopyFailure(sourceDir, targetDir, retainedDir)).toContain(
      "compressed fingerprint mismatch",
    );
    await expect(readFile(path.join(targetDir, "sentinel"), "utf8")).resolves.toBe(
      "known-good-output",
    );
  });

  it("fails closed before output mutation when an advertised retained file is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-retained-missing-"));
    const targetDir = path.join(root, "target");
    const { sourceDir, retainedDir } = await writeCompleteClosure(root);
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "sentinel"), "known-good-output");
    await rm(path.join(retainedDir, RETAINED_VERSIONS[1], "daily-seed-salt-map.compact.json"));

    expect(runCopyFailure(sourceDir, targetDir, retainedDir)).toContain(
      "missing daily-seed-salt-map.compact.json",
    );
    await expect(readFile(path.join(targetDir, "sentinel"), "utf8")).resolves.toBe(
      "known-good-output",
    );
  });

  it("fails closed when any advertised retained bundle fingerprint mismatches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-retained-mismatch-"));
    const targetDir = path.join(root, "target");
    const { sourceDir, retainedDir } = await writeCompleteClosure(root);
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "sentinel"), "known-good-output");
    await writeFile(
      path.join(retainedDir, RETAINED_VERSIONS[1], "score-distribution.compact.json"),
      "corrupt",
    );

    expect(runCopyFailure(sourceDir, targetDir, retainedDir)).toContain("raw fingerprint mismatch");
    await expect(readFile(path.join(targetDir, "sentinel"), "utf8")).resolves.toBe(
      "known-good-output",
    );
  });

  it("rejects manifest paths that could escape the version directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-unsafe-path-"));
    const targetDir = path.join(root, "target");
    const { sourceDir, retainedDir } = await writeCompleteClosure(root);
    const manifestPath = path.join(retainedDir, RETAINED_VERSIONS[1], "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      bundles: Record<string, { path: string }>;
    };
    manifest.bundles.score_distribution!.path = "../score-distribution.compact.json";
    await writeFile(manifestPath, JSON.stringify(manifest));

    expect(runCopyFailure(sourceDir, targetDir, retainedDir)).toContain(
      "path is not a safe relative path",
    );
    await expect(stat(targetDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("enforces exactly the two immediately prior schema versions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-policy-"));
    const targetDir = path.join(root, "target");
    const { sourceDir, retainedDir } = await writeCompleteClosure(root);
    await rm(path.join(retainedDir, RETAINED_VERSIONS[0]), { recursive: true });
    await writeVersionFixture(path.join(retainedDir, "runtime-data-2.6.0"), "runtime-data-2.6.0", {
      canonical: false,
      bundleKeys: ["draft_pool", "scenario_2026"],
    });

    expect(runCopyFailure(sourceDir, targetDir, retainedDir)).toContain(
      "requires exactly runtime-data-2.7.0, runtime-data-2.8.0",
    );
    await expect(stat(targetDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
