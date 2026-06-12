import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildCardId, parseCardId } from "./types/index.js";

// GOLDEN INVARIANT (WS-0b contract, WS-A implementation):
//   ENTITY RESOLUTION yields ONE stable Player.player_id for a human who
//   represented two different nations across tournaments. The classic
//   nation-switcher is Ferenc Puskás (HUN 1954, ESP 1962) — two
//   PlayerTournament cards with DIFFERENT nation_ids must collapse to a SINGLE
//   player_id once the WS-A ER pipeline runs.
//
// WHY THIS IS A CONTRACT-LEVEL GUARDRAIL: dedup across the 16-spin draft
// (`Spin.excluded_player_ids`, `DraftState.deduped_player_ids`) is keyed on
// `player_id`. If ER splits a single human into two player_ids by mistake,
// the same human could be drafted twice. If ER merges two humans into one
// player_id by mistake, one would be invisibly excluded.
//
type RuntimePlayerCard = {
  card_id: string;
  player_id: string;
  tournament_id: number;
  nation_id: string;
  common_name: string;
  full_name: string;
  source_card_id: string;
  source_tournament_id: string;
};

type DraftPoolFixture = {
  player_cards: RuntimePlayerCard[];
};

const here = dirname(fileURLToPath(import.meta.url));
const draftPoolPath = join(here, "..", "..", "data", "src", "generated", "draft-pool.compact.json");
const draftPool = JSON.parse(readFileSync(draftPoolPath, "utf8")) as DraftPoolFixture;

describe("entity resolution — nation-switcher dedup", () => {
  it("Ferenc Puskás resolves to ONE player_id across HUN 1954 and ESP 1962 cards", () => {
    const puskasCards = draftPool.player_cards
      .filter((card) => card.player_id === "P-12676")
      .sort((a, b) => a.tournament_id - b.tournament_id);

    expect(puskasCards.map((card) => card.tournament_id)).toEqual([1954, 1962]);
    expect(new Set(puskasCards.map((card) => card.nation_id))).toEqual(new Set(["T-36", "T-73"]));
    expect(new Set(puskasCards.map((card) => card.player_id))).toEqual(new Set(["P-12676"]));
    expect(puskasCards.map((card) => card.source_tournament_id)).toEqual(["WC-1954", "WC-1962"]);

    for (const card of puskasCards) {
      expect(card.common_name).toBe("Puskás");
      expect(card.full_name).toBe("Ferenc Puskás");
      expect(card.card_id).toBe(buildCardId("P-12676", card.tournament_id));
      expect(parseCardId(card.card_id)).toEqual({
        player_id: "P-12676",
        tournament_id: card.tournament_id,
      });
    }

    // Draft dedup is keyed on player_id, not on card_id or represented nation.
    expect(new Set(puskasCards.map((card) => card.player_id)).size).toBe(1);
    expect(new Set(puskasCards.map((card) => card.card_id)).size).toBe(2);
  });
});
