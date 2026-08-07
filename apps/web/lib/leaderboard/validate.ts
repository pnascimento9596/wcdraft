// F-4 U2 — pure anti-cheat validation core (plan §2, cheapest-rejection-first).
//
// Token-in / verdict-out. This module owns pipeline steps 1–3, 5 and 7–9:
//
//   1. body shape + token size guard + target lane       → INVALID_BODY / TOKEN_TOO_LARGE
//   2. decodeRunToken === null                           → MALFORMED_TOKEN
//   3. strict 6-anchor versionsAgree (= runtime check)   → DIFFERENT_BUILD
//   3a. optional body season_key vs write season         → WRONG_SEASON
//   4. token mode + requested mode match                 → INVALID_BODY
//   5. optional alias validity (§5.1)                     → INVALID_NAME
//   7. DRAFT LEGALITY = full token replay (the keystone) → ILLEGAL_PICK
//   8. deterministic re-sim (buildRunScenario + runTournamentFull)
//   9. claimed-vs-resimmed score equality                → SCORE_MISMATCH
//
// Steps 4 (identity gate + CSRF) and 6 (rate limits, ranked-attempt check)
// are ROUTE surfaces (U3/U5) interleaved by the caller between 3→5 and 5→7;
// their rejection codes are declared here so the HTTP mapping stays
// single-sourced, but this module never produces them.
//
// PURITY CONTRACT: no I/O, no DB, no clock, no ambient state. Everything the
// pipeline needs (catalog, versions, scenario bundle) is injected via
// `ValidationData`; identical inputs produce identical verdicts. The CPU-bound
// work (replay ~6 ms p50, sim ~1 ms) runs only after every cheap gate passed.
//
// THE KEYSTONE (step 7, threat T1): `reconstructDraftFromToken` re-derives
// every spin's choose-from-3 player choices from the token's parent_seed alone
// and v3 player picks address only those choices by index. A token whose pick
// log claims an index outside the materialized `rolled_card_ids` is not
// forgeable — it fails replay before score authority.

import { type ScoreComponent } from "@wcdraft/core";
import type { Scenario2026Bundle } from "@wcdraft/data";

import type { GameData, RunRecordVersions } from "../game/data";
import {
  decodeRunToken,
  RUN_TOKEN_MAX_LEN,
  tokenDraftConfig,
  versionsAgree,
  type RunTokenBody,
} from "../game/run-token";
import { verifyAndResimRunToken } from "../game/verify-and-resim-run-token";
import {
  DAILY_CHALLENGE_KIND,
  SEASON_CHALLENGE_KIND,
  dailyCoverageForDate,
  isCanonicalDailyConfig,
  isDailyChallengeDate,
  type LeaderboardChallengeKind,
} from "../game/daily";
import { validateDisplayName, type DisplayNameRejection } from "./display-name";
import { DEFAULT_LEADERBOARD_SEASON_ID } from "./season";
import type { BoardDraftOrder, BoardEra, BoardRatingBasis } from "./config";

// ─── Codes ───────────────────────────────────────────────────────────────────

/** Rejection codes this pure core can produce. */
export type SubmitRejectionCode =
  | "INVALID_BODY"
  | "NON_CANONICAL_CONFIG"
  | "TOKEN_TOO_LARGE"
  | "MALFORMED_TOKEN"
  | "DIFFERENT_BUILD"
  | "WRONG_SEASON"
  | "DAILY_UNAVAILABLE"
  | "INVALID_NAME"
  | "ILLEGAL_PICK"
  | "SIM_FAILURE"
  | "SCORE_MISMATCH";

/** Codes owned by the route layer (U3/U5) — steps 4 and 6 of the pipeline. */
export type SubmitGateCode =
  | "AUTH_REQUIRED"
  | "VERIFICATION_REQUIRED"
  | "CSRF_FAILED"
  | "RATE_LIMITED"
  | "BAD_ATTEMPT";

export type SubmitErrorCode = SubmitRejectionCode | SubmitGateCode;

/**
 * Single-sourced HTTP mapping for the submit route (plan §2). SIM_FAILURE is
 * a contract bug (step 8 cannot legitimately fail after a successful replay
 * against server-owned scenario/world) — the route must log + alert and never
 * persist.
 */
export const SUBMIT_ERROR_HTTP_STATUS: Readonly<Record<SubmitErrorCode, number>> = {
  INVALID_BODY: 400,
  NON_CANONICAL_CONFIG: 422,
  TOKEN_TOO_LARGE: 400,
  MALFORMED_TOKEN: 400,
  // 409 preserves the historical conflict status for version-skew rejections;
  // only the wire identifier and copy changed (WRONG_SEASON → DIFFERENT_BUILD).
  DIFFERENT_BUILD: 409,
  WRONG_SEASON: 409,
  DAILY_UNAVAILABLE: 409,
  AUTH_REQUIRED: 401,
  VERIFICATION_REQUIRED: 403,
  CSRF_FAILED: 403,
  INVALID_NAME: 422,
  RATE_LIMITED: 429,
  BAD_ATTEMPT: 403,
  ILLEGAL_PICK: 422,
  SIM_FAILURE: 500,
  SCORE_MISMATCH: 422,
};

// ─── Verdicts ────────────────────────────────────────────────────────────────

/** Token-field → versions-field anchor pairing (the strict 6-conjunction). */
export const VERSION_ANCHORS = [
  ["sv", "schema_version"],
  ["dv", "dataset_version"],
  ["rv", "rating_version"],
  ["ev", "engine_version"],
  ["uv", "ruleset_version"],
  ["hv", "data_bundle_hash"],
] as const satisfies readonly (readonly [
  keyof RunTokenBody & ("sv" | "dv" | "rv" | "ev" | "uv" | "hv"),
  keyof RunRecordVersions,
])[];

export type VersionAnchor = (typeof VERSION_ANCHORS)[number][1];

export interface AcceptedSubmission {
  status: "accepted";
  /** Canonical score — from the SERVER's own re-sim, never the client. */
  verified_score: number;
  /** Transparent breakdown (Σ points === verified_score) for the insert. */
  score_breakdown: ScoreComponent[];
  /** Explicit active aggregate season id, decoupled from runtime/rating bumps. */
  season_key: string;
  challenge_type: LeaderboardChallengeKind;
  challenge_date: string | null;
  rating_version: string;
  /** First-class board mode; explicitly requested and matched to token `md`. */
  draft_mode: SubmissionDraftMode;
  /** Token-derived config axes persisted with the row for exact board filters. */
  draft_order: BoardDraftOrder;
  era: BoardEra;
  rating_basis: BoardRatingBasis;
  /** Normalized alias — persist THIS, not the raw input. Null means username fallback. */
  display_alias: string | null;
  /** Decoded token body (rid / ps available to the route for logging). */
  token_body: RunTokenBody;
}

export interface RejectedSubmission {
  status: "rejected";
  code: SubmitRejectionCode;
  /** Safe for logs/clients: never echoes the raw display-name value. */
  reason: string;
  /** Set iff code === "INVALID_NAME". */
  name_reason?: DisplayNameRejection;
  /** Set iff code === "DIFFERENT_BUILD" — which of the six anchors diverged. */
  mismatched_anchors?: VersionAnchor[];
}

export type SubmitVerdict = AcceptedSubmission | RejectedSubmission;

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** Untrusted POST body fields (already JSON-parsed by the route). */
export type SubmissionDraftMode = "classic" | "hidden";

export interface SubmissionBody {
  token: unknown;
  claimed_score: unknown;
  /** Required explicit target lane; never inferred from board UI state. */
  draft_mode?: unknown;
  /** New field name. */
  display_alias?: unknown;
  /** Legacy client field; treated as alias while the UI migrates. */
  display_name?: unknown;
  /** Defaults to season. Daily must be explicit and token-backed. */
  challenge?: unknown;
  /** UTC YYYY-MM-DD, required when challenge === daily. */
  challenge_date?: unknown;
  /**
   * Optional claimed leaderboard season id. Omitted by current clients (write
   * season is server-owned). When present it must equal the active write
   * season; a mismatch is WRONG_SEASON (distinct from version-anchor skew).
   */
  season_key?: unknown;
}

/** Injected server-owned data — built once per process by the route (U3). */
export interface ValidationData {
  gameData: GameData;
  scenario: Scenario2026Bundle;
  /** Explicit active aggregate season id. */
  seasonKey?: string;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

function rejected(code: SubmitRejectionCode, reason: string): RejectedSubmission {
  return { status: "rejected", code, reason };
}

function mismatchedAnchors(token: RunTokenBody, versions: RunRecordVersions): VersionAnchor[] {
  return VERSION_ANCHORS.filter(([t, v]) => token[t] !== versions[v]).map(([, v]) => v);
}

function isSubmissionDraftMode(value: unknown): value is SubmissionDraftMode {
  return value === "classic" || value === "hidden";
}

function parseChallenge(
  body: SubmissionBody,
):
  | { kind: typeof SEASON_CHALLENGE_KIND; date: null }
  | { kind: typeof DAILY_CHALLENGE_KIND; date: string }
  | null {
  const raw = body.challenge ?? SEASON_CHALLENGE_KIND;
  if (raw === SEASON_CHALLENGE_KIND) return { kind: SEASON_CHALLENGE_KIND, date: null };
  if (raw !== DAILY_CHALLENGE_KIND) return null;
  return isDailyChallengeDate(body.challenge_date)
    ? { kind: DAILY_CHALLENGE_KIND, date: body.challenge_date }
    : null;
}

interface AcceptedPreflight {
  status: "ok";
  token: RunTokenBody;
  targetDraftMode: SubmissionDraftMode;
  config: ReturnType<typeof tokenDraftConfig>;
  challenge:
    | { kind: typeof SEASON_CHALLENGE_KIND; date: null }
    | { kind: typeof DAILY_CHALLENGE_KIND; date: string };
  displayAlias: string | null;
}

function tokenDailyChallenge(token: RunTokenBody) {
  return token.v === 3 || token.v === 4 ? token.ch : undefined;
}

/**
 * Cheap preflight only: body shape, token decode/anchors/config, daily metadata,
 * and alias validation. It deliberately does NOT replay picks or re-sim.
 */
function submissionPreflight(
  body: SubmissionBody,
  data: Pick<ValidationData, "gameData" | "seasonKey">,
): AcceptedPreflight | RejectedSubmission {
  // 1 — shape + size. Size BEFORE decode so an oversize token never reaches
  // base64/JSON work (decodeRunToken would null it, but with the wrong code).
  if (typeof body.token !== "string") {
    return rejected("INVALID_BODY", "token must be a string");
  }
  if (body.token.length > RUN_TOKEN_MAX_LEN) {
    return rejected("TOKEN_TOO_LARGE", `token exceeds ${RUN_TOKEN_MAX_LEN} chars`);
  }
  if (typeof body.claimed_score !== "number" || !Number.isSafeInteger(body.claimed_score)) {
    return rejected("INVALID_BODY", "claimed_score must be an integer");
  }
  if (!isSubmissionDraftMode(body.draft_mode)) {
    return rejected("INVALID_BODY", "draft_mode must be 'classic' or 'hidden'");
  }
  const targetDraftMode = body.draft_mode;
  const challenge = parseChallenge(body);
  if (challenge === null) {
    return rejected("INVALID_BODY", "challenge must be 'season' or 'daily' with a valid date");
  }

  // 2 — decode (never throws; null on any malformation incl. bad mode tag).
  const token = decodeRunToken(body.token);
  if (token === null) {
    return rejected("MALFORMED_TOKEN", "token failed to decode");
  }

  // 3 — runtime compatibility check = strict 6-anchor conjunction.
  // Version-anchor divergence is DIFFERENT_BUILD, not WRONG_SEASON: the
  // leaderboard season id is an explicit server policy decoupled from
  // schema/engine/hash bumps (season-2026-squad-depth survived 2.10→2.11).
  if (!versionsAgree(token, data.gameData.versions)) {
    return {
      status: "rejected",
      code: "DIFFERENT_BUILD",
      reason: "token version anchors do not match the current build",
      mismatched_anchors: mismatchedAnchors(token, data.gameData.versions),
    };
  }

  // 3a — optional claimed season id. Runs after the anchor check so a token
  // that is both skew and wrong-season keeps the pre-existing first-failure
  // ordering (anchors before season). Omitted season_key is a no-op for
  // current clients; write season remains server-owned on accept.
  const writeSeason = data.seasonKey ?? DEFAULT_LEADERBOARD_SEASON_ID;
  if (body.season_key !== undefined && body.season_key !== null && body.season_key !== "") {
    if (typeof body.season_key !== "string") {
      return rejected("INVALID_BODY", "season_key must be a string when provided");
    }
    if (body.season_key !== writeSeason) {
      return rejected(
        "WRONG_SEASON",
        "submission season_key does not match the active leaderboard season",
      );
    }
  }

  // 3b — board mode target: every legal config can post, but the explicit
  // request target must still agree with the token's declared Classic/Memory
  // mode. That prevents a client from submitting a Memory token to a Classic
  // board (or vice versa) while preserving all non-canonical config axes.
  const config = tokenDraftConfig(token);
  if (token.md !== targetDraftMode) {
    return rejected(
      "INVALID_BODY",
      `draft_mode ${targetDraftMode} does not match token mode ${token.md}`,
    );
  }

  const tokenChallenge = tokenDailyChallenge(token);
  if (challenge.kind === DAILY_CHALLENGE_KIND) {
    if (!tokenChallenge || tokenChallenge.k !== DAILY_CHALLENGE_KIND) {
      return rejected("INVALID_BODY", "daily submissions require daily token metadata");
    }
    if (tokenChallenge.d !== challenge.date || tokenChallenge.s !== token.ps) {
      return rejected("INVALID_BODY", "daily token date/seed does not match the submission");
    }
    const coverage = dailyCoverageForDate(tokenChallenge.d, data.gameData.dailySeedSaltMap);
    if (!coverage.covered) {
      return rejected(
        "DAILY_UNAVAILABLE",
        "daily submissions are unavailable outside the published UTC coverage window",
      );
    }
    if (tokenChallenge.s !== coverage.seed) {
      return rejected("INVALID_BODY", "daily token seed does not match the UTC date");
    }
    if (
      !isCanonicalDailyConfig({
        mode: token.md,
        formationId: token.fid,
        draftFlow: config.draft_flow,
        eraPreset: config.era_preset,
        ratingBasis: config.rating_basis,
      })
    ) {
      return rejected(
        "NON_CANONICAL_CONFIG",
        "daily submissions must use the canonical daily config",
      );
    }
  } else if (tokenChallenge !== undefined) {
    return rejected("INVALID_BODY", "daily tokens must post to the daily board");
  }

  // 5 — optional display alias.
  const rawAlias = body.display_alias ?? body.display_name ?? null;
  let displayAlias: string | null = null;
  if (rawAlias !== null && rawAlias !== "") {
    const alias = validateDisplayName(rawAlias);
    if (!alias.ok) {
      return {
        status: "rejected",
        code: "INVALID_NAME",
        reason: `display alias rejected (${alias.reason})`,
        name_reason: alias.reason,
      };
    }
    displayAlias = alias.name;
  }

  return { status: "ok", token, targetDraftMode, config, challenge, displayAlias };
}

export function validateSubmissionCheap(
  body: SubmissionBody,
  data: Pick<ValidationData, "gameData" | "seasonKey">,
): RejectedSubmission | null {
  const preflight = submissionPreflight(body, data);
  return preflight.status === "rejected" ? preflight : null;
}

/**
 * Validate one leaderboard submission. Pure and deterministic over
 * (`body`, `data`); strictly cheapest-rejection-first.
 */
export function validateSubmission(body: SubmissionBody, data: ValidationData): SubmitVerdict {
  const preflight = submissionPreflight(body, data);
  if (preflight.status === "rejected") return preflight;
  const { token, targetDraftMode, config, challenge, displayAlias } = preflight;

  // 7–8 — shared pure kernel: full replay + deterministic re-sim + post-match
  // reconcile. Preflight (cheap gates / BAD_ATTEMPT ordering) already ran above.
  const resim = verifyAndResimRunToken(token, data.gameData, data.scenario);
  if (resim.status === "rejected") {
    return rejected(resim.reason, resim.message);
  }
  const run = resim.run;

  // 9 — honest-state: never persist a number the player didn't see.
  if (run.score !== body.claimed_score) {
    return rejected(
      "SCORE_MISMATCH",
      `claimed_score ${body.claimed_score} does not equal verified score ${run.score}`,
    );
  }

  return {
    status: "accepted",
    verified_score: run.score,
    score_breakdown: run.score_breakdown,
    season_key: data.seasonKey ?? DEFAULT_LEADERBOARD_SEASON_ID,
    challenge_type: challenge.kind,
    challenge_date: challenge.date,
    rating_version: token.rv,
    draft_mode: targetDraftMode,
    draft_order: config.draft_flow,
    era: config.era_preset,
    rating_basis: config.rating_basis,
    display_alias: displayAlias,
    token_body: token,
  };
}
