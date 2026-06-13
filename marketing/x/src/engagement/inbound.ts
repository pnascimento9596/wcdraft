// Phase B — inbound engagement (auto-replies to people who contact US).
//
// POLICY-SAFE: we only ever reply to accounts that engaged us first
// (mentions/replies), one reply per user per day, never a reply to a reply of
// our own reply (no thread spirals), templates rotated to avoid verbatim
// repetition. Share-token mentions get a contextual reply built from a REAL
// stat in THEIR run (decoded with the real decoder; a wrong-version token gets
// the honest "older build" angle). Questions get a short helpful reply. Abuse/
// spam is never answered — ledger only.
//
// This module is PURE decision logic (no network) so every rule is unit-
// testable. The orchestrator (run-engagement.ts) wires it to the live client
// and only runs when the tier is Basic+.

import { DEEP_LINKS } from "../config.ts";
import { pickFeatureHook } from "../compose/composer.ts";
import { assertClean } from "../lexicon.ts";
import { extractShareToken } from "./extract.ts";
import { runFromToken } from "../engine/run-from-token.ts";
import { loadMarketingGameData, type MarketingGameData } from "../engine/game-data.ts";

export interface Mention {
  id: string;
  author_id: string;
  author_username: string;
  text: string;
  conversation_id: string;
  /** The account this tweet replies TO (if any). */
  in_reply_to_user_id: string | null;
  /** True when this tweet is itself a reply to one of OUR tweets. */
  is_reply_to_us: boolean;
}

export type MentionKind = "share_token" | "question" | "abuse" | "other";

export type ReplyDecision =
  | {
      action: "reply";
      text: string;
      in_reply_to_tweet_id: string;
      kind: MentionKind;
      reason: string;
    }
  | { action: "skip"; kind: MentionKind; reason: string };

const ABUSE_RX =
  /\b(f[u*]ck|sh[i*]t|bitch|slur|n[i1]gg|retard|kys|scam|free followers|buy followers|crypto pump)\b/i;
const QUESTION_RX = /\?|\b(how|what|where|why|can i|do you|is it|does it)\b/i;

export function classifyMention(m: Mention): MentionKind {
  if (ABUSE_RX.test(m.text)) return "abuse";
  if (extractShareToken(m.text)) return "share_token";
  if (QUESTION_RX.test(m.text)) return "question";
  return "other";
}

// ─── Reply templates (rotated by mention id) ─────────────────────────────────

function tokenReplyText(
  record: string,
  champion: boolean,
  perfect: boolean,
  hook: string,
  variant: number,
): string {
  const result = perfect
    ? "a perfect 8-0 — chef's kiss"
    : champion
      ? `${record} and the trophy`
      : record;
  const variants = [
    `Love it — that XI ran ${result}. ${hook} ${DEEP_LINKS.play}`,
    `${result}. Respect the squad. ${hook} ${DEEP_LINKS.play}`,
    `Nice run — ${result}. ${hook} ${DEEP_LINKS.play}`,
  ];
  return variants[variant % variants.length]!;
}

function staleTokenReplyText(hook: string, variant: number): string {
  const variants = [
    `That run's from an older wcdraft build, so it won't replay on the current bracket — but love the squad. Fresh spin's on us: ${DEEP_LINKS.play}`,
    `Older-build run — the bracket's moved since, so it won't reproduce now. Worth a fresh spin: ${hook} ${DEEP_LINKS.play}`,
  ];
  return variants[variant % variants.length]!;
}

function questionReplyText(hook: string, variant: number): string {
  const variants = [
    `Happy to help — everything's free and runs in your browser. ${hook} Start here: ${DEEP_LINKS.play}`,
    `Good question — it's all in-browser, no download. ${hook} ${DEEP_LINKS.howToPlay}`,
  ];
  return variants[variant % variants.length]!;
}

/**
 * Decide how to reply to a single mention. Caller has ALREADY enforced the
 * per-user/per-day and per-conversation limits; this enforces the no-spiral
 * and abuse rules and builds the (lexicon-clean) reply text.
 */
export function decideReply(
  m: Mention,
  seed: string,
  gd: MarketingGameData = loadMarketingGameData(),
): ReplyDecision {
  const kind = classifyMention(m);

  // Never spiral: don't reply to a reply of our own reply.
  if (m.is_reply_to_us) {
    return { action: "skip", kind, reason: "would create a reply-to-our-reply thread spiral" };
  }
  if (kind === "abuse") {
    return { action: "skip", kind, reason: "abuse/spam — never reply, ledger only" };
  }

  const variant = hashVariant(m.id);
  let text: string;
  if (kind === "share_token") {
    const token = extractShareToken(m.text)!;
    const run = runFromToken(token, gd);
    const hook = pickFeatureHook(`${seed}:${m.id}`).text;
    if (run.ok) {
      text = tokenReplyText(
        run.summary.record,
        run.summary.is_champion,
        run.summary.is_perfect_eight_zero,
        hook,
        variant,
      );
    } else if (run.reason === "version_skew" || run.reason === "newer_version") {
      text = staleTokenReplyText(hook, variant);
    } else {
      // Malformed/foreign token in a mention — treat as a generic question.
      text = questionReplyText(hook, variant);
    }
  } else if (kind === "question") {
    const hook = pickFeatureHook(`${seed}:${m.id}`).text;
    text = questionReplyText(hook, variant);
  } else {
    return { action: "skip", kind, reason: "no actionable share token or question" };
  }

  // Final guardrail — a reply that trips the lexicon is dropped, never sent.
  try {
    assertClean(text, `inbound-reply:${m.id}`);
  } catch (err) {
    return {
      action: "skip",
      kind,
      reason: `reply failed lexicon: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { action: "reply", text, in_reply_to_tweet_id: m.id, kind, reason: "engaged us first" };
}

function hashVariant(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 3;
}
