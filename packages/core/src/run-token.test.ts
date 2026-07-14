import { describe, expect, it } from "vitest";

import {
  decodeRunToken,
  encodeRunTokenBody,
  RUN_TOKEN_V3_PREFIX,
  RUN_TOKEN_V4_PREFIX,
  type RunTokenV4Body,
} from "./run-token.js";

const base = {
  rid: "run-token-mode-boundary",
  fid: "4-3-3",
  ps: "run-token-mode-boundary-seed",
  tn: "Mode Boundary XI",
  df: "squad_first",
  rb: "career",
  ef: { id: "all_time", min: 1930, max: 2026 },
  sv: "runtime-data-test",
  dv: "dataset-test",
  rv: "rating-test",
  ev: "engine-test",
  uv: "ruleset-test",
  hv: "hash-test",
} as const;

describe("run token mode/version boundary", () => {
  it("rejects open-pick-space modes under t3 bodies", () => {
    for (const md of ["open", "open_hidden"] as const) {
      const body = {
        ...base,
        v: 3,
        md,
        pl: Array.from({ length: 17 }, () => ({ k: "m" as const })),
      };

      const token =
        RUN_TOKEN_V3_PREFIX + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");

      expect(decodeRunToken(token)).toBeNull();
    }
  });

  it("accepts open and blind-open modes under t4 bodies", () => {
    for (const md of ["open", "open_hidden"] as const) {
      const body = {
        ...base,
        v: 4,
        md,
        pl: Array.from({ length: 17 }, (_, i) => ({ k: "m" as const, mc: `M-${i}:2026` })),
      } satisfies RunTokenV4Body;

      const token =
        RUN_TOKEN_V4_PREFIX + Buffer.from(JSON.stringify(body), "utf8").toString("base64url");

      expect(decodeRunToken(token)).toMatchObject({ v: 4, md });
    }
  });

  it("rejects classic and hidden modes under t4 bodies", () => {
    const body = {
      ...base,
      v: 4,
      md: "open",
      pl: Array.from({ length: 17 }, (_, i) => ({ k: "m" as const, mc: `M-${i}:2026` })),
    } satisfies RunTokenV4Body;

    for (const md of ["classic", "hidden"] as const) {
      const tampered = { ...body, md };
      const token =
        RUN_TOKEN_V4_PREFIX + Buffer.from(JSON.stringify(tampered), "utf8").toString("base64url");

      expect(decodeRunToken(token)).toBeNull();
    }
  });

  it("canonicalizes arbitrary body, config, pick, mp+a, and challenge insertion order", () => {
    const canonical = {
      ...base,
      v: 4,
      md: "open",
      pl: Array.from({ length: 17 }, (_, index) =>
        index === 0
          ? { k: "m" as const, mc: "M-1:2026" }
          : { k: "p" as const, c: `P-${index}:2026`, s: `bench.${index}` },
      ),
      mp: 1,
      a: Array.from({ length: 16 }, (_, index) => 15 - index),
      ch: { k: "daily", d: "2026-07-13", s: base.ps },
    } satisfies RunTokenV4Body;
    const reordered = {
      ch: { s: canonical.ch.s, d: canonical.ch.d, k: canonical.ch.k },
      a: canonical.a,
      mp: canonical.mp,
      hv: canonical.hv,
      uv: canonical.uv,
      ev: canonical.ev,
      rv: canonical.rv,
      dv: canonical.dv,
      sv: canonical.sv,
      pl: canonical.pl.map((pick) =>
        pick.k === "m" ? { mc: pick.mc, k: pick.k } : { s: pick.s, c: pick.c, k: pick.k },
      ),
      ef: { max: canonical.ef.max, min: canonical.ef.min, id: canonical.ef.id },
      rb: canonical.rb,
      df: canonical.df,
      md: canonical.md,
      tn: canonical.tn,
      ps: canonical.ps,
      fid: canonical.fid,
      rid: canonical.rid,
      v: canonical.v,
    } satisfies RunTokenV4Body;

    expect(encodeRunTokenBody(reordered)).toBe(encodeRunTokenBody(canonical));
  });
});
