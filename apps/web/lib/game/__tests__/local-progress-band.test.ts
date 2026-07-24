import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocalProgressBand } from "../../../components/game/local-progress-band";

describe("LocalProgressBand", () => {
  it("renders a null streak as an explicit empty state, not a broken dash chrome", () => {
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

    expect(html).toContain("No streak yet");
    expect(html).not.toContain("Streak —");
    expect(html).toContain("Today —");
    expect(html).toContain("All-time 84");
  });

  it("still renders a real zero streak as 0", () => {
    const html = renderToStaticMarkup(
      createElement(LocalProgressBand, {
        summary: {
          targetDate: "2026-06-29",
          streakDays: 0,
          todayBest: null,
          allTimeBest: null,
        },
        compact: true,
      }),
    );
    expect(html).toContain("Streak 0");
    expect(html).not.toContain("No streak yet");
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

    expect(html).toContain("Friend&#x27;s run: 8-0 · 84 pts to beat");
  });

  it("keeps the sign-in nudge inline and persists dismissal against the trigger key", () => {
    const source = readFileSync(
      new URL("../../../components/game/local-progress-band.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("Keep your streak on every device");
    expect(source).toContain('href="/sign-in"');
    expect(source).toContain("Dismiss");
    expect(source).toContain("window.localStorage.getItem(trigger.storageKey)");
    expect(source).toContain('window.localStorage.setItem(trigger.storageKey, "1")');
    expect(source).toContain("checkedStorageKey === trigger.storageKey");
    expect(source).toContain("dismissedKey !== trigger.storageKey");
  });
});
