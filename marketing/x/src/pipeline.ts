// Phase A pipeline — one poster invocation.
//
// The GitHub Actions cron fires several times a day (jittered). Each fire runs
// this once: it picks the slot's content (a due queue item, else a seeded
// generated post), enforces the kill switch + per-day cap + idempotency, and
// either writes a dry-run artifact (default) or publishes one live post.
//
// EVERYTHING ships dry-run first. Live posting requires MARKETING_LIVE=true AND
// a working poster; absent either, the pipeline stays in dry-run.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS_DIR, LEDGER_PATH } from "./paths.ts";
import {
  appendLedger,
  countForDay,
  hasPosted,
  readLedger,
  utcDay,
  type LedgerEntry,
  type PostMode,
} from "./ledger.ts";
import { dailyPostCap, isLive, isPaused } from "./config.ts";
import {
  composeDailyChallenge,
  composeFactoid,
  composeFeaturePitch,
  type Post,
} from "./compose/composer.ts";
import { dueItems, loadQueue, resolveQueueItem, type QueueItem } from "./queue.ts";
import { loadMarketingGameData, type MarketingGameData } from "./engine/game-data.ts";
import type { PostFamily } from "./compose/templates.ts";

/** Minimal poster seam — the X client implements this; tests inject a fake. */
export interface Poster {
  post(text: string): Promise<{ id: string }>;
}

/** Generated-content rotation (no external token needed). Length = default cap. */
const ROTATION: PostFamily[] = [
  "daily_challenge",
  "feature_pitch",
  "factoid",
  "feature_pitch",
  "daily_challenge",
  "factoid",
];

export function plannedFamily(slot: number): PostFamily {
  return ROTATION[slot % ROTATION.length]!;
}

export interface PosterOptions {
  now?: Date;
  env?: NodeJS.ProcessEnv;
  gd?: MarketingGameData;
  /** Live poster. Required to actually publish; absent → forced dry-run. */
  poster?: Poster;
  /** Override the active ledger path (tests). */
  ledgerPath?: string;
  /** Override the dry-run artifact dir (tests). */
  artifactsDir?: string;
}

export type PosterAction =
  | { action: "paused" }
  | { action: "cap_reached"; count: number; cap: number }
  | { action: "nothing_to_post"; detail: string }
  | { action: "dry_run"; post: Post; source: "queue" | "generated" }
  | { action: "posted"; post: Post; x_post_id: string; source: "queue" | "generated" };

function dryRunLedgerPath(dir: string): string {
  return join(dir, "dry-run.ledger.jsonl");
}

/** Pick the next not-yet-posted candidate: a due queue item first, else generated. */
function selectCandidate(
  day: string,
  slot: number,
  now: Date,
  gd: MarketingGameData,
  activeLedger: string,
): { post: Post; source: "queue" | "generated" } | { skip: string } {
  // 1. Due queue items (curated), oldest id first, skipping already-posted ones.
  const queue: QueueItem[] = loadQueue();
  for (const item of dueItems(queue, now)) {
    const res = resolveQueueItem(item, gd);
    if (!res.ok) continue; // honest skip (e.g. skewed token) — try the next item
    if (hasPosted(res.post.content_hash, activeLedger)) continue;
    return { post: res.post, source: "queue" };
  }
  // 2. Generated content for the slot's family, with a few seed bumps to dodge
  //    an already-posted hash (idempotent, never double-post).
  const family = plannedFamily(slot);
  for (let i = 0; i < 6; i += 1) {
    const seed = i === 0 ? `${day}:slot${slot}:${family}` : `${day}:slot${slot}:${family}:b${i}`;
    let post: Post;
    if (family === "daily_challenge") post = composeDailyChallenge(seed, gd);
    else if (family === "factoid") post = composeFactoid(seed, gd);
    else post = composeFeaturePitch(seed);
    if (!hasPosted(post.content_hash, activeLedger)) return { post, source: "generated" };
  }
  return { skip: "all candidates already posted (idempotent no-op)" };
}

function writeDryRunArtifact(dir: string, day: string, entry: LedgerEntry): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `dry-run-${day}.jsonl`);
  const prior = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, prior + JSON.stringify(entry) + "\n", "utf8");
}

/**
 * Run one poster slot. Pure except for ledger/artifact writes and (when live)
 * the injected poster. Returns a structured action for the CLI to log.
 */
export async function runPoster(opts: PosterOptions = {}): Promise<PosterAction> {
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;
  const gd = opts.gd ?? loadMarketingGameData();

  if (isPaused(env)) return { action: "paused" };

  const live = isLive(env) && !!opts.poster;
  const mode: PostMode = live ? "live" : "dry_run";
  const artifactsDir = opts.artifactsDir ?? ARTIFACTS_DIR;
  const activeLedger = opts.ledgerPath ?? (live ? LEDGER_PATH : dryRunLedgerPath(artifactsDir));

  const day = utcDay(now);
  const cap = dailyPostCap(env);
  const count = countForDay(day, mode, activeLedger);
  if (count >= cap) return { action: "cap_reached", count, cap };

  const slot = count; // Nth post of the day.
  const sel = selectCandidate(day, slot, now, gd, activeLedger);
  if ("skip" in sel) return { action: "nothing_to_post", detail: sel.skip };

  const { post, source } = sel;
  const baseEntry: Omit<LedgerEntry, "x_post_id"> = {
    at: now.toISOString(),
    day,
    mode,
    family: post.family,
    post_id: post.id,
    content_hash: post.content_hash,
    deep_link: post.deep_link,
    text: post.text,
    referenced_feature_ids: post.referenced_feature_ids,
  };

  if (!live) {
    const entry: LedgerEntry = { ...baseEntry, x_post_id: null };
    appendLedger(entry, activeLedger);
    writeDryRunArtifact(artifactsDir, day, entry);
    return { action: "dry_run", post, source };
  }

  const result = await opts.poster!.post(post.text);
  const entry: LedgerEntry = { ...baseEntry, x_post_id: result.id };
  appendLedger(entry, activeLedger);
  return { action: "posted", post, x_post_id: result.id, source };
}

export { readLedger };
