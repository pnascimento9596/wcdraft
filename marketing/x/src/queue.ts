// Committed content queue. Queue items are explicit, hand-curated posts —
// the pinned intro, a hand-authored pitch, or a result-spotlight pointed at a
// REAL replay-checked share token. The seeded generator (composer) fills the
// remaining daily slots; the queue is for content a human wants to pin down.
//
// Idempotency is the ledger's job (content_hash), NOT mutation of these files:
// the poster NEVER edits a committed queue file. To stop an item, set its
// `status` to "paused" by hand. A "posted" item simply stops re-appearing
// because its content_hash is already in the ledger.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { QUEUE_DIR } from "./paths.ts";
import { assertClean } from "./lexicon.ts";
import { assertFeatureTruth } from "./features.ts";
import { effectiveLength, type ComposeResult, type Post } from "./compose/composer.ts";
import { composeResultSpotlight } from "./compose/composer.ts";
import { X_MAX_POST_LEN } from "./config.ts";
import { loadMarketingGameData, type MarketingGameData } from "./engine/game-data.ts";

export type QueueFamily = "literal" | "result_spotlight";
export type QueueStatus = "queued" | "paused" | "posted";

export interface QueueItem {
  id: string;
  family: QueueFamily;
  status: QueueStatus;
  /** ISO-8601; null = eligible in any slot. */
  scheduled_at: string | null;
  params: {
    /** literal: the exact post text (still validated). */
    text?: string;
    /** literal: deep link contained in the text (for length accounting). */
    deep_link?: string;
    /** literal: feature ids the text asserts (must all be live). */
    referenced_feature_ids?: string[];
    /** result_spotlight: a REAL, replay-checked share token. */
    token?: string;
    /** result_spotlight: composer seed (defaults to item id). */
    seed?: string;
  };
}

export function loadQueue(dir = QUEUE_DIR): QueueItem[] {
  if (!existsSync(dir)) return [];
  const out: QueueItem[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".json")) continue;
    const item = JSON.parse(readFileSync(join(dir, f), "utf8")) as QueueItem;
    validateQueueItemShape(item, f);
    out.push(item);
  }
  return out;
}

function validateQueueItemShape(item: QueueItem, file: string): void {
  if (!item.id) throw new Error(`queue/${file}: missing id`);
  if (item.family !== "literal" && item.family !== "result_spotlight") {
    throw new Error(`queue/${file}: invalid family "${item.family}"`);
  }
  if (!["queued", "paused", "posted"].includes(item.status)) {
    throw new Error(`queue/${file}: invalid status "${item.status}"`);
  }
  if (item.scheduled_at !== null && Number.isNaN(Date.parse(item.scheduled_at))) {
    throw new Error(`queue/${file}: unparseable scheduled_at "${item.scheduled_at}"`);
  }
  if (item.family === "literal" && !item.params.text) {
    throw new Error(`queue/${file}: literal item needs params.text`);
  }
  if (item.family === "result_spotlight" && !item.params.token) {
    throw new Error(`queue/${file}: result_spotlight item needs params.token`);
  }
}

/** Items eligible right now: queued AND (no schedule OR schedule already due). */
export function dueItems(items: QueueItem[], now: Date): QueueItem[] {
  return items.filter(
    (i) =>
      i.status === "queued" &&
      (i.scheduled_at === null || Date.parse(i.scheduled_at) <= now.getTime()),
  );
}

/** Resolve a queue item into a validated Post (or an honest skip). */
export function resolveQueueItem(
  item: QueueItem,
  gd: MarketingGameData = loadMarketingGameData(),
): ComposeResult {
  if (item.family === "result_spotlight") {
    return composeResultSpotlight(item.params.seed ?? item.id, item.params.token!, gd);
  }
  // literal
  const text = item.params.text!;
  const deepLink = item.params.deep_link ?? "";
  const refs = item.params.referenced_feature_ids ?? [];
  const context = `queue:${item.id}`;
  try {
    assertClean(text, context);
    assertFeatureTruth(refs, context);
    const eff = effectiveLength(text, deepLink);
    if (eff > X_MAX_POST_LEN) {
      return {
        ok: false,
        reason: "too_long",
        detail: `${context}: ${eff} chars > ${X_MAX_POST_LEN}`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: "invalid",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  const content_hash = createHash("sha256").update(text.trim()).digest("hex");
  const post: Post = {
    id: `literal-${content_hash.slice(0, 12)}`,
    family: "feature_pitch",
    text,
    referenced_feature_ids: refs,
    deep_link: deepLink,
    feature_forward: true,
    content_hash,
  };
  return { ok: true, post };
}
