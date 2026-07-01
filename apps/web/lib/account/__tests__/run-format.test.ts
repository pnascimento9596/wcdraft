import { describe, expect, it } from "vitest";

import { formatAccountRunRecord } from "../run-format";

describe("formatAccountRunRecord", () => {
  it("renders null draws as an honest dash, not a fabricated zero", () => {
    expect(
      formatAccountRunRecord({
        record: { wins: 5, losses: 2, draws: null },
      }),
    ).toBe("5-2-—");
  });

  it("renders each missing W-L-D component independently", () => {
    expect(
      formatAccountRunRecord({
        record: { wins: null, losses: null, draws: null },
      }),
    ).toBe("—-—-—");
  });
});
