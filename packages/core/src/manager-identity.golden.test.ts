import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildManagerCardId, parseManagerCardId } from "./types/index.js";
import { ManagerTournamentSchema } from "./schemas/index.js";

// GOLDEN INVARIANT (WS-0c depth-layer contract, WS-A implementation):
//   MANAGER ENTITY RESOLUTION yields ONE stable Manager.manager_id for a
//   human coach who managed multiple national federations across tournaments.
//   The canonical multi-nation manager is Carlos Alberto Parreira: six World
//   Cups across FIVE different nations (Kuwait, UAE, Brazil, Saudi Arabia,
//   South Africa, then Brazil again). ONE manager_id, MANY manager_card_ids.
//
// The current ETL output (etl/output/managers.json + manager_tournaments.json)
// already exhibits this — manager_id "M-311" has six ManagerTournament rows
// across five distinct nation_ids. THIS test re-asserts the invariant inside
// the core data contract once the WS-A manager-resolution pipeline is wired
// to the contract types in `types/manager.ts`.
//
// WHY THIS IS A CONTRACT-LEVEL GUARDRAIL: the WS-0c 17-spin draft picks a
// MANAGER on at most one spin. If manager-ER splits a single human into two
// manager_ids by mistake, the same human could appear in TWO different
// (tournament, nation) spins' `rolled_manager_card_id`s — letting the user
// re-draft "the same coach" disguised. If manager-ER merges two humans into
// one manager_id by mistake, real history is silently rewritten.
//
type RuntimeManagerCard = {
  manager_card_id: string;
  manager_id: string;
  tournament_id: number;
  nation_id: string;
  common_name: string;
  full_name: string;
  matches: number | null;
  final_placement: number | null;
  sources: [];
};

type DraftPoolFixture = {
  manager_cards: RuntimeManagerCard[];
};

const here = dirname(fileURLToPath(import.meta.url));
const draftPoolPath = join(here, "..", "..", "data", "src", "generated", "draft-pool.compact.json");
const draftPool = JSON.parse(readFileSync(draftPoolPath, "utf8")) as DraftPoolFixture;

describe("manager identity — multi-nation manager resolves to ONE manager_id", () => {
  it("Carlos Alberto Parreira (M-311) resolves to ONE manager_id across 6 World Cups / 5 nations", () => {
    const parreiraCards = draftPool.manager_cards
      .filter((card) => card.manager_id === "M-311")
      .sort((a, b) => a.tournament_id - b.tournament_id);

    expect(parreiraCards.map((card) => card.tournament_id)).toEqual([
      1982, 1990, 1994, 1998, 2006, 2010,
    ]);
    expect(new Set(parreiraCards.map((card) => card.manager_id))).toEqual(new Set(["M-311"]));
    expect(new Set(parreiraCards.map((card) => card.nation_id))).toEqual(
      new Set(["T-45", "T-82", "T-09", "T-63", "T-70"]),
    );
    expect(
      parreiraCards.filter((card) => card.nation_id === "T-09").map((card) => card.tournament_id),
    ).toEqual([1994, 2006]);

    for (const card of parreiraCards) {
      expect(card.common_name).toBe("Carlos Alberto Parreira");
      expect(card.full_name).toBe("Carlos Alberto Parreira");
      expect(card.manager_card_id).toBe(buildManagerCardId("M-311", card.tournament_id));
      expect(parseManagerCardId(card.manager_card_id)).toEqual({
        manager_id: "M-311",
        tournament_id: card.tournament_id,
      });
    }

    expect(new Set(parreiraCards.map((card) => card.manager_card_id)).size).toBe(6);
  });

  it("two ManagerTournament rows with the same manager_id but different nation_ids both validate", () => {
    const parsed = [1994, 1998].map((year) => {
      const card = draftPool.manager_cards.find(
        (candidate) => candidate.manager_id === "M-311" && candidate.tournament_id === year,
      );
      expect(card).toBeDefined();
      return ManagerTournamentSchema.parse({
        manager_card_id: card!.manager_card_id,
        manager_id: card!.manager_id,
        tournament_id: card!.tournament_id,
        nation_id: card!.nation_id,
        matches: card!.matches,
        final_placement: card!.final_placement,
        sources: card!.sources,
      });
    });

    expect(parsed.map((row) => row.manager_id)).toEqual(["M-311", "M-311"]);
    expect(parsed.map((row) => row.nation_id)).toEqual(["T-09", "T-63"]);
    expect(parsed.map((row) => parseManagerCardId(row.manager_card_id))).toEqual([
      { manager_id: "M-311", tournament_id: 1994 },
      { manager_id: "M-311", tournament_id: 1998 },
    ]);
  });
});
