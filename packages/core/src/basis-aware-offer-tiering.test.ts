import { describe, expect, it } from "vitest";

import {
  activeSpin,
  buildDraftCatalog,
  createDraft,
  resolveChoiceOverall,
  type DraftDataset,
  type DraftPlayerCard,
  type RatingBasis,
} from "./index.js";

const DUAL_PLAYERS: DraftPlayerCard[] = Array.from({ length: 24 }, (_, index) => ({
  player_id: `p-${index.toString().padStart(2, "0")}`,
  tournament_id: 1,
  nation_id: "n1",
  eligible_positions: [["GK"], ["DF"], ["MF"], ["FW"]][
    index % 4
  ] as DraftPlayerCard["eligible_positions"],
  choice_overall: {
    career: 100 - index,
    current: 60 + index,
  },
}));

function datasetWith(players: readonly DraftPlayerCard[]): DraftDataset {
  return {
    tournaments: [{ tournament_id: 1, year: 2022 }],
    managers: [{ manager_id: "m-n1", tournament_id: 1, nation_id: "n1" }],
    players,
  };
}

function firstOffer(
  players: readonly DraftPlayerCard[],
  rating_basis: RatingBasis,
): readonly string[] {
  const catalog = buildDraftCatalog(datasetWith(players));
  const draft = createDraft(catalog, {
    run_id: `basis-offer-${rating_basis}`,
    parent_seed: "wcdraft:basis-aware-offer-tiering:v1",
    formation_id: "4-3-3",
    mode: "classic",
    dataset_version: "test-dataset",
    rating_version: "test-rating",
    engine_version: "test-engine",
    rating_basis,
  });
  const spin = activeSpin(draft);
  expect(spin).not.toBeNull();
  return spin!.rolled_card_ids;
}

function scalarPlayers(basis: RatingBasis): DraftPlayerCard[] {
  return DUAL_PLAYERS.map((card) => ({
    ...card,
    choice_overall: resolveChoiceOverall(card, basis),
  }));
}

describe("basis-aware offer tiering", () => {
  it("resolves the selected display value and preserves scalar compatibility", () => {
    const card = DUAL_PLAYERS[0]!;
    expect(resolveChoiceOverall(card, "career")).toBe(100);
    expect(resolveChoiceOverall(card, "current")).toBe(60);
    expect(resolveChoiceOverall({ ...card, choice_overall: 77 }, "career")).toBe(77);
    expect(resolveChoiceOverall({ ...card, choice_overall: 77 }, "current")).toBe(77);
    expect(resolveChoiceOverall({ ...card, choice_overall: null }, "current")).toBeNull();
  });

  it("Career's dual-value offer is byte-equal to the legacy scalar path", () => {
    expect(JSON.stringify(firstOffer(DUAL_PLAYERS, "career"))).toBe(
      JSON.stringify(firstOffer(scalarPlayers("career"), "career")),
    );
  });

  it("Current uses Current values and is byte-equal to an equivalent scalar input", () => {
    const career = firstOffer(DUAL_PLAYERS, "career");
    const current = firstOffer(DUAL_PLAYERS, "current");
    expect(current).not.toEqual(career);
    expect(JSON.stringify(current)).toBe(
      JSON.stringify(firstOffer(scalarPlayers("current"), "career")),
    );
  });
});
