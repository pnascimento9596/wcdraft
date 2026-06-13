// F-4 U3 — GET /api/leaderboard (board) + GET /api/leaderboard/me handlers.
//
// Board: public read, keyset pagination riding the partial
// `leaderboard_entries_top_idx` exactly — (season_key, mode, draft_mode,
// verified_score DESC, created_at ASC, id), `hidden_at IS NULL` always.
// Season defaults to the CURRENT derived key (plan §3); `draft_mode` is the
// explicit Classic / Memory lane (default: Classic). CDN-cached 30 s
// (plan §5.2).
//
// /me: session required (no CSRF — read-only); caller's best + rank +
// recent entries for the season, uncached.
//
// Honest-state: ranks are DB-window-computed in the same snapshot as the
// page; an empty board is an empty array; nulls stay null; errors are typed
// codes. The cursor is an opaque base64url token over the exact index
// triple — no rank inside it (ranks shift between snapshots; the triple
// does not).

import { NextResponse, type NextRequest } from "next/server";
import { leaderboardEntries, type Db } from "@wcdraft/db";
import { eq } from "drizzle-orm";

import { LeaderboardGateError, requireReadIdentity } from "./identity-gate";
import {
  boardPage,
  identityBoardRank,
  recentEntriesFor,
  toApiEntryWithProfile,
  type ApiLeaderboardEntry,
  type BoardCursor,
  type BoardDraftMode,
  type BoardMode,
  type BoardRow,
} from "./store";

export const BOARD_DEFAULT_LIMIT = 25;
export const BOARD_MAX_LIMIT = 50;
export const ME_RECENT_LIMIT = 10;

export interface ReadRouteDeps {
  readonly db: Db;
  readonly now: () => number;
  /** Lazy — only read when a session cookie is present. */
  readonly getCookieSecret: () => string;
  /** The server's current season key (pure function of the manifest). */
  readonly currentSeasonKey: () => string;
}

function queryError(message: string): NextResponse {
  return NextResponse.json({ error: "INVALID_QUERY", message }, { status: 400 });
}

// ─── Cursor codec (opaque base64url over the keyset triple) ─────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeBoardCursor(row: BoardRow): string {
  return Buffer.from(
    JSON.stringify({ s: row.verified_score, c: row.created_at.toISOString(), i: row.id }),
    "utf8",
  ).toString("base64url");
}

/** Strict decode — any malformation returns null (route maps to 400). */
export function decodeBoardCursor(raw: string): BoardCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.s !== "number" || !Number.isSafeInteger(o.s)) return null;
  if (typeof o.c !== "string") return null;
  const createdAt = new Date(o.c);
  if (Number.isNaN(createdAt.getTime())) return null;
  if (typeof o.i !== "string" || !UUID_RE.test(o.i)) return null;
  return { score: o.s, createdAt, id: o.i };
}

// ─── Shared query parsing ───────────────────────────────────────────────────

interface ParsedBoardParams {
  seasonKey: string;
  mode: BoardMode;
}

function parseSeasonAndMode(
  req: NextRequest,
  deps: ReadRouteDeps,
): ParsedBoardParams | NextResponse {
  const q = req.nextUrl.searchParams;
  const seasonKey = q.get("season") ?? deps.currentSeasonKey();
  if (seasonKey.length === 0 || seasonKey.length > 256) {
    return queryError("season is not a valid season key");
  }
  const mode = q.get("mode") ?? "ranked";
  if (mode !== "casual" && mode !== "ranked") {
    return queryError("mode must be 'casual' or 'ranked'");
  }
  return { seasonKey, mode };
}

function parseDraftMode(req: NextRequest): BoardDraftMode | NextResponse {
  const draftModeRaw = req.nextUrl.searchParams.get("draft_mode") ?? "classic";
  if (draftModeRaw !== "classic" && draftModeRaw !== "hidden") {
    return queryError("draft_mode must be 'classic' or 'hidden'");
  }
  return draftModeRaw;
}

// ─── GET /api/leaderboard ───────────────────────────────────────────────────

export interface BoardResponseBody {
  readonly season_key: string;
  readonly current_season_key: string;
  readonly mode: BoardMode;
  readonly draft_mode: BoardDraftMode;
  readonly entries: readonly (Omit<BoardRow, "created_at"> & { created_at: string })[];
  readonly next_cursor: string | null;
}

export async function handleLeaderboardBoardGet(
  req: NextRequest,
  deps: ReadRouteDeps,
): Promise<NextResponse> {
  try {
    const base = parseSeasonAndMode(req, deps);
    if (base instanceof NextResponse) return base;
    const q = req.nextUrl.searchParams;

    const draftMode = parseDraftMode(req);
    if (draftMode instanceof NextResponse) return draftMode;

    const limitRaw = q.get("limit");
    let limit = BOARD_DEFAULT_LIMIT;
    if (limitRaw !== null) {
      const n = Number(limitRaw);
      if (!Number.isSafeInteger(n) || n < 1) {
        return queryError("limit must be a positive integer");
      }
      limit = Math.min(n, BOARD_MAX_LIMIT);
    }

    const cursorRaw = q.get("cursor");
    let cursor: BoardCursor | null = null;
    if (cursorRaw !== null) {
      cursor = decodeBoardCursor(cursorRaw);
      if (cursor === null) {
        return NextResponse.json(
          { error: "BAD_CURSOR", message: "cursor failed to decode" },
          { status: 400 },
        );
      }
    }

    const page = await boardPage(deps.db, {
      seasonKey: base.seasonKey,
      mode: base.mode,
      draftMode,
      limit,
      cursor,
    });
    const lastRow = page.rows[page.rows.length - 1];
    const body: BoardResponseBody = {
      season_key: base.seasonKey,
      current_season_key: deps.currentSeasonKey(),
      mode: base.mode,
      draft_mode: draftMode,
      entries: page.rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
      next_cursor: page.hasMore && lastRow ? encodeBoardCursor(lastRow) : null,
    };
    const res = NextResponse.json(body);
    // Plan §5.2 — Vercel CDN absorbs board reads. DOCUMENTED TRADE-OFF
    // (q-001 carryover e): after a light→dark LEADERBOARD_ENABLED flip the
    // CDN can keep serving this 200 for ≤30s (+SWR 120s revalidation
    // window). Accepted: only already-public board rows are exposed; the
    // dark-mode 404 is never cached, so dark→light flips are instant and
    // the security posture is unchanged.
    res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res;
  } catch (err) {
    console.error("[leaderboard] unexpected board error", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

// ─── GET /api/leaderboard/me ────────────────────────────────────────────────

export interface MeResponseBody {
  readonly season_key: string;
  readonly mode: BoardMode;
  readonly draft_mode: BoardDraftMode;
  readonly best: ApiLeaderboardEntry | null;
  /** Board rank of the caller's best visible entry; null when boardless. */
  readonly rank: number | null;
  readonly recent: readonly ApiLeaderboardEntry[];
}

export async function handleLeaderboardMeGet(
  req: NextRequest,
  deps: ReadRouteDeps,
): Promise<NextResponse> {
  try {
    const identity = await requireReadIdentity(req, {
      db: deps.db,
      now: deps.now,
      getCookieSecret: deps.getCookieSecret,
    });
    const base = parseSeasonAndMode(req, deps);
    if (base instanceof NextResponse) return base;
    const draftMode = parseDraftMode(req);
    if (draftMode instanceof NextResponse) return draftMode;

    // requireReadIdentity guarantees a session id.
    const sessionId = identity.sessionId as string;
    const recent = await recentEntriesFor(deps.db, {
      seasonKey: base.seasonKey,
      mode: base.mode,
      draftMode,
      userId: identity.userId,
      sessionId,
      limit: ME_RECENT_LIMIT,
    });
    const best = await identityBoardRank(deps.db, {
      seasonKey: base.seasonKey,
      mode: base.mode,
      draftMode,
      identityKey: identity.userId ?? sessionId,
    });
    const bestRow = best ? (recent.find((r) => r.id === best.entryId) ?? null) : null;
    // The best entry may be older than the recent window — fetch it directly
    // if so (still the same identity scope, so no leak surface).
    const bestApi = best && !bestRow ? await fetchEntryById(deps.db, best.entryId) : bestRow;

    const body: MeResponseBody = {
      season_key: base.seasonKey,
      mode: base.mode,
      draft_mode: draftMode,
      best: bestApi,
      rank: best?.rank ?? null,
      recent,
    };
    const res = NextResponse.json(body);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    if (err instanceof LeaderboardGateError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error("[leaderboard] unexpected me error", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

async function fetchEntryById(db: Db, id: string): Promise<ApiLeaderboardEntry | null> {
  const rows = await db
    .select()
    .from(leaderboardEntries)
    .where(eq(leaderboardEntries.id, id))
    .limit(1);
  return rows[0] ? toApiEntryWithProfile(db, rows[0]) : null;
}
