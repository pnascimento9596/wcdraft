import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const homeHeroCss = readFileSync(
  fileURLToPath(new URL("../../../components/home/home-hero.module.css", import.meta.url)),
  "utf8",
);
const playPageCss = readFileSync(
  fileURLToPath(new URL("../../../app/play/play-page.module.css", import.meta.url)),
  "utf8",
);
const modeCss = readFileSync(
  fileURLToPath(new URL("../../../components/game/game-styles/shared.module.css", import.meta.url)),
  "utf8",
);

describe("mobile compaction contract", () => {
  it("sizes landing and mode surfaces from the small viewport and safe-area-aware masthead", () => {
    const shellHeight = "calc(100svh - 3.35rem - 1px - env(safe-area-inset-top, 0px))";
    expect(homeHeroCss).toContain(shellHeight);
    expect(playPageCss).toContain(shellHeight);
    expect(homeHeroCss).not.toContain("100vh");
    expect(playPageCss).not.toContain("100vh");
  });

  it("keeps all five modes visible instead of introducing a disclosure control", () => {
    expect(modeCss).toContain("Daily plus the four repeatable modes");
    expect(modeCss).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(modeCss).not.toContain("details[open]");
  });

  it("retains the 44px floor through full-card and dock-button targets", () => {
    expect(modeCss).toContain("min-height: 118px");
    expect(modeCss).toContain(".modeDock :global(.btn)");
  });
});
