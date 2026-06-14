import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import { describe, expect, it } from "vitest";

const SCRIPT_PATH = new URL("../scripts/copy-web-assets.mjs", import.meta.url);

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function brotli(buf: Buffer): Buffer {
  return brotliCompressSync(buf, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
}

async function writeRuntimeFixture(
  dir: string,
  version: string,
): Promise<{
  draft: Buffer;
  scenario: Buffer;
}> {
  await mkdir(dir, { recursive: true });
  const draft = Buffer.from(JSON.stringify({ schema_version: version, cards: ["P-1-2026"] }));
  const scenario = Buffer.from(JSON.stringify({ schema_version: version, teams: ["T-1"] }));
  const manifest = {
    schema_version: version,
    dataset_version: "fixture",
    bundles: {
      draft_pool: {
        path: "draft-pool.compact.json",
        bytes: draft.length,
        bytes_gzip: 0,
        bytes_brotli: 0,
        sha256: sha256(draft),
      },
      scenario_2026: {
        path: "scenario-2026.compact.json",
        bytes: scenario.length,
        bytes_gzip: 0,
        bytes_brotli: 0,
        sha256: sha256(scenario),
      },
    },
  };

  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(dir, "draft-pool.compact.json"), draft);
  await writeFile(path.join(dir, "scenario-2026.compact.json"), scenario);
  return { draft, scenario };
}

async function writeRetainedFixture(root: string, version: string): Promise<Buffer> {
  const versionDir = path.join(root, version);
  const { draft } = await writeRuntimeFixture(versionDir, version);
  await writeFile(path.join(versionDir, "draft-pool.compact.json.br"), brotli(draft));
  return draft;
}

describe("copy-web-assets", () => {
  it("writes a versioned compressed draft pool whose decompressed bytes match the manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-"));
    const sourceDir = path.join(root, "source");
    const targetDir = path.join(root, "target");
    const retainedDir = path.join(root, "retained");
    const { draft } = await writeRuntimeFixture(sourceDir, "runtime-data-fixture");

    execFileSync(process.execPath, [
      fileURLToPath(SCRIPT_PATH),
      "--source-dir",
      sourceDir,
      "--target-dir",
      targetDir,
      "--retained-dir",
      retainedDir,
    ]);

    await expect(stat(path.join(targetDir, "draft-pool.compact.json"))).resolves.toBeDefined();
    await expect(
      stat(path.join(targetDir, "runtime-data-fixture", "draft-pool.compact.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const compressed = await readFile(
      path.join(targetDir, "runtime-data-fixture", "draft-pool.compact.json.br"),
    );
    expect(brotliDecompressSync(compressed).equals(draft)).toBe(true);
    expect(sha256(brotliDecompressSync(compressed))).toBe(sha256(draft));
  });

  it("copies retained prior versions alongside the current version", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-retained-"));
    const sourceDir = path.join(root, "source");
    const targetDir = path.join(root, "target");
    const retainedDir = path.join(root, "retained");
    await writeRuntimeFixture(sourceDir, "runtime-data-next");
    const retainedDraft = await writeRetainedFixture(retainedDir, "runtime-data-prev");

    execFileSync(process.execPath, [
      fileURLToPath(SCRIPT_PATH),
      "--source-dir",
      sourceDir,
      "--target-dir",
      targetDir,
      "--retained-dir",
      retainedDir,
    ]);

    const retainedCompressed = await readFile(
      path.join(targetDir, "runtime-data-prev", "draft-pool.compact.json.br"),
    );
    expect(brotliDecompressSync(retainedCompressed).equals(retainedDraft)).toBe(true);
    await expect(
      stat(path.join(targetDir, "runtime-data-next", "draft-pool.compact.json.br")),
    ).resolves.toBeDefined();
  });
});
