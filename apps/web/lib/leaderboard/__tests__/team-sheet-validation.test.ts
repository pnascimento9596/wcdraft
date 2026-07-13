import { describe, expect, it } from "vitest";

import {
  deriveAndCacheLineupInspector,
  resetLineupInspectorCacheForTests,
} from "../lineup-inspector";
import { SUBMIT_ERROR_HTTP_STATUS, validateSubmission } from "../validate";
import { asDraftedTeamSheet } from "../../game/team-sheet";
import { buildRunTokenBody } from "../../game/run-token";
import { runSimulationSync } from "../../game/simulate";
import {
  buildOriginRecord,
  buildServerGameData,
  encodeBody,
  serverScenarioBundle,
} from "./_harness";

const gameData = buildServerGameData();
const scenario = serverScenarioBundle();
const validation = { gameData, scenario };

function arrangedRecord() {
  const record = buildOriginRecord(gameData, "wcdraft:leaderboard:team-sheet");
  const arrangement = [...asDraftedTeamSheet(record.draft)];
  [arrangement[0], arrangement[11]] = [arrangement[11]!, arrangement[0]!];
  return { ...record, arrangement };
}

describe("leaderboard team-sheet authority", () => {
  it("accepts the score from the same arranged XI encoded in the token", () => {
    const record = arrangedRecord();
    const score = runSimulationSync(gameData, scenario, record).simulation.run.score;
    const verdict = validateSubmission(
      {
        token: encodeBody(buildRunTokenBody(record)),
        claimed_score: score,
        draft_mode: "classic",
      },
      validation,
    );
    expect(verdict.status).toBe("accepted");
  });

  it.each([
    ["wrong count", Array.from({ length: 15 }, (_, index) => index)],
    ["duplicate", [0, 0, ...Array.from({ length: 14 }, (_, index) => index + 2)]],
    ["unknown player", [...Array.from({ length: 15 }, (_, index) => index), 99]],
    ["negative unknown player", [-1, ...Array.from({ length: 15 }, (_, index) => index + 1)]],
    ["starter/bench overlap", [...Array.from({ length: 15 }, (_, index) => index), 0]],
  ])("maps %s to typed HTTP 422 ILLEGAL_PICK", (_label, encoded) => {
    const body = buildRunTokenBody(arrangedRecord());
    body.a = encoded;
    const verdict = validateSubmission(
      { token: encodeBody(body), claimed_score: 0, draft_mode: "classic" },
      validation,
    );
    expect(verdict).toMatchObject({ status: "rejected", code: "ILLEGAL_PICK" });
    expect(SUBMIT_ERROR_HTTP_STATUS.ILLEGAL_PICK).toBe(422);
  });

  it("renders arranged XI/bench through the shared OG inspector path", () => {
    resetLineupInspectorCacheForTests();
    const record = arrangedRecord();
    const inspected = deriveAndCacheLineupInspector(
      encodeBody(buildRunTokenBody(record)),
      validation,
    );
    expect(inspected.status).toBe("accepted");
    if (inspected.status !== "accepted") return;
    expect(inspected.view.starters[0]!.card?.card_id).toBe(record.arrangement[0]);
    expect(inspected.view.bench[0]!.card?.card_id).toBe(record.arrangement[11]);
  });
});
