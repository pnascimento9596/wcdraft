// Tests for the social web-intent helpers added in ws-results/history-share.
//
// The honest-state contract: `buildShareIntentUrls` MUST consume only the
// tokenized share URL. The share screen never calls into
// these helpers with a bare `run-v1-*` id; the screen disables affordances
// when tokenization fails so this module never sees a non-reproducible URL.
//
// These tests pin the URL shape so a future copy/encoding tweak can't
// silently produce a malformed query.

import { describe, expect, it } from "vitest";

import {
  buildShareCaption,
  buildShareIntentText,
  buildShareIntentUrls,
  SHARE_TAGLINE,
  type ShareView,
} from "../share-adapters";

function makeView(overrides: Partial<ShareView> = {}): ShareView {
  return {
    team_name: "Auriverde XI",
    headline: "CHAMPIONS",
    display_record: "8-0",
    is_champion: true,
    is_perfect_eight_zero: true,
    goals_for: 22,
    goals_against: 3,
    formation_name: "4-2-3-1",
    manager: { name: "Tite", nation_code: "BRA" },
    stars: [
      { name: "Pelé", nation_code: "BRA", overall: 95 },
      { name: "Maradona", nation_code: "ARG", overall: 94 },
      { name: "Zidane", nation_code: "FRA", overall: 93 },
    ],
    top_scorer: {
      player_id: "p-pele",
      name: "Pelé",
      goals: 9,
      nation_id: null,
      nation_code: null,
      nation_name: null,
    },
    seed: "wcdraft:run:v1:run-v1-k:4-2-3-1",
    reached_round: "FINAL",
    matches_played: 8,
    shootout_wins: 0,
    ...overrides,
  };
}

const TOKEN_URL = "https://wcdraft.app/play/share?run=t2.eyJ2IjoyLCJ0Ijoid2NkcmFmdCJ9";

describe("buildShareCaption", () => {
  it("includes the team record + the standard wcdraft tagline", () => {
    const view = makeView();
    const caption = buildShareCaption(view, TOKEN_URL);
    expect(caption).toContain("Auriverde XI went 8-0 on wcdraft.");
    expect(caption).toContain(SHARE_TAGLINE);
    expect(SHARE_TAGLINE).toBe("Built my all-time XI on wcdraft");
  });

  it("appends the share URL when one is provided", () => {
    const caption = buildShareCaption(makeView(), TOKEN_URL);
    expect(caption.endsWith(TOKEN_URL)).toBe(true);
  });

  it("omits the URL line when tokenization failed (null)", () => {
    const caption = buildShareCaption(makeView(), null);
    expect(caption).not.toMatch(/https?:\/\//);
    // Caption still ends with the tagline — no trailing blank line.
    expect(caption.trim().endsWith(SHARE_TAGLINE)).toBe(true);
  });
});

describe("buildShareIntentText", () => {
  it("never includes the URL (caller passes url= separately)", () => {
    const text = buildShareIntentText(makeView());
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).toContain("Auriverde XI went 8-0 on wcdraft.");
    expect(text).toContain(SHARE_TAGLINE);
  });
});

describe("buildShareIntentUrls", () => {
  const view = makeView();
  const intentText = buildShareIntentText(view);
  const caption = buildShareCaption(view, TOKEN_URL);
  const urls = buildShareIntentUrls({ url: TOKEN_URL, text: intentText, caption });

  it("targets the correct host for each platform", () => {
    expect(urls.twitter.startsWith("https://twitter.com/intent/tweet?")).toBe(true);
    expect(urls.whatsapp.startsWith("https://wa.me/?")).toBe(true);
    expect(urls.facebook.startsWith("https://www.facebook.com/sharer/sharer.php?")).toBe(true);
    expect(urls.reddit.startsWith("https://www.reddit.com/submit?")).toBe(true);
  });

  it("twitter intent carries `text` + `url` as separate params", () => {
    const parsed = new URL(urls.twitter);
    expect(parsed.searchParams.get("text")).toBe(intentText);
    expect(parsed.searchParams.get("url")).toBe(TOKEN_URL);
  });

  it("whatsapp intent prefills the full caption (single combined field)", () => {
    const parsed = new URL(urls.whatsapp);
    expect(parsed.searchParams.get("text")).toBe(caption);
  });

  it("facebook intent carries `u=<url>`", () => {
    const parsed = new URL(urls.facebook);
    expect(parsed.searchParams.get("u")).toBe(TOKEN_URL);
  });

  it("reddit intent carries `url` + `title` (no URL in title)", () => {
    const parsed = new URL(urls.reddit);
    expect(parsed.searchParams.get("url")).toBe(TOKEN_URL);
    const title = parsed.searchParams.get("title");
    expect(title).toBe(intentText);
    expect(title).not.toMatch(/https?:\/\//);
  });

  it("only references the tokenized URL — never a bare run-v1-* id", () => {
    // The screen guards this at the call site, but we double-pin it here so
    // any accidental refactor that lets a `run-v1-*` URL through is caught
    // in the helper layer too.
    for (const intent of Object.values(urls)) {
      expect(intent).not.toMatch(/run-v1-/);
      expect(decodeURIComponent(intent)).toMatch(/\?run=t\d+\./);
    }
  });
});
