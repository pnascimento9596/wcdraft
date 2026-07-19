// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { runTournamentFull } from "@wcdraft/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimulationCeremony } from "../../../components/game/simulation-ceremony";
import {
  buildScenarioInputs,
  type ScenarioName,
} from "../../../../../packages/core/test/fixtures/sim-fixtures";
import type { PersistedSimulation } from "../simulation-payload";

function runReal(name: ScenarioName, seed: string): PersistedSimulation {
  const inputs = buildScenarioInputs(name);
  const result = runTournamentFull(inputs.draft, inputs.scenario, seed, inputs.world);
  return {
    scenario: inputs.scenario,
    run: result.run,
    matches: result.matches,
    group_stage: result.group_stage,
    knockout_ladder_meta: {
      rounds: result.knockout_ladder_meta.rounds.map((round) => ({ ...round })),
    },
  };
}

function fixture(kind: "champion" | "sf" | "r16"): PersistedSimulation {
  if (kind === "champion") return runReal("blowout", "wcb-golden-blowout-0");
  if (kind === "r16") return runReal("upset", "wcb-golden-upset-1");
  for (let index = 0; index < 500; index += 1) {
    const simulation = runReal("blowout", `wcdraft:ceremony:render:sf:${index.toString()}`);
    if (simulation.matches.at(-1)?.round === "SF" && !simulation.run.is_champion) return simulation;
  }
  throw new Error("no deterministic semi-final-loss render fixture found");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("simulation ceremony rendered honest states", () => {
  it.each([
    ["champion", ["win", "win", "win", "win", "champ"], "100.00", "true", "Champions"],
    ["sf", ["win", "win", "win", "loss", "none"], "75.00", "false", "Out in the semi-final"],
    ["r16", ["win", "loss", "none", "none", "none"], "50.00", "false", "Out in the round of 16"],
  ] as const)(
    "renders the real %s result without lighting later nodes",
    async (kind, states, fill, gold, status) => {
      let now = 0;
      let frame: FrameRequestCallback | null = null;
      vi.spyOn(performance, "now").mockImplementation(() => now);
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      });
      vi.stubGlobal("cancelAnimationFrame", () => undefined);
      const mount = document.createElement("div");
      document.body.append(mount);
      const root = createRoot(mount);
      const simulation = fixture(kind);
      const props = { onSkip: () => undefined, reducedMotion: true };

      await act(async () =>
        root.render(createElement(SimulationCeremony, { ...props, matches: [], simulation: null })),
      );
      await act(async () =>
        root.render(
          createElement(SimulationCeremony, { ...props, matches: simulation.matches, simulation }),
        ),
      );
      now = 4_000;
      await act(async () => {
        frame?.(now);
      });

      const nodes = [...document.querySelectorAll("[data-ceremony-node]")];
      expect(nodes.map((node) => node.getAttribute("data-state"))).toEqual(states);
      expect(nodes.map((node) => node.getAttribute("data-visible"))).toEqual(
        states.map((state) => (state === "none" ? "false" : "true")),
      );
      const trophy = document.querySelector("[data-ceremony-trophy='true']");
      expect(trophy?.getAttribute("data-fill-pct")).toBe(fill);
      expect(trophy?.getAttribute("data-gold")).toBe(gold);
      expect(document.body.textContent).toContain(status);
      if (kind !== "champion") expect(nodes[4]?.getAttribute("data-state")).not.toBe("champ");

      await act(async () => root.unmount());
    },
  );
});
