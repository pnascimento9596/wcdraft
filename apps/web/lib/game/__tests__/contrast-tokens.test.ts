import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const AA_BODY = 4.5;

const tokensCss = readFileSync(new URL("../../../app/ds/tokens.css", import.meta.url), "utf8");
const globalsCss = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

describe("design tokens — AA body text contrast", () => {
  it("keeps low-ink readable on dark draft canvas and cards", () => {
    const darkTokens = varsFromBlock(tokensCss, /:root\s*\{/u);
    const darkGlobals = varsFromBlock(globalsCss, /:root\[data-theme="dark"\]\s*\{/u);

    expectContrast(darkTokens, "--ink-400", darkTokens, ["--bg-850", "--bg-800"]);
    expectContrast(darkGlobals, "--tx3", darkGlobals, ["--s0", "--s1"]);
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
      expectContrast(lightTokens, fg, lightTokens, ["--bg-900", "--bg-800", "--bg-void"]);
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
      expectContrast(lightGlobals, fg, lightGlobals, ["--s0", "--s1", "--bg"]);
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
