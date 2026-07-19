import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const observed = vi.hoisted(() => ({ calls: [] as Array<[string, string, string | undefined]> }));

vi.mock("./rng.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rng.js")>();
  return {
    ...actual,
    deriveSubseed(
      runSeed: string,
      substream: Parameters<typeof actual.deriveSubseed>[1],
      scope?: string,
    ) {
      observed.calls.push([runSeed, substream, scope]);
      return actual.deriveSubseed(runSeed, substream, scope);
    },
  };
});

import { runTournamentFull } from "./engine/tournament.js";
import { buildScenarioInputs } from "../test/fixtures/sim-fixtures.js";

const SEED = "wcb-golden-blowout-0";
// Hash of the ACTUAL deriveSubseed calls observed across one full engine run.
const LOCKED_TRACE_SHA256 = "3316c5487b1b150b8df1f051a4e88d582443876629d275f65cab5de2ceb6df77";

describe("full-tournament RNG decision sequence", () => {
  it("keeps the observed full-path derived-subseed trace byte-identical", () => {
    const inputs = buildScenarioInputs("blowout");
    observed.calls.length = 0;
    const result = runTournamentFull(inputs.draft, inputs.scenario, SEED, inputs.world);
    expect(result.matches.map((match) => match.match_index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const bytes = JSON.stringify(observed.calls);
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect({ count: observed.calls.length, hash }).toEqual({
      count: 34,
      hash: LOCKED_TRACE_SHA256,
    });
  });
});
