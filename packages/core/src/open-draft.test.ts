import { describe, expect, it } from "vitest";

import {
  activeSpin,
  buildCardId,
  buildDraftCatalog,
  createDraft,
  type DraftDataset,
  type DraftMode,
} from "./index.js";

const dataset: DraftDataset = {
  tournaments: [
    { tournament_id: 1, year: 2018 },
    { tournament_id: 2, year: 2022 },
  ],
  managers: [{ manager_id: "m-n1", tournament_id: 1, nation_id: "n1" }],
  players: [
    {
      player_id: "dup",
      tournament_id: 1,
      nation_id: "n1",
      eligible_positions: ["FW"],
      choice_overall: 95,
    },
    {
      player_id: "dup",
      tournament_id: 2,
      nation_id: "n1",
      eligible_positions: ["GK"],
      choice_overall: 80,
    },
    {
      player_id: "keeper",
      tournament_id: 1,
      nation_id: "n1",
      eligible_positions: ["GK"],
      choice_overall: 88,
    },
    {
      player_id: "mid",
      tournament_id: 2,
      nation_id: "n1",
      eligible_positions: ["MF"],
      choice_overall: 87,
    },
  ],
};

function openSpinCardIds(mode: Extract<DraftMode, "open" | "open_hidden">): string[] {
  const catalog = buildDraftCatalog(dataset);
  const draft = createDraft(catalog, {
    run_id: `open-card-space-${mode}`,
    parent_seed: "wcdraft/open-card-space-regression",
    formation_id: "4-3-3",
    mode,
    team_name: "Open Card Space XI",
    dataset_version: "test-dataset",
    rating_version: "test-rating",
    engine_version: "test-engine",
  });
  const spin = activeSpin(draft);
  expect(spin).not.toBeNull();
  return [...spin!.rolled_card_ids];
}

describe("open draft card space", () => {
  it("Blind Open keeps Open Draft's legal representative cards and uses position/card-id display order", () => {
    const expectedDupCard = buildCardId("dup", 1);
    const rejectedDupCard = buildCardId("dup", 2);
    const keeperCard = buildCardId("keeper", 1);
    const midCard = buildCardId("mid", 2);
    const open = openSpinCardIds("open");
    const blindOpen = openSpinCardIds("open_hidden");

    expect([...blindOpen].sort()).toEqual([...open].sort());
    expect(open).toEqual([expectedDupCard, keeperCard, midCard]);
    expect(blindOpen).toEqual([keeperCard, midCard, expectedDupCard]);
    expect(blindOpen).toContain(expectedDupCard);
    expect(blindOpen).not.toContain(rejectedDupCard);
  });
});
