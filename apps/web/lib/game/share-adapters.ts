// I3.9 — adapters that turn a persisted RunRecord into the deterministic
// content the share card + caption need.
//
// LICENSING — names + national flag codes only. No faces / kits / crests /
// maker logos / governing-body marks. This module never emits competition
// names; we say "football" never "soccer"; we never use the word "World"
// followed by "Cup". The shell footer carries the standalone disclaimer per
// Surface Inventory v2 — share copy stays mark-free.

import {
  FORMATION_TEMPLATES,
  type DraftState,
  type MatchResult,
  type RunResult,
} from "@wcdraft/core";

import type { GameData } from "./data";
import type { RunRecordV1 } from "./run-record";
import { topScorerView, type TopScorerView } from "./results-adapters";

// ─── Headline ────────────────────────────────────────────────────────────────

export type ShareHeadline = "CHAMPIONS" | "RUN COMPLETE" | "ELIMINATED IN GROUP";

export function headlineFor(run: RunResult, matchesPlayed: number): ShareHeadline {
  if (run.is_champion) return "CHAMPIONS";
  if (matchesPlayed === 3) return "ELIMINATED IN GROUP";
  return "RUN COMPLETE";
}

// ─── Star players ────────────────────────────────────────────────────────────

export interface ShareStar {
  name: string;
  /** Three-letter nation code for the flag-shaped chip. */
  nation_code: string;
  /** OVR rating used for ordering — not displayed. */
  overall: number;
}

/**
 * Pick the three top-rated starter players. Ties broken by card_id ascending
 * so the share card is byte-stable per run. Skips any starter whose `overall`
 * is null (honest-state — we never invent a rating to fill the slot).
 */
export function topStars(gameData: GameData, draft: DraftState, n = 3): ShareStar[] {
  const stars: Array<ShareStar & { card_id: string }> = [];
  for (const slot of draft.squad) {
    if (!slot.is_starter || slot.card_id === null) continue;
    const cardId = slot.card_id as string;
    const rating = gameData.indexes.ratingByCardId.get(cardId);
    const card = gameData.indexes.playerByCardId.get(cardId);
    if (!rating || !card || rating.overall === null) continue;
    const nation = gameData.indexes.nationById.get(card.nation_id);
    const code = nation?.code ?? card.nation_id.toUpperCase();
    const name = card.common_name && card.common_name.trim().length > 0 ? card.common_name : card.full_name;
    stars.push({
      name,
      nation_code: code,
      overall: rating.overall,
      card_id: cardId,
    });
  }
  stars.sort((a, b) => {
    if (b.overall !== a.overall) return b.overall - a.overall;
    return a.card_id.localeCompare(b.card_id);
  });
  return stars.slice(0, n).map(({ name, nation_code, overall }) => ({
    name,
    nation_code,
    overall,
  }));
}

// ─── Manager line ────────────────────────────────────────────────────────────

export interface ShareManager {
  name: string;
  nation_code: string;
}

export function managerLine(gameData: GameData, draft: DraftState): ShareManager | null {
  if (draft.manager_card_id === null) return null;
  const m = gameData.indexes.managerByCardId.get(draft.manager_card_id);
  if (!m) return null;
  const name = m.common_name && m.common_name.trim().length > 0 ? m.common_name : m.full_name;
  const nation = gameData.indexes.nationById.get(m.nation_id);
  const code = nation?.code ?? m.nation_id.toUpperCase();
  return { name, nation_code: code };
}

// ─── Formation name ──────────────────────────────────────────────────────────

export function formationName(draft: DraftState): string {
  const f = FORMATION_TEMPLATES[draft.formation_id];
  return f?.name ?? draft.formation_id;
}

// ─── Top scorer for the caption ──────────────────────────────────────────────

/**
 * Top scorer for the share caption — delegates to the same derivation used
 * by the results screen so the two views never disagree.
 */
export function topScorerCaption(
  gameData: GameData,
  run: RunResult,
  matches: readonly MatchResult[],
): TopScorerView | null {
  return topScorerView(gameData, run, matches);
}

// ─── Composite share view ────────────────────────────────────────────────────

export interface ShareView {
  team_name: string;
  headline: ShareHeadline;
  /** Pure W–L (no draws), matching the on-screen record scoreboard. */
  display_record: string;
  is_champion: boolean;
  is_perfect_eight_zero: boolean;
  goals_for: number;
  goals_against: number;
  formation_name: string;
  manager: ShareManager | null;
  stars: ShareStar[];
  top_scorer: TopScorerView | null;
  seed: string;
  reached_round: string;
  matches_played: number;
  shootout_wins: number;
}

export function buildShareView(gameData: GameData, record: RunRecordV1): ShareView | null {
  if (!record.simulation) return null;
  const run = record.simulation.run;
  const matches = record.simulation.matches;
  const draft = record.draft;
  const headline = headlineFor(run, matches.length);
  return {
    team_name: draft.team_name,
    headline,
    display_record: `${run.wins}-${run.losses}`,
    is_champion: run.is_champion,
    is_perfect_eight_zero:
      run.is_champion && run.wins === 8 && run.losses === 0 && matches.length === 8,
    goals_for: run.aggregate.goals_for,
    goals_against: run.aggregate.goals_against,
    formation_name: formationName(draft),
    manager: managerLine(gameData, draft),
    stars: topStars(gameData, draft, 3),
    top_scorer: topScorerCaption(gameData, run, matches),
    seed: run.seed,
    reached_round: run.reached_round,
    matches_played: matches.length,
    shootout_wins: run.shootout_wins,
  };
}

// ─── Caption text ────────────────────────────────────────────────────────────

/** Standard short social tagline (ws-results/history-share). */
export const SHARE_TAGLINE = "Built my all-time XI on wcdraft" as const;

/**
 * Plain-text caption to copy / native-share / clipboard. The URL line lets
 * the receiver reproduce the same run via `?run=` URLs. We never emit
 * competition marks. When `url` is null (token-encoding failed), the URL
 * line is omitted — the share screen disables affordances around that case.
 */
export function buildShareCaption(view: ShareView, url: string | null): string {
  const lines: string[] = [];
  lines.push(`${view.team_name} went ${view.display_record} on wcdraft.`);
  lines.push(SHARE_TAGLINE);
  if (url) lines.push(url);
  return lines.join("\n");
}

/**
 * Short intent text — does NOT include the URL. Platforms like Twitter and
 * Reddit pass `url=` as a separate query field, so embedding it in the text
 * would double-render the link. Use this for text-and-url web intents and
 * for `navigator.share({ text, url })`.
 */
export function buildShareIntentText(view: ShareView): string {
  return `${view.team_name} went ${view.display_record} on wcdraft. ${SHARE_TAGLINE}`;
}

// ─── Social web intents ──────────────────────────────────────────────────────

export type ShareIntentKind = "twitter" | "whatsapp" | "facebook" | "reddit";

export interface ShareIntentUrls {
  twitter: string;
  whatsapp: string;
  facebook: string;
  reddit: string;
}

/**
 * Build social web-intent URLs. The caller MUST pass a tokenized share URL
 * (`?run=t1.…`) so the destination preserves the reproducible-replay
 * guarantee — never a bare `run-v1-*` id.
 */
export function buildShareIntentUrls(args: {
  /** Tokenized share URL: `https://wcdraft.app/play/share?run=t1.…`. */
  url: string;
  /** Short text without the URL — for platforms that take url= separately. */
  text: string;
  /** Full caption including the URL — for platforms with one combined field. */
  caption: string;
}): ShareIntentUrls {
  const { url, text, caption } = args;

  const twitter = new URLSearchParams({ text, url }).toString();
  const whatsapp = new URLSearchParams({ text: caption }).toString();
  const facebook = new URLSearchParams({ u: url }).toString();
  const reddit = new URLSearchParams({ url, title: text }).toString();

  return {
    twitter: `https://twitter.com/intent/tweet?${twitter}`,
    whatsapp: `https://wa.me/?${whatsapp}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?${facebook}`,
    reddit: `https://www.reddit.com/submit?${reddit}`,
  };
}
