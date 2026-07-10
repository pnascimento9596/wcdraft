import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import { describe, expect, it } from "vitest";

const SCRIPT_PATH = new URL("../scripts/copy-web-assets.mjs", import.meta.url);
const WEB_PACKAGE_PATH = new URL("../../../apps/web/package.json", import.meta.url);

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

async function writeRuntimeFixture(
  dir: string,
  version: string,
): Promise<{
  draft: Buffer;
  draftBr: Buffer;
  scenario: Buffer;
}> {
  await mkdir(dir, { recursive: true });
  const draft = Buffer.from(JSON.stringify({ schema_version: version, cards: ["P-1-2026"] }));
  const scenario = Buffer.from(JSON.stringify({ schema_version: version, teams: ["T-1"] }));
  const draftBr = brotli(draft);
  const scenarioBr = brotli(scenario);
  const fingerprint = (raw: Buffer, compressed: Buffer, bundlePath: string) => ({
    path: bundlePath,
    bytes: raw.length,
    bytes_gzip: 0,
    bytes_brotli: compressed.length,
    sha256: sha256(raw),
    raw_sha256: sha256(raw),
    compressed_sha256: sha256(compressed),
    compressed_bytes: compressed.length,
    brotli_impl_version: process.versions.brotli ?? "unknown",
    options: { quality: 11, mode: "text", size_hint: raw.length },
  });
  const manifest = {
    schema_version: version,
    dataset_version: "fixture",
    bundles: {
      draft_pool: fingerprint(draft, draftBr, "draft-pool.compact.json"),
      scenario_2026: fingerprint(scenario, scenarioBr, "scenario-2026.compact.json"),
    },
  };

  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  await writeFile(path.join(dir, "draft-pool.compact.json"), draft);
  await writeFile(path.join(dir, "draft-pool.compact.json.br"), draftBr);
  await writeFile(path.join(dir, "scenario-2026.compact.json"), scenario);
  await writeFile(path.join(dir, "scenario-2026.compact.json.br"), scenarioBr);
  return { draft, draftBr, scenario };
}

async function writeRetainedFixture(root: string, version: string): Promise<Buffer> {
  const versionDir = path.join(root, version);
  const { draft } = await writeRuntimeFixture(versionDir, version);
  await writeFile(path.join(versionDir, "draft-pool.compact.json.br"), brotli(draft));
  return draft;
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

  it("writes a versioned compressed draft pool whose decompressed bytes match the manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-"));
    const sourceDir = path.join(root, "source");
    const targetDir = path.join(root, "target");
    const retainedDir = path.join(root, "retained");
    const { draft, draftBr } = await writeRuntimeFixture(sourceDir, "runtime-data-fixture");
    await rm(path.join(sourceDir, "draft-pool.compact.json"));

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
    expect(compressed.equals(draftBr)).toBe(true);
    expect(brotliDecompressSync(compressed).equals(draft)).toBe(true);
    expect(sha256(brotliDecompressSync(compressed))).toBe(sha256(draft));
  });

  it("reuses the canonical current artifact byte-for-byte on unchanged copies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-reuse-"));
    const sourceDir = path.join(root, "source");
    const targetDir = path.join(root, "target");
    const retainedDir = path.join(root, "retained");
    const { draftBr } = await writeRuntimeFixture(sourceDir, "runtime-data-reuse");
    const args = [
      fileURLToPath(SCRIPT_PATH),
      "--source-dir",
      sourceDir,
      "--target-dir",
      targetDir,
      "--retained-dir",
      retainedDir,
    ];

    execFileSync(process.execPath, args);
    const first = await readFile(
      path.join(targetDir, "runtime-data-reuse", "draft-pool.compact.json.br"),
    );
    execFileSync(process.execPath, args);
    const second = await readFile(
      path.join(targetDir, "runtime-data-reuse", "draft-pool.compact.json.br"),
    );

    expect(first.equals(draftBr)).toBe(true);
    expect(second.equals(first)).toBe(true);
  });

  it("fails closed before copy when a compressed fingerprint mismatches", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wcdraft-copy-assets-mismatch-"));
    const sourceDir = path.join(root, "source");
    const targetDir = path.join(root, "target");
    const retainedDir = path.join(root, "retained");
    await writeRuntimeFixture(sourceDir, "runtime-data-mismatch");
    await writeFile(path.join(sourceDir, "draft-pool.compact.json.br"), Buffer.from("corrupt"));

    expect(() =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(SCRIPT_PATH),
          "--source-dir",
          sourceDir,
          "--target-dir",
          targetDir,
          "--retained-dir",
          retainedDir,
        ],
        { stdio: "pipe" },
      ),
    ).toThrow();
    await expect(stat(path.join(targetDir, "manifest.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
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
