// F-4 U4 — browser-side leaderboard client (thin fetch layer).
//
// Rides the existing session pattern: board reads are public GETs, /me is a
// credentialed GET (no CSRF — read-only), submit POSTs through the F-3.5
// CSRF double-submit helper. Every result is a typed branch — a failed
// fetch is a failed fetch, never an empty board.
//
// Browser-only — do not import from a Server Component.

import { boundedRequest, isRequestTimeoutError, REQUEST_BUDGET_MS } from "@wcdraft/data/client";

import { postJsonResponse } from "../auth/client";
import { isUnsafeMutationResponseAmbiguous } from "../unsafe-mutation";
import type { BoardDraftModeFilter, BoardFilter, BoardPageWire } from "./board-view";
import { boardQueryString } from "./board-view";
import type { LeaderboardLineupView, LeaderboardLineupWire } from "./lineup-view";
import type { BoardDraftOrder, BoardEra, BoardRatingBasis } from "./config";
import { outcomeFromResponse, type SubmitBoardMode, type SubmitPhase } from "./submit-state";

// ─── Board page ──────────────────────────────────────────────────────────────

export type BoardFetchResult =
  | { readonly ok: true; readonly page: BoardPageWire }
  | { readonly ok: false; readonly reason: "timeout" | "unavailable" };

export async function fetchBoardPage(opts: {
  filter: BoardFilter;
  cursor: string | null;
  limit?: number;
}): Promise<BoardFetchResult> {
  try {
    return await boundedRequest(
      async (signal) => {
        const r = await fetch(`/api/leaderboard${boardQueryString(opts)}`, {
          headers: { Accept: "application/json" },
          signal,
        });
        if (!r.ok) return { ok: false, reason: "unavailable" } as const;
        return { ok: true, page: (await r.json()) as BoardPageWire } as const;
      },
      {
        operation: "leaderboard standings",
        timeoutMs: REQUEST_BUDGET_MS.leaderboard,
        safety: "safe-read",
      },
    );
  } catch (error) {
    return { ok: false, reason: isRequestTimeoutError(error) ? "timeout" : "unavailable" };
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
    return await boundedRequest(
      async (signal) => {
        const r = await fetch(`/api/leaderboard/me${boardQueryString({ ...opts, cursor: null })}`, {
          credentials: "include",
          headers: { Accept: "application/json" },
          signal,
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
      },
      {
        operation: "leaderboard account presence",
        timeoutMs: REQUEST_BUDGET_MS.leaderboard,
        safety: "safe-read",
      },
    );
  } catch {
    return null;
  }
}

// ─── Lineup inspector ───────────────────────────────────────────────────────

export type LeaderboardLineupFetchResult =
  | { readonly ok: true; readonly lineup: LeaderboardLineupView }
  | { readonly ok: false; readonly message: string };

export async function fetchLeaderboardLineup(
  entryId: string,
): Promise<LeaderboardLineupFetchResult> {
  try {
    return await boundedRequest(
      async (signal) => {
        const q = new URLSearchParams({ entry_id: entryId });
        const r = await fetch(`/api/leaderboard/lineup?${q.toString()}`, {
          headers: { Accept: "application/json" },
          signal,
        });
        let body: LeaderboardLineupWire | null;
        try {
          body = (await r.json()) as LeaderboardLineupWire;
        } catch {
          if (signal.aborted) throw signal.reason;
          body = null;
        }
        if (r.ok && body?.ok === true) return { ok: true, lineup: body.lineup } as const;
        return {
          ok: false,
          message:
            body?.ok === false ? body.message : "The lineup could not be inspected for this entry.",
        } as const;
      },
      {
        operation: "leaderboard lineup",
        timeoutMs: REQUEST_BUDGET_MS.leaderboard,
        safety: "safe-read",
      },
    );
  } catch (error) {
    return {
      ok: false,
      message: isRequestTimeoutError(error)
        ? "The lineup check timed out. Close this panel or try it again."
        : "The lineup inspector did not respond.",
    };
  }
}

// ─── Submit ──────────────────────────────────────────────────────────────────

/**
 * POST one run to the board. Resolves to the UI phase for the settled
 * outcome — timeout is distinct because a dispatched mutation may have
 * reached the server even when the client did not receive its verdict.
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
  try {
    const r = await postJsonResponse<unknown>("/api/leaderboard/submit", {
      token: input.token,
      claimed_score: input.claimedScore,
      draft_mode: input.draftMode,
      display_alias: input.displayName,
      mode: input.mode,
      challenge: input.challenge ?? "season",
      challenge_date: input.challengeDate ?? null,
    });
    return outcomeFromResponse(r.status, r.data, r.headers.get("Retry-After"));
  } catch (error) {
    if (isRequestTimeoutError(error)) return { kind: "timeout" };
    return { kind: "unreachable" };
  }
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
  | {
      readonly ok: false;
      readonly status: number | null;
      readonly message: string | null;
      readonly timedOut: boolean;
      /**
       * No definitive non-commit verdict was received, or a successful HTTP
       * response could not be decoded into its issued attempt. Either case
       * makes issuing another seed unsafe.
       */
      readonly outcomeUnknown: boolean;
    };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUsableExpiry(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

export async function requestRankedAttempt(input: {
  readonly formationId: string;
  readonly draftMode: BoardDraftModeFilter;
  readonly draftOrder: BoardDraftOrder;
  readonly era: BoardEra;
  readonly ratingBasis: BoardRatingBasis;
}): Promise<RankedAttemptFetchResult> {
  try {
    const r = await postJsonResponse<{
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
    }>("/api/ranked/attempt", {
      formation_id: input.formationId,
      draft_mode: input.draftMode,
      draft_order: input.draftOrder,
      era: input.era,
      rating_basis: input.ratingBasis,
    });
    const body = r.data;
    if (
      r.ok &&
      body !== null &&
      isNonEmptyString(body.attempt_id) &&
      isNonEmptyString(body.parent_seed) &&
      isUsableExpiry(body.expires_at) &&
      isNonEmptyString(body.season_key) &&
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
    const acceptedWithoutUsableAttempt = r.ok;
    const acknowledgementAmbiguous = isUnsafeMutationResponseAmbiguous(r.status);
    return {
      ok: false,
      status: r.status,
      message: acceptedWithoutUsableAttempt
        ? "The ranked seed response could not be verified. The attempt may have been issued."
        : acknowledgementAmbiguous
          ? "The server could not confirm whether the ranked attempt was issued."
          : typeof body?.message === "string"
            ? body.message
            : null,
      timedOut: false,
      outcomeUnknown: acceptedWithoutUsableAttempt || acknowledgementAmbiguous,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: isRequestTimeoutError(error)
        ? "The ranked request timed out. It may have completed; check before trying again."
        : null,
      timedOut: isRequestTimeoutError(error),
      outcomeUnknown: true,
    };
  }
}
