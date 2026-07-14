import { describe, expect, it } from "vitest";

import {
  activeSpin,
  isDraftComplete,
  pickManager,
  pickPlayer,
  selectDraftTarget,
} from "@wcdraft/core";

import {
  configBadgesFromRecordToken,
  configBadgesFromReplayToken,
  draftTargetLabel,
  lockBarIdleCopy,
} from "../config-badges";
import { getCatalogForEra } from "../data";
import { createNewRunRecord, type RunRecordV1 } from "../run-record";
import {
  buildRunTokenBody,
  encodeRunToken,
  type RunTokenV1Body,
  type RunTokenV3Body,
} from "../run-token";
import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";

const gameData = buildGameDataFromBundles();

function encodeBody(body: unknown, prefix: string): string {
  return prefix + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function legacyPickLogFromRecord(record: RunRecordV1): RunTokenV1Body["pl"] {
  return [...record.draft.spins]
    .sort((a, b) => a.index - b.index)
    .map((spin) => {
      if (spin.picked_kind === "manager") return { k: "m" as const };
      if (spin.picked_card_id === null || spin.assigned_slot_id === null) {
        throw new Error(`spin ${spin.index} is missing player pick fields`);
      }
      return { k: "p" as const, c: spin.picked_card_id as string, s: spin.assigned_slot_id };
    });
}

function v1BodyFrom(b: RunTokenV3Body, record: RunRecordV1): RunTokenV1Body {
  return {
    v: 1,
    rid: b.rid,
    fid: b.fid,
    ps: b.ps,
    tn: b.tn,
    md: b.md,
    pl: legacyPickLogFromRecord(record),
    sv: b.sv,
    dv: b.dv,
    rv: b.rv,
    ev: b.ev,
    uv: b.uv,
    hv: b.hv,
  };
}

async function completePositionFirstModernRun(): Promise<RunRecordV1> {
  const created = await createNewRunRecord(gameData, {
    formation_id: "4-3-3",
    mode: "classic",
    draft_flow: "position_first",
    era_preset: "modern",
  });
  const catalog = getCatalogForEra(gameData, "modern");
  let draft = created.record.draft;
  while (!isDraftComplete(draft)) {
    const targets: string[] = [];
    if (draft.manager_card_id === null) targets.push("manager");
    for (const sl of draft.squad) {
      if (sl.card_id === null) targets.push(sl.slot_id);
    }
    let advanced = false;
    for (const target of targets) {
      try {
        const rolled = selectDraftTarget(catalog, draft, target);
        const spin = activeSpin(rolled)!;
        draft =
          target === "manager"
            ? pickManager(catalog, rolled)
            : pickPlayer(catalog, rolled, spin.rolled_card_ids[0]!);
        advanced = true;
        break;
      } catch {
        continue;
      }
    }
    if (!advanced) throw new Error("position-first modern walk could not advance");
  }
  return { ...created.record, draft, status: "complete" };
}

describe("run config badges", () => {
  it("renders no badge noise for default-config t2 records", () => {
    const record = buildOriginRecord(gameData);
    expect(configBadgesFromRecordToken(record)).toEqual([]);
    expect(configBadgesFromReplayToken(encodeRunToken(record))).toEqual([]);
  });

  it("renders no badge noise for legacy t1 default tokens", () => {
    const record = buildOriginRecord(gameData);
    const t3Body = buildRunTokenBody(record);
    if (t3Body.v !== 3) throw new Error("expected default fixture to emit a t3 body");
    const t1 = encodeBody(v1BodyFrom(t3Body, record), "t1.");
    expect(configBadgesFromReplayToken(t1)).toEqual([]);
  });

  it("renders only non-default axes in era, draft-flow, rating-basis order", async () => {
    const record = await completePositionFirstModernRun();
    const expected = [
      { axis: "era_preset", label: "Modern (2018–26)" },
      { axis: "draft_flow", label: "Position First" },
    ];
    expect(configBadgesFromRecordToken(record)).toEqual(expected);
    expect(configBadgesFromReplayToken(encodeRunToken(record))).toEqual(expected);
  });
});

describe("position-first lock-bar copy", () => {
  it("names the committed target slot instead of using generic slot-pick copy", async () => {
    const record = await completePositionFirstModernRun();
    const target = record.draft.spins.find(
      (s) => s.target_slot_id && s.target_slot_id !== "manager",
    )!.target_slot_id!;
    const label = draftTargetLabel(record.draft, target);
    expect(label).toMatch(/\b(GK|DF|MF|FW|CB|LB|RB|LWB|RWB|DM|CM|AM|LW|RW|ST)\b/);
    expect(lockBarIdleCopy({ lockedTargetLabel: label, showReviewCta: false })).toBe(
      `Locked target: ${label}. Select a player for this slot.`,
    );
  });

  it("preserves default and complete-state copy outside a locked target", () => {
    expect(lockBarIdleCopy({ lockedTargetLabel: null, showReviewCta: false })).toBe(
      "Select a player and a slot, or pick the manager.",
    );
    expect(lockBarIdleCopy({ lockedTargetLabel: null, showReviewCta: true })).toBe(
      "Draft complete. Review your squad and prep for the run.",
    );
  });
});
