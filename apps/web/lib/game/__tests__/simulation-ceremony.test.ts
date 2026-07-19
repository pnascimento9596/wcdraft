import { describe, expect, it } from "vitest";
import { runTournamentFull } from "@wcdraft/core";

import {
  ceremonyTiming,
  deriveCeremonyModel,
  deriveStreamedCeremonyModel,
  isCeremonyResolved,
} from "../../../components/game/simulation-ceremony";
import type { PersistedSimulation } from "../simulation-payload";
import { buildScenarioInputs, type ScenarioName } from "../../../../../packages/core/test/fixtures/sim-fixtures";

function runReal(name: ScenarioName, seed: string): PersistedSimulation {
  const inputs = buildScenarioInputs(name);
  const result = runTournamentFull(inputs.draft, inputs.scenario, seed, inputs.world);
  return {
    scenario: inputs.scenario,
    run: result.run,
    matches: result.matches,
    group_stage: result.group_stage,
    knockout_ladder_meta: { rounds: result.knockout_ladder_meta.rounds.map((round) => ({ ...round })) },
  };
}

function realFixture(kind: "champion" | "sf" | "r16" | "group") {
  const locked = kind === "champion" ? runReal("blowout", "wcb-golden-blowout-0")
    : kind === "r16" ? runReal("upset", "wcb-golden-upset-1")
      : kind === "group" ? runReal("group_elimination", "wcb-golden-group_elimination-0") : null;
  if (locked) return locked;
  for (let index = 0; index < 500; index += 1) {
    const simulation = runReal("blowout", `wcdraft:ceremony:real:${kind}:${index.toString()}`);
    const rounds = simulation.matches.map((match) => match.round);
    if (kind === "champion" && simulation.run.is_champion) return simulation;
    if (kind === "sf" && rounds.at(-1) === "SF" && !simulation.run.is_champion) return simulation;
    if (kind === "r16" && rounds.at(-1) === "R16" && !simulation.run.is_champion) return simulation;
    if (kind === "group" && simulation.matches.every((match) => match.phase === "group")) return simulation;
  }
  throw new Error(`no deterministic ${kind} fixture found in bounded seed search`);
}

describe("simulation ceremony honest-state renderer", () => {
  it.each([
    ["champion", 100, "Champions", ["win", "win", "win", "win", "champ"]],
    ["sf", 75, "Out in the semi-final", ["win", "win", "win", "loss", "none"]],
    ["r16", 50, "Out in the round of 16", ["win", "loss", "none", "none", "none"]],
    ["group", 0, "Out in the group stage", ["none", "none", "none", "none", "none"]],
  ] as const)("derives the %s path only from a real tournament result", (kind, fill, status, states) => {
    const model = deriveCeremonyModel(realFixture(kind));
    expect(model.fillPct).toBe(fill);
    expect(model.status).toBe(status);
    expect(model.nodes.map((node) => node.state)).toEqual(states);
    expect(model.nodes.at(-1)?.state === "champ").toBe(kind === "champion");
    expect(model.champion).toBe(kind === "champion");
    if (kind !== "champion" && kind !== "group") {
      expect(model.heroNum).toBe(model.nodes.find((node) => node.state === "loss")?.score);
    }
  });

  it("has no canned production outcome before the terminal simulation exists", () => {
    expect(deriveCeremonyModel(null)).toMatchObject({ champion: false, fillPct: 0, status: "", heroNum: "" });
    expect(deriveCeremonyModel(null).nodes.every((node) => node.state === "none")).toBe(true);
  });

  it("derives each arrived node from the real stream before the terminal payload", () => {
    const simulation = realFixture("sf");
    const knockout = simulation.matches.filter((match) => match.phase === "knockout");
    const afterFirstArrival = deriveStreamedCeremonyModel(
      simulation.matches.slice(0, simulation.matches.indexOf(knockout[0]!) + 1),
      null,
    );
    expect(afterFirstArrival.nodes[0]).toMatchObject({
      state: "win",
      score: deriveCeremonyModel(simulation).nodes[0]?.score,
    });
    expect(afterFirstArrival.nodes.slice(1).every((node) => node.state === "none")).toBe(true);
    expect(afterFirstArrival.status).toBe("");

    const afterLossArrival = deriveStreamedCeremonyModel(simulation.matches, null);
    expect(afterLossArrival.nodes.map((node) => node.state)).toEqual(["win", "win", "win", "loss", "none"]);
    expect(afterLossArrival.status).toBe("");
    expect(afterLossArrival.heroNum).toBe(afterLossArrival.nodes[3]?.score);
  });

  it("keeps the approved outcome beats separate from the 3200ms navigation floor", () => {
    expect(ceremonyTiming(deriveCeremonyModel(realFixture("champion")))).toEqual({
      beats: [520, 820, 1120, 1420, 1760], resolve: 2100,
    });
    expect(ceremonyTiming(deriveCeremonyModel(realFixture("sf")))).toEqual({
      beats: [520, 820, 1120, 1520, null], resolve: 1860,
    });
    expect(ceremonyTiming(deriveCeremonyModel(realFixture("r16")))).toEqual({
      beats: [520, 900, null, null, null], resolve: 1440,
    });
  });

  it("does not complete at the floor when a real result arrives after 3200ms", () => {
    const model = deriveCeremonyModel(realFixture("sf"));
    expect(isCeremonyResolved(3_200, true, model.nodes, [true, true, true, false, false])).toBe(false);
    expect(isCeremonyResolved(5_001, true, model.nodes, [true, true, true, true, false])).toBe(true);
  });
});
