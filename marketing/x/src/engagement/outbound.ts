// Phase C — outbound discovery (policy-constrained).
//
// Output is QUOTE-POSTS and FOLLOWS only — original commentary quoting a
// public post, leading with a differentiator from the inventory, never an
// @-reply to an account that hasn't engaged us. Caps: 3 quote-posts/day, 20
// follows/day (enforced in the orchestrator via the engagement ledger). Tone:
// never disparage another game. UNSOLICITED_REPLIES ships FALSE and even when
// flipped this module NEVER emits an @-reply — quote-posts + follows only.

import { DEEP_LINKS } from "../config.ts";
import { pickFeatureHook } from "../compose/composer.ts";
import { assertClean } from "../lexicon.ts";

export interface PublicTweet {
  id: string;
  author_id: string;
  author_username: string;
  text: string;
}

export type OutboundDecision =
  | { action: "quote_post"; text: string; quote_tweet_id: string; reason: string }
  | { action: "skip"; reason: string };

// Tone guard: we never disparage another product. These are OUR words — keep
// them positive and comparative-of-ourselves only.
const DISPARAGE_RX =
  /\b(worse|trash|garbage|sucks|terrible|beats|better than|inferior|rip[- ]?off)\b/i;

function quoteText(hook: string, variant: number): string {
  const variants = [
    `If you like a good draft debate — ours is free, in your browser, with era presets and a manager as one of your picks. ${hook} ${DEEP_LINKS.play}`,
    `For the all-time XI crowd: ${hook} Free, in-browser, 1930–2026. ${DEEP_LINKS.play}`,
    `Same energy over here — ${hook} Free to play, nothing to download. ${DEEP_LINKS.play}`,
  ];
  return variants[variant % variants.length]!;
}

/**
 * Build a quote-post for a discovered public tweet. NEVER an @-reply. Returns
 * a skip if the tone guard or lexicon would be tripped.
 */
export function decideQuotePost(tweet: PublicTweet, seed: string): OutboundDecision {
  const hook = pickFeatureHook(`out:${seed}:${tweet.id}`).text;
  const variant = hashVariant(tweet.id);
  const text = quoteText(hook, variant);
  if (DISPARAGE_RX.test(text)) {
    return { action: "skip", reason: "tone guard: text reads as disparaging" };
  }
  try {
    assertClean(text, `outbound-quote:${tweet.id}`);
  } catch (err) {
    return {
      action: "skip",
      reason: `lexicon: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return {
    action: "quote_post",
    text,
    quote_tweet_id: tweet.id,
    reason: "quote-post discovery (no @-reply)",
  };
}

/**
 * Explicit invariant: outbound NEVER produces an unsolicited @-reply. The
 * config flag `UNSOLICITED_REPLIES` exists only so flipping it is a visible
 * owner action; this lane's actions are quote-posts and follows ONLY, so even
 * a flipped flag does not unlock @-replies. Exposed for the test that pins the
 * guarantee.
 */
export function outboundAllowsUnsolicitedReplies(): boolean {
  return false;
}

function hashVariant(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 3;
}
