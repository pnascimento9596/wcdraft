import { describe, expect, it } from "vitest";

import { buildCardId, type CardId, type Rating, type Team2026 } from "./index.js";
import { runTournamentFull } from "./engine/tournament.js";
import { membersFromTeam2026 } from "./engine/match.js";
import { buildScenarioInputs } from "../test/fixtures/sim-fixtures.js";

describe("sim honest-null boundaries", () => {
  it("throws when a drafted bench card is absent from SimWorld.ratings", () => {
    const inputs = buildScenarioInputs("blowout");
    const bench = inputs.draft.squad.find((slot) => !slot.is_starter && slot.card_id !== null);
    expect(bench).toBeDefined();
    delete (inputs.world.ratings as Record<string, Rating>)[bench!.card_id as string];

    expect(() =>
      runTournamentFull(inputs.draft, inputs.scenario, "honest-missing-bench-rating", inputs.world),
    ).toThrow(/missing a Rating for drafted card_id/u);
  });

  it("throws when a drafted manager is absent from SimWorld.managerTournaments", () => {
    const inputs = buildScenarioInputs("blowout");
    expect(inputs.draft.manager_card_id).not.toBeNull();
    inputs.world.managerTournaments = {};

    expect(() =>
      runTournamentFull(inputs.draft, inputs.scenario, "honest-missing-manager", inputs.world),
    ).toThrow(/missing a ManagerTournament for drafted manager_card_id/u);
  });

  it("throws when an opponent squad card id cannot be parsed", () => {
    const team: Team2026 = {
      team_id: "T-bad",
      nation_id: "badland",
      group: "A",
      group_slot: 1,
      squad_card_ids: ["not-a-card-id" as CardId, buildCardId("ok", 2026)],
      aggregate_rating: {
        attack: 50,
        midfield: 50,
        defense: 50,
        goalkeeping: 50,
        coverage: 1,
      },
      squad_status: "projected",
      rating_version: "fixture-rating",
      sources: [],
    };

    expect(() => membersFromTeam2026(team)).toThrow(/unparseable squad card_id/u);
  });
});
