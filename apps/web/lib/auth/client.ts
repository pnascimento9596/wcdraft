// F-3.5 — auth client helpers (browser-only).
//
// Wraps the CSRF bootstrap + double-submit dance so the rest of the app
// can do `await postWithCsrf("/api/runs", {...})` and not duplicate the
// cookie-read/header-set boilerplate at every call site. Reads the csrf
// token from the non-httpOnly `wcdraft_csrf` cookie set by F-2's
// /api/auth/csrf endpoint; falls back to bootstrapping the cookie when
// missing.
//
// Server-side only — DO NOT import from a Server Component.

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
export async function ensureCsrfToken(): Promise<string> {
  const existing = readCsrfCookie();
  if (existing && existing.length > 0) return existing;
  const r = await fetch("/api/auth/csrf", {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) {
    throw new Error(`auth-client: /api/auth/csrf returned HTTP ${r.status.toString()}`);
  }
  const data = (await r.json()) as { csrfToken?: string };
  if (!data.csrfToken) throw new Error("auth-client: csrf token missing in response");
  return data.csrfToken;
}

export interface FetchWithCsrfInit {
  readonly method: "POST" | "DELETE" | "PUT" | "PATCH";
  readonly headers?: Record<string, string>;
  readonly body?: BodyInit | null;
}

/**
 * Mutating fetch: ensures CSRF + Origin/Host headers + same-origin
 * credentials. Throws on transport failure; returns the Response for
 * callers to inspect status/body.
 */
export async function fetchWithCsrf(url: string, init: FetchWithCsrfInit): Promise<Response> {
  const csrf = await ensureCsrfToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers ?? {}),
    [CSRF_HEADER]: csrf,
  };
  return fetch(url, {
    method: init.method,
    credentials: "include",
    headers,
    body: init.body ?? undefined,
  });
}

/** POST with a JSON body (sets Content-Type) + CSRF. */
export async function postJson<T>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const r = await fetchWithCsrf(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: T | null;
  try {
    data = (await r.json()) as T;
  } catch {
    data = null;
  }
  return { ok: r.ok, status: r.status, data };
}

/** PUT with a JSON body (sets Content-Type) + CSRF. */
export async function putJson<T>(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const r = await fetchWithCsrf(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: T | null;
  try {
    data = (await r.json()) as T;
  } catch {
    data = null;
  }
  return { ok: r.ok, status: r.status, data };
}

/** DELETE with CSRF. */
export async function deleteCsrf(url: string): Promise<Response> {
  return fetchWithCsrf(url, { method: "DELETE" });
}

export interface SessionInfoResponse {
  session: {
    userId: string | null;
    username: string | null;
    isAnonymous: boolean;
    expiresAt: string;
  } | null;
}

/** Fetch /api/auth/session — never mutates. */
export async function fetchSession(): Promise<SessionInfoResponse> {
  const r = await fetch("/api/auth/session", {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!r.ok) return { session: null };
  return (await r.json()) as SessionInfoResponse;
}
