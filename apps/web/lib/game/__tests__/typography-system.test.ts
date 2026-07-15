import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ACTIVE_SOURCE_ROOTS = ["app", "components", "lib", "public/og"] as const;
const ACTIVE_EXTENSIONS = new Set([".css", ".svg", ".ts", ".tsx"]);
const MAX_POSITIVE_TRACKING_EM = 0.1;

type TrackingDeclaration = {
  readonly file: string;
  readonly line: number;
  readonly value: number;
};

describe("Terrace typography source contract", () => {
  it("uses Archivo at every active authored font seam", () => {
    const sources = activeSources();
    const combined = sources.map(({ source }) => source).join("\n");

    expect(combined).not.toContain("Space " + "Grotesk");
    expect(combined).not.toContain("space-" + "grotesk");
    expect(combined).not.toContain("fonts.google" + "apis");

    const globals = readFileSync(path.join(WEB_ROOT, "app/globals.css"), "utf8");
    for (const weight of [400, 500, 600, 700, 800, 900] as const) {
      expect(globals).toContain(`font-weight: ${weight.toString()};`);
      expect(globals).toContain(`/fonts/archivo/archivo-latin-${weight.toString()}-normal.woff2`);
      expect(globals).toContain(
        `/fonts/archivo/archivo-latin-ext-${weight.toString()}-normal.woff2`,
      );
    }
  });

  it("pins the approved display, heading, body, micro, and button roles", () => {
    const globals = readFileSync(path.join(WEB_ROOT, "app/globals.css"), "utf8");
    const tokens = readFileSync(path.join(WEB_ROOT, "app/ds/tokens.css"), "utf8");
    const roleContract = [
      "--font-weight-display: 900;",
      "--font-weight-heading: 800;",
      "--font-weight-regular: 400;",
      "--font-weight-medium: 500;",
      "--font-weight-button: 800;",
      "--tracking-display: -0.035em;",
      "--tracking-heading: -0.02em;",
      "--tracking-body: 0;",
      "--tracking-micro: 0.1em;",
      "--tracking-button: 0.02em;",
    ] as const;

    for (const declaration of roleContract) {
      expect(globals).toContain(declaration);
      expect(tokens).toContain(declaration);
    }
    expect(globals).toMatch(
      /\.display\s*\{[^}]*font-weight:\s*var\(--font-weight-display\);[^}]*letter-spacing:\s*var\(--tracking-display\);/su,
    );
    expect(globals).toMatch(
      /h1,\s*h2,\s*h3\s*\{[^}]*font-weight:\s*var\(--font-weight-heading\);[^}]*letter-spacing:\s*var\(--tracking-heading\);/su,
    );
    expect(globals).toMatch(
      /\.eyebrow\s*\{[^}]*letter-spacing:\s*var\(--tracking-micro\);[^}]*font-weight:\s*var\(--font-weight-medium\);/su,
    );
    expect(globals).toMatch(
      /\.btn\s*\{[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
    );
  });

  it("rejects positive tracking above 0.10em on every active authored surface", () => {
    const violations = activeSources().flatMap(({ file, source }) =>
      trackingDeclarations(file, source).filter(
        ({ value }) => value > MAX_POSITIVE_TRACKING_EM + Number.EPSILON,
      ),
    );
    expect(violations).toEqual([]);
  });

  it("retains the mechanical tnum request on data surfaces", () => {
    const globals = readFileSync(path.join(WEB_ROOT, "app/globals.css"), "utf8");
    const tokens = readFileSync(path.join(WEB_ROOT, "app/ds/tokens.css"), "utf8");
    expect(globals).toContain("font-variant-numeric: tabular-nums;");
    expect(globals).toContain('font-feature-settings: "kern", "liga", "tnum";');
    expect(tokens).toContain("font-variant-numeric: tabular-nums;");
  });
});

function activeSources(): readonly { file: string; source: string }[] {
  return ACTIVE_SOURCE_ROOTS.flatMap((root) => collectSources(path.join(WEB_ROOT, root)));
}

function collectSources(root: string): readonly { file: string; source: string }[] {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") return [];
      return collectSources(absolute);
    }
    if (!ACTIVE_EXTENSIONS.has(path.extname(entry.name)) || /\.test\.[^.]+$/u.test(entry.name)) {
      return [];
    }
    return [
      {
        file: path.relative(WEB_ROOT, absolute),
        source: readFileSync(absolute, "utf8"),
      },
    ];
  });
}

function trackingDeclarations(file: string, source: string): readonly TrackingDeclaration[] {
  const declarations: TrackingDeclaration[] = [];
  const pattern =
    /\b(?:letter-spacing|letterSpacing)\s*(?::|=)\s*(?:"|')?(-?(?:\d+\.?\d*|\.\d+))em/gu;
  for (const match of source.matchAll(pattern)) {
    declarations.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      value: Number(match[1]),
    });
  }
  return declarations;
}
