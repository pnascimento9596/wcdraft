import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { RUN_SURFACE_PALETTE } from "../run-palette";

const AA_BODY = 4.5;
const RAMP_POSITION_TOLERANCE = 0.006;
// Approved ceremony artwork literals with no Terrace token. This exception is
// deliberately file/value/count scoped so another hardcoded color still fails.
const CEREMONY_LITERAL_COLORS = new Map([
  ["components/game/simulation-ceremony.module.css|#05130c", 1],
  ["components/game/simulation-ceremony.tsx|#f5c95f", 2],
]);

const tokensCss = readFileSync(new URL("../../../app/ds/tokens.css", import.meta.url), "utf8");
const globalsCss = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
const globalErrorSource = readFileSync(
  new URL("../../../app/global-error.tsx", import.meta.url),
  "utf8",
);
const manifestSource = readFileSync(new URL("../../../app/manifest.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../../../app/layout.tsx", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../../../app/page.tsx", import.meta.url), "utf8");
const shareDefaultSvg = readFileSync(
  new URL("../../../public/og/share-default.svg", import.meta.url),
  "utf8",
);
const verifyFlowSource = readFileSync(
  new URL("../../auth/verify-flow.ts", import.meta.url),
  "utf8",
);

const PROGRAMME = {
  page: "#f1ecdf",
  card: "#faf7ee",
  raised: "#fefef5",
  well: "#e8e2d1",
  border: "#ddd6c4",
  ink: "#16180f",
  inkSecondary: "#5c5c4e",
  accentText: "#0f5f3f",
  goldText: "#7a5a12",
} as const;

const TERRACE = {
  page: "#0f100e",
  card: "#1a1d19",
  raised: "#212520",
  border: "#2b2f29",
  ink: "#ebe6da",
  accent: "#3f9268",
  accentPress: "#408964",
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
    expect(requireVar(darkGlobals, "--accent-press")).toBe(TERRACE.accentPress);
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

  it("keeps CTA ink AA across the solid, pressed, and standalone auth fills", () => {
    const darkGlobals = varsFromBlock(globalsCss, /:root\[data-theme="dark"\]\s*\{/u);
    const lightGlobals = varsFromBlock(globalsCss, /:root,\s*:root\[data-theme="light"\]\s*\{/u);
    const pressed = requireVar(darkGlobals, "--accent-press");
    const globalActiveRule = cssBlock(
      globalsCss,
      /:where\(\s*a,\s*button,\s*summary,\s*\[role="button"\],\s*\[role="link"\],\s*\[role="menuitem"\],\s*\[role="radio"\],\s*\[role="switch"\],\s*\[role="tab"\]\s*\):active/u,
    );

    expect(contrastRatio(TERRACE.onAccent, TERRACE.accent)).toBeGreaterThanOrEqual(AA_BODY);
    expect(pressed).toBe(TERRACE.accentPress);
    expect(contrastRatio(TERRACE.onAccent, "#37805b")).toBeCloseTo(3.9833, 3);
    expect(contrastRatio(TERRACE.onAccent, "#3f8863")).toBeLessThan(AA_BODY);
    expect(contrastRatio(TERRACE.onAccent, pressed)).toBeCloseTo(4.5074, 3);
    expect(contrastRatio(TERRACE.onAccent, pressed)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrastRatio(TERRACE.onGold, TERRACE.gold)).toBeGreaterThanOrEqual(AA_BODY);
    for (const backgroundName of ["--bg", "--s1", "--s2"] as const) {
      const background = requireVar(darkGlobals, backgroundName);
      const fadedInk = mixSrgb(TERRACE.onAccent, background, 0.82);
      const fadedFill = mixSrgb(pressed, background, 0.82);
      expect(contrastRatio(fadedInk, fadedFill), backgroundName).toBeLessThan(AA_BODY);
    }
    expect(globalActiveRule).toContain("translate: 0 1px");
    expect(globalActiveRule).not.toContain("opacity:");
    expect(globalsCss).toMatch(
      /\.btn--primary:active\s*\{[^}]*translate:\s*none;[^}]*background:\s*var\(--accent-press\);/u,
    );
    expect(homeSource).toContain('className="btn btn--primary btn--gold"');
    expect(contrastRatio(requireVar(darkGlobals, "--gold-ink"), pressed)).toBeCloseTo(4.3715, 3);
    expect(globalsCss).toMatch(
      /\.btn--primary\.btn--gold:active\s*\{[^}]*background:\s*var\(--gold-solid\);/u,
    );
    for (const globals of [lightGlobals, darkGlobals]) {
      expect(
        contrastRatio(requireVar(globals, "--gold-ink"), requireVar(globals, "--gold-solid")),
      ).toBeGreaterThanOrEqual(AA_BODY);
    }
    expect(verifyFlowSource).toContain("--accent-press: #408964");
    expect(verifyFlowSource).toContain("button:hover { background: var(--accent-press); }");
    expect(RUN_SURFACE_PALETTE.dark.accentStrong).toBe(TERRACE.accentPress);
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
    const approvedCounts = new Map<string, number>();
    const violations = componentFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/#[0-9A-Fa-f]{3,8}\b/gu)].flatMap((match) => {
        const relative = file.pathname.split("/apps/web/").at(-1) ?? file.pathname;
        const key = `${relative}|${match[0].toLowerCase()}`;
        if (CEREMONY_LITERAL_COLORS.has(key)) {
          approvedCounts.set(key, (approvedCounts.get(key) ?? 0) + 1);
          return [];
        }
        return [`${file.pathname}:${lineAt(source, match.index ?? 0)}:${match[0]}`];
      });
    });
    expect(approvedCounts).toEqual(CEREMONY_LITERAL_COLORS);
    expect(CEREMONY_LITERAL_COLORS.has("components/game/simulation-ceremony.tsx|#ffffff")).toBe(
      false,
    );
    expect(violations).toEqual([]);
  });
});

describe("Terrace light Programme palette", () => {
  it("maps Programme onto both existing token surfaces without flattening their roles", () => {
    const lightTokens = varsFromBlock(tokensCss, /\[data-theme="light"\]\s*\{/u);
    const lightGlobals = varsFromBlock(globalsCss, /:root,\s*:root\[data-theme="light"\]\s*\{/u);

    expect(requireVar(lightTokens, "--bg-void")).toBe(PROGRAMME.page);
    expect(requireVar(lightTokens, "--bg-850")).toBe(PROGRAMME.page);
    expect(requireVar(lightTokens, "--bg-800")).toBe(PROGRAMME.card);
    expect(requireVar(lightTokens, "--bg-750")).toBe(PROGRAMME.raised);
    expect(requireVar(lightTokens, "--bg-650")).toBe(PROGRAMME.well);
    expect(requireVar(lightTokens, "--line")).toBe(PROGRAMME.border);
    expect(requireVar(lightTokens, "--ink-100")).toBe(PROGRAMME.ink);
    expect(requireVar(lightTokens, "--ink-400")).toBe(PROGRAMME.inkSecondary);
    expect(requireVar(lightTokens, "--teal-bright")).toBe(PROGRAMME.accentText);
    expect(requireVar(lightTokens, "--ember")).toBe(TERRACE.accent);
    expect(requireVar(lightTokens, "--ember-bright")).toBe(PROGRAMME.accentText);
    expect(requireVar(lightTokens, "--gold")).toBe(TERRACE.gold);
    expect(requireVar(lightTokens, "--gold-bright")).toBe(PROGRAMME.goldText);

    expect(requireVar(lightGlobals, "--bg")).toBe(PROGRAMME.page);
    expect(requireVar(lightGlobals, "--s1")).toBe(PROGRAMME.card);
    expect(requireVar(lightGlobals, "--s2")).toBe(PROGRAMME.raised);
    expect(requireVar(lightGlobals, "--well")).toBe(PROGRAMME.well);
    expect(requireVar(lightGlobals, "--line")).toBe(PROGRAMME.border);
    expect(requireVar(lightGlobals, "--tx")).toBe(PROGRAMME.ink);
    expect(requireVar(lightGlobals, "--tx3")).toBe(PROGRAMME.inkSecondary);
    expect(requireVar(lightGlobals, "--accent")).toBe(TERRACE.accent);
    expect(requireVar(lightGlobals, "--accent-solid")).toBe(TERRACE.accent);
    expect(requireVar(lightGlobals, "--accent-text")).toBe(PROGRAMME.accentText);
    expect(requireVar(lightGlobals, "--gold")).toBe(TERRACE.gold);
    expect(requireVar(lightGlobals, "--gold-solid")).toBe(TERRACE.gold);
    expect(requireVar(lightGlobals, "--gold-strong")).toBe(PROGRAMME.goldText);
    expect(requireVar(lightGlobals, "--accent-ink")).toBe(TERRACE.onAccent);
    expect(requireVar(lightGlobals, "--accent-on-solid")).toBe(TERRACE.onAccent);
    expect(requireVar(lightGlobals, "--gold-ink")).toBe(TERRACE.onGold);
  });

  it("preserves the current surface and ink ramps' relative-luminance steps", () => {
    expectRampPositions(
      ["#f1ecdf", "#fbf8f0", "#ffffff"],
      [PROGRAMME.page, PROGRAMME.card, PROGRAMME.raised],
    );
    expectRampPositions(
      ["#16211a", "#2f3a33", "#46524b", "#566158", "#9aa399"],
      [PROGRAMME.ink, "#333529", "#4c4d40", PROGRAMME.inkSecondary, "#a09e8c"],
    );
  });

  it("keeps every light body-text stop AA on every actual paper surface", () => {
    const lightTokens = varsFromBlock(tokensCss, /\[data-theme="light"\]\s*\{/u);
    const lightGlobals = varsFromBlock(globalsCss, /:root,\s*:root\[data-theme="light"\]\s*\{/u);

    for (const fg of [
      "--ink-100",
      "--ink-200",
      "--ink-300",
      "--ink-400",
      "--cyan",
      "--cyan-bright",
      "--cyan-deep",
      "--teal",
      "--teal-bright",
      "--teal-deep",
      "--ember-bright",
      "--gold-bright",
      "--gold-deep",
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
    ] as const) {
      expectContrast(lightTokens, fg, lightTokens, ["--bg-900", "--bg-800", "--bg-750"]);
    }

    for (const fg of [
      "--tx",
      "--tx2",
      "--tx3",
      "--accent-deep",
      "--accent-text",
      "--gold-strong",
      "--gold-deep",
      "--hist",
      "--proj",
      "--est",
      "--mgr",
      "--unk",
      "--neg",
      "--field",
    ] as const) {
      expectContrast(lightGlobals, fg, lightGlobals, ["--bg", "--s1", "--s2"]);
    }
  });

  it("keeps structural solids separate and preserves the actual dark on-fill inks", () => {
    const lightGlobals = varsFromBlock(globalsCss, /:root,\s*:root\[data-theme="light"\]\s*\{/u);

    expect(requireVar(lightGlobals, "--accent-solid")).toBe(TERRACE.accent);
    expect(requireVar(lightGlobals, "--gold-solid")).toBe(TERRACE.gold);
    expect(contrastRatio(TERRACE.accent, PROGRAMME.card)).toBeLessThan(AA_BODY);
    expect(contrastRatio(TERRACE.gold, PROGRAMME.card)).toBeLessThan(AA_BODY);
    expect(contrastRatio(PROGRAMME.accentText, PROGRAMME.card)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrastRatio(PROGRAMME.goldText, PROGRAMME.card)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrastRatio(TERRACE.onAccent, TERRACE.accent)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrastRatio(TERRACE.onGold, TERRACE.gold)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrastRatio("#ebe6da", TERRACE.accent)).toBeLessThan(AA_BODY);
  });

  it("keeps the five provenance hues AA and mutually distinguishable on both papers", () => {
    const lightTokens = varsFromBlock(tokensCss, /\[data-theme="light"\]\s*\{/u);
    const hues = [
      requireVar(lightTokens, "--prov-historical"),
      requireVar(lightTokens, "--prov-projected"),
      requireVar(lightTokens, "--prov-estimate"),
      requireVar(lightTokens, "--prov-manager"),
      requireVar(lightTokens, "--prov-unknown"),
    ];

    for (const hue of hues) {
      expect(contrastRatio(hue, PROGRAMME.page), `${hue} on page`).toBeGreaterThanOrEqual(AA_BODY);
      expect(contrastRatio(hue, PROGRAMME.card), `${hue} on card`).toBeGreaterThanOrEqual(AA_BODY);
    }
    for (let left = 0; left < hues.length; left += 1) {
      for (let right = left + 1; right < hues.length; right += 1) {
        expect(deltaE76(hues[left]!, hues[right]!)).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it("locks every dark/shared token byte while light Programme evolves independently", () => {
    const darkInventory = [
      ...customPropertyInventory(tokensCss, /:root\s*\{/u, "tokens"),
      ...customPropertyInventory(globalsCss, /:root\[data-theme="dark"\]\s*\{/u, "globals"),
    ];
    expect(darkInventory).toHaveLength(164);
    expect(createHash("sha256").update(JSON.stringify(darkInventory)).digest("hex")).toBe(
      "92f49ea9bdb1226a647fa6f69173d8065f1d2d1e89758ec978801f991493bbae",
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
