// F-4 U2 — golden acceptance fixtures for the validation pipeline.
//
// One ACCEPTED classic token + one ACCEPTED hidden token, committed with the
// engine-derived verified_score / score_breakdown / season_key. The test
// pushes the committed token through the SERVER pipeline (`validateSubmission`
// over real bundles) and asserts byte-equal outputs.
//
// FIXTURE REGEN: never written by tests. On any version-anchor bump:
//   pnpm build && pnpm --filter @wcdraft/web gen:leaderboard-golden
// — regen in the same PR as the bump, inspect the diff (e2e-golden discipline).

import { describe, expect, it } from "vitest";

import type { ScoreComponent } from "@wcdraft/core";

import { decodeRunToken } from "../../game/run-token";
import { deriveSeasonKey } from "../season";
import { validateSubmission, type ValidationData } from "../validate";
import { buildServerGameData, serverScenarioBundle } from "./_harness";
import fixtureJson from "./fixtures/leaderboard-validate-golden.json" with { type: "json" };

interface GoldenCase {
  parent_seed: string;
  display_name: string;
  token: string;
  expected: {
    verified_score: number;
    score_breakdown: ScoreComponent[];
    season_key: string;
    draft_mode: "classic" | "hidden";
  };
}
const GOLDEN = fixtureJson as unknown as {
  season_key: string;
  classic: GoldenCase;
  hidden: GoldenCase;
};

const data: ValidationData = {
  gameData: buildServerGameData(),
  scenario: serverScenarioBundle(),
};

/** JSON round-trip — strip frozen-array/prototype quirks for deep equality. */
function asPlain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe("leaderboard validation golden — committed accepted fixtures", () => {
  it("the fixture's season_key matches the live 6-anchor derivation", () => {
    expect(deriveSeasonKey(data.gameData.versions)).toBe(GOLDEN.season_key);
  });

  for (const key of ["classic", "hidden"] as const) {
    const g = GOLDEN[key];

    it(`${key}: the committed token is ACCEPTED with byte-equal canonical outputs`, () => {
      const verdict = validateSubmission(
        {
          token: g.token,
          claimed_score: g.expected.verified_score,
          display_name: g.display_name,
        },
        data,
      );
      expect(verdict.status).toBe("accepted");
      if (verdict.status !== "accepted") return;
      expect(verdict.verified_score).toBe(g.expected.verified_score);
      expect(verdict.season_key).toBe(g.expected.season_key);
      expect(verdict.draft_mode).toBe(g.expected.draft_mode);
      expect(verdict.display_name).toBe(g.display_name);
      expect(asPlain(verdict.score_breakdown)).toEqual(g.expected.score_breakdown);
      // Transparent-score invariant: the breakdown reassembles the score.
      const sum = verdict.score_breakdown.reduce((acc, c) => acc + c.points, 0);
      expect(sum).toBe(verdict.verified_score);
      // The token's self-declared mode is what the verdict carries.
      expect(decodeRunToken(g.token)?.md).toBe(g.expected.draft_mode);
    });

    it(`${key}: the pipeline is deterministic (two runs, identical verdicts)`, () => {
      const body = {
        token: g.token,
        claimed_score: g.expected.verified_score,
        display_name: g.display_name,
      };
      const a = validateSubmission(body, data);
      const b = validateSubmission(body, data);
      expect(asPlain(a)).toEqual(asPlain(b));
    });
  }
});
