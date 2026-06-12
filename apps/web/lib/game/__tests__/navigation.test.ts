import { describe, expect, it } from "vitest";

import {
  getRunIdFromSearchParams,
  parseRunSearchParams,
  resultsHref,
  shareHref,
} from "../navigation";

describe("run navigation params", () => {
  it("keeps local run ids distinct from replay tokens", () => {
    expect(parseRunSearchParams(new URLSearchParams("run=run-v1-abc_123"))).toEqual({
      kind: "id",
      run_id: "run-v1-abc_123",
    });
    expect(getRunIdFromSearchParams(new URLSearchParams("run=run-v1-abc_123"))).toBe(
      "run-v1-abc_123",
    );
  });

  it("routes legacy t1, current t2, and future token versions to the decoder", () => {
    expect(parseRunSearchParams(new URLSearchParams("run=t1.legacyBody"))).toEqual({
      kind: "token",
      token: "t1.legacyBody",
    });
    expect(parseRunSearchParams(new URLSearchParams("run=t2.currentBody"))).toEqual({
      kind: "token",
      token: "t2.currentBody",
    });
    expect(parseRunSearchParams(new URLSearchParams("run=t3.futureBody"))).toEqual({
      kind: "token",
      token: "t3.futureBody",
    });
    expect(getRunIdFromSearchParams(new URLSearchParams("run=t2.currentBody"))).toBeNull();
  });

  it("rejects malformed token-shaped route values before decoder dispatch", () => {
    expect(parseRunSearchParams(new URLSearchParams("run=t2."))).toBeNull();
    expect(parseRunSearchParams(new URLSearchParams("run=t.abc"))).toBeNull();
    expect(parseRunSearchParams(new URLSearchParams("run=abc.def"))).toBeNull();
    expect(parseRunSearchParams(new URLSearchParams("run=t12345.body"))).toBeNull();
  });

  it("builds replay and share hrefs with opaque token values", () => {
    expect(resultsHref("t2.currentBody")).toBe("/play/results?run=t2.currentBody");
    expect(shareHref("t2.currentBody")).toBe("/play/share?run=t2.currentBody");
  });
});
