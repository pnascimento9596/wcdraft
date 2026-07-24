// F-4 U3 — rate-limit SEAM for the submit route. Pipeline step 6.
//
// U3 ships the INTERFACE with a deny-nothing default; U5 implements the real
// limiter (auth_rate_limits sliding-window buckets: 6/h + 20/day per session,
// 30/h per IP — plan §5.2) and swaps it in at the route's dependency
// construction WITHOUT touching the route logic: the route only ever calls
// `checkSubmit` and maps decisions:
//   - capped → 429 RATE_LIMITED + Retry-After
//   - store_unavailable → 503 RATE_LIMIT_UNAVAILABLE + Retry-After + correlation
//
// The seam sits between the identity gate (step 4) and `validateSubmission`
// (steps 5+) so a rate-limited caller never reaches the CPU-bound replay.

export interface SubmitRateLimitContext {
  /** From the identity gate — null for fully anonymous submissions. */
  readonly sessionId: string | null;
  readonly userId: string | null;
  /** First x-forwarded-for hop (hashed by the U5 implementation, never
   *  stored raw — same treatment as the magic-link limiter). */
  readonly ip: string;
}

export type SubmitRateLimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "capped";
      readonly retryAfterSeconds: number;
    }
  | {
      readonly allowed: false;
      readonly reason: "store_unavailable";
      readonly retryAfterSeconds: number;
      readonly correlationId: string;
    };

export interface SubmitRateLimiter {
  checkSubmit(ctx: SubmitRateLimitContext): Promise<SubmitRateLimitDecision>;
}

/** U3 default: deny nothing. U5 replaces this at the route's deps builder. */
export const allowAllSubmitRateLimiter: SubmitRateLimiter = {
  checkSubmit: () => Promise.resolve({ allowed: true }),
};
