import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { RESULTS_ENTRY_PATHS, resultsPrimaryCta } from "../results-cta";

describe("resultsPrimaryCta", () => {
  it("enumerates every results entry path with exactly one primary action", () => {
    expect(RESULTS_ENTRY_PATHS.length).toBeGreaterThanOrEqual(6);
    const ids = new Set(RESULTS_ENTRY_PATHS.map((p) => p.id));
    expect(ids.has("classic")).toBe(true);
    expect(ids.has("hidden")).toBe(true);
    expect(ids.has("open")).toBe(true);
    expect(ids.has("legends")).toBe(true);
    expect(ids.has("daily")).toBe(true);
    expect(ids.has("challenge-originated")).toBe(true);

    for (const path of RESULTS_ENTRY_PATHS) {
      const primary = resultsPrimaryCta({ isDaily: path.isDaily });
      if (path.isDaily) {
        expect(primary).toBe("share");
      } else {
        expect(primary).toBe("draft-again");
      }
    }
  });

  it("wires the results screen so only one btn--primary is chosen structurally", () => {
    const source = readFileSync(
      new URL("../../../components/game/results-screen.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("resultsPrimaryCta");
    expect(source).toContain('data-results-actions="early"');
    expect(source).toContain("Replay tools");
    expect(source).toContain('data-daily-seed="visible"');
    // Share and Draft Again no longer both hard-code btn--primary.
    expect(source).not.toMatch(
      /href=\{draftAgainHref\} className="btn btn--primary"[\s\S]*href=\{shareHref\([^)]*\)\} className=\{`btn btn--primary/,
    );
  });

  it("keeps Replay tools closed by default via native details", () => {
    const source = readFileSync(
      new URL("../../../components/game/results-screen.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("<details className={s.replayTools}>");
    expect(source).not.toContain("<details open");
    expect(source).not.toContain("open={true}");
  });
});
