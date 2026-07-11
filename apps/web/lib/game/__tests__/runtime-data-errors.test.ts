import { describe, expect, it, vi } from "vitest";

import { RuntimeDataIntegrityError } from "@wcdraft/data/client";
import type { RuntimeDataManifest } from "@wcdraft/data";

import { loadGameDataUncached, type GameData } from "../data";
import { describeGameError, RuntimeDataLoadError, toRuntimeDataLoadError } from "../errors";

describe("runtime-data failure typing and player-facing recovery", () => {
  it("keeps corruption distinct from timeout/unavailable failures", () => {
    const corruptCause = new RuntimeDataIntegrityError(
      "digest_mismatch",
      "draft_pool",
      "test mismatch",
    );
    const abort = new DOMException("request timed out", "AbortError");
    const corrupt = toRuntimeDataLoadError("load failed", corruptCause);
    const timeout = toRuntimeDataLoadError("load failed", abort);
    const unavailable = toRuntimeDataLoadError("load failed", new TypeError("network offline"));

    expect(corrupt.kind).toBe("corrupt");
    expect(timeout.kind).toBe("timeout");
    expect(unavailable.kind).toBe("unavailable");
    expect(corrupt.cause).toBe(corruptCause);
    expect(timeout.cause).toBe(abort);
  });

  it("logs technical detail but returns stable player copy", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const display = describeGameError(
      new RuntimeDataLoadError(
        "corrupt",
        "HTTP 200 /data/wcdraft/runtime-data-2.9.0/draft-pool.compact.json.br SHA mismatch",
      ),
    );

    expect(display).toEqual({
      title: "Player database unavailable",
      message: "We couldn't load the player database. Please try again.",
      action: "reload",
    });
    expect(JSON.stringify(display)).not.toMatch(/HTTP|runtime-data|draft-pool|SHA/u);
    expect(consoleError).toHaveBeenCalledWith(
      "[game] runtime data load failed",
      expect.objectContaining({ kind: "corrupt", message: expect.stringContaining("SHA") }),
    );
    consoleError.mockRestore();
  });

  it("never constructs game data or version anchors after integrity failure", async () => {
    const manifest = {
      bundles: { draft_pool: {}, daily_seed_salt_map: undefined },
    } as unknown as RuntimeDataManifest;
    const build = vi.fn(() => ({}) as GameData);

    await expect(
      loadGameDataUncached({
        waitForHandoff: async () => undefined,
        loadManifest: async () => manifest,
        loadDraftPool: async () => {
          throw new RuntimeDataIntegrityError(
            "digest_mismatch",
            "draft_pool",
            "one-byte corruption",
          );
        },
        loadSaltMap: async () => {
          throw new Error("salt map should not load");
        },
        build,
      }),
    ).rejects.toBeInstanceOf(RuntimeDataIntegrityError);
    expect(build).not.toHaveBeenCalled();
  });

  it("draft error panel contract exposes both Retry and Home actions", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../../../components/game/draft-screen/index.tsx", import.meta.url), "utf8"),
    );
    expect(source).toContain(">\n            Retry\n");
    expect(source).toContain('<Link href="/" className="btn btn--ghost">');
    expect(source).toContain(">\n            Home\n");
  });
});
