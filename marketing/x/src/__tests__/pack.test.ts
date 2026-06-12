import { describe, expect, it } from "vitest";

import { generateWeekPack, isoLabel, isoWeek } from "../pack/generate.ts";
import { renderWeekPackMarkdown } from "../pack/render.ts";
import { REPLY_BANK, QUOTE_BANK, DISCOVERY_SEARCHES } from "../pack/banks.ts";
import { renderReplyBank, renderQuoteBank, xLen } from "../pack/render-banks.ts";
import { checkLexicon } from "../lexicon.ts";
import { isLiveFeature } from "../features.ts";
import { X_MAX_POST_LEN } from "../config.ts";
import { effectiveLength } from "../compose/composer.ts";
import { loadMarketingGameData } from "../engine/game-data.ts";

const gd = loadMarketingGameData();
const REF = new Date("2026-06-15T12:00:00Z"); // a Monday

describe("ISO week", () => {
  it("labels a known week", () => {
    expect(isoLabel(REF)).toMatch(/^2026-W\d{2}$/);
    expect(isoWeek(REF).year).toBe(2026);
  });
});

describe("weekly pack generator", () => {
  const pack = generateWeekPack(REF, gd);

  it("produces ~6 posts/day across 7 days, all clean/true/in-length", () => {
    expect(pack.days.length).toBe(7);
    let count = 0;
    for (const day of pack.days) {
      expect(day.length).toBeGreaterThanOrEqual(5);
      for (const p of day) {
        count += 1;
        expect(checkLexicon(p.text)).toEqual([]);
        expect(effectiveLength(p.text, p.deep_link)).toBeLessThanOrEqual(X_MAX_POST_LEN);
        expect(p.char_count).toBeLessThanOrEqual(X_MAX_POST_LEN);
      }
    }
    expect(count).toBeGreaterThanOrEqual(35);
  });

  it("dedupes — no identical post text appears twice in the pack", () => {
    const texts = [...pack.days.flat(), ...pack.spotlights].map((p) => p.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("is deterministic for the same ISO week", () => {
    const a = renderWeekPackMarkdown(generateWeekPack(REF, gd));
    const b = renderWeekPackMarkdown(generateWeekPack(new Date("2026-06-17T08:00:00Z"), gd)); // same week
    expect(a).toBe(b);
  });

  it("renders a markdown file with day sections + char counts", () => {
    const md = renderWeekPackMarkdown(pack);
    expect(md).toContain(`week ${pack.iso_label}`);
    expect(md).toContain("## Monday");
    expect(md).toContain("/280 chars");
    expect(md).toContain("Result spotlights");
  });

  it("any result-spotlight in the pack carries a real record (never invented)", () => {
    for (const s of pack.spotlights) {
      expect(checkLexicon(s.text)).toEqual([]);
      expect(s.text).toMatch(/\d+-\d+/);
    }
  });
});

describe("reply + quote banks", () => {
  const allVariants = [...REPLY_BANK, ...QUOTE_BANK].flatMap((s) => s.variants);

  it("every bank variant is lexicon-clean, ≤280, and references only live features", () => {
    for (const v of allVariants) {
      expect(checkLexicon(v.text), v.text).toEqual([]);
      expect(xLen(v.text), v.text).toBeLessThanOrEqual(X_MAX_POST_LEN);
      for (const id of v.referenced_feature_ids ?? []) expect(isLiveFeature(id)).toBe(true);
    }
  });

  it("reply bank covers all required scenarios with the required variant counts", () => {
    const byId = Object.fromEntries(REPLY_BANK.map((s) => [s.id, s.variants.length]));
    expect(byId.shared_run).toBe(3);
    expect(byId.question).toBe(3);
    expect(byId.praise).toBe(2);
    expect(byId.how_different).toBe(3);
    expect(byId.bug_report).toBe(2);
  });

  it("the how-different replies never disparage another game", () => {
    const disparage = /\b(worse|trash|garbage|sucks|terrible|beats|better than|inferior)\b/i;
    const scn = REPLY_BANK.find((s) => s.id === "how_different")!;
    for (const v of scn.variants) expect(disparage.test(v.text)).toBe(false);
  });

  it("discovery search links are valid x.com search URLs", () => {
    expect(DISCOVERY_SEARCHES.length).toBeGreaterThanOrEqual(4);
    for (const s of DISCOVERY_SEARCHES) expect(s.url).toMatch(/^https:\/\/x\.com\/search\?q=/);
  });

  it("rendered banks contain their sections", () => {
    expect(renderReplyBank()).toContain("reply bank");
    const q = renderQuoteBank();
    expect(q).toContain("quote-post bank");
    expect(q).toContain("Discovery");
  });
});
