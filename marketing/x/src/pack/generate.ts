// Weekly content-pack generator (zero-API operating model).
//
// The owner does not run the X API; instead this produces a week of ready-to-
// paste posts that the owner schedules through X's native composer. It reuses
// the SAME composer as the (dormant) live poster, so every post in a pack is
// already gated by the banned-lexicon + feature-truth + length checks — a pack
// can only contain clean, true, in-length posts. Output is deterministic for a
// given ISO week, so a pack is reproducible and reviewable.

import {
  effectiveLength,
  composeDailyChallenge,
  composeFactoid,
  composeFeaturePitch,
  type Post,
} from "../compose/composer.ts";
import { loadMarketingGameData, type MarketingGameData } from "../engine/game-data.ts";
import { loadQueue, resolveQueueItem } from "../queue.ts";
import type { PostFamily } from "../compose/templates.ts";

/** ~6 posts/day across the families that need no external token. */
const DAILY_ROTATION: PostFamily[] = [
  "feature_pitch",
  "daily_challenge",
  "factoid",
  "feature_pitch",
  "daily_challenge",
  "factoid",
];

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export interface PackPost {
  family: PostFamily;
  text: string;
  /** Effective X length (a wrapped t.co link counts as 23). */
  char_count: number;
  deep_link: string;
  /** Optional human note (e.g. "sample run — swap in your own"). */
  note?: string;
}

export interface WeekPack {
  iso_label: string; // e.g. "2026-W24"
  year: number;
  week: number;
  /** 7 day-buckets, each a list of posts. */
  days: PackPost[][];
  /** Result-spotlight posts from queued real share tokens (may be empty). */
  spotlights: PackPost[];
  total: number;
}

/** ISO-8601 week number (Mon-start). */
export function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return { year: d.getUTCFullYear(), week };
}

export function isoLabel(date: Date): string {
  const { year, week } = isoWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function toPackPost(p: Post, note?: string): PackPost {
  return {
    family: p.family,
    text: p.text,
    char_count: effectiveLength(p.text, p.deep_link),
    deep_link: p.deep_link,
    note,
  };
}

/**
 * Generate a full week pack. Deterministic for `(iso week, dataset)`. Posts are
 * deduped across the whole pack by content hash (re-seeded on collision so the
 * same line never appears twice).
 */
export function generateWeekPack(
  refDate: Date,
  gd: MarketingGameData = loadMarketingGameData(),
): WeekPack {
  const label = isoLabel(refDate);
  const { year, week } = isoWeek(refDate);
  const seen = new Set<string>();
  const days: PackPost[][] = [];

  for (let d = 0; d < 7; d += 1) {
    const dayPosts: PackPost[] = [];
    for (let s = 0; s < DAILY_ROTATION.length; s += 1) {
      const family = DAILY_ROTATION[s]!;
      let post: Post | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const seed = `pack:${label}:d${d}:s${s}${attempt ? `:x${attempt}` : ""}`;
        const candidate =
          family === "daily_challenge"
            ? composeDailyChallenge(seed, gd)
            : family === "factoid"
              ? composeFactoid(seed, gd)
              : composeFeaturePitch(seed);
        if (!seen.has(candidate.content_hash)) {
          post = candidate;
          break;
        }
      }
      if (post) {
        seen.add(post.content_hash);
        dayPosts.push(toPackPost(post));
      }
    }
    days.push(dayPosts);
  }

  // Result spotlights from any non-posted result_spotlight queue item that
  // resolves to a real run today. (The composer/queue still gate truth.)
  const spotlights: PackPost[] = [];
  const queue = loadQueue();
  for (const item of queue.filter(
    (i) => i.family === "result_spotlight" && i.status !== "posted",
  )) {
    const res = resolveQueueItem(item, gd);
    if (res.ok && !seen.has(res.post.content_hash)) {
      seen.add(res.post.content_hash);
      const note =
        item.status === "paused" || item.id.includes("sample")
          ? "SAMPLE run — replace with your own strong run's share link before posting"
          : undefined;
      spotlights.push(toPackPost(res.post, note));
    }
  }

  const total = days.reduce((n, dp) => n + dp.length, 0) + spotlights.length;
  return { iso_label: label, year, week, days, spotlights, total };
}
