import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FONT_SOURCE_ROOTS = ["app", "components", "lib", "public/og"] as const;
const TRACKING_SOURCE_ROOTS = ["app", "assets", "components", "lib", "public"] as const;
const ACTIVE_EXTENSIONS = new Set([".css", ".svg", ".ts", ".tsx"]);
const MAX_POSITIVE_TRACKING_EM = 0.1;

type TrackingDeclaration = {
  readonly file: string;
  readonly line: number;
  readonly value: number;
};

describe("Terrace typography source contract", () => {
  it("uses Archivo at every active authored font seam", () => {
    const sources = authoredSources(FONT_SOURCE_ROOTS);
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

    const shared = readFileSync(
      path.join(WEB_ROOT, "components/game/game-styles/shared.module.css"),
      "utf8",
    );
    const draftShell = readFileSync(
      path.join(WEB_ROOT, "components/game/game-styles/draft-shell.module.css"),
      "utf8",
    );
    const signIn = readFileSync(path.join(WEB_ROOT, "app/sign-in/sign-in.css"), "utf8");
    const results = readFileSync(
      path.join(WEB_ROOT, "components/game/game-styles/results.module.css"),
      "utf8",
    );
    const draftPolish = readFileSync(
      path.join(WEB_ROOT, "components/game/game-styles/draft-polish.module.css"),
      "utf8",
    );
    const staticShare = readFileSync(path.join(WEB_ROOT, "public/og/share-default.svg"), "utf8");
    const shareScreen = readFileSync(
      path.join(WEB_ROOT, "components/game/share-screen.tsx"),
      "utf8",
    );
    const runOg = readFileSync(path.join(WEB_ROOT, "lib/game/run-og-image.tsx"), "utf8");
    for (const source of [shared, draftShell]) {
      expect(source).toMatch(
        /\.(?:modeName|formationTitle|formationCardName)\s*\{[^}]*font-weight:\s*var\(--font-weight-heading\);[^}]*letter-spacing:\s*var\(--tracking-heading\);/su,
      );
    }
    expect(shared).toMatch(
      /\.modeCta\s*\{[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
    );
    expect(draftShell).toMatch(
      /\.formationCardCta\s*\{[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
    );
    expect(signIn).toMatch(
      /\.signin-form__submit\s*\{[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
    );
    expect(results).toMatch(
      /\.seedCopyButton\s*\{[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
    );
    for (const source of [shared, draftPolish]) {
      expect(source).toMatch(
        /\.panelTitle\s*\{[^}]*font-weight:\s*var\(--font-weight-heading\);[^}]*letter-spacing:\s*var\(--tracking-heading\);/su,
      );
    }
    expect(staticShare).toMatch(
      /<!-- Headline -->[\s\S]*font-weight="800" letter-spacing="-0\.02em"/u,
    );
    expect(shareScreen).toMatch(/fontSize="18"\s+fontWeight="800"\s+letterSpacing="-0\.02em"/u);
    expect(draftPolish).toMatch(
      /\.rareMomentTitle\s*\{[^}]*font-weight:\s*var\(--font-weight-heading\);[^}]*letter-spacing:\s*var\(--tracking-heading\);/su,
    );
    for (const weight of [400, 500, 800, 900] as const) {
      expect(runOg).toContain(`weight: ${weight.toString()},`);
    }
    expect(runOg).toContain('fontWeight: 900,\n                letterSpacing: "-0.035em"');
    expect(runOg).toContain('fontWeight: 800,\n              letterSpacing: "-0.02em"');

    expectRoleDeclarations(
      shared,
      "modeName",
      "var(--font-weight-heading)",
      "var(--tracking-heading)",
    );
    expectRoleDeclarations(
      shared,
      "modeCta",
      "var(--font-weight-button)",
      "var(--tracking-button)",
    );
    expectRoleDeclarations(
      `${draftShell}\n${draftPolish}`,
      "formationTitle",
      "var(--font-weight-heading)",
      "var(--tracking-heading)",
    );
    expectRoleDeclarations(
      `${draftShell}\n${draftPolish}`,
      "formationCardName",
      "var(--font-weight-heading)",
      "var(--tracking-heading)",
    );
    expectRoleDeclarations(
      `${draftShell}\n${draftPolish}`,
      "formationCardCta",
      "var(--font-weight-button)",
      "var(--tracking-button)",
    );
  });

  it("rejects positive tracking above 0.10em on every active authored surface", () => {
    const violations = authoredSources(TRACKING_SOURCE_ROOTS).flatMap(({ file, source }) =>
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

function authoredSources(roots: readonly string[]): readonly { file: string; source: string }[] {
  return roots.flatMap((root) => collectSources(path.join(WEB_ROOT, root)));
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

function expectRoleDeclarations(
  source: string,
  className: string,
  expectedWeight: string,
  expectedTracking: string,
): void {
  const blocks = [...source.matchAll(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`, "gu"))];
  expect(blocks.length, `missing .${className} blocks`).toBeGreaterThan(0);

  const weights: string[] = [];
  const tracking: string[] = [];
  for (const block of blocks) {
    const body = block[1] ?? "";
    weights.push(
      ...[...body.matchAll(/font-weight:\s*([^;]+);/gu)].map((match) => match[1]!.trim()),
    );
    tracking.push(
      ...[...body.matchAll(/letter-spacing:\s*([^;]+);/gu)].map((match) => match[1]!.trim()),
    );
  }
  expect(weights.length, `missing .${className} weight`).toBeGreaterThan(0);
  expect(tracking.length, `missing .${className} tracking`).toBeGreaterThan(0);
  expect(new Set(weights), `.${className} weight overrides`).toEqual(new Set([expectedWeight]));
  expect(new Set(tracking), `.${className} tracking overrides`).toEqual(
    new Set([expectedTracking]),
  );
}
