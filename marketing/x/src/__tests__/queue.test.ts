import { describe, expect, it } from "vitest";

import { dueItems, loadQueue, resolveQueueItem } from "../queue.ts";
import { checkLexicon } from "../lexicon.ts";
import { isLiveFeature } from "../features.ts";
import { effectiveLength } from "../compose/composer.ts";
import { X_MAX_POST_LEN } from "../config.ts";
import { loadMarketingGameData } from "../engine/game-data.ts";

const gd = loadMarketingGameData();

describe("committed queue", () => {
  const items = loadQueue();

  it("loads and shape-validates every committed queue file", () => {
    expect(items.length).toBeGreaterThanOrEqual(3);
  });

  it("every literal item resolves clean, truthful, and within the length limit", () => {
    for (const item of items.filter((i) => i.family === "literal")) {
      const res = resolveQueueItem(item, gd);
      expect(res.ok, `${item.id}: ${res.ok ? "" : res.detail}`).toBe(true);
      if (!res.ok) continue;
      expect(checkLexicon(res.post.text)).toEqual([]);
      for (const id of res.post.referenced_feature_ids) expect(isLiveFeature(id)).toBe(true);
      expect(effectiveLength(res.post.text, res.post.deep_link)).toBeLessThanOrEqual(
        X_MAX_POST_LEN,
      );
    }
  });

  it("the result_spotlight sample is PAUSED (not auto-eligible)", () => {
    const spotlight = items.find((i) => i.family === "result_spotlight");
    expect(spotlight?.status).toBe("paused");
    // Paused items are never returned as due.
    expect(
      dueItems(items, new Date("2030-01-01T00:00:00Z")).some((i) => i.id === spotlight?.id),
    ).toBe(false);
  });

  it("the committed sample token still replays to a real run today (regenerate on version bump)", () => {
    const spotlight = items.find((i) => i.family === "result_spotlight");
    expect(spotlight).toBeTruthy();
    if (!spotlight) return;
    const res = resolveQueueItem(spotlight, gd);
    // Either it resolves to a real post (versions agree) OR it honestly skips
    // with version_skew after a bump — both are acceptable; a fabricated result
    // is not. If this flips to skew, regenerate the token.
    if (res.ok) {
      expect(res.post.text).toMatch(/\d+-\d+/); // contains the real record
    } else {
      expect(["version_skew", "newer_version"]).toContain(res.reason);
    }
  });
});
