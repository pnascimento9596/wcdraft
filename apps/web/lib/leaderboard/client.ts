// F-4 U4 — browser-side leaderboard client (thin fetch layer).
//
// Rides the existing session pattern: board reads are public GETs, /me is a
// credentialed GET (no CSRF — read-only), submit POSTs through the F-3.5
// CSRF double-submit helper. Every result is a typed branch — a failed
// fetch is a failed fetch, never an empty board.
//
// Browser-only — do not import from a Server Component.

import { ensureCsrfToken } from "../auth/client";
import type { BoardDraftModeFilter, BoardFilter, BoardPageWire } from "./board-view";
import { boardQueryString } from "./board-view";
import type { BoardDraftOrder, BoardEra, BoardRatingBasis } from "./config";
import { outcomeFromResponse, type SubmitBoardMode, type SubmitPhase } from "./submit-state";

// ─── Board page ──────────────────────────────────────────────────────────────

export type BoardFetchResult =
  | { readonly ok: true; readonly page: BoardPageWire }
  | { readonly ok: false };

export async function fetchBoardPage(opts: {
  filter: BoardFilter;
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
  /** Board rank of that entry (season+mode+draft_mode view). */
  readonly rank: number | null;
  readonly verifiedScore: number;
}

/**
 * Resolve the caller's board presence. Null whenever it can't be resolved
 * honestly (no session → 401, feature dark → 404, transport failure) — the
 * board then simply renders without a highlight.
 */
export async function fetchMyPresence(opts: {
  filter: BoardFilter;
}): Promise<MyBoardPresence | null> {
  try {
    const r = await fetch(`/api/leaderboard/me${boardQueryString({ ...opts, cursor: null })}`, {
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
  mode: SubmitBoardMode;
  draftMode: BoardDraftModeFilter;
  displayName: string | null;
  challenge?: "season" | "daily";
  challengeDate?: string | null;
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
        draft_mode: input.draftMode,
        display_alias: input.displayName,
        mode: input.mode,
        challenge: input.challenge ?? "season",
        challenge_date: input.challengeDate ?? null,
      }),
    });
  } catch {
    return { kind: "unreachable" };
  }
  const body: unknown = await r.json().catch(() => null);
  return outcomeFromResponse(r.status, body, r.headers.get("Retry-After"));
}

// ─── Ranked attempt seed ────────────────────────────────────────────────────

export type RankedAttemptFetchResult =
  | {
      readonly ok: true;
      readonly attempt: {
        readonly attempt_id: string;
        readonly parent_seed: string;
        readonly expires_at: string;
        readonly season_key: string;
        readonly formation_id: string;
        readonly draft_mode: BoardDraftModeFilter;
        readonly draft_order: BoardDraftOrder;
        readonly era: BoardEra;
        readonly rating_basis: BoardRatingBasis;
      };
    }
  | { readonly ok: false; readonly status: number | null; readonly message: string | null };

export async function requestRankedAttempt(input: {
  readonly formationId: string;
  readonly draftMode: BoardDraftModeFilter;
  readonly draftOrder: BoardDraftOrder;
  readonly era: BoardEra;
  readonly ratingBasis: BoardRatingBasis;
}): Promise<RankedAttemptFetchResult> {
  let r: Response;
  try {
    const csrf = await ensureCsrfToken();
    r = await fetch("/api/ranked/attempt", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        formation_id: input.formationId,
        draft_mode: input.draftMode,
        draft_order: input.draftOrder,
        era: input.era,
        rating_basis: input.ratingBasis,
      }),
    });
  } catch {
    return { ok: false, status: null, message: null };
  }
  const body = (await r.json().catch(() => null)) as {
    attempt_id?: unknown;
    parent_seed?: unknown;
    expires_at?: unknown;
    season_key?: unknown;
    formation_id?: unknown;
    draft_mode?: unknown;
    draft_order?: unknown;
    era?: unknown;
    rating_basis?: unknown;
    message?: unknown;
  } | null;
  if (
    r.ok &&
    body !== null &&
    typeof body.attempt_id === "string" &&
    typeof body.parent_seed === "string" &&
    typeof body.expires_at === "string" &&
    typeof body.season_key === "string" &&
    body.formation_id === input.formationId &&
    body.draft_mode === input.draftMode &&
    body.draft_order === input.draftOrder &&
    body.era === input.era &&
    body.rating_basis === input.ratingBasis
  ) {
    return {
      ok: true,
      attempt: {
        attempt_id: body.attempt_id,
        parent_seed: body.parent_seed,
        expires_at: body.expires_at,
        season_key: body.season_key,
        formation_id: input.formationId,
        draft_mode: input.draftMode,
        draft_order: input.draftOrder,
        era: input.era,
        rating_basis: input.ratingBasis,
      },
    };
  }
  return {
    ok: false,
    status: r.status,
    message: typeof body?.message === "string" ? body.message : null,
  };
}
