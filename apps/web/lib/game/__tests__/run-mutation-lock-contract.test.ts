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
const SETUP_SOURCE = readFileSync(
  new URL("../../../components/game/draft-screen/setup.tsx", import.meta.url),
  "utf8",
);
const DRAFT_LOADER_SOURCE = readFileSync(
  new URL("../../../components/game/draft-screen/use-draft-screen-loader.ts", import.meta.url),
  "utf8",
);
const HISTORY_SOURCE = readFileSync(new URL("../history.ts", import.meta.url), "utf8");

describe("run mutation serialization contract", () => {
  it("holds one store-wide exclusive seam around creation, records, counter, cap, and index", () => {
    expect(RUN_RECORD_SOURCE).toContain("async function withRunStoreLock");
    expect(RUN_RECORD_SOURCE).toContain('options: { mode: "exclusive"; signal?: AbortSignal }');
    expect(RUN_RECORD_SOURCE).toContain("manager.request(");
    expect(RUN_RECORD_SOURCE).toContain("RUN_STORE_LOCK_NAME,");
    expect(RUN_RECORD_SOURCE).toContain('RUN_STORE_LOCK_NAME = "wcdraft:run-store:v1"');
    expect(RUN_RECORD_SOURCE).not.toContain("RUN_MUTATION_LOCK_PREFIX");
    for (const boundary of [
      "createNewRunRecordUnlocked",
      "saveNewRunRecordUnlocked",
      "setRunArrangementUnlocked",
      "setRunTeamNameUnlocked",
      "beginRunSimulationUnlocked",
      "updateRunRecordUnlocked",
      "setRunSimulationUnlocked",
      "setRunStatusUnlocked",
      "setRunPinnedUnlocked",
      "evictStaleRunRecordsUnlocked",
    ]) {
      expect(RUN_RECORD_SOURCE).toContain(boundary);
    }
  });

  it("fails closed for durable browsers without Web Locks and queues volatile mutations", () => {
    expect(RUN_RECORD_SOURCE).toContain("if (!manager) return unavailable()");
    expect(RUN_RECORD_SOURCE).toContain("const previous = volatileMutationTail");
    expect(RUN_RECORD_SOURCE).toContain("RUN_MUTATION_LOCK_UNAVAILABLE_WARNING");
  });

  it("keeps raw whole-record writes private and serializes the exported creation check", () => {
    expect(RUN_RECORD_SOURCE).toContain("export function saveNewRunRecord");
    expect(RUN_RECORD_SOURCE).toContain("function saveRunRecordUnlocked");
    expect(RUN_RECORD_SOURCE).toContain("function saveNewRunRecordUnlocked");
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
    expect(SETUP_SOURCE).toContain("await createNewRunRecord");
    expect(DRAFT_LOADER_SOURCE).toContain("await createNewRunRecord");
    expect(DRAFT_LOADER_SOURCE).toContain("await evictStaleRunRecords");
    expect(HISTORY_SOURCE).toContain("await evictStaleRunRecords");
  });

  it("keeps load and list render reads pure while locked cleanup owns repair", () => {
    const loadStart = RUN_RECORD_SOURCE.indexOf("export function loadRunRecord");
    const saveStart = RUN_RECORD_SOURCE.indexOf("export function saveNewRunRecord", loadStart);
    const loadSource = RUN_RECORD_SOURCE.slice(loadStart, saveStart);
    expect(loadSource).not.toContain("removeItem");
    expect(loadSource).not.toContain("saveIndex");

    const listStart = RUN_RECORD_SOURCE.indexOf("export function listRunRecords");
    const cleanupStart = RUN_RECORD_SOURCE.indexOf("export function evictStaleRunRecords");
    const listSource = RUN_RECORD_SOURCE.slice(listStart, cleanupStart);
    expect(listSource).not.toContain("removeItem");
    expect(listSource).not.toContain("saveIndex");
  });
});
