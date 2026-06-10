// F-4 U2 — pure anti-cheat validation core (plan §2, cheapest-rejection-first).
//
// Token-in / verdict-out. This module owns pipeline steps 1–3, 5 and 7–9:
//
//   1. body shape + token size guard                     → INVALID_BODY / TOKEN_TOO_LARGE
//   2. decodeRunToken === null                           → MALFORMED_TOKEN
//   3. strict 6-anchor versionsAgree (= season check)    → WRONG_SEASON
//   5. display-name validity (§5.1)                      → INVALID_NAME
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
// every spin's offered candidates from the token's parent_seed alone and
// `pickPlayer` rejects any card not in that spin's re-derived
// `rolled_card_ids` (packages/core/src/draft.ts). A token whose pick log
// claims a card the seed never offered is not forgeable — it fails replay.

import {
  buildRunScenario,
  runTournamentFull,
  type DraftState,
  type ScoreComponent,
} from "@wcdraft/core";
import type { Scenario2026Bundle } from "@wcdraft/data";

import type { GameData, RunRecordVersions } from "../game/data";
import type { RunRecordV1 } from "../game/run-record";
import {
  decodeRunToken,
  RUN_TOKEN_MAX_LEN,
  versionsAgree,
  reconstructDraftFromToken,
  type RunTokenV1Body,
} from "../game/run-token";
import { buildSimWorldInputs } from "../game/simulate";
import { validateDisplayName, type DisplayNameRejection } from "./display-name";
import { deriveSeasonKey } from "./season";

// ─── Codes ───────────────────────────────────────────────────────────────────

/** Rejection codes this pure core can produce. */
export type SubmitRejectionCode =
  | "INVALID_BODY"
  | "TOKEN_TOO_LARGE"
  | "MALFORMED_TOKEN"
  | "WRONG_SEASON"
  | "INVALID_NAME"
  | "ILLEGAL_PICK"
  | "SIM_FAILURE"
  | "SCORE_MISMATCH";

/** Codes owned by the route layer (U3/U5) — steps 4 and 6 of the pipeline. */
export type SubmitGateCode =
  | "AUTH_REQUIRED"
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
  TOKEN_TOO_LARGE: 400,
  MALFORMED_TOKEN: 400,
  WRONG_SEASON: 409,
  AUTH_REQUIRED: 401,
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
] as const satisfies readonly (readonly [keyof RunTokenV1Body, keyof RunRecordVersions])[];

export type VersionAnchor = (typeof VERSION_ANCHORS)[number][1];

export interface AcceptedSubmission {
  status: "accepted";
  /** Canonical score — from the SERVER's own re-sim, never the client. */
  verified_score: number;
  /** Transparent breakdown (Σ points === verified_score) for the insert. */
  score_breakdown: ScoreComponent[];
  /** Season = full 6-anchor tuple, derived from the server's versions (§3). */
  season_key: string;
  /** Self-declared fairness dimension from the token's `md` (see plan §7). */
  draft_mode: "classic" | "hidden";
  /** Normalized (trimmed + NFC) name — persist THIS, not the raw input. */
  display_name: string;
  /** Decoded token body (rid / ps available to the route for logging). */
  token_body: RunTokenV1Body;
}

export interface RejectedSubmission {
  status: "rejected";
  code: SubmitRejectionCode;
  /** Safe for logs/clients: never echoes the raw display-name value. */
  reason: string;
  /** Set iff code === "INVALID_NAME". */
  name_reason?: DisplayNameRejection;
  /** Set iff code === "WRONG_SEASON" — which of the six anchors diverged. */
  mismatched_anchors?: VersionAnchor[];
}

export type SubmitVerdict = AcceptedSubmission | RejectedSubmission;

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** Untrusted POST body fields (already JSON-parsed by the route). */
export interface SubmissionBody {
  token: unknown;
  claimed_score: unknown;
  display_name: unknown;
}

/** Injected server-owned data — built once per process by the route (U3). */
export interface ValidationData {
  gameData: GameData;
  scenario: Scenario2026Bundle;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

function rejected(code: SubmitRejectionCode, reason: string): RejectedSubmission {
  return { status: "rejected", code, reason };
}

function mismatchedAnchors(
  token: RunTokenV1Body,
  versions: RunRecordVersions,
): VersionAnchor[] {
  return VERSION_ANCHORS.filter(([t, v]) => token[t] !== versions[v]).map(([, v]) => v);
}

/**
 * Validate one leaderboard submission. Pure and deterministic over
 * (`body`, `data`); strictly cheapest-rejection-first.
 */
export function validateSubmission(
  body: SubmissionBody,
  data: ValidationData,
): SubmitVerdict {
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

  // 2 — decode (never throws; null on any malformation incl. bad mode tag).
  const token = decodeRunToken(body.token);
  if (token === null) {
    return rejected("MALFORMED_TOKEN", "token failed to decode");
  }

  // 3 — season check = strict 6-anchor conjunction.
  if (!versionsAgree(token, data.gameData.versions)) {
    return {
      status: "rejected",
      code: "WRONG_SEASON",
      reason: "token version anchors do not match the current season tuple",
      mismatched_anchors: mismatchedAnchors(token, data.gameData.versions),
    };
  }

  // 5 — display name (4 and 6 are route seams; both are O(1) DB/header work
  // and MUST run before the CPU-bound steps below — see module header).
  const name = validateDisplayName(body.display_name);
  if (!name.ok) {
    return {
      status: "rejected",
      code: "INVALID_NAME",
      reason: `display name rejected (${name.reason})`,
      name_reason: name.reason,
    };
  }

  // 7 — THE KEYSTONE: full replay re-derives every spin's candidates from the
  // token's parent_seed; any pick outside rolled_card_ids throws RunTokenError.
  let draft: DraftState;
  try {
    draft = reconstructDraftFromToken(token, data.gameData);
  } catch (err) {
    return rejected("ILLEGAL_PICK", err instanceof Error ? err.message : String(err));
  }

  // 8 — deterministic re-sim on server-owned scenario/world. A throw here
  // after a successful replay is a contract bug (route maps to 500 + alert).
  let run: { score: number; score_breakdown: ScoreComponent[] };
  try {
    const record: RunRecordV1 = {
      record_version: 1,
      run_id: token.rid,
      parent_seed: token.ps,
      created_seq: 0,
      updated_seq: 0,
      versions: data.gameData.versions,
      draft,
      status: "ready",
    };
    const { world, teams, bracket } = buildSimWorldInputs(data.gameData, data.scenario, record);
    const { scenario } = buildRunScenario({
      parent_seed: token.ps,
      teams,
      bracket,
      ruleset_version: data.gameData.versions.ruleset_version,
    });
    const result = runTournamentFull(draft, scenario, token.ps, world);
    run = result.run;
  } catch (err) {
    return rejected("SIM_FAILURE", err instanceof Error ? err.message : String(err));
  }

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
    season_key: deriveSeasonKey(data.gameData.versions),
    draft_mode: token.md,
    display_name: name.name,
    token_body: token,
  };
}
