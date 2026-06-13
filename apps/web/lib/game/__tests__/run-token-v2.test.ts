// DC-1 — `t2.` config-bearing token surface (plan §A).
//
// What this file proves, beyond the v1 coverage in run-token.test.ts:
//   1. COMPATIBILITY PROPERTY — a current-anchor `t1.` fixture and the
//      equivalent `t2.` default-config token produce a byte-identical
//      DraftState through the same replay path.
//   2. DECODE FUZZ — unknown df / rb / ef.id, NON-CANONICAL ef bounds,
//      missing `ts` on position-first entries, incoherent `ts` (manager ts
//      !== "manager", player ts !== s), wrong pick counts: all land on an
//      honest null (MALFORMED at the API), never a guessed default.
//   3. ANCHOR FUZZ — flipping each of sv/dv/rv/ev/uv/hv on a `t2.` token
//      yields versionsAgree === false (WRONG_SEASON path), never replay.
//   4. HONEST REPLAY GATES — a decodable token whose config this build does
//      not implement is REFUSED by reconstructDraftFromToken with a loud
//      error (no fallback config, no silent substitution).
//      NOTE: the era gate flips to a real filtered-catalog replay in DC-2 and
//      the flow gate to a real position-first replay in DC-3 — those units
//      update the affected cases below in the same change.
//   5. COMMITTED PREV-SKEW FIXTURES — previous-build t1 / t2-default /
//      t2-non-default tokens trip skew against the current bundle, and a
//      config-tampered current-build token fails decode. Fixtures live in
//      fixtures/run-token-skew.json (regen: pnpm --filter @wcdraft/web
//      gen:token-skew on anchor bumps; the tampered case is anchor-stable).

import { describe, expect, it } from "vitest";

import type { GameData } from "../data";
import {
  buildRunTokenBody,
  decodeRunToken,
  encodeRunToken,
  isNewerRunTokenVersion,
  reconstructDraftFromToken,
  RUN_TOKEN_V2_PREFIX,
  tokenDraftConfig,
  versionsAgree,
  type RunTokenV1Body,
  type RunTokenV2Body,
} from "../run-token";

import skewFixtures from "./fixtures/run-token-skew.json" with { type: "json" };

import { buildGameDataFromBundles, buildOriginRecord } from "./run-token.test-harness";

const gameData: GameData = buildGameDataFromBundles();
const origin = buildOriginRecord(gameData);
const originBody: RunTokenV2Body = buildRunTokenBody(origin);

function encodeBody(body: unknown, prefix: string = RUN_TOKEN_V2_PREFIX): string {
  return prefix + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/** The equivalent `t1.` body for a default-config v2 body (compat property). */
function v1BodyFrom(b: RunTokenV2Body): RunTokenV1Body {
  return {
    v: 1,
    rid: b.rid,
    fid: b.fid,
    ps: b.ps,
    tn: b.tn,
    md: b.md,
    pl: b.pl.map((p) => (p.k === "m" ? { k: "m" as const } : { k: "p" as const, c: p.c, s: p.s })),
    sv: b.sv,
    dv: b.dv,
    rv: b.rv,
    ev: b.ev,
    uv: b.uv,
    hv: b.hv,
  };
}

function tamperedV2(mutate: (b: RunTokenV2Body) => void): string {
  const copy = JSON.parse(JSON.stringify(originBody)) as RunTokenV2Body;
  mutate(copy);
  return encodeBody(copy);
}

// ─── 1. t1 ↔ t2 default-config compatibility property ───────────────────────

describe("t2 — t1/t2 default-config equivalence (plan §A compatibility property)", () => {
  it("a default-config t2 token and its equivalent t1 token replay to a byte-identical DraftState", () => {
    const t2 = decodeRunToken(encodeBody(originBody));
    const t1 = decodeRunToken(encodeBody(v1BodyFrom(originBody), "t1."));
    expect(t2).not.toBeNull();
    expect(t1).not.toBeNull();
    const fromV2 = reconstructDraftFromToken(t2!, gameData);
    const fromV1 = reconstructDraftFromToken(t1!, gameData);
    expect(JSON.stringify(fromV1)).toBe(JSON.stringify(fromV2));
    expect(JSON.stringify(fromV2)).toBe(JSON.stringify(origin.draft));
  });

  it("tokenDraftConfig normalizes t1 to the default config", () => {
    const t1 = decodeRunToken(encodeBody(v1BodyFrom(originBody), "t1."))!;
    expect(tokenDraftConfig(t1)).toEqual({
      md: origin.draft.mode,
      draft_flow: "squad_first",
      rating_basis: "career",
      era_preset: "all_time",
    });
  });
});

// ─── 2. decode fuzz — malformed-config cases land on honest errors ──────────

describe("t2 — decode fuzz (config malformations reject, never default)", () => {
  it("round-trips a well-formed default-config body", () => {
    const decoded = decodeRunToken(encodeRunToken(origin));
    expect(decoded).not.toBeNull();
    expect(decoded!.v).toBe(2);
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(originBody));
  });

  it("rejects unknown df / rb / ef.id values", () => {
    expect(decodeRunToken(tamperedV2((b) => ((b as { df: string }).df = "slot_first")))).toBeNull();
    expect(decodeRunToken(tamperedV2((b) => ((b as { rb: string }).rb = "prime")))).toBeNull();
    expect(
      decodeRunToken(tamperedV2((b) => ((b.ef as { id: string }).id = "since_1998"))),
    ).toBeNull();
  });

  it("rejects NON-CANONICAL era bounds (tamper-after-encode)", () => {
    // Right id, wrong bounds — a relabel/tamper cannot reinterpret the pool.
    expect(decodeRunToken(tamperedV2((b) => (b.ef.min = 1954)))).toBeNull();
    expect(decodeRunToken(tamperedV2((b) => (b.ef.max = 2030)))).toBeNull();
    expect(
      decodeRunToken(tamperedV2((b) => (b.ef = { id: "modern", min: 1930, max: 2026 }))),
    ).toBeNull();
  });

  it("rejects position_first entries with missing ts", () => {
    // Flipping df alone leaves every pick without the now-required ts.
    expect(decodeRunToken(tamperedV2((b) => (b.df = "position_first")))).toBeNull();
  });

  it("rejects incoherent ts under EITHER flow", () => {
    // Manager ts must be "manager".
    expect(
      decodeRunToken(
        tamperedV2((b) => {
          const m = b.pl.find((p) => p.k === "m")!;
          (m as { ts?: string }).ts = "gk";
        }),
      ),
    ).toBeNull();
    // Player ts must equal s.
    expect(
      decodeRunToken(
        tamperedV2((b) => {
          const p = b.pl.find((p) => p.k === "p")!;
          (p as { ts?: string }).ts = "bench.4";
        }),
      ),
    ).toBeNull();
  });

  it("accepts a coherent position_first pick log (ts on every entry)", () => {
    const t = tamperedV2((b) => {
      b.df = "position_first";
      for (const p of b.pl) {
        if (p.k === "m") (p as { ts?: string }).ts = "manager";
        else (p as { ts?: string }).ts = p.s;
      }
    });
    const decoded = decodeRunToken(t);
    expect(decoded).not.toBeNull();
    expect(tokenDraftConfig(decoded!).draft_flow).toBe("position_first");
  });

  it("rejects wrong pick counts (>17 and <17)", () => {
    expect(
      decodeRunToken(tamperedV2((b) => b.pl.push({ k: "p", c: "x:1", s: "bench.9" }))),
    ).toBeNull();
    expect(decodeRunToken(tamperedV2((b) => void b.pl.pop()))).toBeNull();
  });

  it("rejects unknown body versions and oversized payloads", () => {
    expect(decodeRunToken(tamperedV2((b) => ((b as { v: number }).v = 3)))).toBeNull();
    expect(decodeRunToken("t2." + "A".repeat(9000))).toBeNull();
    expect(decodeRunToken("t2.")).toBeNull();
    expect(decodeRunToken("t2.!!!")).toBeNull();
  });
});

// ─── 3. anchor fuzz on t2 ────────────────────────────────────────────────────

describe("t2 — anchor fuzz (every flipped anchor yields skew, never replay)", () => {
  const ANCHORS = ["sv", "dv", "rv", "ev", "uv", "hv"] as const;
  for (const anchor of ANCHORS) {
    it(`flipping ${anchor} trips versionsAgree`, () => {
      const decoded = decodeRunToken(
        tamperedV2((b) => ((b as unknown as Record<string, unknown>)[anchor] = "flipped-anchor-x")),
      );
      expect(decoded).not.toBeNull();
      expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
    });
  }
});

// ─── 4. replay of the selected rating basis ─────────────────────────────────

describe("t2 — replay carries the rating basis (both bases live)", () => {
  it("rb 'current' decodes AND replays, recording the current basis on the draft", () => {
    const decoded = decodeRunToken(tamperedV2((b) => (b.rb = "current")));
    expect(decoded).not.toBeNull();
    const draft = reconstructDraftFromToken(decoded!, gameData);
    expect(draft.rating_basis).toBe("current");
  });

  it("the basis is the ONLY difference vs a career replay (spins are basis-independent)", () => {
    const current = reconstructDraftFromToken(
      decodeRunToken(tamperedV2((b) => (b.rb = "current")))!,
      gameData,
    );
    const career = reconstructDraftFromToken(
      decodeRunToken(tamperedV2((b) => (b.rb = "career")))!,
      gameData,
    );
    expect({ ...current, rating_basis: "career" }).toEqual(career);
  });
});

// ─── 5. future-version detection ─────────────────────────────────────────────

describe("future token versions — honest 'newer build' detection", () => {
  it("flags t3+ and never flags t1/t2/garbage", () => {
    expect(isNewerRunTokenVersion("t3.abcd")).toBe(true);
    expect(isNewerRunTokenVersion("t12.abcd")).toBe(true);
    expect(isNewerRunTokenVersion(encodeRunToken(origin))).toBe(false);
    expect(isNewerRunTokenVersion("t1.abcd")).toBe(false);
    expect(isNewerRunTokenVersion("run-v1-7")).toBe(false);
    expect(isNewerRunTokenVersion("")).toBe(false);
  });

  it("a t3 token does not decode (UI shows the newer-version notice instead)", () => {
    expect(decodeRunToken("t3." + Buffer.from("{}").toString("base64url"))).toBeNull();
  });
});

// ─── 6. pre-DC-1 local records normalize to defaults on encode ──────────────

describe("encode — pre-DC-1 RunRecord (no config fields) normalizes to defaults", () => {
  it("emits the default config axes, mirroring t1 decode-compat", () => {
    const legacyDraft = JSON.parse(JSON.stringify(origin.draft)) as Record<string, unknown>;
    delete legacyDraft.draft_flow;
    delete legacyDraft.rating_basis;
    delete legacyDraft.era_preset;
    const legacyRecord = { ...origin, draft: legacyDraft as unknown as typeof origin.draft };
    const body = buildRunTokenBody(legacyRecord);
    expect(body.df).toBe("squad_first");
    expect(body.rb).toBe("career");
    expect(body.ef).toEqual({ id: "all_time", min: 1930, max: 2026 });
  });
});

// ─── 7. committed PREV skew fixtures (plan §A fixture list) ──────────────────

describe("committed PREV-skew fixtures (fixtures/run-token-skew.json)", () => {
  it("current-prod t1 token: anchors derive from the shipped manifest and now trip skew", () => {
    const decoded = decodeRunToken(skewFixtures.current_prod_t1.token);
    expect(decoded).not.toBeNull();
    expect(decoded!.v).toBe(1);
    expect(decoded!.sv).toBe(skewFixtures.current_prod_source.anchors.sv);
    expect(decoded!.ev).toBe(skewFixtures.current_prod_source.anchors.ev);
    expect(decoded!.rv).toBe(skewFixtures.current_prod_source.anchors.rv);
    expect(tokenDraftConfig(decoded!)).toMatchObject({
      draft_flow: "squad_first",
      rating_basis: "career",
      era_preset: "all_time",
    });
    expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
    expect(decoded!.sv).not.toBe(gameData.versions.schema_version);
    expect(decoded!.rv).not.toBe(gameData.versions.rating_version);
    expect(decoded!.hv).not.toBe(gameData.versions.data_bundle_hash);
    expect(decoded!.ev).not.toBe(gameData.versions.engine_version);
  });

  it("prev-build t1 token: decodes, default config, trips skew", () => {
    const decoded = decodeRunToken(skewFixtures.prev_t1.token);
    expect(decoded).not.toBeNull();
    expect(decoded!.v).toBe(1);
    expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
    expect(tokenDraftConfig(decoded!).era_preset).toBe("all_time");
  });

  it("prev-build t2 default-config token: decodes, trips skew", () => {
    const decoded = decodeRunToken(skewFixtures.prev_t2_default.token);
    expect(decoded).not.toBeNull();
    expect(decoded!.v).toBe(2);
    expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
    expect(tokenDraftConfig(decoded!)).toMatchObject({
      draft_flow: "squad_first",
      rating_basis: "career",
      era_preset: "all_time",
    });
  });

  it("prev t1 and prev t2-default are equivalent defaults, but both remain version-skew", () => {
    const t1 = decodeRunToken(skewFixtures.prev_t1.token);
    const t2 = decodeRunToken(skewFixtures.prev_t2_default.token);
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    expect(tokenDraftConfig(t1!)).toEqual(tokenDraftConfig(t2!));
    expect(JSON.stringify(t1!.pl)).toBe(JSON.stringify(t2!.pl));
    expect(versionsAgree(t1!, gameData.versions)).toBe(false);
    expect(versionsAgree(t2!, gameData.versions)).toBe(false);
  });

  it("prev-build t2 NON-default-config token: decodes with its config, trips skew", () => {
    const decoded = decodeRunToken(skewFixtures.prev_t2_nondefault.token);
    expect(decoded).not.toBeNull();
    expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
    expect(tokenDraftConfig(decoded!)).toMatchObject({
      draft_flow: "position_first",
      era_preset: "modern",
    });
  });

  it("config-tampered current-build t2 token: fails decode outright (anchor-stable case)", () => {
    expect(decodeRunToken(skewFixtures.tampered_current_t2.token)).toBeNull();
    expect(isNewerRunTokenVersion(skewFixtures.tampered_current_t2.token)).toBe(false);
  });
});
