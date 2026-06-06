// Unit tests for the results-adapters scorer-name resolution. Verifies the
// honest-state contract: when an event's card_id is outside the draft pool
// (or null), `resolveScorerName` returns "—" — NEVER the raw player_id, NEVER
// a fabricated name.
//
// Background — review on PR #18 caught the prior implementation falling back
// to the raw `player_id` when the card lookup missed, which leaks internal
// vocabulary into the UI and violates the honest-state rule.

import { describe, expect, it } from "vitest";

import type { GameData, GameDataIndexes } from "../data";
import { resolveScorerName } from "../results-adapters";

// ─── Minimal GameData stub ───────────────────────────────────────────────────
//
// The adapter reads ONLY `gameData.indexes.playerByCardId`. We expose a stub
// matching the surface the function touches; the cast at the boundary is a
// narrow test-only escape hatch.

function makeStub(
  entries: Array<{ card_id: string; common_name: string; full_name: string }>,
): GameData {
  const playerByCardId = new Map<string, { common_name: string; full_name: string }>();
  for (const e of entries) {
    playerByCardId.set(e.card_id, { common_name: e.common_name, full_name: e.full_name });
  }
  const indexes = {
    playerByCardId,
    managerByCardId: new Map(),
    ratingByCardId: new Map(),
    nationById: new Map(),
    tournamentById: new Map(),
  } as unknown as GameDataIndexes;
  return { indexes } as unknown as GameData;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("resolveScorerName — honest-state fallback", () => {
  it("returns the card's common_name when the card is in the pool", () => {
    const gd = makeStub([
      { card_id: "card-1", common_name: "Pelé", full_name: "Edson Arantes do Nascimento" },
    ]);
    expect(resolveScorerName(gd, "player-1", "card-1")).toBe("Pelé");
  });

  it("falls back to full_name when common_name is empty / whitespace", () => {
    const gd = makeStub([
      { card_id: "card-2", common_name: "   ", full_name: "Full Name Here" },
    ]);
    expect(resolveScorerName(gd, "player-2", "card-2")).toBe("Full Name Here");
  });

  it("returns '—' when card_id is null (no resolution possible)", () => {
    const gd = makeStub([]);
    expect(resolveScorerName(gd, "player-x", null)).toBe("—");
  });

  it("returns '—' when card_id is unresolved — never leaks the raw player_id", () => {
    // CRITICAL REGRESSION: pre-fix behaviour was to return `player_id`
    // verbatim when the card lookup missed. This test pins the new behaviour:
    // raw ids must never reach the UI.
    const gd = makeStub([]);
    const got = resolveScorerName(gd, "unknown-player-id-12345", "unknown-card-id");
    expect(got).toBe("—");
    expect(got).not.toBe("unknown-player-id-12345");
    expect(got).not.toContain("unknown");
  });

  it("returns '—' when both player_id and card_id are null", () => {
    const gd = makeStub([]);
    expect(resolveScorerName(gd, null, null)).toBe("—");
  });

  it("prefers the card-resolved name over the player_id when both are provided", () => {
    const gd = makeStub([
      { card_id: "card-3", common_name: "Maradona", full_name: "Diego Armando Maradona" },
    ]);
    expect(resolveScorerName(gd, "different-player-id", "card-3")).toBe("Maradona");
  });
});
