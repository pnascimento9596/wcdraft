/**
 * Shared browser-safe request budgets. These are elapsed-operation budgets,
 * including response-body parsing when the caller keeps that work inside
 * `boundedRequest`.
 */
export const REQUEST_BUDGET_MS = Object.freeze({
  /** Runtime manifests and bundles are large and may be cold at the edge. */
  runtimeData: 30_000,
  /** Public leaderboard reads and ranked/submit API calls. */
  leaderboard: 12_000,
  /** Session, CSRF, account, history, and progress API calls. */
  auth: 12_000,
  /** Deliberately preserves A1's lightweight Daily metadata budget. */
  dailyMetadata: 12_000,
});

export type RequestSafety = "safe-read" | "unsafe-mutation";

export interface BoundedRequestOptions {
  /** PII-free operation label for diagnostics and translated UI errors. */
  readonly operation: string;
  readonly timeoutMs: number;
  /**
   * Safe reads may expose a Retry action. Unsafe mutations must not be
   * automatically replayed after an ambiguous timeout.
   */
  readonly safety: RequestSafety;
  /** Optional caller cancellation composed with the internal timeout. */
  readonly signal?: AbortSignal;
}

/** Stable translated timeout; never includes a request URL or response body. */
export class RequestTimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;
  readonly retrySafe: boolean;

  constructor(options: Pick<BoundedRequestOptions, "operation" | "timeoutMs" | "safety">) {
    super(`${options.operation} timed out after ${options.timeoutMs.toString()}ms`);
    this.name = "RequestTimeoutError";
    this.operation = options.operation;
    this.timeoutMs = options.timeoutMs;
    this.retrySafe = options.safety === "safe-read";
  }
}

export function isRequestTimeoutError(error: unknown): error is RequestTimeoutError {
  return error instanceof RequestTimeoutError;
}

function abortError(reason: unknown): unknown {
  if (reason !== undefined) return reason;
  const error = new Error("The request was aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Run one request operation within a hard budget.
 *
 * The helper invokes `run` exactly once. It aborts the supplied signal on
 * timeout, but also races the operation so a fetch implementation that ignores
 * AbortSignal still settles for the caller. Late resolution/rejection remains
 * observed by Promise.race and cannot produce a second caller-visible effect.
 */
export async function boundedRequest<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: BoundedRequestOptions,
): Promise<T> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new TypeError("boundedRequest: timeoutMs must be a positive safe integer");
  }
  const operation = options.operation.trim();
  if (operation.length === 0) {
    throw new TypeError("boundedRequest: operation must be a non-empty PII-free label");
  }
  if (options.signal?.aborted) throw abortError(options.signal.reason);

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let removeExternalAbort: () => void = () => undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new RequestTimeoutError({
        operation,
        timeoutMs: options.timeoutMs,
        safety: options.safety,
      });
      controller.abort(error);
      reject(error);
    }, options.timeoutMs);
  });

  const contenders: Promise<T>[] = [Promise.resolve().then(() => run(controller.signal)), timeout];
  const externalSignal = options.signal;
  if (externalSignal) {
    contenders.push(
      new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          const reason = abortError(externalSignal.reason);
          controller.abort(reason);
          reject(reason);
        };
        externalSignal.addEventListener("abort", onAbort, { once: true });
        removeExternalAbort = () => externalSignal.removeEventListener("abort", onAbort);
      }),
    );
  }

  try {
    return await Promise.race(contenders);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    removeExternalAbort();
  }
}
