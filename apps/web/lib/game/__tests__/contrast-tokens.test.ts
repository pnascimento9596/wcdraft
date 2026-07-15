import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const AA_BODY = 4.5;
const AA_LARGE = 3.0;

const tokensCss = readFileSync(new URL("../../../app/ds/tokens.css", import.meta.url), "utf8");
const globalsCss = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

/**
 * Brand structural solids kept bright for large/UI chrome (mark, solid fills).
 * They are NOT required to clear AA body (≥4.5) on light paper — only large-text
 * (≥18px/bold → ≥3:1) when used as text. Text-facing accent ramps use deepened
 * light-theme tokens (`--teal`, `--gold`, `--accent`) instead.
 */
const BRAND_SOLID_LARGE_ONLY = {
  emerald: "#2ecf92",
  gold: "#f5b62a",
} as const;

describe("design tokens — AA body text contrast", () => {
  it("keeps low-ink readable on dark canvas, cards, and raised panels", () => {
    const darkTokens = varsFromBlock(tokensCss, /:root\s*\{/u);
    const darkGlobals = varsFromBlock(globalsCss, /:root\[data-theme="dark"\]\s*\{/u);

    // bg-750 / s2 are raised panels — the prior ink-400 (#828195) failed body AA here (~4.37).
    expectContrast(darkTokens, "--ink-400", darkTokens, ["--bg-850", "--bg-800", "--bg-750"]);
    expectContrast(darkGlobals, "--tx3", darkGlobals, ["--s0", "--s1", "--s2"]);

    // Pin measured ratios so silent regressions cannot re-darken muted ink.
    const ink400 = requireVar(darkTokens, "--ink-400");
    const bg750 = requireVar(darkTokens, "--bg-750");
    expect(contrastRatio(ink400, bg750)).toBeGreaterThanOrEqual(AA_BODY);
    expect(ink400).toBe("#8a899c");
  });

  it("keeps low-ink and accent text readable on light paper surfaces", () => {
    const lightTokens = varsFromBlock(tokensCss, /\[data-theme="light"\]\s*\{/u);
    const lightGlobals = varsFromBlock(globalsCss, /:root,\s*:root\[data-theme="light"\]\s*\{/u);

    const tokenTextVars = [
      "--ink-400",
      "--cyan",
      "--cyan-bright",
      "--cyan-deep",
      "--teal",
      "--teal-bright",
      "--teal-deep",
      "--ember",
      "--ember-bright",
      "--ember-deep",
      "--gold",
      "--gold-bright",
      "--gold-deep",
      "--amber",
      "--amber-bright",
      "--win",
      "--loss",
      "--draw",
      "--warn",
      "--info",
      "--prov-historical",
      "--prov-projected",
      "--prov-estimate",
      "--prov-manager",
      "--prov-legend",
      "--prov-unknown",
      "--pos-gk",
      "--pos-def",
      "--pos-mid",
      "--pos-fwd",
    ] as const;
    for (const fg of tokenTextVars) {
      expectContrast(lightTokens, fg, lightTokens, [
        "--bg-900",
        "--bg-800",
        "--bg-void",
        "--bg-750",
      ]);
    }

    const globalTextVars = [
      "--tx3",
      "--accent",
      "--gold",
      "--hist",
      "--proj",
      "--est",
      "--mgr",
      "--unk",
      "--neg",
      "--field",
    ] as const;
    for (const fg of globalTextVars) {
      expectContrast(lightGlobals, fg, lightGlobals, ["--s0", "--s1", "--bg", "--s2"]);
    }
  });

  it("preserves brand solids for structural chrome; text ramps stay deepened", () => {
    const lightGlobals = varsFromBlock(globalsCss, /:root,\s*:root\[data-theme="light"\]\s*\{/u);
    const lightTokens = varsFromBlock(tokensCss, /\[data-theme="light"\]\s*\{/u);
    const darkGlobals = varsFromBlock(globalsCss, /:root\[data-theme="dark"\]\s*\{/u);

    // Structural solid stays the brand emerald/gold; text-facing ramps are deepened.
    // Architect note: brand solids are fills/mark/wordmark chrome — not body text on
    // light paper (emerald≈1.7:1 on cream). Do not darken the mark to chase body AA.
    expect(requireVar(lightGlobals, "--accent-solid")).toBe(BRAND_SOLID_LARGE_ONLY.emerald);
    expect(requireVar(lightGlobals, "--gold-solid")).toBe(BRAND_SOLID_LARGE_ONLY.gold);
    expect(requireVar(lightTokens, "--teal")).not.toBe(BRAND_SOLID_LARGE_ONLY.emerald);
    expect(requireVar(lightTokens, "--gold")).not.toBe(BRAND_SOLID_LARGE_ONLY.gold);
    // Deepened text accents still clear body AA (covered above); brand solids do not.
    expect(
      contrastRatio(BRAND_SOLID_LARGE_ONLY.emerald, requireVar(lightGlobals, "--s0")),
    ).toBeLessThan(AA_BODY);

    // On the dark canvas the same solids clear large-text AA (mark / solid CTAs).
    for (const solid of Object.values(BRAND_SOLID_LARGE_ONLY)) {
      for (const bgName of ["--s0", "--s1"] as const) {
        const bg = requireVar(darkGlobals, bgName);
        const ratio = contrastRatio(solid, bg);
        expect(ratio, `${solid} large-text on dark ${bgName} ${bg}`).toBeGreaterThanOrEqual(
          AA_LARGE,
        );
      }
    }
  });
});

function varsFromBlock(source: string, start: RegExp): Map<string, string> {
  const startMatch = start.exec(source);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`CSS block not found: ${start}`);
  }
  const open = source.indexOf("{", startMatch.index);
  const close = source.indexOf("\n}", open);
  if (open < 0 || close < 0) throw new Error(`CSS block is not closed: ${start}`);
  const body = source.slice(open + 1, close);
  const vars = new Map<string, string>();
  for (const match of body.matchAll(/(--[A-Za-z0-9_-]+):\s*(#[0-9A-Fa-f]{6})\s*;/gu)) {
    vars.set(match[1]!, match[2]!);
  }
  return vars;
}

function expectContrast(
  fgVars: Map<string, string>,
  fgName: string,
  bgVars: Map<string, string>,
  bgNames: readonly string[],
): void {
  const fg = requireVar(fgVars, fgName);
  for (const bgName of bgNames) {
    const bg = requireVar(bgVars, bgName);
    const ratio = contrastRatio(fg, bg);
    expect(ratio, `${fgName} ${fg} on ${bgName} ${bg}`).toBeGreaterThanOrEqual(AA_BODY);
  }
}

function requireVar(vars: Map<string, string>, name: string): string {
  const value = vars.get(name);
  if (!value) throw new Error(`CSS variable ${name} not found`);
  return value;
}

function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const high = Math.max(fg, bg);
  const low = Math.min(fg, bg);
  return (high + 0.05) / (low + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}
