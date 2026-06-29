// F-4 U4 — pure board view-model helpers (client-safe; no I/O, no clock).
//
// Everything time- or state-dependent takes its inputs explicitly (nowMs,
// previously loaded rows) so the components stay thin and these stay
// deterministic under test. Honest-state: ranks/scores/times come from the
// server rows verbatim; a malformed breakdown renders as absent ("—"),
// never re-derived client-side.
import type {
  BoardDraftMode,
  BoardDraftOrder,
  BoardEra,
  BoardLane,
  BoardRatingBasis,
} from "./config";
import type { LeaderboardChallengeKind } from "../game/daily";

export type BoardDraftModeFilter = BoardDraftMode;
export interface BoardFilter {
  readonly challenge: LeaderboardChallengeKind;
  readonly challengeDate?: string | null;
  readonly lane: BoardLane;
  readonly draftMode: BoardDraftMode;
  readonly draftOrder: BoardDraftOrder;
  readonly era: BoardEra;
  readonly ratingBasis: BoardRatingBasis;
}

/** Wire shape of one GET /api/leaderboard entry (BoardResponseBody.entries[i]). */
export interface BoardEntryWire {
  readonly rank: number;
  readonly id: string;
  readonly draft_mode: BoardDraftMode;
  readonly draft_order: BoardDraftOrder;
  readonly era: BoardEra;
  readonly rating_basis: BoardRatingBasis;
  readonly rating_version: string | null;
  readonly percentile: number | null;
  readonly field_size: number;
  readonly display_name: string;
  readonly verified_score: number;
  readonly score_breakdown: unknown;
  readonly created_at: string;
}

export interface BoardPageWire {
  readonly season_key: string;
  readonly current_season_key: string;
  readonly mode: "casual" | "ranked";
  readonly draft_mode: BoardDraftModeFilter;
  readonly draft_order: BoardDraftOrder;
  readonly era: BoardEra;
  readonly rating_basis: BoardRatingBasis;
  readonly challenge_type?: LeaderboardChallengeKind;
  readonly challenge_date?: string | null;
  readonly entries: readonly BoardEntryWire[];
  readonly next_cursor: string | null;
}

// ─── Relative time ───────────────────────────────────────────────────────────

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "just now" → "Nm ago" → "Nh ago" → "Nd ago" → short date. Deterministic
 *  over (nowMs, iso); a future or unparseable timestamp renders "—". */
export function relativeTimeLabel(nowMs: number, iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const delta = nowMs - t;
  if (delta < 0) return "—";
  if (delta < MIN) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MIN)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

// ─── Score breakdown (evidence popover) ──────────────────────────────────────

export interface BreakdownLineView {
  readonly label: string;
  readonly points: number;
}

/** Strictly validate the persisted jsonb breakdown. Anything off-shape →
 *  null (the row simply offers no evidence view — never a fabricated one). */
export function breakdownLines(raw: unknown): BreakdownLineView[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines: BreakdownLineView[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") return null;
    const o = item as Record<string, unknown>;
    if (typeof o.label !== "string" || typeof o.points !== "number") return null;
    lines.push({ label: o.label, points: o.points });
  }
  return lines;
}

// ─── Row views ───────────────────────────────────────────────────────────────

export interface BoardRowView {
  readonly key: string;
  readonly rank: number;
  readonly displayName: string;
  readonly score: number;
  readonly draftMode: BoardDraftMode;
  readonly draftOrder: BoardDraftOrder;
  readonly era: BoardEra;
  readonly ratingBasis: BoardRatingBasis;
  readonly ratingVersion: string | null;
  readonly percentile: number | null;
  readonly fieldSize: number;
  readonly timeLabel: string;
  readonly isMine: boolean;
  readonly breakdown: BreakdownLineView[] | null;
}

export function boardRowViews(
  entries: readonly BoardEntryWire[],
  opts: { nowMs: number; myEntryId: string | null },
): BoardRowView[] {
  return entries.map((e) => ({
    key: e.id,
    rank: e.rank,
    displayName: e.display_name,
    score: e.verified_score,
    draftMode: e.draft_mode,
    draftOrder: e.draft_order,
    era: e.era,
    ratingBasis: e.rating_basis,
    ratingVersion: e.rating_version,
    percentile: e.percentile,
    fieldSize: e.field_size,
    timeLabel: relativeTimeLabel(opts.nowMs, e.created_at),
    isMine: opts.myEntryId !== null && e.id === opts.myEntryId,
    breakdown: breakdownLines(e.score_breakdown),
  }));
}

// ─── Keyset pagination (load-more accumulation) ─────────────────────────────

export interface BoardAccumulator {
  readonly entries: readonly BoardEntryWire[];
  readonly nextCursor: string | null;
}

export const EMPTY_BOARD: BoardAccumulator = { entries: [], nextCursor: null };

/**
 * Append one fetched page. The U3 keyset contract guarantees no overlap;
 * ids already present are dropped defensively (a CDN-cached page replayed
 * after a refresh must not duplicate rows).
 */
export function appendBoardPage(acc: BoardAccumulator, page: BoardPageWire): BoardAccumulator {
  const seen = new Set(acc.entries.map((e) => e.id));
  const fresh = page.entries.filter((e) => !seen.has(e.id));
  return {
    entries: [...acc.entries, ...fresh],
    nextCursor: page.next_cursor,
  };
}

/** Query string for GET /api/leaderboard — current season is the server's
 *  explicit default, so no season param is sent by the board UI. */
export function boardQueryString(opts: { filter: BoardFilter; cursor: string | null }): string {
  const q = new URLSearchParams();
  q.set("challenge", opts.filter.challenge);
  if (opts.filter.challenge === "daily" && opts.filter.challengeDate) {
    q.set("date", opts.filter.challengeDate);
  }
  q.set("mode", opts.filter.lane);
  q.set("draft_mode", opts.filter.draftMode);
  q.set("draft_order", opts.filter.draftOrder);
  q.set("era", opts.filter.era);
  q.set("rating_basis", opts.filter.ratingBasis);
  if (opts.cursor !== null) q.set("cursor", opts.cursor);
  return `?${q.toString()}`;
}

// ─── Season label ────────────────────────────────────────────────────────────

/**
 * Human header for a season id. Legacy/archive ids and the current pinned
 * default still use `engine_rating_dataset_ruleset_hash`; the label leads
 * with the readable anchors when that shape is present.
 */
export function seasonLabel(seasonKey: string): string {
  if (seasonKey.startsWith("season-")) return seasonKey;
  const parts = seasonKey.split("_");
  if (parts.length < 5) return seasonKey;
  // dataset · engine — the two anchors a player can act on (refresh = new data build).
  return `${parts[2]} · ${parts[0]}`;
}
