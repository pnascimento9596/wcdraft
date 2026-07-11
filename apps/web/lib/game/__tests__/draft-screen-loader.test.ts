import { describe, expect, it, vi } from "vitest";

import type { GameData } from "../data";
import { RuntimeDataLoadError } from "../errors";
import { loadInitialDraftData } from "../../../components/game/draft-screen/use-draft-screen-loader";

const gameData = {} as GameData;

describe("Daily draft setup preflight", () => {
  it("returns terminal unavailable without starting full game-data loading", async () => {
    const loadDailyAvailability = vi.fn(async () => false);
    const loadGameData = vi.fn(async () => gameData);

    await expect(
      loadInitialDraftData(null, "2026-07-03", { loadDailyAvailability, loadGameData }),
    ).resolves.toEqual({ kind: "daily_unavailable" });
    expect(loadDailyAvailability).toHaveBeenCalledOnce();
    expect(loadDailyAvailability).toHaveBeenCalledWith("2026-07-03");
    expect(loadGameData).not.toHaveBeenCalled();
  });

  it("fails closed on lightweight availability errors without loading the pool path", async () => {
    const loadDailyAvailability = vi.fn(async () => {
      throw new Error("salt map unavailable");
    });
    const loadGameData = vi.fn(async () => gameData);

    await expect(
      loadInitialDraftData(null, "2026-07-03", { loadDailyAvailability, loadGameData }),
    ).resolves.toEqual({ kind: "daily_unavailable" });
    expect(loadGameData).not.toHaveBeenCalled();
  });

  it("preserves a translated metadata timeout for the retryable first-load panel", async () => {
    const timeout = new Error("timed out");
    timeout.name = "RequestTimeoutError";
    const translated = new RuntimeDataLoadError("Daily metadata took too long to load.", timeout);
    const loadDailyAvailability = vi.fn(async () => {
      throw translated;
    });
    const loadGameData = vi.fn(async () => gameData);

    await expect(
      loadInitialDraftData(null, "2026-07-03", { loadDailyAvailability, loadGameData }),
    ).rejects.toBe(translated);
    expect(loadGameData).not.toHaveBeenCalled();
  });

  it("loads full game data only after lightweight coverage succeeds", async () => {
    const order: string[] = [];
    const loadDailyAvailability = vi.fn(async (date: string) => {
      order.push(`availability:${date}`);
      return true;
    });
    const loadGameData = vi.fn(async () => {
      order.push("game-data");
      return gameData;
    });

    await expect(
      loadInitialDraftData(null, "2026-07-03", { loadDailyAvailability, loadGameData }),
    ).resolves.toEqual({ kind: "loaded", gameData });
    expect(order).toEqual(["availability:2026-07-03", "game-data"]);
  });

  it("preserves historical run-id resume without current rolling coverage", async () => {
    const loadDailyAvailability = vi.fn(async () => false);
    const loadGameData = vi.fn(async () => gameData);

    await expect(
      loadInitialDraftData("historical-run", "2026-06-29", {
        loadDailyAvailability,
        loadGameData,
      }),
    ).resolves.toEqual({ kind: "loaded", gameData });
    expect(loadDailyAvailability).not.toHaveBeenCalled();
    expect(loadGameData).toHaveBeenCalledOnce();
  });
});
