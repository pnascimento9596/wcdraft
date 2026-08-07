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

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { GameData } from "../data";
import {
  buildRunTokenBody,
  decodeRunToken,
  encodeRunToken,
  isNewerRunTokenVersion,
  reconstructDraftFromToken,
  RUN_TOKEN_V3_PREFIX,
  tokenDraftConfig,
  virtualRecordFromToken,
  versionsAgree,
  type RunTokenV1Body,
  type RunTokenV2Body,
  type RunTokenV3Body,
} from "../run-token";
import { dailyChallengeForDate } from "../daily";

import skewFixtures from "./fixtures/run-token-skew.json" with { type: "json" };

import { buildGameDataFromBundles, buildOriginRecord, PARENT_SEED } from "./run-token.test-harness";

const gameData: GameData = buildGameDataFromBundles();
const origin = buildOriginRecord(gameData);
const builtOriginBody = buildRunTokenBody(origin);
if (builtOriginBody.v !== 3) throw new Error("expected default fixture to emit a t3 body");
const originBody: RunTokenV3Body = builtOriginBody;
const retained29Manifest = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../packages/data/src/retained-runtime-data/runtime-data-2.9.0/manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  schema_version: string;
  dataset_version: string;
  rating_version_historical: string;
  rating_version_projected: string;
  engine_version: string;
  ruleset_version: string;
  bundles: { draft_pool: { sha256: string }; scenario_2026: { sha256: string } };
};

function encodeBody(body: unknown, prefix: string = RUN_TOKEN_V3_PREFIX): string {
  return prefix + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

function legacyPickLogFromOrigin(): RunTokenV1Body["pl"] {
  return [...origin.draft.spins]
    .sort((a, b) => a.index - b.index)
    .map((spin) => {
      if (spin.picked_kind === "manager") return { k: "m" as const };
      if (spin.picked_card_id === null || spin.assigned_slot_id === null) {
        throw new Error(`origin spin ${spin.index} is missing player pick fields`);
      }
      return { k: "p" as const, c: spin.picked_card_id as string, s: spin.assigned_slot_id };
    });
}

/** The equivalent `t1.` body for a default-config v3 body. */
function v1BodyFrom(b: RunTokenV3Body): RunTokenV1Body {
  return {
    v: 1,
    rid: b.rid,
    fid: b.fid,
    ps: b.ps,
    tn: b.tn,
    md: b.md,
    pl: legacyPickLogFromOrigin(),
    sv: b.sv,
    dv: b.dv,
    rv: b.rv,
    ev: b.ev,
    uv: b.uv,
    hv: b.hv,
  };
}

function v2BodyFrom(b: RunTokenV3Body): RunTokenV2Body {
  return {
    v: 2,
    rid: b.rid,
    fid: b.fid,
    ps: b.ps,
    tn: b.tn,
    md: b.md,
    df: b.df,
    rb: b.rb,
    ef: b.ef,
    pl: legacyPickLogFromOrigin(),
    sv: b.sv,
    dv: b.dv,
    rv: b.rv,
    ev: b.ev,
    uv: b.uv,
    hv: b.hv,
  };
}

function tamperedV3(mutate: (b: RunTokenV3Body) => void): string {
  const copy = JSON.parse(JSON.stringify(originBody)) as RunTokenV3Body;
  mutate(copy);
  return encodeBody(copy);
}

// ─── 1. t3 default-config replay + legacy replay refusal ────────────────────

describe("t3 — default-config replay and legacy refusal", () => {
  it("a default-config t3 token replays to the originating DraftState", () => {
    const t3 = decodeRunToken(encodeBody(originBody));
    expect(t3).not.toBeNull();
    const fromV3 = reconstructDraftFromToken(t3!, gameData);
    expect(JSON.stringify(fromV3)).toBe(JSON.stringify(origin.draft));
  });

  it("current-anchor t1/t2 bodies decode but cannot replay under choose-from-3", () => {
    const t1 = decodeRunToken(encodeBody(v1BodyFrom(originBody), "t1."));
    const t2 = decodeRunToken(encodeBody(v2BodyFrom(originBody), "t2."));
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    expect(versionsAgree(t1!, gameData.versions)).toBe(true);
    expect(versionsAgree(t2!, gameData.versions)).toBe(true);
    expect(() => reconstructDraftFromToken(t1!, gameData)).toThrow(/legacy token version/);
    expect(() => reconstructDraftFromToken(t2!, gameData)).toThrow(/legacy token version/);
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
    expect(decoded!.v).toBe(3);
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(originBody));
  });

  it("round-trips daily challenge metadata into token-loaded virtual records", () => {
    const saltMap = gameData.dailySeedSaltMap;
    if (saltMap === null) throw new Error("daily salt map fixture is missing");
    const challenge = dailyChallengeForDate(saltMap.window.start_date, saltMap);
    const record = {
      ...buildOriginRecord(gameData, challenge.seed),
      parent_seed: challenge.seed,
      challenge,
    };
    const decoded = decodeRunToken(encodeRunToken(record));
    if (decoded === null || decoded.v !== 3) throw new Error("daily token did not decode as t3");
    expect(decoded.ch).toEqual({ k: "daily", d: challenge.date, s: challenge.seed });

    const virtual = virtualRecordFromToken(decoded, gameData);
    expect(virtual.parent_seed).toBe(challenge.seed);
    expect(virtual.challenge).toEqual(challenge);
    expect(virtual.draft).toEqual(record.draft);
  });

  it("does not render forged daily metadata when seed/date derivation disagrees", () => {
    const saltMap = gameData.dailySeedSaltMap;
    if (saltMap === null) throw new Error("daily salt map fixture is missing");
    const challenge = dailyChallengeForDate(saltMap.window.start_date, saltMap);
    const record = {
      ...buildOriginRecord(gameData, challenge.seed),
      parent_seed: challenge.seed,
      challenge,
    };
    const body = buildRunTokenBody(record);
    if (body.v !== 3) throw new Error("daily token did not encode as t3");
    const forged = {
      ...body,
      ch: { k: "daily" as const, d: saltMap.dates[1]!.date, s: challenge.seed },
    };
    const decoded = decodeRunToken(encodeBody(forged));
    expect(decoded).not.toBeNull();

    const virtual = virtualRecordFromToken(decoded!, gameData);
    expect(virtual.parent_seed).toBe(challenge.seed);
    expect(virtual.challenge).toBeUndefined();
  });

  it("rejects unknown df / rb / ef.id values", () => {
    expect(decodeRunToken(tamperedV3((b) => ((b as { df: string }).df = "slot_first")))).toBeNull();
    expect(decodeRunToken(tamperedV3((b) => ((b as { rb: string }).rb = "prime")))).toBeNull();
    expect(
      decodeRunToken(tamperedV3((b) => ((b.ef as { id: string }).id = "since_1998"))),
    ).toBeNull();
  });

  it("rejects NON-CANONICAL era bounds (tamper-after-encode)", () => {
    // Right id, wrong bounds — a relabel/tamper cannot reinterpret the pool.
    expect(decodeRunToken(tamperedV3((b) => (b.ef.min = 1954)))).toBeNull();
    expect(decodeRunToken(tamperedV3((b) => (b.ef.max = 2030)))).toBeNull();
    expect(
      decodeRunToken(tamperedV3((b) => (b.ef = { id: "modern", min: 1930, max: 2026 }))),
    ).toBeNull();
  });

  it("rejects position_first entries with missing ts", () => {
    // Flipping df alone leaves every pick without the now-required ts.
    expect(decodeRunToken(tamperedV3((b) => (b.df = "position_first")))).toBeNull();
  });

  it("rejects incoherent ts under EITHER flow", () => {
    // Manager ts must be "manager".
    expect(
      decodeRunToken(
        tamperedV3((b) => {
          const m = b.pl.find((p) => p.k === "m")!;
          (m as { ts?: string }).ts = "gk";
        }),
      ),
    ).toBeNull();
    // Player ts must equal s.
    expect(
      decodeRunToken(
        tamperedV3((b) => {
          const p = b.pl.find((p) => p.k === "p")!;
          (p as { ts?: string }).ts = "bench.4";
        }),
      ),
    ).toBeNull();
  });

  it("accepts a coherent position_first pick log (ts on every entry)", () => {
    const t = tamperedV3((b) => {
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
      decodeRunToken(tamperedV3((b) => b.pl.push({ k: "p", ci: 0, s: "bench.9" }))),
    ).toBeNull();
    expect(decodeRunToken(tamperedV3((b) => void b.pl.pop()))).toBeNull();
  });

  it("rejects unknown body versions and oversized payloads", () => {
    expect(decodeRunToken(tamperedV3((b) => ((b as { v: number }).v = 4)))).toBeNull();
    expect(decodeRunToken("t3." + "A".repeat(9000))).toBeNull();
    expect(decodeRunToken("t3.")).toBeNull();
    expect(decodeRunToken("t3.!!!")).toBeNull();
  });
});

// ─── 3. anchor fuzz on t2 ────────────────────────────────────────────────────

describe("t2 — anchor fuzz (every flipped anchor yields skew, never replay)", () => {
  const ANCHORS = ["sv", "dv", "rv", "ev", "uv", "hv"] as const;
  for (const anchor of ANCHORS) {
    it(`flipping ${anchor} trips versionsAgree`, () => {
      const decoded = decodeRunToken(
        tamperedV3((b) => ((b as unknown as Record<string, unknown>)[anchor] = "flipped-anchor-x")),
      );
      expect(decoded).not.toBeNull();
      expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
    });
  }
});

// ─── 4. replay of the selected rating basis ─────────────────────────────────

describe("t2 — replay carries the rating basis (both bases live)", () => {
  it("rb 'current' decodes AND replays, recording the current basis on the draft", () => {
    const decoded = decodeRunToken(tamperedV3((b) => (b.rb = "current")));
    expect(decoded).not.toBeNull();
    const draft = reconstructDraftFromToken(decoded!, gameData);
    expect(draft.rating_basis).toBe("current");
  });

  it.each(["career", "current"] as const)(
    "a freshly authored %s token round-trips to its exact selected-basis draft",
    (basis) => {
      const record = buildOriginRecord(gameData, `${PARENT_SEED}:${basis}`, basis);
      const decoded = decodeRunToken(encodeRunToken(record));
      expect(decoded).not.toBeNull();
      expect(tokenDraftConfig(decoded!).rating_basis).toBe(basis);
      expect(JSON.stringify(reconstructDraftFromToken(decoded!, gameData))).toBe(
        JSON.stringify(record.draft),
      );
    },
  );

  it("the selected basis may change the reconstructed offer stream", () => {
    const career = buildOriginRecord(gameData, `${PARENT_SEED}:basis-delta`, "career");
    const current = buildOriginRecord(gameData, `${PARENT_SEED}:basis-delta`, "current");
    expect(current.draft.rating_basis).toBe("current");
    expect(current.draft.spins).not.toEqual(career.draft.spins);
  });
});

// ─── 5. future-version detection ─────────────────────────────────────────────

describe("future token versions — honest 'newer build' detection", () => {
  it("flags t5+ and never flags t1/t2/t3/t4/garbage", () => {
    expect(isNewerRunTokenVersion("t5.abcd")).toBe(true);
    expect(isNewerRunTokenVersion("t12.abcd")).toBe(true);
    expect(isNewerRunTokenVersion(encodeRunToken(origin))).toBe(false);
    expect(isNewerRunTokenVersion("t4.abcd")).toBe(false);
    expect(isNewerRunTokenVersion("t3.abcd")).toBe(false);
    expect(isNewerRunTokenVersion("t1.abcd")).toBe(false);
    expect(isNewerRunTokenVersion("run-v1-7")).toBe(false);
    expect(isNewerRunTokenVersion("")).toBe(false);
  });

  it("a malformed t4 body does not decode", () => {
    expect(decodeRunToken("t4." + Buffer.from("{}").toString("base64url"))).toBeNull();
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
  it("treats a token minted on retained runtime-data-2.9.0 as honest version skew", () => {
    const retainedBody: RunTokenV3Body = {
      ...originBody,
      sv: retained29Manifest.schema_version,
      dv: retained29Manifest.dataset_version,
      rv: `${retained29Manifest.rating_version_historical}+${retained29Manifest.rating_version_projected}`,
      ev: retained29Manifest.engine_version,
      uv: retained29Manifest.ruleset_version,
      hv: `${retained29Manifest.bundles.draft_pool.sha256}+${retained29Manifest.bundles.scenario_2026.sha256}`,
    };
    const decoded = decodeRunToken(encodeBody(retainedBody));

    expect(decoded).not.toBeNull();
    expect(decoded!.sv).toBe("runtime-data-2.9.0");
    expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
  });

  it("pre-Season-2 shipped t3 token: real production anchors now trip skew", () => {
    const decoded = decodeRunToken(skewFixtures.shipped_pre_s2_t3.token);
    expect(decoded).not.toBeNull();
    expect(decoded!.v).toBe(3);
    expect(skewFixtures.shipped_pre_s2_source.production_main_commit).toBe(
      "f04559f46b43944e94a4ccfa904d8cf9c1a65231",
    );
    expect(skewFixtures.shipped_pre_s2_source.producer).toBe(
      "shipped build deterministic test run; not user data",
    );
    expect(skewFixtures.shipped_pre_s2_source.body_sha256).toBe(
      "38aa896cef26b2c33092bea0f1a1a4feb7fce1b86043cb566b4c5d663b35b2e6",
    );
    expect(decoded!.sv).toBe("runtime-data-2.10.0");
    expect(decoded!.ev).toBe("engine-2026.06.30-manager-attrition");
    expect(decoded!.rv).toBe("wc-perf-6.6.0+proj-career-5.6.0");
    expect(tokenDraftConfig(decoded!)).toMatchObject({
      draft_flow: "squad_first",
      rating_basis: "career",
      era_preset: "all_time",
    });
    expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
    // After runtime-data-2.11.0, schema + data_bundle_hash also diverge (payload diet).
    expect(decoded!.sv).not.toBe(gameData.versions.schema_version);
    expect(decoded!.rv).toBe(gameData.versions.rating_version);
    expect(decoded!.hv).not.toBe(gameData.versions.data_bundle_hash);
    expect(decoded!.ev).not.toBe(gameData.versions.engine_version);
  });

  it("immediate pre-basis shipped t3 token: schema+engine fences trip skew after 2.11 diet", () => {
    const decoded = decodeRunToken(skewFixtures.shipped_pre_basis_t3.token);
    expect(decoded).not.toBeNull();
    expect(decoded!.v).toBe(3);
    expect(skewFixtures.shipped_pre_basis_source.production_main_commit).toBe(
      "735e0ecc127ac13b90527141b5fb43c019f0b03e",
    );
    expect(skewFixtures.shipped_pre_basis_source.body_sha256).toBe(
      "408f7ca241ef208b792cef3b804e37fe3d388d3551c3fe5a7221c05515aa60b3",
    );
    expect(decoded!.ev).toBe("engine-2026.07.14-squad-depth");
    // Pre-basis token was minted on 2.10; RF-01 schema diet also moves sv/hv.
    expect(decoded!.sv).not.toBe(gameData.versions.schema_version);
    expect(decoded!.dv).toBe(gameData.versions.dataset_version);
    expect(decoded!.rv).toBe(gameData.versions.rating_version);
    expect(decoded!.uv).toBe(gameData.versions.ruleset_version);
    expect(decoded!.hv).not.toBe(gameData.versions.data_bundle_hash);
    expect(decoded!.ev).not.toBe(gameData.versions.engine_version);
    expect(versionsAgree(decoded!, gameData.versions)).toBe(false);
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
