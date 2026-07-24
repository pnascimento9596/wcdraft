import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Spin } from "@wcdraft/core";

import {
  isSpinSkipUnlocked,
  readLocalFlag,
  shouldShowSpinSkipHint,
  SKIP_SPIN_ANIMATIONS_STORAGE_KEY,
  SPIN_SKIP_HINT_SEEN_STORAGE_KEY,
  SPIN_SKIP_READY_STORAGE_KEY,
  SPIN_SKIP_UNLOCK_MS,
  writeLocalFlag,
} from "../spin-skip-prefs";
import { skipSpinAnimState } from "../../../components/game/slot-machine";
import type { GameDataIndexes } from "../data";
import { buildSlotRevealModel } from "../slot-reveal";

describe("spin skip unlock threshold", () => {
  it("unlocks at the spin-start threshold, not only at settle", () => {
    expect(SPIN_SKIP_UNLOCK_MS).toBe(300);
    expect(isSpinSkipUnlocked(0, false)).toBe(false);
    expect(isSpinSkipUnlocked(299, false)).toBe(false);
    expect(isSpinSkipUnlocked(300, false)).toBe(true);
    expect(isSpinSkipUnlocked(0, true)).toBe(true);
  });

  it("shows the first-time hint only while spinning and not yet dismissed", () => {
    expect(shouldShowSpinSkipHint(true, false, true)).toBe(true);
    expect(shouldShowSpinSkipHint(true, true, true)).toBe(false);
    expect(shouldShowSpinSkipHint(true, false, false)).toBe(false);
    expect(shouldShowSpinSkipHint(false, false, true)).toBe(false);
  });
});

describe("spin skip localStorage persistence", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists taught skip across a simulated new session", () => {
    expect(readLocalFlag(SPIN_SKIP_READY_STORAGE_KEY)).toBe(false);
    writeLocalFlag(SPIN_SKIP_READY_STORAGE_KEY, true);
    // Simulate a new page load / session: re-read from durable storage.
    expect(readLocalFlag(SPIN_SKIP_READY_STORAGE_KEY)).toBe(true);
    expect(store.get(SPIN_SKIP_READY_STORAGE_KEY)).toBe("1");
  });

  it("persists the presentation-only skip-animations toggle without touching tokens", () => {
    expect(readLocalFlag(SKIP_SPIN_ANIMATIONS_STORAGE_KEY)).toBe(false);
    writeLocalFlag(SKIP_SPIN_ANIMATIONS_STORAGE_KEY, true);
    expect(readLocalFlag(SKIP_SPIN_ANIMATIONS_STORAGE_KEY)).toBe(true);
    writeLocalFlag(SPIN_SKIP_HINT_SEEN_STORAGE_KEY, true);
    expect(readLocalFlag(SPIN_SKIP_HINT_SEEN_STORAGE_KEY)).toBe(true);
  });
});

function makeSpin(
  index: number,
  nationId: string,
  tournamentId: number,
  opts: { rare?: boolean; draw_probability?: number } = {},
): Spin {
  return {
    index,
    tournament_id: tournamentId,
    nation_id: nationId,
    rolled_card_ids: [],
    excluded_player_ids: [],
    rolled_manager_card_id: null,
    rare: opts.rare ?? false,
    draw_probability: opts.draw_probability ?? 0.062,
    status: "pending",
    picked_kind: null,
    picked_player_id: null,
    picked_manager_card_id: null,
    assigned_slot_id: null,
  } as unknown as Spin;
}

function makeIndexes(): GameDataIndexes {
  const nationById = new Map<string, { canonical_name: string; code: string | null }>([
    ["T-03", { canonical_name: "Argentina", code: "ARG" }],
    ["T-09", { canonical_name: "Brazil", code: "BRA" }],
    ["T-30", { canonical_name: "France", code: "FRA" }],
    ["T-31", { canonical_name: "Germany", code: "DEU" }],
    ["T-41", { canonical_name: "Italy", code: "ITA" }],
  ]);
  const tournamentById = new Map<number, { year: number; name: string }>([
    [1, { year: 1986, name: "1986 World Cup" }],
    [2, { year: 1994, name: "1994 World Cup" }],
    [3, { year: 1998, name: "1998 World Cup" }],
    [4, { year: 2002, name: "2002 World Cup" }],
    [5, { year: 2014, name: "2014 World Cup" }],
  ]);
  return {
    playerByCardId: new Map(),
    managerByCardId: new Map(),
    ratingByCardId: new Map(),
    nationById,
    displayNameByCardId: new Map(),
    tournamentById,
  };
}

const SPINS: readonly Spin[] = [
  makeSpin(0, "T-03", 1),
  makeSpin(1, "T-09", 2),
  makeSpin(2, "T-30", 3),
  makeSpin(3, "T-31", 4),
  makeSpin(4, "T-41", 5),
];

describe("spin skip does not alter deterministic landings", () => {
  // Five mode labels as presentation fixtures; the slot model is mode-agnostic.
  const modes = ["classic", "hidden", "open", "legends", "daily"] as const;

  it("produces byte-identical landings with skip used / unused / reduced-motion paths", () => {
    const indexes = makeIndexes();
    for (const mode of modes) {
      void mode;
      const params = {
        activeSpin: SPINS[2]!,
        allSpins: SPINS,
        indexes,
        totalPicks: 17,
      } as const;
      const modelFull = buildSlotRevealModel(params);
      const modelSkip = buildSlotRevealModel(params);
      const modelReduced = buildSlotRevealModel(params);
      // Presentation paths: full spin, skip mid-spin, reduced-motion instant settle.
      expect(skipSpinAnimState("spinning", false)).toBe("spinning");
      expect(skipSpinAnimState("spinning", true)).toBe("settled");
      expect(skipSpinAnimState("idle", true)).toBe("idle");
      expect(JSON.stringify(modelFull)).toBe(JSON.stringify(modelSkip));
      expect(JSON.stringify(modelFull)).toBe(JSON.stringify(modelReduced));
      expect(modelFull.result.nationId).toBe("T-30");
      expect(modelFull.result.yearLabel).toBe("1998");
    }
  });
});
