import { describe, expect, it } from "vitest";

import {
  dailyLeaderboardStandingCompactText,
  dailyLeaderboardStandingText,
  leaderboardStandingText,
  LEADERBOARD_PERCENTILE_MIN_FIELD_SIZE,
} from "../standing-copy";

describe("leaderboard standing copy boundaries", () => {
  it("keeps a zero field honest and suppresses percentile and tie claims", () => {
    const text = dailyLeaderboardStandingText({ rank: 1, percentile: 100, fieldSize: 0 });
    expect(text).toBe("#1");
    expect(text).not.toContain("Top");
    expect(text).not.toContain("Ties");
    expect(text).not.toContain("of 0");
  });

  it.each([
    { fieldSize: 1, rank: 1, expected: "#1 of 1 today · Ties share a rank" },
    { fieldSize: 19, rank: 7, expected: "#7 of 19 today · Ties share a rank" },
  ])("uses exact rank, field size, and tie note at $fieldSize", (sample) => {
    const text = dailyLeaderboardStandingText({
      rank: sample.rank,
      percentile: 1,
      fieldSize: sample.fieldSize,
    });
    expect(text).toBe(sample.expected);
    expect(text).not.toContain("Top");
  });

  it("allows percentile wording at the exact field-size boundary of 20", () => {
    expect(LEADERBOARD_PERCENTILE_MIN_FIELD_SIZE).toBe(20);
    expect(dailyLeaderboardStandingText({ rank: 4, percentile: 85, fieldSize: 20 })).toBe(
      "#4 of 20 today · Top 85% of today's field",
    );
  });

  it("does not invent a percentile for a 20-run field when the server omitted it", () => {
    expect(leaderboardStandingText({ rank: 4, percentile: null, fieldSize: 20 })).toBe(
      "#4 of 20 this board",
    );
  });

  it("does not invent a rank when the server omitted it", () => {
    expect(leaderboardStandingText({ rank: null, percentile: 50, fieldSize: 19 })).toBe(
      "Field size 19 · Rank pending",
    );
  });

  it.each([-5, 0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "omits invalid percentile %s at the threshold",
    (percentile) => {
      const standing = { rank: 1, percentile, fieldSize: 20 };
      expect(leaderboardStandingText(standing)).toBe("#1 of 20 this board");
      expect(dailyLeaderboardStandingCompactText(standing)).toBe("#1");
    },
  );

  it("degrades an inconsistent rank and field tuple without an impossible claim", () => {
    const standing = { rank: 21, percentile: 1, fieldSize: 20 };
    expect(leaderboardStandingText(standing)).toBe("Field size 20 · Rank pending");
    expect(dailyLeaderboardStandingCompactText(standing)).toBe("Rank pending");
  });

  it("uses the same validated boundary for compact fields 19 and 20", () => {
    expect(dailyLeaderboardStandingCompactText({ rank: 4, percentile: 85, fieldSize: 19 })).toBe(
      "#4",
    );
    expect(dailyLeaderboardStandingCompactText({ rank: 4, percentile: 85, fieldSize: 20 })).toBe(
      "Top 85%",
    );
  });

  it("keeps non-finite rank, field, and percentile inputs honest", () => {
    expect(
      leaderboardStandingText({ rank: Number.POSITIVE_INFINITY, percentile: 1, fieldSize: 20 }),
    ).toBe("Field size 20 · Rank pending");
    expect(
      leaderboardStandingText({ rank: 1, percentile: 1, fieldSize: Number.POSITIVE_INFINITY }),
    ).toBe("#1");
    expect(leaderboardStandingText({ rank: 4, percentile: Number.NaN, fieldSize: 19 })).toBe(
      "#4 of 19 this board · Ties share a rank",
    );
  });
});
