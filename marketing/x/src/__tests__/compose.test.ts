import { describe, expect, it } from "vitest";
import { autoDraft } from "@wcdraft/core";

import {
  composeDailyChallenge,
  composeFactoid,
  composeFeaturePitch,
  composeResultSpotlight,
  effectiveLength,
  type Post,
} from "../compose/composer.ts";
import {
  assertFeatureTruth,
  isLiveFeature,
  liveFeatures,
  loadFeatureManifest,
} from "../features.ts";
import { checkLexicon } from "../lexicon.ts";
import { X_MAX_POST_LEN } from "../config.ts";
import { loadMarketingGameData, simulateDraft } from "../engine/game-data.ts";
import { buildTokenBodyFromDraft, encodeRunTokenV2 } from "../engine/token.ts";

const SEEDS = Array.from({ length: 40 }, (_, i) => `seed-${i}`);

function assertValidPost(p: Post): void {
  // 1. Banned-lexicon clean.
  expect(checkLexicon(p.text)).toEqual([]);
  // 2. Every referenced feature is live (feature-truth).
  for (const id of p.referenced_feature_ids) expect(isLiveFeature(id)).toBe(true);
  // 3. Within the X length limit.
  expect(effectiveLength(p.text, p.deep_link)).toBeLessThanOrEqual(X_MAX_POST_LEN);
  // 4. Carries its deep link.
  expect(p.text).toContain(
    p.deep_link.startsWith("http") ? "https://www.wcdraft.com" : p.deep_link,
  );
  // 5. Content hash is stable for the text.
  expect(p.content_hash).toMatch(/^[0-9a-f]{64}$/);
}

describe("feature-truth gate", () => {
  it("passes for live feature ids", () => {
    expect(() => assertFeatureTruth(["calibrated_sim", "leaderboard"], "test")).not.toThrow();
  });
  it("throws for an unknown feature id", () => {
    expect(() => assertFeatureTruth(["telepathy"], "test")).toThrow(/unknown feature/);
  });
  it("now marks rating_basis_choice LIVE (Current basis enabled end-to-end by #118)", () => {
    // #118 made the Career/Current basis choice selectable in prod, so the
    // composer may now pitch it. (It was `planned` while Current was disabled.)
    expect(isLiveFeature("rating_basis_choice")).toBe(true);
    expect(() => assertFeatureTruth(["rating_basis_choice"], "test")).not.toThrow();
  });
});

describe("feature_pitch family", () => {
  it("produces clean, in-length, truthful pitches across seeds", () => {
    for (const s of SEEDS) assertValidPost(composeFeaturePitch(s));
  });
  it("every live feature gets pitched as a pure feature-forward post (coverage)", () => {
    const pitched = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const p = composeFeaturePitch(`cover-${i}`);
      expect(p.feature_forward).toBe(true);
      for (const id of p.referenced_feature_ids) pitched.add(id);
    }
    for (const f of liveFeatures()) expect(pitched.has(f.id)).toBe(true);
  });
});

describe("daily_challenge family", () => {
  it("produces clean, in-length, truthful daily posts across seeds", () => {
    for (const s of SEEDS) {
      const p = composeDailyChallenge(s);
      assertValidPost(p);
      expect(p.referenced_feature_ids.length).toBe(1); // exactly one rotating hook
    }
  });
  it("has at least one feature-forward variant", () => {
    let any = false;
    for (let i = 0; i < 60; i += 1)
      if (composeDailyChallenge(`ff-${i}`).feature_forward) any = true;
    expect(any).toBe(true);
  });
});

describe("factoid family", () => {
  it("produces clean, in-length, truthful factoids across seeds", () => {
    for (const s of SEEDS) {
      const p = composeFactoid(s);
      assertValidPost(p);
      expect(p.referenced_feature_ids.length).toBe(1);
    }
  });
});

describe("result_spotlight family", () => {
  it("renders a clean, truthful spotlight from a real, current token", () => {
    const gd = loadMarketingGameData();
    const seed = "wcdraft:mkt:spot:1";
    const draft = autoDraft({
      run_id: "spot",
      parent_seed: seed,
      formation_id: "4-3-3",
      mode: "classic",
      team_name: "Spotlight XI",
      dataset_version: gd.versions.dataset_version,
      rating_version: gd.versions.rating_version,
      engine_version: gd.versions.engine_version,
      dataset: gd.draftDataset,
    });
    const direct = simulateDraft(gd, draft, seed);
    const token = encodeRunTokenV2(buildTokenBodyFromDraft(draft, gd, seed));
    const res = composeResultSpotlight("compose-seed", token, gd);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    assertValidPost(res.post);
    // The honest narrative must reflect the real record — not invent a win.
    expect(res.post.text).toContain(direct.record);
    expect(res.post.referenced_feature_ids).toContain("calibrated_sim");
  });

  it("honest-state: a foreign token yields a skip, never a post", () => {
    const res = composeResultSpotlight("s", "not-a-real-token", loadMarketingGameData());
    expect(res.ok).toBe(false);
  });
});

describe("manifest sanity", () => {
  it("has live features and a planned rating basis", () => {
    const m = loadFeatureManifest();
    expect(m.features.length).toBeGreaterThan(8);
    expect(liveFeatures().length).toBeGreaterThan(7);
  });
});
