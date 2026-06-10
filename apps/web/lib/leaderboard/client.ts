// F-4 U4 — browser-side leaderboard client (thin fetch layer).
//
// Rides the existing session pattern: board reads are public GETs, /me is a
// credentialed GET (no CSRF — read-only), submit POSTs through the F-3.5
// CSRF double-submit helper. Every result is a typed branch — a failed
// fetch is a failed fetch, never an empty board.
//
// Browser-only — do not import from a Server Component.

import { ensureCsrfToken } from "../auth/client";
import type { BoardDraftModeFilter, BoardPageWire } from "./board-view";
import { boardQueryString } from "./board-view";
import { outcomeFromResponse, type SubmitPhase } from "./submit-state";

// ─── Board page ──────────────────────────────────────────────────────────────

export type BoardFetchResult =
  | { readonly ok: true; readonly page: BoardPageWire }
  | { readonly ok: false };

export async function fetchBoardPage(opts: {
  draftMode: BoardDraftModeFilter;
  cursor: string | null;
}): Promise<BoardFetchResult> {
  try {
    const r = await fetch(`/api/leaderboard${boardQueryString(opts)}`, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return { ok: false };
    return { ok: true, page: (await r.json()) as BoardPageWire };
  } catch {
    return { ok: false };
  }
}

// ─── /me (your-entry highlight) ──────────────────────────────────────────────

export interface MyBoardPresence {
  /** Entry id of the caller's best visible entry (matches a board row id). */
  readonly bestEntryId: string;
  /** Board rank of that entry (season+mode view, unfiltered). */
  readonly rank: number | null;
  readonly verifiedScore: number;
}

/**
 * Resolve the caller's board presence. Null whenever it can't be resolved
 * honestly (no session → 401, feature dark → 404, transport failure) — the
 * board then simply renders without a highlight.
 */
export async function fetchMyPresence(): Promise<MyBoardPresence | null> {
  try {
    const r = await fetch("/api/leaderboard/me", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const body = (await r.json()) as {
      best: { id?: unknown; verified_score?: unknown } | null;
      rank: number | null;
    };
    if (body.best === null || typeof body.best.id !== "string") return null;
    return {
      bestEntryId: body.best.id,
      rank: typeof body.rank === "number" ? body.rank : null,
      verifiedScore:
        typeof body.best.verified_score === "number" ? body.best.verified_score : Number.NaN,
    };
  } catch {
    return null;
  }
}

// ─── Submit ──────────────────────────────────────────────────────────────────

/**
 * POST one run to the board. Resolves to the UI phase for the settled
 * outcome — `unreachable` when no server verdict was produced.
 */
export async function submitRun(input: {
  token: string;
  claimedScore: number;
  displayName: string;
}): Promise<SubmitPhase> {
  let r: Response;
  try {
    const csrf = await ensureCsrfToken();
    r = await fetch("/api/leaderboard/submit", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        token: input.token,
        claimed_score: input.claimedScore,
        display_name: input.displayName,
        mode: "casual",
      }),
    });
  } catch {
    return { kind: "unreachable" };
  }
  const body: unknown = await r.json().catch(() => null);
  return outcomeFromResponse(r.status, body, r.headers.get("Retry-After"));
}
