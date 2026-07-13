import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const RUN_RECORD_SOURCE = readFileSync(new URL("../run-record.ts", import.meta.url), "utf8");
const REVIEW_SOURCE = readFileSync(
  new URL("../../../components/game/review-screen.tsx", import.meta.url),
  "utf8",
);
const DRAFT_SOURCE = readFileSync(
  new URL("../../../components/game/draft-screen/index.tsx", import.meta.url),
  "utf8",
);
const RESULTS_SOURCE = readFileSync(
  new URL("../../../components/game/results-screen.tsx", import.meta.url),
  "utf8",
);

describe("run mutation serialization contract", () => {
  it("holds one shared exclusive per-run seam around every existing-record write", () => {
    expect(RUN_RECORD_SOURCE).toContain("async function withRunMutationLock");
    expect(RUN_RECORD_SOURCE).toContain('options: { mode: "exclusive"; signal?: AbortSignal }');
    expect(RUN_RECORD_SOURCE).toContain("manager.request(lockName");
    expect(RUN_RECORD_SOURCE.match(/return withRunMutationLock/gu)).toHaveLength(7);
    for (const boundary of [
      "setRunArrangementUnlocked",
      "setRunTeamNameUnlocked",
      "beginRunSimulationUnlocked",
      "updateRunRecordUnlocked",
      "setRunSimulationUnlocked",
      "setRunStatusUnlocked",
      "setRunPinnedUnlocked",
    ]) {
      expect(RUN_RECORD_SOURCE).toContain(boundary);
    }
  });

  it("fails closed for durable browsers without Web Locks and queues volatile mutations", () => {
    expect(RUN_RECORD_SOURCE).toContain("if (!manager) return unavailable()");
    expect(RUN_RECORD_SOURCE).toContain("volatileMutationTails.get(lockName)");
    expect(RUN_RECORD_SOURCE).toContain("RUN_MUTATION_LOCK_UNAVAILABLE_WARNING");
  });

  it("keeps raw whole-record writes creation-only", () => {
    expect(RUN_RECORD_SOURCE).toContain("export function saveNewRunRecord");
    expect(RUN_RECORD_SOURCE).toContain("function saveRunRecord");
    expect(RUN_RECORD_SOURCE).not.toContain("export function saveRunRecord");
    expect(DRAFT_SOURCE).not.toContain("saveRunRecord");
    expect(REVIEW_SOURCE).not.toContain("saveRunRecord");
    expect(RESULTS_SOURCE).not.toContain("saveRunRecord");
  });

  it("awaits the serialized boundaries in every production caller", () => {
    expect(DRAFT_SOURCE.match(/await updateRunRecord/gu)).toHaveLength(2);
    expect(REVIEW_SOURCE).toContain("await setRunArrangement");
    expect(REVIEW_SOURCE).toContain("await setRunTeamName");
    expect(REVIEW_SOURCE).toContain("await beginRunSimulation");
    expect(REVIEW_SOURCE).toContain("await setRunSimulation");
    expect(REVIEW_SOURCE).toContain("await setRunStatus");
    expect(RESULTS_SOURCE).toContain("await setRunPinned");
  });
});
