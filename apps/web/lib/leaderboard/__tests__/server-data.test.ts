import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { DEFAULT_RUNTIME_DATA_BASE_PATH } from "@wcdraft/data/client";
import { describe, expect, it } from "vitest";

import { buildServerGameData, resolveRuntimeDataDir, serverScenarioBundle } from "../server-data";

describe("leaderboard server runtime data", () => {
  it("resolves only the current schema-versioned directory from either supported cwd", async () => {
    const root = await mkdtemp(join(tmpdir(), "wcdraft-server-data-path-"));
    const webDir = join(root, "apps", "web");
    const versionedDir = join(webDir, "public", DEFAULT_RUNTIME_DATA_BASE_PATH);
    const legacyDir = join(webDir, "public", "data", "wcdraft");
    await mkdir(versionedDir, { recursive: true });
    await writeFile(join(versionedDir, "manifest.json"), "versioned");
    await writeFile(join(legacyDir, "manifest.json"), "legacy-must-not-win");

    expect(resolveRuntimeDataDir(root)).toBe(versionedDir);
    expect(resolveRuntimeDataDir(webDir)).toBe(versionedDir);
  });

  it("loads the canonical Brotli draft once per process and reuses parsed bundle objects", async () => {
    const first = buildServerGameData();
    const second = buildServerGameData();
    const firstScenario = serverScenarioBundle();
    const secondScenario = serverScenarioBundle();
    const versionedDir = resolveRuntimeDataDir();
    const legacyDir = dirname(versionedDir);

    expect(second.draftPool).toBe(first.draftPool);
    expect(second.manifest).toBe(first.manifest);
    expect(secondScenario).toBe(firstScenario);
    expect(versionedDir.endsWith(DEFAULT_RUNTIME_DATA_BASE_PATH)).toBe(true);
    await expect(
      stat(join(versionedDir, `${first.manifest.bundles.draft_pool.path}.br`)),
    ).resolves.toBeDefined();
    await expect(stat(join(legacyDir, "manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(join(legacyDir, first.manifest.bundles.draft_pool.path)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps share metadata on the same schema-versioned manifest path", async () => {
    const source = await readFile(
      new URL("../../../app/play/share/page.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("new URL(DEFAULT_RUNTIME_DATA_BASE_PATH, base)");
    expect(source).not.toContain('new URL("/data/wcdraft", base)');
  });
});
