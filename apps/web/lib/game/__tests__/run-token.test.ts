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

import {
  autoDraft,
  buildDraftCatalog,
  type DraftDataset,
} from "@wcdraft/core";
import {
  DRAFT_POOL_BUNDLE,
  RUNTIME_DATA_MANIFEST,
  SCENARIO_2026_BUNDLE,
  type RuntimeDataManifest,
} from "@wcdraft/data";

import type { GameData, RunRecordVersions } from "../data";
import { buildGameDataIndexes, composeVersions } from "../data";
import type { RunRecordV1 } from "../run-record";
import { runSimulationSync } from "../simulate";
import {
  buildRunTokenBody,
  decodeRunToken,
  encodeRunToken,
  reconstructDraftFromToken,
  RUN_TOKEN_PREFIX,
  versionsAgree,
  virtualRecordFromToken,
} from "../run-token";

// ─── Harness ─────────────────────────────────────────────────────────────────

const PARENT_SEED = "wcdraft:e2e-real-run:v1:14";

function buildDataset(): DraftDataset {
  return {
    players: DRAFT_POOL_BUNDLE.player_cards.map((c) => ({
      player_id: c.player_id,
      tournament_id: c.tournament_id,
      nation_id: c.nation_id,
      eligible_positions: c.eligible_positions,
    })),
    managers: DRAFT_POOL_BUNDLE.manager_cards.map((m) => ({
      manager_id: m.manager_id,
      tournament_id: m.tournament_id,
      nation_id: m.nation_id,
    })),
    // ENGINE-V2 E-1: era-weighted sampling needs tournament years.
    tournaments: Object.entries(DRAFT_POOL_BUNDLE.tournaments).map(([tid, t]) => ({
      tournament_id: Number(tid),
      year: t.year,
    })),
  };
}

function buildGameDataFromBundles(): GameData {
  const manifest = RUNTIME_DATA_MANIFEST as RuntimeDataManifest;
  const versions: RunRecordVersions = composeVersions(manifest);
  const indexes = buildGameDataIndexes(DRAFT_POOL_BUNDLE);
  const draftDataset = buildDataset();
  const catalog = buildDraftCatalog(draftDataset);
  return {
    manifest,
    draftPool: DRAFT_POOL_BUNDLE,
    versions,
    indexes,
    draftDataset,
    catalog,
    nationByCardId: DRAFT_POOL_BUNDLE.nation_by_card_id,
  };
}

function buildOriginRecord(gameData: GameData, seed = PARENT_SEED): RunRecordV1 {
  const draft = autoDraft({
    run_id: "token-origin",
    parent_seed: seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Origin XI",
    dataset_version: gameData.versions.dataset_version,
    rating_version: gameData.versions.rating_version,
    engine_version: gameData.versions.engine_version,
    dataset: gameData.draftDataset,
  });
  return {
    record_version: 1,
    run_id: "token-origin",
    parent_seed: seed,
    created_seq: 1,
    updated_seq: 1,
    versions: gameData.versions,
    draft,
  };
}

function asPlain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("run-token — encode / decode round-trip", () => {
  const gameData = buildGameDataFromBundles();
  const origin = buildOriginRecord(gameData);

  it("encodes to a `t1.<base64url>` string", () => {
    const token = encodeRunToken(origin);
    expect(token.startsWith(RUN_TOKEN_PREFIX)).toBe(true);
    // Body is base64url: only A-Za-z0-9_- after the prefix.
    const body = token.slice(RUN_TOKEN_PREFIX.length);
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
    // 16 player picks, each with a slot_id + card_id.
    const players = body.pl.filter(
      (p): p is { k: "p"; c: string; s: string } => p.k === "p",
    );
    expect(players.length).toBe(16);
    for (const p of players) {
      expect(p.c.length).toBeGreaterThan(0);
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
    const replaySim = runSimulationSync(
      gameData,
      SCENARIO_2026_BUNDLE,
      virtualRecord,
    ).simulation;

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

describe("run-token — season-merge bump: pre-bump token surfaces skew, current replays byte-identical", () => {
  // The real-world regression this guards: a `?run=` link minted by the
  // PREVIOUS shipped build (engine-2026.06.04 + wc-perf-2.0.0) is opened
  // against THIS build (engine-2026.06.08 + the E-4 wc-perf-3.0.0 ratings).
  // The screens (results-screen / share-screen) gate replay on
  // `versionsAgree` and MUST show the "different build" notice instead of
  // silently re-simulating the old picks against the new ratings.
  const gameData = buildGameDataFromBundles();
  const origin = buildOriginRecord(gameData);

  // Previous shipped build's anchors (pre season-merge).
  const PREV_ENGINE_VERSION = "engine-2026.06.04";
  const PREV_RATING_VERSION = "wc-perf-2.0.0";

  /** A genuine `t1.` token as the previous build would have minted it. */
  function mintPreBumpToken(): string {
    const preBumpVersions: RunRecordVersions = {
      ...gameData.versions,
      engine_version: PREV_ENGINE_VERSION,
      rating_version: PREV_RATING_VERSION,
    };
    const preBumpRecord: RunRecordV1 = { ...origin, versions: preBumpVersions };
    return encodeRunToken(preBumpRecord);
  }

  it("the current build is the bumped season-merge build", () => {
    // Pins the bump so a future stamp change is a conscious re-lock.
    // MV2-10 re-lock: the compact regen carries the MV2 stature-dominant
    // anchors (wc-perf-4.2.0 + proj-career-3.0.0); engine_version is unchanged
    // until the MV2-11b λ refit.
    expect(gameData.versions.engine_version).toBe("engine-2026.06.08");
    expect(gameData.versions.engine_version).toBe(RUNTIME_DATA_MANIFEST.engine_version);
    expect(gameData.versions.rating_version).toContain("wc-perf-4.2.0");
    expect(gameData.versions.rating_version).toContain("proj-career-3.0.0");
    expect(gameData.versions.rating_version).not.toContain(PREV_RATING_VERSION);
  });

  it("a pre-bump token (engine-2026.06.04 + wc-perf-2.0.0) trips skew — NOT a silent re-sim", () => {
    const decoded = decodeRunToken(mintPreBumpToken());
    expect(decoded).not.toBeNull();
    // The token carries the OLD anchors verbatim …
    expect(decoded!.ev).toBe(PREV_ENGINE_VERSION);
    expect(decoded!.rv).toBe(PREV_RATING_VERSION);
    // … so against the current bundle the version gate is FALSE. This is the
    // boolean results-screen.tsx / share-screen.tsx branch on to render the
    // honest "This shared run is from a different build" notice; they never
    // call reconstructDraftFromToken when this is false.
    expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
    // Specifically the engine AND rating anchors diverge (not just one).
    expect(decoded!.ev).not.toBe(gameData.versions.engine_version);
    expect(decoded!.rv).not.toBe(gameData.versions.rating_version);
  });

  it("a current-build token agrees and replays byte-identical (no skew)", () => {
    const decoded = decodeRunToken(encodeRunToken(origin))!;
    expect(decoded.ev).toBe("engine-2026.06.08");
    expect(versionsAgree(decoded, gameData.versions)).toBe(true);

    // Same-build replay is byte-identical end-to-end — the deterministic
    // subset of the persisted simulation reproduces exactly.
    const originSim = runSimulationSync(gameData, SCENARIO_2026_BUNDLE, origin).simulation;
    const replaySim = runSimulationSync(
      gameData,
      SCENARIO_2026_BUNDLE,
      virtualRecordFromToken(decoded, gameData),
    ).simulation;
    expect(JSON.stringify(replaySim)).toBe(JSON.stringify(originSim));
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
      const b64 = (typeof btoa === "function"
        ? btoa(s)
        : Buffer.from(s, "binary").toString("base64"))
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
    const b64 = (typeof btoa === "function"
      ? btoa(json)
      : Buffer.from(json, "binary").toString("base64"))
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
