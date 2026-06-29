// F-4 U2 — golden-fixture generator for the leaderboard validation core.
//
// Produces `lib/leaderboard/__tests__/fixtures/leaderboard-validate-golden.json`:
// one ACCEPTED classic token + one ACCEPTED hidden token, each with the
// engine-derived `verified_score` / `score_breakdown` and the explicit current
// leaderboard season id.
//
// REGEN DISCIPLINE (same as the e2e golden): the test never writes this file.
// When any version anchor bumps, regenerate manually, inspect the diff, and
// land it in the same PR as the anchor bump:
//
//   pnpm build && pnpm --filter @wcdraft/web gen:leaderboard-golden
//
// The generator cross-checks itself: after computing ground truth directly
// through the engine, it pushes each token through `validateSubmission` and
// refuses to write a fixture the validator would not accept.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  buildOriginRecord,
  buildServerGameData,
  expectedRunFor,
  serverScenarioBundle,
} from "../lib/leaderboard/__tests__/_harness";
import { encodeRunToken } from "../lib/game/run-token";
import { DEFAULT_LEADERBOARD_SEASON_ID } from "../lib/leaderboard/season";
import { validateSubmission } from "../lib/leaderboard/validate";

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../lib/leaderboard/__tests__/fixtures/leaderboard-validate-golden.json",
);

const CASES = [
  {
    key: "classic",
    mode: "classic",
    parent_seed: "wcdraft:f4-u2-golden:classic:1",
    display_name: "golden_xi",
  },
  {
    key: "hidden",
    mode: "hidden",
    parent_seed: "wcdraft:f4-u2-golden:hidden:1",
    display_name: "memory_xi_10",
  },
] as const;

const gameData = buildServerGameData();
const scenario = serverScenarioBundle();

const fixture: Record<string, unknown> = {
  comment:
    "F-4 U2 golden — regen via `pnpm --filter @wcdraft/web gen:leaderboard-golden` on anchor bumps; never written by tests.",
  season_key: DEFAULT_LEADERBOARD_SEASON_ID,
  versions: gameData.versions,
};

for (const c of CASES) {
  const record = buildOriginRecord(gameData, c.parent_seed, c.mode, "Golden XI");
  const token = encodeRunToken(record);
  const expected = expectedRunFor(gameData, scenario, record);

  const verdict = validateSubmission(
    {
      token,
      claimed_score: expected.score,
      draft_mode: c.mode,
      display_name: c.display_name,
    },
    { gameData, scenario },
  );
  if (verdict.status !== "accepted") {
    throw new Error(`generator self-check failed for ${c.key}: ${JSON.stringify(verdict)}`);
  }
  if (
    verdict.verified_score !== expected.score ||
    verdict.draft_mode !== c.mode ||
    verdict.season_key !== fixture.season_key
  ) {
    throw new Error(`generator self-check mismatch for ${c.key}`);
  }

  fixture[c.key] = {
    parent_seed: c.parent_seed,
    display_name: c.display_name,
    token,
    expected: {
      verified_score: expected.score,
      score_breakdown: expected.score_breakdown,
      season_key: fixture.season_key,
      draft_mode: c.mode,
    },
  };
}

writeFileSync(OUT, JSON.stringify(fixture, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT}`);
console.log(`season_key: ${String(fixture.season_key)}`);
for (const c of CASES) {
  const entry = fixture[c.key] as { expected: { verified_score: number } };
  console.log(`${c.key}: verified_score=${entry.expected.verified_score}`);
}
