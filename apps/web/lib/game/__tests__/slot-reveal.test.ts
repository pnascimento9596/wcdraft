// Pure-helper tests for the slot-machine reveal model.
//
// Pins the determinism contract:
//   - center reel ALWAYS lands on the active spin's `(nation_id, tournament_id)`
//   - pick label format is exactly `PICK NN OF 17`
//   - flanking landing faces are derived deterministically from the spin ring
//   - identical inputs produce deep-equal output (no randomness)

import { describe, expect, it } from "vitest";

import type { Spin } from "@wcdraft/core";

import type { GameDataIndexes } from "../data";
import { buildSlotRevealModel } from "../slot-reveal";

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
    [1, { year: 1986, name: "1986 FIFA World Cup" }],
    [2, { year: 1994, name: "1994 FIFA World Cup" }],
    [3, { year: 1998, name: "1998 FIFA World Cup" }],
    [4, { year: 2002, name: "2002 FIFA World Cup" }],
    [5, { year: 2014, name: "2014 FIFA World Cup" }],
  ]);
  return {
    playerByCardId: new Map(),
    managerByCardId: new Map(),
    ratingByCardId: new Map(),
    nationById,
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

describe("buildSlotRevealModel", () => {
  it("center reel landing face equals the active spin result", () => {
    const indexes = makeIndexes();
    const model = buildSlotRevealModel({
      activeSpin: SPINS[2]!,
      allSpins: SPINS,
      indexes,
      totalPicks: 17,
    });

    expect(model.result.nationId).toBe("T-30");
    expect(model.result.nationName).toBe("France");
    expect(model.result.yearLabel).toBe("1998");
    expect(model.result.flagSrc).toBe("/flags/T-30.svg");
    expect(model.reels[1].key).toBe("center");
    expect(model.reels[1].landingFace).toEqual(model.result);
  });

  it("pick label uses padded NN OF 17", () => {
    const indexes = makeIndexes();

    expect(
      buildSlotRevealModel({
        activeSpin: SPINS[0]!,
        allSpins: SPINS,
        indexes,
        totalPicks: 17,
      }).pickLabel,
    ).toBe("PICK 01 OF 17");

    expect(
      buildSlotRevealModel({
        activeSpin: SPINS[4]!,
        allSpins: SPINS,
        indexes,
        totalPicks: 17,
      }).pickLabel,
    ).toBe("PICK 05 OF 17");
  });

  it("result line uses the exact SPIN RESULT — NATION YEAR format", () => {
    const indexes = makeIndexes();
    const model = buildSlotRevealModel({
      activeSpin: SPINS[0]!,
      allSpins: SPINS,
      indexes,
      totalPicks: 17,
    });
    expect(model.resultLine).toBe("SPIN RESULT — Argentina 1986");
  });

  it("flanking reels are decorative, distinct from active, deterministic via the spin ring", () => {
    const indexes = makeIndexes();
    const model = buildSlotRevealModel({
      activeSpin: SPINS[2]!, // France 1998 at ring index 2
      allSpins: SPINS,
      indexes,
      totalPicks: 17,
    });

    expect(model.reels[0].key).toBe("left");
    expect(model.reels[2].key).toBe("right");
    // Left should be the prev ring entry: Brazil 1994
    expect(model.reels[0].landingFace.nationId).toBe("T-09");
    // Right should be the next ring entry: Germany 2002
    expect(model.reels[2].landingFace.nationId).toBe("T-31");
    // Final entry of each track is its landing face
    expect(model.reels[0].trackFaces.at(-1)).toEqual(model.reels[0].landingFace);
    expect(model.reels[1].trackFaces.at(-1)).toEqual(model.reels[1].landingFace);
    expect(model.reels[2].trackFaces.at(-1)).toEqual(model.reels[2].landingFace);
    // None of the flanking landing faces should equal the active result
    expect(model.reels[0].landingFace.nationId).not.toBe(model.result.nationId);
    expect(model.reels[2].landingFace.nationId).not.toBe(model.result.nationId);
  });

  it("falls back honestly when a nation/tournament lookup is missing", () => {
    const indexes = makeIndexes();
    const orphanSpin = makeSpin(2, "T-UNKNOWN", 9999);
    const allSpins = [SPINS[0]!, SPINS[1]!, orphanSpin, SPINS[3]!, SPINS[4]!];
    const model = buildSlotRevealModel({
      activeSpin: orphanSpin,
      allSpins,
      indexes,
      totalPicks: 17,
    });
    expect(model.result.nationId).toBe("T-UNKNOWN");
    expect(model.result.nationName).toBe("T-UNKNOWN");
    expect(model.result.nationCode).toBeNull();
    expect(model.result.flagSrc).toBeNull();
    expect(model.result.yearLabel).toBe("9999");
    expect(model.resultLine).toBe("SPIN RESULT — T-UNKNOWN 9999");
  });

  it("is referentially deterministic — identical inputs produce deep-equal output", () => {
    const indexes = makeIndexes();
    const a = buildSlotRevealModel({
      activeSpin: SPINS[3]!,
      allSpins: SPINS,
      indexes,
      totalPicks: 17,
    });
    const b = buildSlotRevealModel({
      activeSpin: SPINS[3]!,
      allSpins: SPINS,
      indexes,
      totalPicks: 17,
    });
    expect(a).toEqual(b);
  });
});


describe("buildSlotRevealModel — ENGINE-V2 E-2 rare + draw probability", () => {
  it("passes through Spin.rare unchanged", () => {
    const indexes = makeIndexes();
    const rareSpin = makeSpin(2, "T-09", 1, { rare: true, draw_probability: 0.124 });
    const ring = [SPINS[0]!, SPINS[1]!, rareSpin, SPINS[3]!, SPINS[4]!];
    const model = buildSlotRevealModel({
      activeSpin: rareSpin,
      allSpins: ring,
      indexes,
      totalPicks: 17,
    });
    expect(model.rare).toBe(true);
    expect(model.drawProbability).toBe(0.124);
  });

  it("formats draw_probability honestly — 0.124 → 12.4%", () => {
    const indexes = makeIndexes();
    const rareSpin = makeSpin(2, "T-09", 1, { rare: true, draw_probability: 0.124 });
    const ring = [SPINS[0]!, SPINS[1]!, rareSpin, SPINS[3]!, SPINS[4]!];
    const model = buildSlotRevealModel({
      activeSpin: rareSpin,
      allSpins: ring,
      indexes,
      totalPicks: 17,
    });
    expect(model.drawProbabilityLabel).toBe("12.4%");
  });

  it("formats sub-1% probabilities with 2 decimals (honest, never hidden)", () => {
    const indexes = makeIndexes();
    const rareSpin = makeSpin(2, "T-09", 1, { rare: true, draw_probability: 0.0042 });
    const ring = [SPINS[0]!, SPINS[1]!, rareSpin, SPINS[3]!, SPINS[4]!];
    const model = buildSlotRevealModel({
      activeSpin: rareSpin,
      allSpins: ring,
      indexes,
      totalPicks: 17,
    });
    expect(model.drawProbabilityLabel).toBe("0.42%");
  });

  it("non-rare spins still carry their draw_probability honestly", () => {
    const indexes = makeIndexes();
    const modernSpin = makeSpin(2, "T-30", 5, { rare: false, draw_probability: 0.083 });
    const ring = [SPINS[0]!, SPINS[1]!, modernSpin, SPINS[3]!, SPINS[4]!];
    const model = buildSlotRevealModel({
      activeSpin: modernSpin,
      allSpins: ring,
      indexes,
      totalPicks: 17,
    });
    expect(model.rare).toBe(false);
    expect(model.drawProbability).toBe(0.083);
    expect(model.drawProbabilityLabel).toBe("8.3%");
  });

  it("rare spins in practice read at <= 15% (E-1 contract sanity)", () => {
    const indexes = makeIndexes();
    const rareSpin = makeSpin(2, "T-09", 1, { rare: true, draw_probability: 0.149 });
    const ring = [SPINS[0]!, SPINS[1]!, rareSpin, SPINS[3]!, SPINS[4]!];
    const model = buildSlotRevealModel({
      activeSpin: rareSpin,
      allSpins: ring,
      indexes,
      totalPicks: 17,
    });
    expect(model.rare).toBe(true);
    expect(model.drawProbability).toBeLessThanOrEqual(0.15);
  });
});
