// Static configuration + runtime gates for the marketing poster.
//
// Hard limits live HERE (in code), not only in the workflow, so the caps and
// the kill switch cannot be defeated by editing a config file or a repo
// variable alone. The pipeline reads the env-driven gates through these
// helpers; tests assert the caps are enforced in code.

export const SITE_URL = "https://www.wcdraft.com" as const;
export const X_HANDLE = "@WCDraft" as const;

/** Canonical deep links. The link an X post resolves to (t.co wraps to ~23 chars). */
export const DEEP_LINKS = {
  play: `${SITE_URL}/play`,
  home: SITE_URL,
  howToPlay: `${SITE_URL}/how-to-play`,
  leaderboard: `${SITE_URL}/leaderboard`,
} as const;

/** A share/replay URL for a specific run token. */
export function shareUrl(token: string): string {
  return `${SITE_URL}/play/share?run=${encodeURIComponent(token)}`;
}

/** X post hard length limit. A wrapped t.co link counts as this many chars. */
export const X_MAX_POST_LEN = 280 as const;
export const TCO_LINK_LEN = 23 as const;

// ─── Hard caps (code-enforced, not config-only) ──────────────────────────────

/** Default per-day published-post cap for Phase A. Workflow runs day-one at half. */
export const DEFAULT_DAILY_POST_CAP = 6 as const;
/** Phase B: at most one auto-reply per user per day. */
export const INBOUND_REPLIES_PER_USER_PER_DAY = 1 as const;
/** Phase C caps. */
export const OUTBOUND_QUOTE_POSTS_PER_DAY = 3 as const;
export const OUTBOUND_FOLLOWS_PER_DAY = 20 as const;

/**
 * Phase C: replying to accounts that have NOT engaged us is an X
 * automation-rules suspension risk. Ships FALSE. Flipping it is an explicit
 * OWNER action, not a code change a lane can sneak in — and even when true the
 * pipeline still refuses to @-reply non-engagers (quote-posts + follows only).
 */
export const UNSOLICITED_REPLIES = false as const;

// ─── Runtime gates ───────────────────────────────────────────────────────────

/** Global kill switch — repo variable MARKETING_PAUSED=true halts everything. */
export function isPaused(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MARKETING_PAUSED ?? "").toLowerCase() === "true";
}

/** Live posting requires an explicit opt-in; everything is dry-run otherwise. */
export function isLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MARKETING_LIVE ?? "").toLowerCase() === "true";
}

/** Per-day cap, overridable by env (e.g. half on day one) but clamped to the code default. */
export function dailyPostCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.MARKETING_DAILY_CAP);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DAILY_POST_CAP;
  return Math.min(Math.floor(raw), DEFAULT_DAILY_POST_CAP);
}

export type Tier = "free" | "basic_or_higher" | "unknown";

/** Phase B/C require read access (mentions/search) → Basic tier or higher. */
export function engagementEnabled(tier: Tier): boolean {
  return tier === "basic_or_higher";
}
