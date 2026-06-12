// Engagement ledger — idempotency + hard rate limits for Phases B/C, COMMITTED
// like the post ledger. The caps live in code (config.ts) and are enforced
// HERE by counting prior entries, so neither a config edit nor a double run can
// exceed them.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { ENGAGEMENT_LEDGER_PATH } from "../paths.ts";
import {
  INBOUND_REPLIES_PER_USER_PER_DAY,
  OUTBOUND_FOLLOWS_PER_DAY,
  OUTBOUND_QUOTE_POSTS_PER_DAY,
} from "../config.ts";

export type EngagementKind = "inbound_reply" | "quote_post" | "follow" | "abuse_logged";

export interface EngagementEntry {
  at: string;
  day: string;
  kind: EngagementKind;
  mode: "dry_run" | "live";
  author_id: string;
  conversation_id: string | null;
  target_tweet_id: string;
  x_post_id: string | null;
}

export function readEngagementLedger(path = ENGAGEMENT_LEDGER_PATH): EngagementEntry[] {
  if (!existsSync(path)) return [];
  const out: EngagementEntry[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as EngagementEntry);
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}

export function appendEngagement(entry: EngagementEntry, path = ENGAGEMENT_LEDGER_PATH): void {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

// ─── Limit checks (return true when the action is STILL allowed) ──────────────

export function canReplyToUser(authorId: string, day: string, ledger: EngagementEntry[]): boolean {
  const n = ledger.filter(
    (e) => e.kind === "inbound_reply" && e.day === day && e.author_id === authorId,
  ).length;
  return n < INBOUND_REPLIES_PER_USER_PER_DAY;
}

export function alreadyRepliedInConversation(
  conversationId: string,
  ledger: EngagementEntry[],
): boolean {
  return ledger.some((e) => e.kind === "inbound_reply" && e.conversation_id === conversationId);
}

export function canQuotePost(day: string, ledger: EngagementEntry[]): boolean {
  return (
    ledger.filter((e) => e.kind === "quote_post" && e.day === day).length <
    OUTBOUND_QUOTE_POSTS_PER_DAY
  );
}

export function canFollow(day: string, ledger: EngagementEntry[]): boolean {
  return (
    ledger.filter((e) => e.kind === "follow" && e.day === day).length < OUTBOUND_FOLLOWS_PER_DAY
  );
}

export function alreadyActedOnTweet(tweetId: string, ledger: EngagementEntry[]): boolean {
  return ledger.some((e) => e.target_tweet_id === tweetId);
}
