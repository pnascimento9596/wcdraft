// DC-2 — era presets through the WEB layer (catalog cache, run creation,
// token replay, reveal label). Core sampling semantics are locked in
// packages/core (draft-config.test.ts) and packages/data
// (era-presets.golden.test.ts); this file proves the app wiring.

import { describe, expect, it } from "vitest";

import { isDraftComplete, stepDraft } from "@wcdraft/core";
import { DRAFT_POOL_BUNDLE } from "@wcdraft/data";

import { getCatalogForEra } from "../data";
import { createNewRunRecord } from "../run-record";
import { buildSlotRevealModel } from "../slot-reveal";
import {
  decodeRunToken,
  encodeRunToken,
  reconstructDraftFromToken,
  tokenDraftConfig,
  versionsAgree,
} from "../run-token";
import { buildGameDataFromBundles } from "./run-token.test-harness";

const gameData = buildGameDataFromBundles();

function tournamentYear(tournament_id: number): number {
  return DRAFT_POOL_BUNDLE.tournaments[String(tournament_id)]!.year;
}

describe("getCatalogForEra (DC-2 catalog cache)", () => {
  it("all_time returns gameData.catalog BY OBJECT IDENTITY (default path provably unchanged)", () => {
    expect(getCatalogForEra(gameData, "all_time")).toBe(gameData.catalog);
  });

  it("non-default catalogs are era-stamped, bounded, and memoized per GameData", () => {
    const modern = getCatalogForEra(gameData, "modern");
    expect(modern).not.toBe(gameData.catalog);
    expect(modern.era.id).toBe("modern");
    expect(modern.hasRareEra).toBe(false);
    for (const pair of modern.pairs) {
      const year = tournamentYear(pair.tournament_id);
      expect(year).toBeGreaterThanOrEqual(2018);
      expect(year).toBeLessThanOrEqual(2026);
    }
    // Memoized: second lookup is the same object.
    expect(getCatalogForEra(gameData, "modern")).toBe(modern);
  });
});

describe("createNewRunRecord + token round-trip under a non-default era (DC-2)", () => {
  // node test env has no localStorage — run-record falls back to its
  // in-memory backend (persistence: "volatile"), which is fine here.
  const created = createNewRunRecord(gameData, {
    formation_id: "4-3-3",
    mode: "classic",
    era_preset: "modern",
  });

  it("records the preset on the DraftState and bounds every spin", () => {
    expect(created.record.draft.era_preset).toBe("modern");
    for (const spin of created.record.draft.spins) {
      const year = tournamentYear(spin.tournament_id);
      expect(year).toBeGreaterThanOrEqual(2018);
      expect(spin.rare).toBe(false);
    }
  });

  it("a completed modern-era run tokenizes with ef modern and replays byte-identically", () => {
    // Complete the draft deterministically through the engine's default
    // policy against the SAME modern catalog the record was created with.
    const catalog = getCatalogForEra(gameData, "modern");
    let draft = created.record.draft;
    while (!isDraftComplete(draft)) draft = stepDraft(catalog, draft);
    const record = { ...created.record, draft };

    const token = encodeRunToken(record);
    const decoded = decodeRunToken(token);
    expect(decoded).not.toBeNull();
    expect(tokenDraftConfig(decoded!)).toMatchObject({ era_preset: "modern" });
    expect(versionsAgree(decoded!, gameData.versions)).toBe(true);

    const replayed = reconstructDraftFromToken(decoded!, gameData);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(draft));
  });
});

describe("spin-reveal era label (DC-2 honest copy)", () => {
  const created = createNewRunRecord(gameData, {
    formation_id: "4-3-3",
    mode: "classic",
    era_preset: "modern",
  });
  const spin = created.record.draft.spins[0]!;

  it("non-default preset surfaces its label; default stays null (unchanged rendering)", () => {
    const modernModel = buildSlotRevealModel({
      activeSpin: spin,
      allSpins: created.record.draft.spins,
      indexes: gameData.indexes,
      totalPicks: 17,
      eraPreset: "modern",
    });
    expect(modernModel.eraPresetLabel).toBe("Modern (2018–2026)");
    expect(modernModel.rare).toBe(false);

    const defaultModel = buildSlotRevealModel({
      activeSpin: spin,
      allSpins: created.record.draft.spins,
      indexes: gameData.indexes,
      totalPicks: 17,
    });
    expect(defaultModel.eraPresetLabel).toBeNull();
  });
});
