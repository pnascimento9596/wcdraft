import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

const AA_BODY = 4.5;
const AA_LARGE = 3.0;
const RAMP_POSITION_TOLERANCE = 0.006;

const tokensCss = readFileSync(new URL("../../../app/ds/tokens.css", import.meta.url), "utf8");
const globalsCss = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
const globalErrorSource = readFileSync(
  new URL("../../../app/global-error.tsx", import.meta.url),
  "utf8",
);
const manifestSource = readFileSync(new URL("../../../app/manifest.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../../../app/layout.tsx", import.meta.url), "utf8");
const shareDefaultSvg = readFileSync(
  new URL("../../../public/og/share-default.svg", import.meta.url),
  "utf8",
);

/**
 * These are the existing light-theme structural brand solids. They are fills,
 * mark chrome, and large display accents rather than body text on light paper.
 */
const LIGHT_BRAND_SOLIDS = {
  emerald: "#2ecf92",
  gold: "#f5b62a",
} as const;

const TERRACE = {
  page: "#0f100e",
  card: "#1a1d19",
  raised: "#212520",
  border: "#2b2f29",
  ink: "#ebe6da",
  accent: "#3f9268",
  accentText: "#3fa268",
  gold: "#d4a94e",
  onAccent: "#05130c",
  onGold: "#1a1305",
} as const;

describe("Terrace dark palette", () => {
  it("maps the approved stops onto both existing token surfaces", () => {
    const darkTokens = varsFromBlock(tokensCss, /:root\s*\{/u);
    const darkGlobals = varsFromBlock(globalsCss, /:root\[data-theme="dark"\]\s*\{/u);

    expect(requireVar(darkTokens, "--bg-void")).toBe(TERRACE.page);
    expect(requireVar(darkTokens, "--bg-800")).toBe(TERRACE.card);
    expect(requireVar(darkTokens, "--bg-750")).toBe(TERRACE.raised);
    expect(requireVar(darkTokens, "--line")).toBe(TERRACE.border);
    expect(requireVar(darkTokens, "--ink-100")).toBe(TERRACE.ink);
    expect(requireVar(darkTokens, "--teal")).toBe(TERRACE.accent);
    expect(requireVar(darkTokens, "--teal-bright")).toBe(TERRACE.accentText);
    expect(requireVar(darkTokens, "--gold")).toBe(TERRACE.gold);

    expect(requireVar(darkGlobals, "--bg")).toBe(TERRACE.page);
    expect(requireVar(darkGlobals, "--s1")).toBe(TERRACE.card);
    expect(requireVar(darkGlobals, "--s2")).toBe(TERRACE.raised);
    expect(requireVar(darkGlobals, "--line")).toBe(TERRACE.border);
    expect(requireVar(darkGlobals, "--tx")).toBe(TERRACE.ink);
    expect(requireVar(darkGlobals, "--accent-solid")).toBe(TERRACE.accent);
    expect(requireVar(darkGlobals, "--accent-text")).toBe(TERRACE.accentText);
    expect(requireVar(darkGlobals, "--gold-solid")).toBe(TERRACE.gold);
    expect(requireVar(darkGlobals, "--accent-on-solid")).toBe(TERRACE.onAccent);
    expect(requireVar(darkGlobals, "--gold-ink")).toBe(TERRACE.onGold);
  });

  it("preserves the prior ramps' relative-luminance positions", () => {
    expectRampPositions(
      ["#080809", "#0e0e10", "#161618", "#1e1e21", "#25252a"],
      ["#0f100e", "#151512", "#1a1d19", "#212520", "#292c28"],
    );
    expectRampPositions(
      ["#edecf2", "#c5c3d4", "#9695a8", "#8a899c", "#424153"],
      ["#ebe6da", "#c3c1b5", "#96968a", "#8a8b7f", "#474c40"],
    );
    expectRampPositions(["#c8861a", "#f5b62a", "#ffd86a"], ["#ac7e34", "#d4a94e", "#f1c15c"]);
  });

  it("keeps every body-text stop AA on the dark surfaces where it is used", () => {
    const darkTokens = varsFromBlock(tokensCss, /:root\s*\{/u);
    const darkGlobals = varsFromBlock(globalsCss, /:root\[data-theme="dark"\]\s*\{/u);

    for (const fg of [
      "--ink-100",
      "--ink-200",
      "--ink-300",
      "--ink-400",
      "--teal-bright",
      "--ember-bright",
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
      "--lock",
      "--lock-dim",
    ] as const) {
      expectContrast(darkTokens, fg, darkTokens, ["--bg-850", "--bg-800", "--bg-750"]);
    }

    for (const fg of [
      "--tx",
      "--tx2",
      "--tx3",
      "--accent-text",
      "--gold",
      "--gold-strong",
      "--hist",
      "--proj",
      "--est",
      "--mgr",
      "--neg",
    ] as const) {
      expectContrast(darkGlobals, fg, darkGlobals, ["--s0", "--s1", "--s2"]);
    }

    expect(contrastRatio(requireVar(darkGlobals, "--field-ink"), "#1f6a47")).toBeGreaterThanOrEqual(
      AA_BODY,
    );
    expect(contrastRatio(requireVar(darkTokens, "--ink-400"), TERRACE.raised)).toBeCloseTo(
      4.5033,
      3,
    );
  });

  it("keeps structural green separate from its minimally lifted text stop", () => {
    const darkGlobals = varsFromBlock(globalsCss, /:root\[data-theme="dark"\]\s*\{/u);
    const card = requireVar(darkGlobals, "--s1");
    const raised = requireVar(darkGlobals, "--s2");
    const structural = requireVar(darkGlobals, "--accent-solid");
    const text = requireVar(darkGlobals, "--accent-text");

    expect(structural).toBe(TERRACE.accent);
    expect(contrastRatio(structural, card)).toBeLessThan(AA_BODY);
    expect(text).toBe(TERRACE.accentText);
    expect(contrastRatio(text, card)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrastRatio(text, raised)).toBeGreaterThanOrEqual(AA_BODY);

    const tintedCard = mixSrgb(structural, requireVar(darkGlobals, "--s1"), 0.14);
    expect(tintedCard).toBe("#1f2d24");
    expect(contrastRatio("#3fa168", tintedCard)).toBeLessThan(AA_BODY);
    expect(contrastRatio(text, tintedCard)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it("keeps CTA ink AA against the approved structural fills", () => {
    expect(contrastRatio(TERRACE.onAccent, TERRACE.accent)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrastRatio(TERRACE.onGold, TERRACE.gold)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it("keeps all five provenance hues AA and mutually distinguishable on page and card", () => {
    const darkTokens = varsFromBlock(tokensCss, /:root\s*\{/u);
    const hues = [
      requireVar(darkTokens, "--prov-historical"),
      requireVar(darkTokens, "--prov-projected"),
      requireVar(darkTokens, "--prov-estimate"),
      requireVar(darkTokens, "--prov-manager"),
      requireVar(darkTokens, "--prov-unknown"),
    ];

    for (const hue of hues) {
      expect(contrastRatio(hue, TERRACE.page), `${hue} on page`).toBeGreaterThanOrEqual(AA_BODY);
      expect(contrastRatio(hue, TERRACE.card), `${hue} on card`).toBeGreaterThanOrEqual(AA_BODY);
    }
    for (let left = 0; left < hues.length; left += 1) {
      for (let right = left + 1; right < hues.length; right += 1) {
        const delta = deltaE76(hues[left]!, hues[right]!);
        expect(delta, `${hues[left]} versus ${hues[right]}`).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it("threads the palette into standalone dark and install surfaces", () => {
    expect(globalErrorSource).toContain("--error-bg: #0f100e");
    expect(globalErrorSource).toContain("--error-accent: #3fa268");
    expect(globalErrorSource).toContain("--error-accent-solid: #3f9268");
    expect(manifestSource).toContain('background_color: "#0f100e"');
    expect(manifestSource).toContain('theme_color: "#3f9268"');
    expect(layoutSource).toContain('{ media: "(prefers-color-scheme: dark)", color: "#0f100e" }');
    expect(shareDefaultSvg).toContain("--terrace-page:#0f100e");
    expect(shareDefaultSvg).toContain("--terrace-card:#1a1d19");
    expect(shareDefaultSvg).toContain('fill="var(--terrace-ink)"');
  });

  it("contains no hardcoded hex colors in component source", () => {
    const componentFiles = filesBelow(new URL("../../../components/", import.meta.url));
    const violations = componentFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/#[0-9A-Fa-f]{3,8}\b/gu)].map(
        (match) => `${file.pathname}:${lineAt(source, match.index ?? 0)}:${match[0]}`,
      );
    });
    expect(violations).toEqual([]);
  });
});

describe("Terrace light-mode immutability", () => {
  it("locks the base light values and the exact shared typography consequence", () => {
    const inventory = [
      ...customPropertyInventory(tokensCss, /\[data-theme="light"\]\s*\{/u, "tokens"),
      ...customPropertyInventory(
        globalsCss,
        /:root,\s*:root\[data-theme="light"\]\s*\{/u,
        "globals",
      ),
    ];
    const sharedTypographyNames = new Set([
      "--font-family",
      "--font-weight-bold",
      "--font-weight-display",
      "--font-weight-heading",
      "--font-weight-button",
      "--tracking-display",
      "--tracking-heading",
      "--tracking-body",
      "--tracking-micro",
      "--tracking-button",
    ]);
    const sharedTypography = inventory.filter(([, name]) => sharedTypographyNames.has(name));
    const preservedBaseValues = inventory.filter(([, name]) => !sharedTypographyNames.has(name));

    expect(preservedBaseValues).toHaveLength(122);
    expect(createHash("sha256").update(JSON.stringify(preservedBaseValues)).digest("hex")).toBe(
      "ce8624f9c559a92f30ea2ecc20b098170e412a8bd48238e31971960a392c59ef",
    );
    expect(sharedTypography).toEqual([
      ["globals", "--font-family", '"Archivo", system-ui, sans-serif'],
      ["globals", "--font-weight-bold", "800"],
      ["globals", "--font-weight-display", "900"],
      ["globals", "--font-weight-heading", "800"],
      ["globals", "--font-weight-button", "800"],
      ["globals", "--tracking-display", "-0.035em"],
      ["globals", "--tracking-heading", "-0.02em"],
      ["globals", "--tracking-body", "0"],
      ["globals", "--tracking-micro", "0.1em"],
      ["globals", "--tracking-button", "0.02em"],
    ]);
  });

  it("keeps low ink and text-facing accents AA on light paper", () => {
    const lightTokens = varsFromBlock(tokensCss, /\[data-theme="light"\]\s*\{/u);
    const lightGlobals = varsFromBlock(globalsCss, /:root,\s*:root\[data-theme="light"\]\s*\{/u);

    for (const fg of [
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
    ] as const) {
      expectContrast(lightTokens, fg, lightTokens, [
        "--bg-900",
        "--bg-800",
        "--bg-void",
        "--bg-750",
      ]);
    }

    for (const fg of [
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
    ] as const) {
      expectContrast(lightGlobals, fg, lightGlobals, ["--s0", "--s1", "--bg", "--s2"]);
    }
  });

  it("preserves the light structural-brand exemption", () => {
    const lightGlobals = varsFromBlock(globalsCss, /:root,\s*:root\[data-theme="light"\]\s*\{/u);
    const lightTokens = varsFromBlock(tokensCss, /\[data-theme="light"\]\s*\{/u);

    expect(requireVar(lightGlobals, "--accent-solid")).toBe(LIGHT_BRAND_SOLIDS.emerald);
    expect(requireVar(lightGlobals, "--gold-solid")).toBe(LIGHT_BRAND_SOLIDS.gold);
    expect(requireVar(lightTokens, "--teal")).not.toBe(LIGHT_BRAND_SOLIDS.emerald);
    expect(requireVar(lightTokens, "--gold")).not.toBe(LIGHT_BRAND_SOLIDS.gold);
    expect(
      contrastRatio(LIGHT_BRAND_SOLIDS.emerald, requireVar(lightGlobals, "--s0")),
    ).toBeLessThan(AA_BODY);
    expect(contrastRatio(LIGHT_BRAND_SOLIDS.emerald, TERRACE.page)).toBeGreaterThanOrEqual(
      AA_LARGE,
    );
  });
});

function cssBlock(source: string, start: RegExp): string {
  const startMatch = start.exec(source);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`CSS block not found: ${start}`);
  }
  const open = source.indexOf("{", startMatch.index);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`CSS block is not closed: ${start}`);
}

function varsFromBlock(source: string, start: RegExp): Map<string, string> {
  const body = cssBlock(source, start);
  const vars = new Map<string, string>();
  for (const match of body.matchAll(/(--[A-Za-z0-9_-]+):\s*(#[0-9A-Fa-f]{6})\s*;/gu)) {
    vars.set(match[1]!, match[2]!);
  }
  return vars;
}

function customPropertyInventory(
  source: string,
  start: RegExp,
  namespace: string,
): Array<[string, string, string]> {
  return [...cssBlock(source, start).matchAll(/(--[A-Za-z0-9_-]+):\s*([^;]+);/gu)].map((match) => [
    namespace,
    match[1]!,
    match[2]!.trim().replace(/\s+/gu, " "),
  ]);
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

function expectRampPositions(previous: readonly string[], next: readonly string[]): void {
  const previousPositions = normalizedRampPositions(previous);
  const nextPositions = normalizedRampPositions(next);
  expect(nextPositions).toHaveLength(previousPositions.length);
  for (let index = 0; index < previousPositions.length; index += 1) {
    expect(Math.abs(nextPositions[index]! - previousPositions[index]!)).toBeLessThanOrEqual(
      RAMP_POSITION_TOLERANCE,
    );
  }
}

function normalizedRampPositions(colors: readonly string[]): number[] {
  const luminances = colors.map(relativeLuminance);
  const start = luminances[0]!;
  const span = luminances.at(-1)! - start;
  return luminances.map((luminance) => (luminance - start) / span);
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

function deltaE76(left: string, right: string): number {
  const a = rgbToLab(left);
  const b = rgbToLab(right);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function mixSrgb(foreground: string, background: string, foregroundWeight: number): string {
  const front = hexToRgb(foreground);
  const back = hexToRgb(background);
  return `#${front
    .map((channel, index) =>
      Math.round(channel * foregroundWeight + back[index]! * (1 - foregroundWeight))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function rgbToLab(hex: string): [number, number, number] {
  const [red, green, blue] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const x = (red! * 0.4124 + green! * 0.3576 + blue! * 0.1805) / 0.95047;
  const y = red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
  const z = (red! * 0.0193 + green! * 0.1192 + blue! * 0.9505) / 1.08883;
  const pivot = (value: number): number =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function filesBelow(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return filesBelow(child);
    return /\.(?:css|ts|tsx)$/u.test(entry.name) ? [child] : [];
  });
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}
