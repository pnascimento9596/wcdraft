// F-4 U4 — single-sourced submit status table (client-safe, no server imports).
//
// Every wire outcome the submit route can produce maps 1:1 to honest copy
// here — components never invent strings per call site, and a code the table
// doesn't know falls back to UNEXPECTED (shown as such, never dressed up as
// success). Lane/config rejections stay policy-neutral in copy: no accusing
// the player, just the server verdict.

import type { SubmitErrorCode } from "./validate";
import type { DisplayNameRejection } from "./display-name";

/** Transport-layer codes owned by the route file (not the pipeline). */
export type SubmitTransportCode =
  | "UNSUPPORTED_MEDIA_TYPE"
  | "BODY_TOO_LARGE"
  | "RATE_LIMIT_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type SubmitWireCode = SubmitErrorCode | SubmitTransportCode;

export interface SubmitStatusCopy {
  readonly title: string;
  readonly message: string;
}

/** Honest copy per wire code. Server verdict is truth — copy restates it,
 *  never softens a rejection into an implied success. */
export const SUBMIT_STATUS_COPY: Readonly<Record<SubmitWireCode, SubmitStatusCopy>> = {
  INVALID_BODY: {
    title: "Submission rejected",
    message: "The submission was malformed. Refresh and try again from this results screen.",
  },
  NON_CANONICAL_CONFIG: {
    title: "Different Daily setup",
    message:
      "Daily boards only take the shared Daily Draft setup for that UTC day. Start from Today's Draft and try again.",
  },
  TOKEN_TOO_LARGE: {
    title: "Submission rejected",
    message: "The run token is larger than the board accepts.",
  },
  MALFORMED_TOKEN: {
    title: "Submission rejected",
    message: "The run token failed to decode on the server.",
  },
  WRONG_SEASON: {
    title: "Different season",
    message:
      "This run is from a different build/season. The board only takes runs simulated on the current one. Refresh and draft a new squad to compete.",
  },
  DAILY_UNAVAILABLE: {
    title: "Daily unavailable",
    message: "Today's Daily is temporarily unavailable. Classic is still ready to play.",
  },
  INVALID_NAME: {
    title: "Name not accepted",
    message: "The server rejected that display name.",
  },
  ILLEGAL_PICK: {
    title: "Run didn't verify",
    message: "The server replayed this run and couldn't verify its picks.",
  },
  SIM_FAILURE: {
    title: "Server error",
    message: "The server failed to re-simulate the run. Nothing was posted. Try again later.",
  },
  SCORE_MISMATCH: {
    title: "Run didn't verify",
    message: "The server re-simulated this run and got a different score, so it wasn't posted.",
  },
  AUTH_REQUIRED: {
    title: "Account required",
    message: "Sign in to post ranked runs. Casual posts anonymously and can be claimed later.",
  },
  VERIFICATION_REQUIRED: {
    title: "Verify email",
    message:
      "Verify your email to post ranked runs. Casual posts still work while verification is pending.",
  },
  CSRF_FAILED: {
    title: "Session check failed",
    message: "Your session couldn't be verified. Refresh the page and try again.",
  },
  RATE_LIMITED: {
    title: "Too many submissions",
    message: "You've hit the submission limit for now.",
  },
  RATE_LIMIT_UNAVAILABLE: {
    title: "Temporarily unavailable",
    message: "Rate limiting is temporarily unavailable. Wait a moment and try again.",
  },
  BAD_ATTEMPT: {
    title: "Not open",
    message: "That lane isn't open for submissions.",
  },
  UNSUPPORTED_MEDIA_TYPE: {
    title: "Submission rejected",
    message: "The submission was sent in a format the server doesn't accept.",
  },
  BODY_TOO_LARGE: {
    title: "Submission rejected",
    message: "The submission was larger than the board accepts.",
  },
  INTERNAL_ERROR: {
    title: "Server error",
    message: "Something went wrong on the server. Nothing was posted. Try again later.",
  },
};

/** Fallback for a code this build doesn't know (newer server, etc.). */
export const SUBMIT_UNEXPECTED_COPY: SubmitStatusCopy = {
  title: "Submission failed",
  message: "The server returned a response this page doesn't recognise. Nothing was posted.",
};

export function submitStatusCopy(code: string): SubmitStatusCopy {
  return (SUBMIT_STATUS_COPY as Record<string, SubmitStatusCopy>)[code] ?? SUBMIT_UNEXPECTED_COPY;
}

/** Live-validation hints mirroring U2's display-name categories. The server
 *  verdict is truth — these only help before the round-trip. */
export const NAME_HINT: Readonly<Record<DisplayNameRejection, string>> = {
  not_a_string: "Enter a display name.",
  too_short: "At least 3 characters.",
  too_long: "At most 20 characters.",
  invalid_chars: "Letters, numbers, and _ only.",
  blocked_term: "That name contains a blocked term.",
};
