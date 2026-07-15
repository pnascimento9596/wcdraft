import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const homeHeroCss = readFileSync(
  fileURLToPath(new URL("../../../components/home/home-hero.module.css", import.meta.url)),
  "utf8",
);
const heroSpinCss = readFileSync(
  fileURLToPath(new URL("../../../components/home/hero-spin-demo.module.css", import.meta.url)),
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

  it("reserves the physical bottom safe area without changing rectangular-viewport density", () => {
    expect(homeHeroCss).toContain("--home-safe-area-bottom: env(safe-area-inset-bottom, 0px);");
    expect(homeHeroCss).toContain("padding-block-end: max(0.5rem, var(--home-safe-area-bottom));");
    expect(homeHeroCss).toContain("calc(0.5rem - var(--home-safe-area-bottom) / 8)");
    expect(homeHeroCss).toContain("calc(0.25rem - var(--home-safe-area-bottom) / 16)");
  });

  it("keeps all five modes visible instead of introducing a disclosure control", () => {
    expect(modeCss).toContain("Daily plus the four repeatable modes");
    expect(modeCss).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(modeCss).not.toContain("details[open]");
  });

  it("retains the 44px floor through full-card and dock-button targets", () => {
    expect(modeCss).toContain("min-height: 52px");
    expect(modeCss).toContain("min-height: 44px");
    expect(modeCss).toContain(".modeDock :global(.btn)");
  });

  it("tightens only the animated poster rhythm at the 360px breakpoint", () => {
    const foldRule = heroSpinCss.slice(heroSpinCss.indexOf("@media (max-width: 380px)"));
    expect(foldRule).toContain(
      "gap: max(0.1rem, calc(0.25rem - var(--home-safe-area-bottom, 0px) / 12));",
    );
    expect(foldRule).toContain(
      "padding: max(0.2rem, calc(0.35rem - var(--home-safe-area-bottom, 0px) / 12));",
    );
    expect(foldRule).toContain(".card .faceFlag");
    expect(foldRule).toContain(".position {\n    font-size: 1.25rem;");
    expect(foldRule).not.toContain(".poster {\n");
  });
});
