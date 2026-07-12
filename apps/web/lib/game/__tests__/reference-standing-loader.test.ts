import { beforeEach, describe, expect, it, vi } from "vitest";

const loaders = vi.hoisted(() => ({
  gameData: vi.fn(),
  distribution: vi.fn(),
}));

vi.mock("../data", () => ({ loadGameData: loaders.gameData }));
vi.mock("@wcdraft/data/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wcdraft/data/client")>()),
  loadScoreDistribution: loaders.distribution,
}));

import {
  loadScoreDistributionOnce,
  resetScoreDistributionCacheForTests,
} from "../reference-standing";

beforeEach(() => {
  vi.clearAllMocks();
  resetScoreDistributionCacheForTests();
});

describe("reference standing loader diagnostics", () => {
  it("fails soft while retaining the typed integrity diagnostic in the console", async () => {
    const manifest = { schema_version: "runtime-data-2.9.0" };
    const integrityFailure = Object.assign(new Error("received SHA-256 did not match"), {
      name: "RuntimeDataIntegrityError",
      failure: "digest_mismatch",
      bundleKey: "score_distribution",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    loaders.gameData.mockResolvedValue({ manifest });
    loaders.distribution.mockRejectedValue(integrityFailure);

    await expect(loadScoreDistributionOnce()).resolves.toBeNull();
    expect(loaders.distribution).toHaveBeenCalledWith({ manifest });
    expect(consoleError).toHaveBeenCalledWith(
      "[reference-standing] score distribution unavailable",
      integrityFailure,
    );
    consoleError.mockRestore();
  });
});
