// Versioned `?run=` token — encode / decode / replay contract tests.
//
// REQUIRED OUTCOMES (PR #18 review BLOCKER #1):
//   - encode → decode round-trip is identity (body byte-equal).
//   - Reconstructed `DraftState` matches the originating draft byte-for-byte.
//   - Running the deterministic simulation on the reconstructed draft yields
//     a deterministic-subset byte-identical to the originating run — i.e. a
//     fresh browser context with NO pre-seeded localStorage can replay the
//     run from `?run=<token>` alone.
//   - Version-skew tokens are detected by `versionsAgree` so screens can
//     refuse to silently produce a divergent run.
//   - Malformed tokens decode to null, never crash.

import { describe, expect, it } from "vitest";

import { autoDraft, type DraftMode, type EraPresetId } from "@wcdraft/core";
import { SCENARIO_2026_BUNDLE } from "@wcdraft/data";

import type { RunRecordVersions } from "../data";
import type { RunRecordV1 } from "../run-record";
import { runSimulationSync } from "../simulate";
import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";
import {
  buildRunTokenBody,
  decodeRunToken,
  encodeRunToken,
  reconstructDraftFromToken,
  RUN_TOKEN_V3_PREFIX,
  RUN_TOKEN_V4_PREFIX,
  type RunTokenV4Body,
  versionsAgree,
  virtualRecordFromToken,
} from "../run-token";

// ─── Harness ─────────────────────────────────────────────────────────────────
// (shared builders live in run-token.test-harness.ts)

function asPlain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function buildOpenOriginRecord(
  gameData: ReturnType<typeof buildGameDataFromBundles>,
  seed: string,
  eraPreset: EraPresetId = "all_time",
  mode: Extract<DraftMode, "open" | "open_hidden"> = "open",
): RunRecordV1 {
  const draft = autoDraft({
    run_id: `token-${mode}-origin-${eraPreset}`,
    parent_seed: seed,
    formation_id: "4-3-3",
    mode,
    team_name: mode === "open_hidden" ? "Blind Open XI" : "Open XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    era_preset: eraPreset,
    dataset: gameData.draftDataset,
  });
  return {
    record_version: 1,
    run_id: draft.run_id,
    parent_seed: seed,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
  };
}

function expectV4Body(record: RunRecordV1): RunTokenV4Body {
  const body = buildRunTokenBody(record);
  if (body.v !== 4) throw new Error("expected Open Draft record to emit a t4 body");
  return body;
}

function encodeV4Body(body: RunTokenV4Body): string {
  return RUN_TOKEN_V4_PREFIX + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function encodeRawV3Body(body: unknown): string {
  return RUN_TOKEN_V3_PREFIX + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function cloneV4(body: RunTokenV4Body): RunTokenV4Body {
  return JSON.parse(JSON.stringify(body)) as RunTokenV4Body;
}

function v4PlayerPicks(body: RunTokenV4Body) {
  return body.pl
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: Extract<RunTokenV4Body["pl"][number], { k: "p" }>; i: number } => {
      return x.p.k === "p";
    });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("run-token — encode / decode round-trip", () => {
  const gameData = buildGameDataFromBundles();
  const origin = buildOriginRecord(gameData);

  it("encodes to a `t3.<base64url>` string", () => {
    const token = encodeRunToken(origin);
    expect(token.startsWith(RUN_TOKEN_V3_PREFIX)).toBe(true);
    // Body is base64url: only A-Za-z0-9_- after the prefix.
    const body = token.slice(RUN_TOKEN_V3_PREFIX.length);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/u);
  });

  it("encode → decode round-trips to a byte-identical body", () => {
    const built = buildRunTokenBody(origin);
    const token = encodeRunToken(origin);
    const decoded = decodeRunToken(token);
    expect(decoded).not.toBeNull();
    // JSON-stringified equality — pins byte identity at the body level.
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(built));
    expect(asPlain(decoded!)).toEqual(asPlain(built));
  });

  it("encodes all 17 picks in spin-index order", () => {
    const body = buildRunTokenBody(origin);
    expect(body.pl.length).toBe(17);
    // Exactly one manager pick across the 17 spins.
    const managers = body.pl.filter((p) => p.k === "m");
    expect(managers.length).toBe(1);
    // 16 player picks, each with a slot_id + choice index into the re-derived offer.
    const players = body.pl.filter((p): p is { k: "p"; ci: number; s: string } => p.k === "p");
    expect(players.length).toBe(16);
    for (const p of players) {
      expect(p.ci).toBeGreaterThanOrEqual(0);
      expect(p.ci).toBeLessThan(3);
      expect(p.s.length).toBeGreaterThan(0);
    }
  });

  it("token body carries every version anchor verbatim", () => {
    const body = buildRunTokenBody(origin);
    expect(body.sv).toBe(gameData.versions.schema_version);
    expect(body.dv).toBe(gameData.versions.dataset_version);
    expect(body.rv).toBe(gameData.versions.rating_version);
    expect(body.ev).toBe(gameData.versions.engine_version);
    expect(body.uv).toBe(gameData.versions.ruleset_version);
    expect(body.hv).toBe(gameData.versions.data_bundle_hash);
  });

  it("round-trips the stable manager-presence tier and rejects an out-of-domain value", () => {
    const record = { ...origin, manager_presence_band: 1 as const };
    const body = buildRunTokenBody(record);
    expect(body.mp).toBe(1);
    expect(decodeRunToken(encodeRunToken(record))).toMatchObject({ v: 3, mp: 1 });
    const forged = { ...body, mp: 2 };
    expect(decodeRunToken(encodeRawV3Body(forged))).toBeNull();
  });
});

describe("run-token — fresh-context replay (the BLOCKER scenario)", () => {
  const gameData = buildGameDataFromBundles();
  const origin = buildOriginRecord(gameData);

  it("reconstructs a DraftState byte-identical to the originating draft", () => {
    const token = encodeRunToken(origin);
    const decoded = decodeRunToken(token)!;
    const replayed = reconstructDraftFromToken(decoded, gameData);
    // Plain JSON to defeat frozen / prototype quirks.
    expect(asPlain(replayed)).toEqual(asPlain(origin.draft));
    // Byte-identity at the JSON-string level — the strongest check.
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(origin.draft));
  });

  it("running the simulation on the replayed draft yields a byte-identical deterministic subset", () => {
    // Origin simulation — what the source browser persists.
    const originSim = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, origin).simulation;

    // Fresh-context replay — token decoded against the SAME bundle, NO
    // pre-seeded localStorage. This is the regression contract: the user
    // receiving the URL on a clean browser must see the SAME run.
    const token = encodeRunToken(origin);
    const decoded = decodeRunToken(token)!;
    expect(versionsAgree(decoded, gameData.versions)).toBe(true);
    const virtualRecord = virtualRecordFromToken(decoded, gameData);
    const replaySim = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, virtualRecord).simulation;

    // The deterministic subset — `{ scenario, run, matches, group_stage,
    // knockout_ladder_meta }` — must be byte-identical end-to-end.
    expect(JSON.stringify(replaySim)).toBe(JSON.stringify(originSim));
  });

  it("MatchResult.match_id strings stay stable across replay (uses the originating run_id)", () => {
    const originSim = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, origin).simulation;
    const token = encodeRunToken(origin);
    const decoded = decodeRunToken(token)!;
    const virtualRecord = virtualRecordFromToken(decoded, gameData);
    const replaySim = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, virtualRecord).simulation;
    const originIds = originSim.matches.map((m) => m.match_id);
    const replayIds = replaySim.matches.map((m) => m.match_id);
    expect(replayIds).toEqual(originIds);
  });
});

describe("run-token — Open Draft t4 replay", () => {
  const gameData = buildGameDataFromBundles();
  const origin = buildOpenOriginRecord(gameData, "wcdraft:open-token:all-time");
  const blindOrigin = buildOpenOriginRecord(
    gameData,
    "wcdraft:blind-open-token:all-time",
    "all_time",
    "open_hidden",
  );

  it("encodes Open Draft as t4 with picked card and manager ids", () => {
    const token = encodeRunToken(origin);
    expect(token.startsWith(RUN_TOKEN_V4_PREFIX)).toBe(true);
    const body = expectV4Body(origin);
    expect(body.md).toBe("open");
    expect(body.pl).toHaveLength(17);
    expect(body.pl.some((p) => p.k === "m" && "mc" in p)).toBe(true);
    expect(body.pl.filter((p) => p.k === "p").every((p) => "c" in p)).toBe(true);
  });

  it("encodes Blind Open as t4 with picked card and manager ids", () => {
    const token = encodeRunToken(blindOrigin);
    expect(token.startsWith(RUN_TOKEN_V4_PREFIX)).toBe(true);
    const body = expectV4Body(blindOrigin);
    expect(body.md).toBe("open_hidden");
    expect(body.pl).toHaveLength(17);
    expect(body.pl.some((p) => p.k === "m" && "mc" in p)).toBe(true);
    expect(body.pl.filter((p) => p.k === "p").every((p) => "c" in p)).toBe(true);
  });

  it("round-trips and reconstructs Open Draft and Blind Open byte-for-byte", () => {
    for (const record of [origin, blindOrigin]) {
      const token = encodeRunToken(record);
      const decoded = decodeRunToken(token);
      expect(decoded?.v).toBe(4);
      expect(JSON.stringify(decoded)).toBe(JSON.stringify(expectV4Body(record)));
      const replayed = reconstructDraftFromToken(decoded!, gameData);
      expect(asPlain(replayed)).toEqual(asPlain(record.draft));
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(record.draft));
    }
  });

  it.each([
    ["Open Draft", origin],
    ["Blind Open", blindOrigin],
  ] as const)("rejects a %s t4 player card from the wrong nation", (_label, record) => {
    const body = cloneV4(expectV4Body(record));
    const firstPlayer = v4PlayerPicks(body)[0];
    if (!firstPlayer) throw new Error("fixture has no player picks");
    const { p, i } = firstPlayer;
    const spin = record.draft.spins[i]!;
    const wrongNation = gameData.draftPool.player_cards.find(
      (card) => card.nation_id !== spin.nation_id,
    );
    if (!wrongNation) throw new Error("fixture has no wrong-nation card");
    body.pl[i] = { ...p, c: wrongNation.card_id };
    const decoded = decodeRunToken(encodeV4Body(body));
    expect(decoded?.v).toBe(4);
    expect(() => reconstructDraftFromToken(decoded!, gameData)).toThrow(/not a candidate/i);
  });

  it.each([
    ["Open Draft", origin],
    ["Blind Open", blindOrigin],
  ] as const)("rejects a %s t4 duplicate player pick", (_label, record) => {
    const body = cloneV4(expectV4Body(record));
    const players = v4PlayerPicks(body);
    if (players.length < 2) throw new Error("fixture has fewer than two player picks");
    body.pl[players[1]!.i] = { ...players[1]!.p, c: players[0]!.p.c };
    const decoded = decodeRunToken(encodeV4Body(body));
    expect(decoded?.v).toBe(4);
    expect(() => reconstructDraftFromToken(decoded!, gameData)).toThrow(
      /already drafted|not a candidate/i,
    );
  });

  it.each([
    ["Open Draft", "open"],
    ["Blind Open", "open_hidden"],
  ] as const)("rejects a %s t4 card excluded by the era preset", (_label, mode) => {
    const modern = buildOpenOriginRecord(gameData, `wcdraft:${mode}-token:modern`, "modern", mode);
    const body = cloneV4(expectV4Body(modern));
    const players = v4PlayerPicks(body);
    const oldCard = players
      .map(({ p, i }) => {
        const spin = modern.draft.spins[i]!;
        const card = gameData.draftPool.player_cards.find((candidate) => {
          const tournament = gameData.draftPool.tournaments[String(candidate.tournament_id)];
          return (
            candidate.nation_id === spin.nation_id &&
            tournament !== undefined &&
            tournament.year < 2018
          );
        });
        return card ? { p, i, card } : null;
      })
      .find((item): item is NonNullable<typeof item> => item !== null);
    if (!oldCard) throw new Error("modern fixture has no same-nation pre-2018 card to tamper in");
    body.pl[oldCard.i] = { ...oldCard.p, c: oldCard.card.card_id };
    const decoded = decodeRunToken(encodeV4Body(body));
    expect(decoded?.v).toBe(4);
    expect(() => reconstructDraftFromToken(decoded!, gameData)).toThrow(/not a candidate/i);
  });
});

describe("run-token — honest-state on version skew", () => {
  const gameData = buildGameDataFromBundles();
  const origin = buildOriginRecord(gameData);

  it("versionsAgree is true when all anchors match", () => {
    const decoded = decodeRunToken(encodeRunToken(origin))!;
    expect(versionsAgree(decoded, gameData.versions)).toBe(true);
  });

  it("versionsAgree is false when ANY anchor differs", () => {
    const decoded = decodeRunToken(encodeRunToken(origin))!;
    const cases: Array<Partial<RunRecordVersions>> = [
      { schema_version: "different" },
      { dataset_version: "different" },
      { rating_version: "different" },
      { engine_version: "different" },
      { ruleset_version: "different" },
      { data_bundle_hash: "different" },
    ];
    for (const patch of cases) {
      const skew = { ...gameData.versions, ...patch };
      expect(
        versionsAgree(decoded, skew),
        `expected skew on ${Object.keys(patch).join(",")} to trip versionsAgree`,
      ).toBe(false);
    }
  });
});

describe("run-token — malformed input safety", () => {
  it("returns null for an empty string", () => {
    expect(decodeRunToken("")).toBeNull();
  });

  it("returns null for a non-token string", () => {
    expect(decodeRunToken("run-v1-abc123")).toBeNull();
    expect(decodeRunToken("hello")).toBeNull();
  });

  it("returns null for invalid base64url payload", () => {
    expect(decodeRunToken("t1.!!!not_base64!!!")).toBeNull();
  });

  it("returns null when the decoded JSON is the wrong shape", () => {
    const garbage = (() => {
      const s = JSON.stringify({ hello: "world" });
      // inline base64url encode
      const b64 = (
        typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64")
      )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/u, "");
      return `t1.${b64}`;
    })();
    expect(decodeRunToken(garbage)).toBeNull();
  });

  it("returns null for an over-long token", () => {
    const oversized = "t1." + "A".repeat(9000);
    expect(decodeRunToken(oversized)).toBeNull();
  });

  it("returns null when the version sentinel is wrong", () => {
    const body = {
      v: 2,
      rid: "x",
      fid: "4-3-3",
      ps: "wcdraft:demo",
      tn: "X",
      md: "classic",
      pl: [],
      sv: "1",
      dv: "1",
      rv: "1",
      ev: "1",
      uv: "1",
      hv: "1",
    };
    const json = JSON.stringify(body);
    const b64 = (
      typeof btoa === "function" ? btoa(json) : Buffer.from(json, "binary").toString("base64")
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/u, "");
    expect(decodeRunToken(`t1.${b64}`)).toBeNull();
  });
});

describe("run-token — token shape & size sanity", () => {
  const gameData = buildGameDataFromBundles();
  const origin = buildOriginRecord(gameData);

  it("the encoded token is well under the URL-safe ceiling", () => {
    const token = encodeRunToken(origin);
    // 8KB ceiling; real tokens come in well under 2KB.
    expect(token.length).toBeLessThan(8192);
    expect(token.length).toBeGreaterThan(0);
  });

  it("encoding is stable: same record → same token", () => {
    const a = encodeRunToken(origin);
    const b = encodeRunToken(origin);
    expect(a).toBe(b);
  });
});
