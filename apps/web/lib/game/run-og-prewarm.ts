/**
 * Session-scoped OG-sign prewarm + dedupe.
 *
 * At most one in-flight sign request per run token. A successful non-null
 * result is cached for the session. Soft-fail (null) is not sticky — callers
 * may retry with `force` after the previous attempt settles (share-screen
 * resilience). Concurrent affordances always collapse onto the active
 * in-flight promise.
 *
 * Share remains non-blocking: plain-link copy never waits on this module.
 */

import { requestRunOgSign, type RunOgSignClientResult } from "./run-og-client";

const OG_SIGN_BUDGET_MS = 4_000;

const inFlight = new Map<string, Promise<RunOgSignClientResult | null>>();
const successCache = new Map<string, RunOgSignClientResult>();
let attemptCount = 0;

export function resetRunOgPrewarmForTests(): void {
  inFlight.clear();
  successCache.clear();
  attemptCount = 0;
}

export function runOgPrewarmAttemptCountForTests(): number {
  return attemptCount;
}

export function getCachedRunOgSign(token: string): RunOgSignClientResult | null | undefined {
  if (successCache.has(token)) return successCache.get(token)!;
  return undefined;
}

export type SignRunOgOptions = {
  readonly signal?: AbortSignal;
  readonly operation?: string;
  /**
   * Bypass a sticky success cache (manual Retry / soft-fail loop). Never
   * doubles an in-flight request — concurrent callers still share it.
   */
  readonly force?: boolean;
};

/**
 * Shared sign entrypoint used by prewarm, share-screen, and challenge.
 * Concurrent callers for the same token share one network request.
 */
export function signRunOg(
  token: string,
  options: SignRunOgOptions = {},
): Promise<RunOgSignClientResult | null> {
  if (options.force) {
    successCache.delete(token);
  } else if (successCache.has(token)) {
    return Promise.resolve(successCache.get(token)!);
  }

  const existing = inFlight.get(token);
  if (existing) return existing;

  attemptCount += 1;
  const promise = requestRunOgSign(token, {
    operation: options.operation ?? "prewarm signed share preview",
    timeoutMs: OG_SIGN_BUDGET_MS,
    safety: "safe-read",
    signal: options.signal,
  })
    .then((result) => {
      if (result?.signed || result?.challengeProof) {
        successCache.set(token, result);
      }
      return result;
    })
    .catch(() => null)
    .finally(() => {
      if (inFlight.get(token) === promise) inFlight.delete(token);
    });

  inFlight.set(token, promise);
  return promise;
}

/** Intent-time prewarm: viewport / pointerdown / focus. */
export function prewarmRunOgSign(token: string): Promise<RunOgSignClientResult | null> {
  return signRunOg(token, { operation: "prewarm signed share preview" });
}
