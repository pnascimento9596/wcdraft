import { describe, expect, it } from "vitest";

import {
  decodeRunToken,
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
});
