import { describe, expect, it } from "vitest";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import { runSimulationSync } from "../simulate";
import {
  asDraftedTeamSheet,
  decodeTeamSheetArrangement,
  encodeTeamSheetArrangement,
  materializeTeamSheetDraft,
  TeamSheetError,
  verifyTeamSheetArrangement,
} from "../team-sheet";
import {
  buildRunTokenBody,
  decodeRunToken,
  encodeRunToken,
  reconcileRunToken,
  reconstructDraftFromToken,
  virtualRecordFromToken,
} from "../run-token";
import type { RunRecordV1 } from "../run-record";
import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";

const gameData = buildGameDataFromBundles();

function swappedRecord(seed = "wcdraft:team-sheet:swap"): RunRecordV1 {
  const record = buildOriginRecord(gameData, seed);
  const arrangement = [...asDraftedTeamSheet(record.draft)];
  [arrangement[0], arrangement[11]] = [arrangement[11]!, arrangement[0]!];
  return { ...record, arrangement };
}

describe("team-sheet arrangement and shared mp+a reconciliation", () => {
  it("defaults absent arrangement to the byte-stable as-drafted assignment", () => {
    const record = buildOriginRecord(gameData, "wcdraft:team-sheet:legacy");
    expect(encodeTeamSheetArrangement(record.draft)).toBeUndefined();
    expect(buildRunTokenBody(record).a).toBeUndefined();
    const decoded = decodeRunToken(encodeRunToken(record));
    expect(decoded && "a" in decoded ? decoded.a : undefined).toBeUndefined();
    expect(virtualRecordFromToken(decoded!, gameData).draft).toEqual(record.draft);
  });

  it.each([
    ["neither", false, false],
    ["mp only", true, false],
    ["a only", false, true],
    ["mp and a", true, true],
  ] as const)("round-trips and reconciles %s optional-field presence", (_label, mp, a) => {
    const base = a
      ? swappedRecord(`wcdraft:team-sheet:matrix:${_label}`)
      : buildOriginRecord(gameData, `wcdraft:team-sheet:matrix:${_label}`);
    const record: RunRecordV1 = { ...base, ...(mp ? { manager_presence_band: 1 as const } : {}) };
    const encoded = encodeRunToken(record);
    const decoded = decodeRunToken(encoded)!;
    expect(decoded.v === 3 || decoded.v === 4 ? decoded.mp !== undefined : false).toBe(mp);
    expect(decoded.v === 3 || decoded.v === 4 ? decoded.a !== undefined : false).toBe(a);

    const projected = reconstructDraftFromToken(decoded, gameData);
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, {
      ...record,
      draft: projected,
      arrangement: undefined,
    });
    expect(() => reconcileRunToken(decoded, gameData, simulation.matches)).not.toThrow();
  });

  it("fuzzes 128 deterministic permutations through the compact codec", () => {
    const record = buildOriginRecord(gameData, "wcdraft:team-sheet:fuzz");
    const base = [...asDraftedTeamSheet(record.draft)];
    for (let seed = 0; seed < 128; seed += 1) {
      const permutation = [...base];
      for (let index = permutation.length - 1; index > 0; index -= 1) {
        const swapWith = (seed * 17 + index * 13) % (index + 1);
        [permutation[index], permutation[swapWith]] = [permutation[swapWith]!, permutation[index]!];
      }
      const encoded = encodeTeamSheetArrangement(record.draft, permutation);
      expect(decodeTeamSheetArrangement(record.draft, encoded)).toEqual(permutation);
    }
  });

  it("rejects structural defects but allows and warns on severe position mismatch", () => {
    const record = swappedRecord();
    const projected = materializeTeamSheetDraft(gameData, record.draft, record.arrangement);
    expect(projected.squad[0]!.validation_warnings.length).toBeGreaterThan(0);

    const duplicate = [...record.arrangement!];
    duplicate[1] = duplicate[0]!;
    expectErrorCode(() => verifyTeamSheetArrangement(record.draft, duplicate), "DUPLICATE_PLAYER");
    expectErrorCode(
      () => verifyTeamSheetArrangement(record.draft, record.arrangement!.slice(1)),
      "WRONG_COUNT",
    );
    const unknown = [...record.arrangement!];
    unknown[0] = "not-a-drafted-card";
    expectErrorCode(() => verifyTeamSheetArrangement(record.draft, unknown), "UNKNOWN_PLAYER");
    const overlap = [...asDraftedTeamSheet(record.draft)];
    overlap[11] = overlap[0]!;
    expectErrorCode(() => verifyTeamSheetArrangement(record.draft, overlap), "SLOT_BENCH_OVERLAP");
  });

  it("keeps the authoritative pick draft immutable and replays arranged simulation byte-for-byte", () => {
    const record = swappedRecord("wcdraft:team-sheet:replay");
    const sourceBytes = JSON.stringify(record.draft);
    const local = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, record).simulation;
    expect(JSON.stringify(record.draft)).toBe(sourceBytes);

    const decoded = decodeRunToken(encodeRunToken(record))!;
    const virtual = virtualRecordFromToken(decoded, gameData);
    const replay = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, virtual).simulation;
    expect(JSON.stringify(replay)).toBe(JSON.stringify(local));
    expect(replay.matches.every((match) => match.team_facts?.manager_presence_band === 1)).toBe(
      true,
    );
    expect(replay.matches.every((match) => match.team_facts?.base_synergy !== undefined)).toBe(
      true,
    );
  });

  it("rejects a forged mp through the same reconciliation used for arrangement", () => {
    const record = swappedRecord("wcdraft:team-sheet:forged-mp");
    const decoded = decodeRunToken(encodeRunToken(record))!;
    if (decoded.v !== 3 && decoded.v !== 4) throw new Error("expected current token");
    decoded.mp = 0;
    const projected = reconstructDraftFromToken(decoded, gameData);
    const { simulation } = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, {
      ...record,
      draft: projected,
      arrangement: undefined,
    });
    expect(() => reconcileRunToken(decoded, gameData, simulation.matches)).toThrow(
      /manager tactical tier/u,
    );
  });
});

function expectErrorCode(fn: () => unknown, code: TeamSheetError["code"]): void {
  try {
    fn();
    throw new Error("expected TeamSheetError");
  } catch (error) {
    expect(error).toBeInstanceOf(TeamSheetError);
    expect((error as TeamSheetError).code).toBe(code);
  }
}
