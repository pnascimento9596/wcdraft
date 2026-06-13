// CLI: Phase B (inbound replies) + Phase C (outbound quote-posts/follows).
//
// Gated on the live API tier: both phases need read access (mentions/search),
// i.e. Basic tier or higher. On Free tier this prints an honest gated-off line
// and exits 0 WITHOUT touching the API further — Phase A posting is unaffected.
// Everything is dry-run unless MARKETING_LIVE=true.

import { engagementEnabled, isLive, isPaused } from "../config.ts";
import { loadXCreds, XClient } from "../x-client/client.ts";
import { probeTier } from "../x-client/tier-probe.ts";
import { decideReply, type Mention } from "../engagement/inbound.ts";
import { decideQuotePost, type PublicTweet } from "../engagement/outbound.ts";
import {
  alreadyActedOnTweet,
  alreadyRepliedInConversation,
  appendEngagement,
  canQuotePost,
  canReplyToUser,
  readEngagementLedger,
  type EngagementEntry,
} from "../engagement/engagement-ledger.ts";
import { utcDay } from "../ledger.ts";

const SEARCH_QUERIES = [
  '("all-time XI" OR "all time XI") (football OR "world cup") -is:retweet lang:en',
  '("world cup" draft game) -is:retweet lang:en',
];

function parseMentions(json: unknown, ourUserId: string): Mention[] {
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.map((t) => {
    const r = t as {
      id: string;
      author_id: string;
      text: string;
      conversation_id?: string;
      in_reply_to_user_id?: string;
      referenced_tweets?: Array<{ type: string }>;
    };
    const isReply = (r.referenced_tweets ?? []).some((x) => x.type === "replied_to");
    return {
      id: r.id,
      author_id: r.author_id,
      author_username: "",
      text: r.text,
      conversation_id: r.conversation_id ?? r.id,
      in_reply_to_user_id: r.in_reply_to_user_id ?? null,
      is_reply_to_us: isReply && r.in_reply_to_user_id === ourUserId,
    } satisfies Mention;
  });
}

function parseSearch(json: unknown): PublicTweet[] {
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.map((t) => {
    const r = t as { id: string; author_id: string; text: string };
    return { id: r.id, author_id: r.author_id, author_username: "", text: r.text };
  });
}

async function main(): Promise<void> {
  const env = process.env;
  if (isPaused(env)) {
    console.log("MARKETING_PAUSED=true — engagement halted.");
    return;
  }
  const creds = loadXCreds(env);
  if (!creds) {
    console.log("no X credentials — engagement skipped.");
    return;
  }
  const client = new XClient(creds);
  const probe = await probeTier(client);
  console.log(`tier: ${probe.tier} — ${probe.detail}`);
  if (!engagementEnabled(probe.tier)) {
    console.log(
      `Phase B/C GATED OFF — they require Basic tier or higher (current: ${probe.tier}). ` +
        `Phase A posting is unaffected. Re-run after upgrading the API plan.`,
    );
    return;
  }

  const live = isLive(env);
  const mode = live ? "live" : "dry_run";
  const day = utcDay(new Date());
  const me = await client.getMe();

  // ─── Phase B — inbound ─────────────────────────────────────────────────────
  const mentions = parseMentions(await client.getMentions(me.id), me.id);
  for (const m of mentions) {
    const ledger = readEngagementLedger();
    if (alreadyActedOnTweet(m.id, ledger)) continue;
    const decision = decideReply(m, day);
    if (decision.action === "skip") {
      if (decision.kind === "abuse") {
        appendEngagement(abuseEntry(m, mode, day));
      }
      console.log(`inbound skip (${decision.kind}): ${decision.reason}`);
      continue;
    }
    if (
      !canReplyToUser(m.author_id, day, ledger) ||
      alreadyRepliedInConversation(m.conversation_id, ledger)
    ) {
      console.log(`inbound skip: per-user/per-conversation limit for ${m.author_id}`);
      continue;
    }
    let xId: string | null = null;
    if (live) xId = (await client.createTweet(decision.text, { in_reply_to_tweet_id: m.id })).id;
    appendEngagement(replyEntry(m, mode, day, xId));
    console.log(`inbound ${live ? "reply" : "DRY-RUN reply"}: ${decision.text}`);
  }

  // ─── Phase C — outbound (quote-posts only; never an @-reply) ────────────────
  for (const q of SEARCH_QUERIES) {
    const tweets = parseSearch(await client.searchRecent(q, 10));
    for (const t of tweets) {
      const ledger = readEngagementLedger();
      if (!canQuotePost(day, ledger)) break;
      if (alreadyActedOnTweet(t.id, ledger)) continue;
      const decision = decideQuotePost(t, day);
      if (decision.action === "skip") continue;
      let xId: string | null = null;
      if (live) xId = (await client.createTweet(decision.text, { quote_tweet_id: t.id })).id;
      appendEngagement(quoteEntry(t, mode, day, xId));
      console.log(`outbound ${live ? "quote-post" : "DRY-RUN quote-post"}: ${decision.text}`);
    }
  }
}

function replyEntry(
  m: Mention,
  mode: "dry_run" | "live",
  day: string,
  xId: string | null,
): EngagementEntry {
  return {
    at: new Date().toISOString(),
    day,
    kind: "inbound_reply",
    mode,
    author_id: m.author_id,
    conversation_id: m.conversation_id,
    target_tweet_id: m.id,
    x_post_id: xId,
  };
}
function abuseEntry(m: Mention, mode: "dry_run" | "live", day: string): EngagementEntry {
  return {
    at: new Date().toISOString(),
    day,
    kind: "abuse_logged",
    mode,
    author_id: m.author_id,
    conversation_id: m.conversation_id,
    target_tweet_id: m.id,
    x_post_id: null,
  };
}
function quoteEntry(
  t: PublicTweet,
  mode: "dry_run" | "live",
  day: string,
  xId: string | null,
): EngagementEntry {
  return {
    at: new Date().toISOString(),
    day,
    kind: "quote_post",
    mode,
    author_id: t.author_id,
    conversation_id: null,
    target_tweet_id: t.id,
    x_post_id: xId,
  };
}

void main();
