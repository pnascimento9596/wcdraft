import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DraftAppBar, draftModeCueForRun } from "@/components/game/draft-screen/app-bar";

describe("friend challenge draft app bar", () => {
  it("labels a seed-disclosed Classic challenge Casual, never Ranked-capable", () => {
    const html = renderToStaticMarkup(
      createElement(DraftAppBar, {
        spinNumber: 1,
        progressPct: 0,
        mode: "classic",
        casualOnly: true,
      }),
    );

    expect(html).toContain('aria-label="Draft mode: Classic · Casual"');
    expect(html).toContain("Classic ·</span><b>Casual</b>");
    expect(html).not.toContain("Ranked-capable");
    expect(draftModeCueForRun({ mode: "classic", casualOnly: true })).toBe("Casual");
  });

  it("preserves the ordinary Classic cue outside a friend challenge", () => {
    const html = renderToStaticMarkup(
      createElement(DraftAppBar, {
        spinNumber: 1,
        progressPct: 0,
        mode: "classic",
      }),
    );

    expect(html).toContain('aria-label="Draft mode: Classic · Ranked-capable"');
    expect(html).toContain("Classic ·</span><b>Ranked-capable</b>");
    expect(html).toContain("Ranked-capable");
  });
});
