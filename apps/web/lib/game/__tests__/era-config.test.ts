// DC-2 — era presets through the WEB layer (catalog cache, run creation,
// token replay, reveal label). Core sampling semantics are locked in
// packages/core (draft-config.test.ts) and packages/data
// (era-presets.golden.test.ts); this file proves the app wiring.

import { describe, expect, it } from "vitest";

import { ERA_PRESETS, ERA_PRESET_IDS, isDraftComplete, stepDraft } from "@wcdraft/core";
import { DRAFT_POOL_BUNDLE } from "@wcdraft/data";

import { getCatalogForEra } from "../data";
import { ERA_PRESET_LABELS } from "../era-labels";
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

const ERA_NAMES = {
  all_time: "All-time",
  post_2000: "Post-2000",
  post_2010: "Post-2010",
  modern: "Modern",
} as const;

function tournamentYear(tournament_id: number): number {
  return DRAFT_POOL_BUNDLE.tournaments[String(tournament_id)]!.year;
}

function compactRange(id: (typeof ERA_PRESET_IDS)[number]): string {
  const preset = ERA_PRESETS[id];
  const max =
    Math.floor(preset.min_year / 100) === Math.floor(preset.max_year / 100)
      ? String(preset.max_year).slice(2)
      : String(preset.max_year);
  return `${preset.min_year}–${max}`;
}

describe("era preset display labels match core bounds", () => {
  it("renders every preset name with the actual resolved filter range", () => {
    for (const id of ERA_PRESET_IDS) {
      expect(ERA_PRESET_LABELS[id]).toBe(`${ERA_NAMES[id]} (${compactRange(id)})`);
    }
  });
});

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

  it("records the preset on the DraftState and bounds every spin", async () => {
    const resolved = await created;
    expect(resolved.record.draft.era_preset).toBe("modern");
    for (const spin of resolved.record.draft.spins) {
      const year = tournamentYear(spin.tournament_id);
      expect(year).toBeGreaterThanOrEqual(2018);
      expect(spin.rare).toBe(false);
    }
  });

  it("a completed modern-era run tokenizes with ef modern and replays byte-identically", async () => {
    // Complete the draft deterministically through the engine's default
    // policy against the SAME modern catalog the record was created with.
    const catalog = getCatalogForEra(gameData, "modern");
    const resolved = await created;
    let draft = resolved.record.draft;
    while (!isDraftComplete(draft)) draft = stepDraft(catalog, draft);
    const record = { ...resolved.record, draft };

    const token = encodeRunToken(record);
    const decoded = decodeRunToken(token);
    expect(decoded).not.toBeNull();
    expect(tokenDraftConfig(decoded!)).toMatchObject({ era_preset: "modern" });
    expect(versionsAgree(decoded!, gameData.versions)).toBe(true);

    const replayed = reconstructDraftFromToken(decoded!, gameData);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(draft));
  });
});

describe("pick-path catalog coherence (DC-2 regression guard)", () => {
  it("a modern-era draft picked against the UNFILTERED catalog diverges or throws — the UI must use getCatalogForEra", async () => {
    const created = await createNewRunRecord(gameData, {
      formation_id: "4-3-3",
      mode: "classic",
      era_preset: "modern",
    });
    const right = getCatalogForEra(gameData, "modern");
    const wrong = gameData.catalog;
    const draft = created.record.draft;
    const spin = draft.spins[0]!;
    const card = spin.rolled_card_ids[0]!;
    const viaRight = stepDraft(right, draft);
    // The unfiltered catalog rebuilds pending spins from the FULL pool — the
    // result must not silently equal the bounded rebuild (or it throws on a
    // missing pair). Either way: never byte-equal.
    let divergedOrThrew: boolean;
    try {
      const viaWrong = stepDraft(wrong, draft);
      divergedOrThrew = JSON.stringify(viaWrong) !== JSON.stringify(viaRight);
    } catch {
      divergedOrThrew = true;
    }
    expect(divergedOrThrew).toBe(true);
    void card;
  });
});

describe("spin-reveal era label (DC-2 honest copy)", () => {
  const created = createNewRunRecord(gameData, {
    formation_id: "4-3-3",
    mode: "classic",
    era_preset: "modern",
  });

  it("non-default preset surfaces its label; default stays null (unchanged rendering)", async () => {
    const resolved = await created;
    const spin = resolved.record.draft.spins[0]!;
    const modernModel = buildSlotRevealModel({
      activeSpin: spin,
      allSpins: resolved.record.draft.spins,
      indexes: gameData.indexes,
      totalPicks: 17,
      eraPreset: "modern",
    });
    expect(modernModel.eraPresetLabel).toBe("Modern (2018–26)");
    expect(modernModel.rare).toBe(false);

    const defaultModel = buildSlotRevealModel({
      activeSpin: spin,
      allSpins: resolved.record.draft.spins,
      indexes: gameData.indexes,
      totalPicks: 17,
    });
    expect(defaultModel.eraPresetLabel).toBeNull();
  });
});
