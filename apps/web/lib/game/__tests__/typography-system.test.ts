import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WEB_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FONT_SOURCE_ROOTS = ["app", "components", "lib", "public/og"] as const;
const TRACKING_SOURCE_ROOTS = ["app", "assets", "components", "lib", "public"] as const;
const ACTIVE_EXTENSIONS = new Set([".css", ".svg", ".ts", ".tsx"]);
const MAX_POSITIVE_TRACKING_EM = 0.1;
const LOCKED_UPPERCASE_ROLE_INVENTORY_SHA256 =
  "e04584509b77df53557eb721c66f4b98055cd259a4de2a7d80fe81cdf632f7b3";

type TrackingDeclaration = {
  readonly file: string;
  readonly line: number;
  readonly raw: string;
  readonly value: number;
};

type RoleViolation = {
  readonly file: string;
  readonly line: number;
  readonly selector: string;
  readonly weight: string | null;
  readonly tracking: string | null;
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

    const latinExtFaces = [
      ...globals.matchAll(
        /@font-face\s*\{[^}]*archivo-latin-ext-(400|500|600|700|800|900)-normal\.woff2[^}]*unicode-range:\s*([^;]+);[^}]*\}/gsu,
      ),
    ];
    expect(latinExtFaces).toHaveLength(6);
    for (const [, weight, range] of latinExtFaces) {
      expect(range, `Archivo ${weight} Latin-ext eligibility`).toContain("U+0100-02BA");
      expect(range, `Archivo ${weight} Latin-ext eligibility`).toContain("U+02C7-02CC");
      expect(range, `Archivo ${weight} Latin-ext eligibility`).toContain("U+02DD-02FF");
      expect(range, `Archivo ${weight} combining-mark eligibility`).toContain("U+0300-0304");
      expect(range, `Archivo ${weight} combining-mark eligibility`).toContain("U+0308-0309");
      expect(range, `Archivo ${weight} combining-mark eligibility`).toContain("U+0323");
      expect(range, `Archivo ${weight} Latin-ext eligibility`).toContain("U+1D00-1DBF");
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
    expect(globals).toMatch(
      /button\s*\{[^}]*font-weight:\s*var\(--font-weight-button\)\s*!important;[^}]*letter-spacing:\s*var\(--tracking-button\)\s*!important;/su,
    );

    const shared = readFileSync(
      path.join(WEB_ROOT, "components/game/game-styles/shared.module.css"),
      "utf8",
    );
    const draftShell = readFileSync(
      path.join(WEB_ROOT, "components/game/game-styles/draft-shell.module.css"),
      "utf8",
    );
    const draftBase = readFileSync(
      path.join(WEB_ROOT, "components/game/game-styles/draft-base.module.css"),
      "utf8",
    );
    const draftSpin = readFileSync(
      path.join(WEB_ROOT, "components/game/game-styles/draft-spin.module.css"),
      "utf8",
    );
    const signIn = readFileSync(path.join(WEB_ROOT, "app/sign-in/sign-in.css"), "utf8");
    const account = readFileSync(path.join(WEB_ROOT, "app/account/account.css"), "utf8");
    const accountClient = readFileSync(
      path.join(WEB_ROOT, "app/account/account-client.tsx"),
      "utf8",
    );
    const leaderboard = readFileSync(
      path.join(WEB_ROOT, "components/leaderboard/leaderboard.module.css"),
      "utf8",
    );
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
    const globalError = readFileSync(path.join(WEB_ROOT, "app/global-error.tsx"), "utf8");
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
    expect(signIn).toMatch(
      /\.signin-screen__title\s*\{[^}]*letter-spacing:\s*var\(--tracking-display\);/su,
    );
    expect(signIn).toMatch(
      /\.signin-sent__h\s*\{[^}]*font-weight:\s*var\(--font-weight-display\);[^}]*letter-spacing:\s*var\(--tracking-display\);/su,
    );
    expect(signIn).toMatch(
      /\.signin-form__inline\s*\{[^}]*font:[^;]+;[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
    );
    expect(signIn).toMatch(
      /\.signin-sent__again\s*\{[^}]*font:[^;]+;[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
    );
    expect(globals).toMatch(/\.prose h3\s*\{[^}]*letter-spacing:\s*var\(--tracking-heading\);/su);
    expect(account).toMatch(
      /\.account-head h1\s*\{[^}]*font-weight:\s*var\(--font-weight-display\);[^}]*letter-spacing:\s*var\(--tracking-display\);/su,
    );
    expect(account).toMatch(
      /\.account-section-head h2\s*\{[^}]*font-weight:\s*var\(--font-weight-heading\);[^}]*letter-spacing:\s*var\(--tracking-heading\);/su,
    );
    expect(account).toMatch(
      /\.account-run h3\s*\{[^}]*font-weight:\s*var\(--font-weight-heading\);[^}]*letter-spacing:\s*var\(--tracking-heading\);/su,
    );
    expect(account).toMatch(
      /\.account-link-button\s*\{[^}]*font:[^;]+;[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
    );
    for (const accountButtonClass of [
      "account-link-button",
      "account-action",
      "account-danger",
      "account-load-more",
    ] as const) {
      expect(accountClient).toContain(accountButtonClass);
    }
    expect(leaderboard).toMatch(
      /\.submitTitle\s*\{[^}]*font-weight:\s*var\(--font-weight-heading\);[^}]*letter-spacing:\s*var\(--tracking-heading\);/su,
    );
    expect(leaderboard).toMatch(
      /\.laneTab\s*\{[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
    );
    expect(draftShell).toMatch(
      /\.setupSegBtn\s*\{[^}]*font-weight:\s*var\(--font-weight-button\);[^}]*letter-spacing:\s*var\(--tracking-button\);/su,
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
    expect(staticShare).toContain(
      'font-weight:400;src:url("/fonts/archivo/archivo-latin-400-normal.woff2")',
    );
    expect(staticShare).toMatch(
      /<!-- Footer line:[\s\S]*font-weight="500" letter-spacing="0\.1em"/u,
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
    expectUppercaseRoleAssignments(`${runOg}\n${globalError}`);

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
    expectRoleDeclarations(
      `${draftShell}\n${draftPolish}`,
      "appBarTitle",
      "var(--font-weight-heading)",
      "var(--tracking-heading)",
    );
    expectRoleDeclarations(
      `${draftBase}\n${draftPolish}`,
      "benchLabel",
      "var(--font-weight-medium)",
      "var(--tracking-micro)",
    );
    expectRoleDeclarations(
      `${draftSpin}\n${draftPolish}`,
      "spinResultName",
      "var(--font-weight-heading)",
      "var(--tracking-heading)",
    );
    expectRoleDeclarations(
      results,
      "outcomeHeadline",
      "var(--font-weight-heading)",
      "var(--tracking-heading)",
    );
    expectRoleDeclarations(
      results,
      "memoryProgressionTitle",
      "var(--font-weight-heading)",
      "var(--tracking-heading)",
    );
    expectRoleDeclarations(
      results,
      "pinButton",
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

    const adversarialSyntaxes = [
      '<path font-size="100" letter-spacing="60" />',
      ".plus { letter-spacing: +0.11em; }",
      ".calc { letter-spacing: calc(0.10em + 0.01em); }",
    ].join("\n");
    const adversarialViolations = trackingDeclarations(
      "public/flags/fixture.svg",
      adversarialSyntaxes,
    ).filter(({ value }) => value > MAX_POSITIVE_TRACKING_EM + Number.EPSILON);
    expect(adversarialViolations).toEqual([
      {
        file: "public/flags/fixture.svg",
        line: 1,
        raw: "60",
        value: Number.POSITIVE_INFINITY,
      },
      {
        file: "public/flags/fixture.svg",
        line: 2,
        raw: "+0.11em",
        value: 0.11,
      },
      {
        file: "public/flags/fixture.svg",
        line: 3,
        raw: "calc(0.10em + 0.01em)",
        value: Number.POSITIVE_INFINITY,
      },
    ]);
  });

  it("assigns every authored uppercase CSS seam to a locked Terrace role", () => {
    const sources = authoredSources(["app", "components"]).filter(({ file }) =>
      file.endsWith(".css"),
    );
    const violations = sources.flatMap(({ file, source }) => [
      ...uppercaseRoleViolations(file, source),
      ...uppercaseOverrideViolations(file, source),
    ]);
    expect(violations).toEqual([]);

    const inventory = uppercaseRoleInventory(sources);
    expect(inventory.length).toBeGreaterThan(0);
    expect(roleInventoryHash(inventory)).toBe(LOCKED_UPPERCASE_ROLE_INVENTORY_SHA256);

    const legalRoleSwap = sources.map(({ file, source }) => ({
      file,
      source:
        file === "components/game/game-styles/shared.module.css"
          ? source.replace(
              /(?<selector>\.modeTag\s*\{[\s\S]*?font-size:\s*10px;[\s\S]*?)font-weight:\s*var\(--font-weight-medium\);\s*letter-spacing:\s*var\(--tracking-micro\);/u,
              "$<selector>font-weight: var(--font-weight-button);\n  letter-spacing: var(--tracking-button);",
            )
          : source,
    }));
    expect(legalRoleSwap).not.toEqual(sources);
    expect(roleInventoryHash(uppercaseRoleInventory(legalRoleSwap))).not.toBe(
      LOCKED_UPPERCASE_ROLE_INVENTORY_SHA256,
    );
  });

  it("retains the mechanical tnum request on data surfaces", () => {
    const globals = readFileSync(path.join(WEB_ROOT, "app/globals.css"), "utf8");
    const tokens = readFileSync(path.join(WEB_ROOT, "app/ds/tokens.css"), "utf8");
    expect(globals).toContain("font-variant-numeric: tabular-nums;");
    expect(globals).toContain('font-feature-settings: "kern", "liga", "tnum";');
    expect(tokens).toContain("font-variant-numeric: tabular-nums;");
  });

  it("pins renderer-compatible Archivo tabular derivatives for edge OG numerals", () => {
    const route = readFileSync(path.join(WEB_ROOT, "app/api/og/run/route.tsx"), "utf8");
    const runOg = readFileSync(path.join(WEB_ROOT, "lib/game/run-og-image.tsx"), "utf8");
    const shareScreen = readFileSync(
      path.join(WEB_ROOT, "components/game/share-screen.tsx"),
      "utf8",
    );
    const staticShare = readFileSync(path.join(WEB_ROOT, "public/og/share-default.svg"), "utf8");
    const expected = [
      {
        weight: 400,
        source: "9c0a51442fdc30e015f734d04fd957ae00e3f39cc07817050735da301c0d7eda",
        derived: "da77a6ed32a65aade9d833855981c3c6dad4fde8c37f948391275feef4f1fb6b",
      },
      {
        weight: 500,
        source: "29719fa13f06afbcc46f373e9e94f4ade13aca0fc997e7b4d35fea203cad776c",
        derived: "17e321fbc9b4a0f31cd61ad297184dd623e47ac0a0e5fa8177df6a312ceac61e",
      },
      {
        weight: 800,
        source: "585c9cce853f7140238c31f858aa01f8e913cd1ac88f7675f3f8ed26227f93c5",
        derived: "8b64ef4afd88ae8362d108eafd9fc649fef9cfdab2b2e69f1817561dad44ea36",
      },
      {
        weight: 900,
        source: "ee2d90e2a8b1155feb250563fc718e19de211756576108019bbb8d7d3b86c62c",
        derived: "4992706e9cabce7c65cf32d37aa4bc71b0f3f1113d4f13fa98ffd0d7008450bd",
      },
    ] as const;

    for (const { weight, source, derived } of expected) {
      const sourceFont = readFileSync(
        path.join(WEB_ROOT, `public/fonts/archivo/archivo-latin-${weight}-normal.woff`),
      );
      const derivedPath = `public/fonts/archivo-og-tabular/archivo-latin-${weight}-og-tabular.woff`;
      const derivedFont = readFileSync(path.join(WEB_ROOT, derivedPath));
      expect(createHash("sha256").update(sourceFont).digest("hex")).toBe(source);
      expect(createHash("sha256").update(derivedFont).digest("hex")).toBe(derived);
      expect(route).toContain(`/${derivedPath.replace(/^public\//u, "")}`);
    }

    expect(runOg).toContain('fontVariantNumeric: "tabular-nums"');
    expect(shareScreen).toContain("font-variant-numeric:tabular-nums");
    expect(shareScreen).toContain('font-feature-settings:"tnum" 1');
    expect(staticShare).toContain("font-variant-numeric:tabular-nums");
    expect(staticShare).toContain('font-feature-settings:"tnum" 1');
  });

  it("keeps the deterministic Archivo default OG build-owned without changing protected art", () => {
    const generator = readFileSync(
      path.join(WEB_ROOT, "scripts/generate-marketing-assets.mjs"),
      "utf8",
    );
    const banner = readFileSync(path.join(WEB_ROOT, "public/brand/marketing/banner.png"));
    const square = readFileSync(path.join(WEB_ROOT, "public/brand/marketing/og-square.png"));
    const trackedDefaultOg = spawnSync(
      "git",
      ["ls-files", "--error-unmatch", "apps/web/public/brand/marketing/og-default.png"],
      { cwd: path.join(WEB_ROOT, "../.."), encoding: "utf8" },
    );

    expect(generator).toContain("archivo-latin-800-normal.woff");
    expect(generator).toContain("new ImageResponse(");
    expect(generator).toContain('fontFamily: "Archivo"');
    expect(generator).toContain("data: toArrayBuffer(archivoFont)");
    expect(generator).not.toContain("space-" + "grotesk");
    expect(generator).toContain("writeFileSync(defaultOgPath, best.buffer)");
    expect(generator).not.toContain(
      "for (const path of [bannerPath, defaultOgPath, squareOgPath])",
    );
    expect(trackedDefaultOg.status, trackedDefaultOg.stdout || trackedDefaultOg.stderr).not.toBe(0);
    expect(createHash("sha256").update(banner).digest("hex")).toBe(
      "809a8dfe09b8396fc65083fee5981a128e6407cfd66513988d1f0df678936331",
    );
    expect(createHash("sha256").update(square).digest("hex")).toBe(
      "17b4d9f12d3d7dbe4ad275cd2c0a6d109ea8386b3f9117100e5c4352dfb44282",
    );
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
  const pattern = /\b(?:letter-spacing|letterSpacing)\s*(?::|=)\s*(?:(["'])(.*?)\1|([^;,\n}]+))/giu;
  const allowedTokens = new Set([
    "var(--tracking-body)",
    "var(--tracking-button)",
    "var(--tracking-display)",
    "var(--tracking-heading)",
    "var(--tracking-micro)",
  ]);
  for (const match of source.matchAll(pattern)) {
    const raw = (match[2] ?? match[3] ?? "").trim();
    const canonical = raw.replace(/\s*!important\s*$/iu, "").trim();
    const direct = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(em)?$/iu.exec(canonical);
    const numeric = direct ? Number(direct[1]) : Number.NaN;
    const value = allowedTokens.has(canonical)
      ? 0
      : direct?.[2]?.toLowerCase() === "em"
        ? numeric
        : direct && numeric === 0
          ? 0
          : Number.POSITIVE_INFINITY;
    declarations.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      raw,
      value,
    });
  }
  return declarations;
}

function uppercaseRoleViolations(file: string, source: string): readonly RoleViolation[] {
  const allowed = new Set([
    "var(--font-weight-display)/var(--tracking-display)",
    "var(--font-weight-heading)/var(--tracking-heading)",
    "var(--font-weight-medium)/var(--tracking-micro)",
    "var(--font-weight-button)/var(--tracking-button)",
    "900/-0.035em",
    "800/-0.02em",
    "500/0.1em",
    "800/0.02em",
  ]);
  const violations: RoleViolation[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*text-transform:\s*uppercase[^{}]*)\}/gsu)) {
    const selector = match[1]!.trim().replace(/\s+/gu, " ");
    const body = match[2]!;
    const weights = [...body.matchAll(/font-weight:\s*([^;]+);/gu)];
    const trackingValues = [...body.matchAll(/letter-spacing:\s*([^;]+);/gu)];
    const weight = weights.at(-1)?.[1]?.trim() ?? null;
    const tracking = trackingValues.at(-1)?.[1]?.trim() ?? null;
    if (weight !== null && tracking !== null && allowed.has(`${weight}/${tracking}`)) continue;
    violations.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      selector,
      weight,
      tracking,
    });
  }
  return violations;
}

function uppercaseOverrideViolations(file: string, source: string): readonly RoleViolation[] {
  const uppercaseClasses = new Set<string>();
  for (const match of source.matchAll(/([^{}]+)\{[^{}]*text-transform:\s*uppercase[^{}]*\}/gsu)) {
    for (const selector of match[1]!.split(",")) {
      const target =
        selector
          .trim()
          .split(/[\s>+~]+/u)
          .at(-1) ?? "";
      for (const classMatch of target.matchAll(/\.([A-Za-z0-9_-]+)/gu)) {
        uppercaseClasses.add(classMatch[1]!);
      }
    }
  }
  const allowedWeights = new Set([
    "var(--font-weight-display)",
    "var(--font-weight-heading)",
    "var(--font-weight-medium)",
    "var(--font-weight-button)",
    "900",
    "800",
    "500",
  ]);
  const allowedTracking = new Set([
    "var(--tracking-display)",
    "var(--tracking-heading)",
    "var(--tracking-micro)",
    "var(--tracking-button)",
    "-0.035em",
    "-0.02em",
    "0.1em",
    "0.02em",
  ]);
  const violations: RoleViolation[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/gsu)) {
    const selector = match[1]!.trim().replace(/\s+/gu, " ");
    const selectorClasses = selector.split(",").flatMap((part) => {
      const target =
        part
          .trim()
          .split(/[\s>+~]+/u)
          .at(-1) ?? "";
      return [...target.matchAll(/\.([A-Za-z0-9_-]+)/gu)].map((classMatch) => classMatch[1]!);
    });
    if (!selectorClasses.some((className) => uppercaseClasses.has(className))) continue;
    const body = match[2]!;
    const weight = [...body.matchAll(/font-weight:\s*([^;]+);/gu)].at(-1)?.[1]?.trim() ?? null;
    const tracking = [...body.matchAll(/letter-spacing:\s*([^;]+);/gu)].at(-1)?.[1]?.trim() ?? null;
    if (
      (weight === null || allowedWeights.has(weight)) &&
      (tracking === null || allowedTracking.has(tracking))
    ) {
      continue;
    }
    violations.push({
      file,
      line: source.slice(0, match.index).split("\n").length,
      selector,
      weight,
      tracking,
    });
  }
  return violations;
}

function uppercaseRoleInventory(
  sources: readonly { file: string; source: string }[],
): readonly string[] {
  return sources
    .flatMap(({ file, source }) => {
      const uppercaseClasses = new Set<string>();
      const uppercaseTags = new Set<string>();
      for (const match of source.matchAll(
        /([^{}]+)\{[^{}]*text-transform:\s*uppercase[^{}]*\}/gsu,
      )) {
        for (const selector of match[1]!.split(",")) {
          const target =
            selector
              .trim()
              .split(/[\s>+~]+/u)
              .at(-1) ?? "";
          for (const classMatch of target.matchAll(/\.([A-Za-z0-9_-]+)/gu)) {
            uppercaseClasses.add(classMatch[1]!);
          }
          const tag = /^[A-Za-z][A-Za-z0-9-]*/u.exec(target)?.[0]?.toLowerCase();
          if (tag) uppercaseTags.add(tag);
        }
      }

      return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/gsu)].flatMap((match) => {
        const selector = match[1]!.trim().replace(/\s+/gu, " ");
        const body = match[2]!;
        const relevant = selector.split(",").some((part) => {
          const target =
            part
              .trim()
              .split(/[\s>+~]+/u)
              .at(-1) ?? "";
          const classes = [...target.matchAll(/\.([A-Za-z0-9_-]+)/gu)].map(
            (classMatch) => classMatch[1]!,
          );
          const tag = /^[A-Za-z][A-Za-z0-9-]*/u.exec(target)?.[0]?.toLowerCase();
          return (
            classes.some((className) => uppercaseClasses.has(className)) ||
            (tag !== undefined && uppercaseTags.has(tag)) ||
            /text-transform:\s*uppercase/u.test(body)
          );
        });
        if (!relevant) return [];

        const weight = [...body.matchAll(/font-weight:\s*([^;]+);/gu)].at(-1)?.[1]?.trim();
        const tracking = [...body.matchAll(/letter-spacing:\s*([^;]+);/gu)].at(-1)?.[1]?.trim();
        if (weight === undefined && tracking === undefined) return [];
        const role = exactRoleName(weight, tracking);
        return [
          `${file}|${selector}|${role}|weight=${weight ?? "inherit"}|tracking=${tracking ?? "inherit"}`,
        ];
      });
    })
    .sort();
}

function exactRoleName(weight: string | undefined, tracking: string | undefined): string {
  const pair = `${weight ?? "inherit"}/${tracking ?? "inherit"}`;
  const roles = new Map([
    ["var(--font-weight-display)/var(--tracking-display)", "display"],
    ["var(--font-weight-heading)/var(--tracking-heading)", "heading"],
    ["var(--font-weight-medium)/var(--tracking-micro)", "micro"],
    ["var(--font-weight-button)/var(--tracking-button)", "button"],
    ["900/-0.035em", "display"],
    ["800/-0.02em", "heading"],
    ["500/0.1em", "micro"],
    ["800/0.02em", "button"],
  ]);
  return roles.get(pair) ?? "partial-or-invalid";
}

function roleInventoryHash(inventory: readonly string[]): string {
  return createHash("sha256").update(inventory.join("\n")).digest("hex");
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

function expectUppercaseRoleAssignments(source: string): void {
  const occurrences = [...source.matchAll(/textTransform:\s*"uppercase"/gu)];
  expect(occurrences.length).toBeGreaterThan(0);
  for (const occurrence of occurrences) {
    const index = occurrence.index;
    const blockStart = source.lastIndexOf("style={{", index);
    expect(blockStart, "uppercase seam is not inside an inline style").toBeGreaterThanOrEqual(0);
    const blockEnd = source.indexOf("}}", index);
    expect(blockEnd, "uppercase inline style is not closed").toBeGreaterThan(index);
    const body = source.slice(blockStart, blockEnd);
    const weight = /fontWeight:\s*(400|500|800|900),/u.exec(body)?.[1];
    const tracking = /letterSpacing:\s*"(-?\d+(?:\.\d+)?em)",/u.exec(body)?.[1];
    expect(weight, "uppercase seam is missing an explicit registered weight").toBeDefined();
    expect(tracking, "uppercase seam is missing explicit role tracking").toBeDefined();
    expect(
      new Set(["500/0.1em", "800/-0.02em", "900/-0.035em", "800/0.02em"]),
      `uppercase role ${weight}/${tracking}`,
    ).toContain(`${weight}/${tracking}`);
  }
}
