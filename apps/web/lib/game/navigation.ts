// Tiny routing helpers — keeps the /play/draft and /play/review URL shape
// in one place. Always preserves `?run=<run_id>` across navigations.

const RUN_PARAM = "run";

const RUN_ID_RX = /^[A-Za-z0-9._-]{1,64}$/;

/** Tolerant extraction: accepts `URLSearchParams` and plain `?run=...` strings. */
export function getRunIdFromSearchParams(
  params: URLSearchParams | { get: (key: string) => string | null } | null | undefined,
): string | null {
  if (!params) return null;
  const raw = params.get(RUN_PARAM);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!RUN_ID_RX.test(trimmed)) return null;
  return trimmed;
}

export function draftHref(run_id: string | null): string {
  return run_id ? `/play/draft?${RUN_PARAM}=${encodeURIComponent(run_id)}` : "/play/draft";
}

export function reviewHref(run_id: string | null): string {
  return run_id ? `/play/review?${RUN_PARAM}=${encodeURIComponent(run_id)}` : "/play/review";
}

export function resultsHref(run_id: string | null): string {
  return run_id ? `/play/results?${RUN_PARAM}=${encodeURIComponent(run_id)}` : "/play/results";
}

export function shareHref(run_id: string | null): string {
  return run_id ? `/play/share?${RUN_PARAM}=${encodeURIComponent(run_id)}` : "/play/share";
}
