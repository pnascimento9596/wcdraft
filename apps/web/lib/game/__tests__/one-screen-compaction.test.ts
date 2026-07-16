import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const homePage = source("../../../app/page.tsx");
const globals = source("../../../app/globals.css");
const modeSelect = source("../../../components/game/mode-select.tsx");
const legalDisclosure = source("../../../components/legal-disclosure.tsx");
const progressBand = source("../../../components/game/local-progress-band.tsx");
const gameFacade = source("../../../components/game/game.module.css");
const gameStyles = source("../../../components/game/game-styles/shared.module.css");
const responsiveContract = source("./responsive-layout-contract.test.ts");

describe("one-screen information contract", () => {
  it("removes descriptor boxes, ghost numerals, and their collision guard", () => {
    for (const authored of [modeSelect, gameFacade, gameStyles]) {
      expect(authored).not.toContain("modePreview");
      expect(authored).not.toContain("modeIndex");
    }
    expect(modeSelect).not.toMatch(/\bpreview:/u);
    expect(modeSelect).not.toMatch(/\bindex:/u);
    expect(responsiveContract).not.toContain("compact mode pill track");
  });

  it("keeps progress and the featured Daily card to one visual row", () => {
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
    expect(featuredRule).toContain("min-height: 52px");
    expect(gameStyles).toMatch(
      /\.modeCardFeatured \.modeDesc,\s*\.modeCardFeatured \.modeFeatures \{\s*display: none;/u,
    );
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
    const disclosureStyles = source("../../../components/one-screen-disclosure.module.css");
    expect(disclosureStyles).toMatch(/\.notice\s*\{[^}]*font-size:\s*0\.75rem;/su);
    expect(disclosureStyles).toMatch(/\.notice\s*\{[^}]*color:\s*var\(--ink-soft\);/su);
    expect(disclosureStyles).toMatch(/\.notice a\s*\{[^}]*color:\s*var\(--accent-text\);/su);
    expect(homePage).toContain("heroStyles.disclosure");
  });

  it("renders reveal content immediately for reduced-motion users", () => {
    expect(globals).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.reveal > \* \{\s*opacity: 1;\s*transform: none;\s*animation: none;/u,
    );
  });
});
