import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocalProgressBand } from "../../../components/game/local-progress-band";

describe("LocalProgressBand", () => {
  it("renders unknown server streaks as an honest dash", () => {
    const html = renderToStaticMarkup(
      createElement(LocalProgressBand, {
        summary: {
          targetDate: "2026-06-29",
          streakDays: null,
          todayBest: null,
          allTimeBest: 84,
        },
        compact: true,
      }),
    );

    expect(html).toContain("—-DAY STREAK");
    expect(html).toContain("Today&#x27;s best: —");
    expect(html).toContain("All-time best: 84");
  });

  it("pins session-scoped friend-run context into the daily band", () => {
    const html = renderToStaticMarkup(
      createElement(LocalProgressBand, {
        summary: {
          targetDate: "2026-06-29",
          streakDays: 2,
          todayBest: null,
          allTimeBest: null,
        },
        friendRun: { record: "8-0", score: 84 },
        compact: true,
      }),
    );

    expect(html).toContain("Friend&#x27;s run: 8-0 · 84 pts — beat it");
  });
});
