// F-3.5 — auth client helpers (browser-only).
//
// Wraps the CSRF bootstrap + double-submit dance so the rest of the app
// can do `await postWithCsrf("/api/runs", {...})` and not duplicate the
// cookie-read/header-set boilerplate at every call site. Reads the csrf
// token from the non-httpOnly `wcdraft_csrf` cookie set by F-2's
// /api/auth/csrf endpoint; falls back to bootstrapping the cookie when
// missing.
//
// Browser-only — DO NOT import from a Server Component.

import { boundedRequest, isRequestTimeoutError, REQUEST_BUDGET_MS } from "@wcdraft/data/client";

const CSRF_COOKIE = "wcdraft_csrf";
const CSRF_HEADER = "x-csrf-token";

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`).exec(document.cookie);
  return match?.[1] ?? null;
}

/**
 * Ensure the wcdraft_csrf cookie exists (anonymous session set up too).
 * Returns the csrf token. Idempotent — safe to call from many places.
 */
async function readOrFetchCsrfToken(signal: AbortSignal): Promise<string> {
  const existing = readCsrfCookie();
  if (existing && existing.length > 0) return existing;
  const r = await fetch("/api/auth/csrf", {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!r.ok) {
    throw new Error(`auth-client: /api/auth/csrf returned HTTP ${r.status.toString()}`);
  }
  const data = (await r.json()) as { csrfToken?: string };
  if (!data.csrfToken) throw new Error("auth-client: csrf token missing in response");
  return data.csrfToken;
}

export async function ensureCsrfToken(signal?: AbortSignal): Promise<string> {
  return boundedRequest(readOrFetchCsrfToken, {
    operation: "CSRF bootstrap",
    timeoutMs: REQUEST_BUDGET_MS.auth,
    safety: "safe-read",
    signal,
  });
}

export interface FetchWithCsrfInit {
  readonly method: "POST" | "DELETE" | "PUT" | "PATCH";
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit | null;
  readonly signal?: AbortSignal;
}

async function requestWithCsrf<T>(
  operation: string,
  url: string,
  init: FetchWithCsrfInit,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return boundedRequest(
    async (signal) => {
      const csrf = await readOrFetchCsrfToken(signal);
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(init.headers ?? {}),
        [CSRF_HEADER]: csrf,
      };
      const response = await fetch(url, {
        method: init.method,
        credentials: "include",
        headers,
        body: init.body ?? undefined,
        signal,
      });
      return consume(response, signal);
    },
    {
      operation,
      timeoutMs: REQUEST_BUDGET_MS.auth,
      safety: "unsafe-mutation",
      signal: init.signal,
    },
  );
}

/**
 * Mutating fetch: ensures CSRF + Origin/Host headers + same-origin
 * credentials. Throws on transport failure; returns the Response for
 * callers to inspect status/body.
 */
export async function fetchWithCsrf(url: string, init: FetchWithCsrfInit): Promise<Response> {
  return requestWithCsrf("authenticated mutation", url, init, async (response) => response);
}

/** POST with a JSON body (sets Content-Type) + CSRF. */
export async function postJson<T>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  return requestJsonWithCsrf<T>("authenticated POST", url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** POST JSON while preserving response headers for typed domain mapping. */
export async function postJsonResponse<T>(
  url: string,
  body: unknown,
  options?: { readonly signal?: AbortSignal },
): Promise<{ ok: boolean; status: number; headers: Headers; data: T | null }> {
  return requestWithCsrf(
    "authenticated POST",
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options?.signal,
    },
    async (response, signal) => {
      let data: T | null;
      try {
        data = (await response.json()) as T;
      } catch {
        if (signal.aborted) throw signal.reason;
        data = null;
      }
      return { ok: response.ok, status: response.status, headers: response.headers, data };
    },
  );
}

/** PUT with a JSON body (sets Content-Type) + CSRF. */
export async function putJson<T>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  return requestJsonWithCsrf<T>("authenticated PUT", url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function requestJsonWithCsrf<T>(
  operation: string,
  url: string,
  init: FetchWithCsrfInit,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  return requestWithCsrf(operation, url, init, async (response, signal) => {
    let data: T | null;
    try {
      data = (await response.json()) as T;
    } catch {
      if (signal.aborted) throw signal.reason;
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  });
}

/** DELETE with CSRF. */
export async function deleteCsrf(url: string): Promise<Response> {
  return fetchWithCsrf(url, { method: "DELETE" });
}

/** DELETE with an optional JSON body, keeping body parsing inside the budget. */
export async function deleteJson<T>(
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  return requestJsonWithCsrf<T>("authenticated DELETE", url, {
    method: "DELETE",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export interface SessionInfoResponse {
  session: {
    userId: string | null;
    username: string | null;
    emailVerified: boolean;
    isAnonymous: boolean;
    expiresAt: string;
  } | null;
}

/** Fetch /api/auth/session — never mutates. */
export async function fetchSession(): Promise<SessionInfoResponse> {
  return boundedRequest(
    async (signal) => {
      const r = await fetch("/api/auth/session", {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal,
      });
      if (!r.ok) return { session: null };
      return (await r.json()) as SessionInfoResponse;
    },
    {
      operation: "session check",
      timeoutMs: REQUEST_BUDGET_MS.auth,
      safety: "safe-read",
    },
  );
}

/** Domain-safe copy helper; callers supply anti-enumerating operation copy. */
export function authClientErrorMessage(
  error: unknown,
  options: { readonly timeout: string; readonly fallback: string },
): string {
  return isRequestTimeoutError(error) ? options.timeout : options.fallback;
}
