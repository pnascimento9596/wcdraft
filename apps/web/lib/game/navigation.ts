// Tiny routing helpers — keeps the /play/draft and /play/review URL shape
// in one place. Always preserves `?run=<value>` across navigations.
//
// The `?run=` param carries EITHER a local-only run_id (a `run-v1-*` string
// produced by `run-record.ts`) OR a self-contained `t1.<base64url>` token
// produced by `run-token.ts`. The token form is what shared / replay URLs
// emit so a fresh browser (no matching localStorage) can still rebuild the
// run. `parseRunSearchParams` returns the discriminated kind so call sites
// can branch cleanly.

const RUN_PARAM = "run";

// Local run-id format: matches `run-v1-<base36>` plus older lenient ids. The
// upper length cap stays narrow (64) so a token can never be mistaken for one.
const RUN_ID_RX = /^[A-Za-z0-9_-]{1,64}$/;

// Token format. The `.` distinguishes tokens from run-ids (run-ids never
// contain a dot). Keep this prefix in sync with `run-token.ts`.
const RUN_TOKEN_PREFIX = "t1.";
// Generous upper bound on a single URL value (token + the small overhead of
// `?run=` is well under common 8KB URL limits).
const RUN_PARAM_MAX_LEN = 8192;

export type RunParam =
  | { kind: "id"; run_id: string }
  | { kind: "token"; token: string };

/** Tolerant extraction: accepts `URLSearchParams` and plain `?run=...` strings. */
export function getRunIdFromSearchParams(
  params: URLSearchParams | { get: (key: string) => string | null } | null | undefined,
): string | null {
  const parsed = parseRunSearchParams(params);
  return parsed?.kind === "id" ? parsed.run_id : null;
}

/**
 * Return the structured `?run=` value: a local run-id, a self-contained
 * token, or `null` when the value is missing / malformed. Use this in
 * screens that need to handle both local and shared-URL paths.
 */
export function parseRunSearchParams(
  params: URLSearchParams | { get: (key: string) => string | null } | null | undefined,
): RunParam | null {
  if (!params) return null;
  const raw = params.get(RUN_PARAM);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > RUN_PARAM_MAX_LEN) return null;
  if (trimmed.startsWith(RUN_TOKEN_PREFIX)) {
    // Token — payload validation happens in `decodeRunToken`. Here we just
    // confirm the prefix + non-empty body.
    if (trimmed.length <= RUN_TOKEN_PREFIX.length) return null;
    return { kind: "token", token: trimmed };
  }
  if (!RUN_ID_RX.test(trimmed)) return null;
  return { kind: "id", run_id: trimmed };
}

/**
 * Build a `?run=<value>` URL. Accepts EITHER a run-id (in-app navigation) or
 * a `t1.` token (shared / replay URLs).
 */
function runHrefFor(base: string, value: string | null): string {
  return value ? `${base}?${RUN_PARAM}=${encodeURIComponent(value)}` : base;
}

export function draftHref(run_id: string | null): string {
  return runHrefFor("/play/draft", run_id);
}

export function reviewHref(run_id: string | null): string {
  return runHrefFor("/play/review", run_id);
}

export function resultsHref(run_id: string | null): string {
  return runHrefFor("/play/results", run_id);
}

export function shareHref(run_id: string | null): string {
  return runHrefFor("/play/share", run_id);
}

/**
 * History view. No `?run=` param — listing of recent local runs.
 * Kept here so call sites do not hardcode the route literal.
 */
export function historyHref(): string {
  return "/play/history";
}
