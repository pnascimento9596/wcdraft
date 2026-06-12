import { describe, expect, it } from "vitest";
import { autoDraft } from "@wcdraft/core";

import { classifyMention, decideReply, type Mention } from "../engagement/inbound.ts";
import { decideQuotePost, outboundAllowsUnsolicitedReplies } from "../engagement/outbound.ts";
import {
  alreadyRepliedInConversation,
  canFollow,
  canQuotePost,
  canReplyToUser,
  type EngagementEntry,
} from "../engagement/engagement-ledger.ts";
import { UNSOLICITED_REPLIES } from "../config.ts";
import { checkLexicon } from "../lexicon.ts";
import { loadMarketingGameData, simulateDraft } from "../engine/game-data.ts";
import { buildTokenBodyFromDraft, encodeRunTokenV2 } from "../engine/token.ts";

const gd = loadMarketingGameData();

function mention(over: Partial<Mention>): Mention {
  return {
    id: "m1",
    author_id: "u1",
    author_username: "fan",
    text: "hi",
    conversation_id: "c1",
    in_reply_to_user_id: null,
    is_reply_to_us: false,
    ...over,
  };
}

function realToken(seed: string): { token: string; record: string } {
  const draft = autoDraft({
    run_id: "eng",
    parent_seed: seed,
    formation_id: "4-3-3",
    mode: "classic",
    team_name: "Fan XI",
    dataset_version: gd.versions.dataset_version,
    rating_version: gd.versions.rating_version,
    engine_version: gd.versions.engine_version,
    dataset: gd.draftDataset,
  });
  const direct = simulateDraft(gd, draft, seed);
  return {
    token: encodeRunTokenV2(buildTokenBodyFromDraft(draft, gd, seed)),
    record: direct.record,
  };
}

describe("classifyMention", () => {
  it("detects abuse, share tokens, questions, and other", () => {
    expect(classifyMention(mention({ text: "you scam buy followers" }))).toBe("abuse");
    expect(
      classifyMention(
        mention({ text: "check wcdraft.com/play/share?run=t2.abcdefgh_ABCDEFGH123" }),
      ),
    ).toBe("share_token");
    expect(classifyMention(mention({ text: "how do I start?" }))).toBe("question");
    expect(classifyMention(mention({ text: "love this" }))).toBe("other");
  });
});

describe("decideReply (Phase B)", () => {
  it("share-token mention → reply referencing the REAL record + a clean hook", () => {
    const { token, record } = realToken("wcdraft:eng:1");
    const d = decideReply(mention({ text: `my run ${token}` }), "seed", gd);
    expect(d.action).toBe("reply");
    if (d.action !== "reply") return;
    expect(d.text).toContain(record);
    expect(checkLexicon(d.text)).toEqual([]);
  });

  it("abuse → never reply (skip)", () => {
    expect(decideReply(mention({ text: "kys scam" }), "s", gd).action).toBe("skip");
  });

  it("no thread spirals — never reply to a reply of our reply", () => {
    const d = decideReply(mention({ text: "how do I draft?", is_reply_to_us: true }), "s", gd);
    expect(d.action).toBe("skip");
    if (d.action === "skip") expect(d.reason).toMatch(/spiral/);
  });

  it("question → short helpful reply, lexicon-clean", () => {
    const d = decideReply(mention({ text: "what is this?" }), "s", gd);
    expect(d.action).toBe("reply");
    if (d.action === "reply") expect(checkLexicon(d.text)).toEqual([]);
  });

  it("a foreign/older-build token in a mention never fabricates a stat", () => {
    // A t1. token with garbage decodes-null → treated as a generic question, no invented record.
    const d = decideReply(mention({ text: "run t2.not_a_real_token_payload_zzzzzzzz" }), "s", gd);
    if (d.action === "reply") expect(d.text).not.toMatch(/\b\d-\d\b/);
  });
});

describe("engagement caps (code-enforced)", () => {
  const base = {
    at: "",
    day: "2026-06-13",
    mode: "dry_run" as const,
    conversation_id: "c",
    x_post_id: null,
  };

  it("one inbound reply per user per day", () => {
    const ledger: EngagementEntry[] = [
      { ...base, kind: "inbound_reply", author_id: "u1", target_tweet_id: "t1" },
    ];
    expect(canReplyToUser("u1", "2026-06-13", ledger)).toBe(false);
    expect(canReplyToUser("u2", "2026-06-13", ledger)).toBe(true);
  });

  it("one reply per conversation", () => {
    const ledger: EngagementEntry[] = [
      {
        ...base,
        kind: "inbound_reply",
        author_id: "u1",
        conversation_id: "conv9",
        target_tweet_id: "t1",
      },
    ];
    expect(alreadyRepliedInConversation("conv9", ledger)).toBe(true);
  });

  it("3 quote-posts/day, 20 follows/day", () => {
    const q: EngagementEntry[] = Array.from({ length: 3 }, (_, i) => ({
      ...base,
      kind: "quote_post",
      author_id: `a${i}`,
      target_tweet_id: `t${i}`,
    }));
    expect(canQuotePost("2026-06-13", q)).toBe(false);
    const f: EngagementEntry[] = Array.from({ length: 20 }, (_, i) => ({
      ...base,
      kind: "follow",
      author_id: `a${i}`,
      target_tweet_id: `t${i}`,
    }));
    expect(canFollow("2026-06-13", f)).toBe(false);
  });
});

describe("outbound (Phase C)", () => {
  it("produces a quote-post (never an @-reply), lexicon-clean, non-disparaging", () => {
    const d = decideQuotePost(
      { id: "tw1", author_id: "a", author_username: "x", text: "best draft game ever" },
      "seed",
    );
    expect(d.action).toBe("quote_post");
    if (d.action === "quote_post") {
      expect(checkLexicon(d.text)).toEqual([]);
      expect(d.quote_tweet_id).toBe("tw1");
    }
  });

  it("UNSOLICITED_REPLIES ships FALSE and outbound NEVER allows @-replies", () => {
    expect(UNSOLICITED_REPLIES).toBe(false);
    expect(outboundAllowsUnsolicitedReplies()).toBe(false);
  });
});
