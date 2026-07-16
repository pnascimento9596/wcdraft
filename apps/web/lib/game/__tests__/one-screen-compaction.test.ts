import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LegalDisclosure } from "@/components/legal-disclosure";

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const homePage = source("../../../app/page.tsx");
const globals = source("../../../app/globals.css");
const modeSelect = source("../../../components/game/mode-select.tsx");
const legalDisclosure = source("../../../components/legal-disclosure.tsx");
const homeHeroStyles = source("../../../components/home/home-hero.module.css");
const disclosureStyles = source("../../../components/one-screen-disclosure.module.css");
const progressBand = source("../../../components/game/local-progress-band.tsx");
const gameFacade = source("../../../components/game/game.module.css");
const gameStyles = source("../../../components/game/game-styles/shared.module.css");
const formationSetup = source("../../../components/game/draft-screen/setup.tsx");
const draftShellStyles = source("../../../components/game/game-styles/draft-shell.module.css");
const state = source("../../../../../STATE.md");
const responsiveContract = source("./responsive-layout-contract.test.ts");

describe("one-screen information contract", () => {
  it("uses functional body-copy descriptors without restoring descriptor boxes", () => {
    for (const authored of [modeSelect, gameFacade, gameStyles]) {
      expect(authored).not.toContain("modePreview");
      expect(authored).not.toContain("modeIndex");
    }
    expect(modeSelect).not.toMatch(/\bpreview:/u);
    expect(modeSelect).not.toMatch(/\bindex:/u);
    expect(responsiveContract).not.toContain("compact mode pill track");
    for (const descriptor of [
      "Everyone gets the same board today. One try.",
      "Spin, then pick one of three players.",
      "Spin a nation, pick anyone from its squad.",
      "Pick from three with ratings hidden until the end.",
      "Full squad to pick from, ratings hidden until the end.",
    ]) {
      expect(modeSelect).toContain(`desc: "${descriptor}"`);
    }
    expect(gameStyles).toMatch(
      /\.modeCard:not\(\.modeCardFeatured\) \.modeDesc\s*\{[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.25;/su,
    );
    expect(gameStyles).toMatch(
      /\.modeDesc\s*\{[^}]*font-weight:\s*var\(--font-weight-regular\) !important;[^}]*letter-spacing:\s*0 !important;[^}]*text-transform:\s*none !important;/su,
    );
    expect(gameStyles).toMatch(
      /\.modeCard:not\(\.modeCardFeatured\) \.modeCardBottom\s*\{[^}]*display:\s*flex;/su,
    );
  });

  it("keeps progress and the featured Daily header/action to one visual row", () => {
    expect(progressBand).toContain("localProgressRow");
    expect(progressBand).not.toContain("localProgressPrimary");
    expect(progressBand).not.toContain("localProgressBest");
    expect(progressBand).toContain("Streak {streakLabel}");
    expect(progressBand).toContain("Today {formatBestScore(summary.todayBest)}");
    expect(progressBand).toContain("All-time {formatBestScore(summary.allTimeBest)}");

    const featuredRule =
      /\.modeCardFeatured \{(?<body>[^}]*)\}/u.exec(gameStyles)?.groups?.body ?? "";
    expect(featuredRule).toContain("grid-column: 1 / -1");
    expect(featuredRule).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(featuredRule).toContain("min-height: 72px");
    expect(gameStyles).toMatch(/\.modeCardFeatured \.modeFeatures \{\s*display: none;/u);
    expect(gameStyles).toMatch(/\.modeCardFeatured \.modeDesc\s*\{[^}]*grid-area:\s*desc;/su);
  });

  it("keeps the demo, stat strip, and three actions after cutting redundant hero copy", () => {
    expect(homePage).toContain("<HeroSpinDemo />");
    expect(homePage).toContain('href="/play/daily"');
    expect(homePage).toContain('href="/play"');
    expect(homePage).toContain('href="/how-to-play"');
    expect(homePage).toContain('17 <span className="accent">picks</span>');
    expect(homePage).toContain("match run");
    expect(homePage).toContain("a perfect run");
    expect(homePage).toContain(
      "Spin a random national team and a tournament year. Pick one footballer per spin.",
    );
    expect(homePage).not.toContain("hero__daily");
    expect(homePage).not.toContain("hero__live");
  });

  it("replaces the hidden full footer with exact readable disclosure lines", () => {
    expect(globals).toMatch(
      /body:has\(\.hero\) \.site-footer,\s*body:has\(\.game-page--mode\) \.site-footer \{\s*display: none;/u,
    );
    for (const page of [homePage, source("../../../app/play/page.tsx")]) {
      expect(page).toContain("<LegalDisclosure");
      expect(page).toContain("one-screen-disclosure");
    }
    expect(legalDisclosure).toContain("The Fjelstul World Cup Database © 2023 Joshua C. Fjelstul");
    expect(legalDisclosure).toContain("licensed CC-BY-SA");
    expect(legalDisclosure).toContain("github.com/jfjelstul/worldcup");
    expect(legalDisclosure).toContain("), modified.");
    expect(legalDisclosure).toContain(
      "wcdraft is an independent project and is not affiliated with, endorsed by, or associated",
    );
    expect(disclosureStyles).toMatch(/\.notice\s*\{[^}]*font-size:\s*0\.75rem;/su);
    expect(disclosureStyles).toMatch(/\.notice\s*\{[^}]*color:\s*var\(--ink-soft\);/su);
    expect(disclosureStyles).toMatch(/\.notice a\s*\{[^}]*color:\s*var\(--accent-text\);/su);
    expect(homePage).toContain("heroStyles.disclosure");
  });

  it("locks the complete legal copy and lets the route shell own bottom anchoring", () => {
    const markup = renderToStaticMarkup(LegalDisclosure({ className: "probe" }));
    const lines = [...markup.matchAll(/<p[^>]*>(?<line>[\s\S]*?)<\/p>/gu)].map((match) =>
      (match.groups?.line ?? "")
        .replace(/<[^>]+>/gu, "")
        .replace(/\s+/gu, " ")
        .trim(),
    );

    expect(lines).toEqual([
      "Data: The Fjelstul World Cup Database © 2023 Joshua C. Fjelstul, Ph.D., licensed CC-BY-SA 4.0 (github.com/jfjelstul/worldcup), modified.",
      "wcdraft is an independent project and is not affiliated with, endorsed by, or associated with any official competition or governing body.",
    ]);
    expect(disclosureStyles).toContain("margin-inline: auto;");
    expect(disclosureStyles).not.toMatch(/margin:\s*0 auto/u);
    expect(disclosureStyles).not.toMatch(/position:\s*fixed/u);
    expect(homeHeroStyles).toMatch(/\.disclosure\s*\{[^}]*margin-block-start:\s*auto;/su);
  });

  it("keeps formation comparison compact without weakening player-identity encoding", () => {
    expect(formationSetup).not.toContain("DraftAppBar");
    for (const descriptor of [
      '"4-3-3": "Wide attack"',
      '"4-2-3-1": "Compact block"',
      '"4-4-2": "Two strikers"',
      '"4-1-4-1": "Screened defence"',
      '"3-5-2": "Midfield control"',
      '"3-4-3": "Front three"',
      '"3-4-2-1": "Twin creators"',
      '"5-3-2": "Deep defence"',
    ]) {
      expect(formationSetup).toContain(descriptor);
    }
    expect(formationSetup).toContain('.filter((slot) => slot.position_line !== "GK")');
    expect(formationSetup).toContain("miniGoalBox");
    expect(draftShellStyles).toMatch(
      /\.draftShell\[data-formation-select\] \.formationGrid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/su,
    );
    expect(draftShellStyles).toMatch(
      /\.draftShell\[data-formation-select\] \.formationCard\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/su,
    );
    expect(draftShellStyles).toMatch(
      /\.draftShell\[data-formation-select\] \.miniDot\s*\{[^}]*border-radius:\s*50%;[^}]*background:\s*var\(--ink\);/su,
    );
    expect(draftShellStyles).toMatch(
      /\.draftShell\[data-formation-select\] \.miniPitchSelected \.miniDot\s*\{[^}]*background:\s*var\(--accent\);/su,
    );
    expect(draftShellStyles).toMatch(
      /\.formationCardDescriptor\s*\{[^}]*font-weight:\s*var\(--font-weight-medium\) !important;[^}]*letter-spacing:\s*var\(--tracking-micro\) !important;[^}]*text-transform:\s*none !important;/su,
    );
    expect(draftShellStyles).toMatch(
      /\.formationCardSelected \.formationCardName,[^{]*\.formationCardPending \.formationCardName\s*\{[^}]*color:\s*var\(--accent-text\);/su,
    );
    for (const selector of [
      "formationSub",
      "setupAxisLabel",
      "setupSegBtn",
      "setupAxisNote",
      "formationCardDescriptor",
      "formationCardCheck",
    ]) {
      expect(draftShellStyles).toMatch(
        new RegExp(`\\.${selector}\\s*\\{[^}]*font-size:\\s*(?:1[2-9]|[2-9]\\d)px;`, "su"),
      );
    }
    expect(state).toContain(
      "Formation-selector mini-pitches use uniform player markers (owner decision, 2026-07-16). Position=SHAPE remains the platform encoding on all player-identity surfaces: draft cards, choose-from-3, roster lists, team sheet, squad review, results.",
    );
  });

  it("renders reveal content immediately for reduced-motion users", () => {
    expect(globals).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.reveal > \* \{\s*opacity: 1;\s*transform: none;\s*animation: none;/u,
    );
  });
});
