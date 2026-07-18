import { describe, expect, it } from "vitest";

import { resolveChoiceOverall, type DraftPlayerCard } from "@wcdraft/core";

import { DRAFT_POOL_BUNDLE } from "../src/index.js";

function cardWithChoice(choice_overall: DraftPlayerCard["choice_overall"]): DraftPlayerCard {
  return {
    player_id: "equivalence-probe",
    tournament_id: 1,
    nation_id: "probe",
    eligible_positions: ["MF"],
    choice_overall,
  };
}

describe("real-bundle basis-aware offer values", () => {
  it("Career resolves byte-equal to the legacy scalar path for the full population", () => {
    const legacy = DRAFT_POOL_BUNDLE.ratings.map((rating) =>
      resolveChoiceOverall(cardWithChoice(rating.overall), "career"),
    );
    const basisAware = DRAFT_POOL_BUNDLE.ratings.map((rating) =>
      resolveChoiceOverall(
        cardWithChoice({
          career: rating.overall,
          current: rating.basis_ratings.current.overall,
        }),
        "career",
      ),
    );

    expect(legacy).toHaveLength(12_219);
    expect(Buffer.from(JSON.stringify(basisAware))).toEqual(Buffer.from(JSON.stringify(legacy)));
  });

  it("Current resolves every card from basis_ratings.current without a Career fallback", () => {
    const resolved = DRAFT_POOL_BUNDLE.ratings.map((rating) =>
      resolveChoiceOverall(
        cardWithChoice({
          career: rating.overall,
          current: rating.basis_ratings.current.overall,
        }),
        "current",
      ),
    );
    const expected = DRAFT_POOL_BUNDLE.ratings.map(
      (rating) => rating.basis_ratings.current.overall,
    );

    expect(resolved).toHaveLength(12_219);
    expect(resolved).toEqual(expected);
    expect(
      resolved.filter((overall, index) => overall !== DRAFT_POOL_BUNDLE.ratings[index]!.overall)
        .length,
    ).toBeGreaterThan(0);
  });
});
