// Reply bank + quote-post bank + discovery search links.
//
// Zero-API operating model: the owner answers mentions and hunts quote targets
// by hand. These are pre-written, terminology-clean, ≤280-char copy blocks the
// owner picks from — every variant is validated by the bank test (lexicon +
// length + feature-truth on any feature it references). Tone rules: never
// disparage another game; lead with OUR differentiators; "manager" not "coach";
// "Synergy" not "Chemistry"; nominative "World Cup" only.

import { DEEP_LINKS, SITE_URL } from "../config.ts";

export interface BankVariant {
  text: string;
  /** Feature ids the text asserts — validated against features.json (live only). */
  referenced_feature_ids?: string[];
}

export interface BankScenario {
  id: string;
  title: string;
  guidance: string;
  variants: BankVariant[];
}

// ─── Reply bank (inbound — people who contacted us) ──────────────────────────

export const REPLY_BANK: BankScenario[] = [
  {
    id: "shared_run",
    title: "Someone shared their run",
    guidance: "They posted a share link or their XI/record. Be warm, specific, invite a rematch.",
    variants: [
      {
        text: "Love this squad. Want a real test? The link replays the exact run in any browser — same seed, same result. Drop your record and tag a mate to beat it.",
        referenced_feature_ids: ["shareable_replays"],
      },
      {
        text: "Strong XI. The run link is fully reproducible, so anyone can take the same spins and try to top you. That's the whole game — go again and chase the 8-0.",
        referenced_feature_ids: ["shareable_replays", "calibrated_sim"],
      },
      {
        text: "Nice. Try it in Memory mode next — ratings hidden until you simulate, so you're drafting on what you actually remember. The reveal hits different.",
        referenced_feature_ids: ["two_modes"],
      },
    ],
  },
  {
    id: "question",
    title: "Question about the game",
    guidance: "Be helpful and concrete. Always include the play link.",
    variants: [
      {
        text: `Happy to help — it's free and runs entirely in your browser, no download. Seventeen spins, one pick each, build an all-time XI, then run the real 2026 bracket. Start here: ${DEEP_LINKS.play}`,
        referenced_feature_ids: ["free_browser", "seventeen_spins", "calibrated_sim"],
      },
      {
        text: `Good question. You pick your era (All-time, Post-2000, Post-2010, Modern), draft 16 players + a manager, then simulate 8 matches. All in-browser, nothing to install: ${DEEP_LINKS.play}`,
        referenced_feature_ids: ["era_presets", "manager_pick", "free_browser"],
      },
      {
        text: `Sure — Classic shows every rating, Memory hides them until the reveal. Same seeds, same outcomes either way. Have a go: ${DEEP_LINKS.howToPlay}`,
        referenced_feature_ids: ["two_modes"],
      },
    ],
  },
  {
    id: "praise",
    title: "Someone praised the game",
    guidance: "Gracious, brief, nudge them to share.",
    variants: [
      {
        text: "Appreciate that! If you had a run you liked, hit share and post the link — it replays exactly, so your mates can take the same spins.",
        referenced_feature_ids: ["shareable_replays"],
      },
      {
        text: "Thank you — that means a lot for a fan-made project. Tell a friend who'd argue about a 1970 fullback vs a 2026 prospect.",
      },
    ],
  },
  {
    id: "how_different",
    title: "How is this different from 82-0 / 38-0-style games?",
    guidance: "NEVER disparage them. Lead with our distinct features, positively.",
    variants: [
      {
        text: "Same love of a good draft, a few twists: it's free in your browser, you draft across 1930–2026 with era presets, the manager is one of your picks, and your XI plays the real 2026 bracket in a calibrated sim.",
        referenced_feature_ids: ["free_browser", "era_presets", "manager_pick", "calibrated_sim"],
      },
      {
        text: "If you enjoy those, you'll probably like this: pick Squad First or Position First, draft a manager too, and try Memory mode where ratings stay hidden until the reveal. Free, in-browser.",
        referenced_feature_ids: ["draft_flow", "manager_pick", "two_modes", "free_browser"],
      },
      {
        text: "Different flavour of the same fun — nation Synergy rewards a connected XI, a season-keyed leaderboard ranks your run, and every run gets a reproducible share link. No download, no sign-up to play.",
        referenced_feature_ids: [
          "nation_synergy",
          "leaderboard",
          "shareable_replays",
          "free_browser",
        ],
      },
    ],
  },
  {
    id: "bug_report",
    title: "Bug report",
    guidance: "Thank them, ask for repro details, route to a channel. Never promise a fix date.",
    variants: [
      {
        text: "Thanks for flagging — sorry it glitched. A screenshot plus your browser/device helps us reproduce it. Reply here or DM and we'll dig in.",
      },
      {
        text: `Appreciate the report. If you can share the steps + your run's share link, we can replay the exact state and chase it down. More on the project: ${SITE_URL}`,
        referenced_feature_ids: ["shareable_replays"],
      },
    ],
  },
];

// ─── Quote-post bank (outbound — quoting a public post) ──────────────────────

export const QUOTE_BANK: BankScenario[] = [
  {
    id: "wc_news",
    title: "Quoting World Cup news / a fixture moment",
    guidance: "React to the news, then pivot to drafting that team-year in wcdraft.",
    variants: [
      {
        text: "This is exactly the kind of moment wcdraft is built for — spin that nation's squad, pick your XI, and see how they'd run the whole 2026 bracket. Free, in your browser.",
        referenced_feature_ids: ["calibrated_sim", "free_browser"],
      },
      {
        text: "Great window to build an all-time XI for this side — 1930 to 2026, manager included, in a calibrated sim of the real bracket. No download.",
        referenced_feature_ids: ["era_presets", "manager_pick", "calibrated_sim", "free_browser"],
      },
    ],
  },
  {
    id: "draft_games_trending",
    title: "Quoting a trending draft-game post",
    guidance: "Positive, never disparaging. Lead with a differentiator.",
    variants: [
      {
        text: "If draft games are your thing: ours is free in-browser, you pick across 90+ years of World Cup squads, the manager is a real pick, and Memory mode hides ratings until the reveal.",
        referenced_feature_ids: ["free_browser", "era_presets", "manager_pick", "two_modes"],
      },
      {
        text: "Add this one to the rotation — Squad First or Position First, nation Synergy, a season-keyed leaderboard, and a reproducible share link for every run.",
        referenced_feature_ids: [
          "draft_flow",
          "nation_synergy",
          "leaderboard",
          "shareable_replays",
        ],
      },
    ],
  },
  {
    id: "nostalgia",
    title: "Quoting a football-nostalgia / best-XI thread",
    guidance: "Meet the nostalgia, then offer the tool to settle it.",
    variants: [
      {
        text: "This is a pub argument with receipts waiting to happen. In wcdraft you draft the all-time XI yourself, then run it through the real 2026 bracket. Free, in your browser.",
        referenced_feature_ids: ["calibrated_sim", "free_browser"],
      },
      {
        text: "Settle it properly: pick your era, draft 16 players + a manager, and let the sim decide. Same seed replays for anyone you challenge.",
        referenced_feature_ids: [
          "era_presets",
          "manager_pick",
          "calibrated_sim",
          "shareable_replays",
        ],
      },
    ],
  },
];

// ─── Discovery search links (the owner opens these to find quote targets) ────

export interface DiscoverySearch {
  label: string;
  url: string;
}

function searchUrl(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
}

export const DISCOVERY_SEARCHES: DiscoverySearch[] = [
  { label: "All-time XI football chatter", url: searchUrl('"all-time XI" football') },
  { label: "World Cup draft talk", url: searchUrl('"world cup" draft') },
  {
    label: "Best XI / nostalgia threads",
    url: searchUrl('"best XI" (1970 OR 1986 OR 1998 OR 2006)'),
  },
  { label: "World Cup 2026 build-up", url: searchUrl("World Cup 2026 squad") },
  { label: "Football draft games trending", url: searchUrl("football draft game") },
];
