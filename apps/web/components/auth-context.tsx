"use client";

// F-3.5 — auth context. The root layout (Server Component) computes
// `authEnabled` from process.env via `isAuthEnabled()` and passes it as a
// prop into this provider so client components read it without an extra
// API roundtrip. The provider also tracks the live session (set by the
// header's mount-time GET /api/auth/session call) and exposes
// `refresh()` so post-sign-in/post-sign-out flows can re-read.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchSession, type SessionInfoResponse } from "@/lib/auth/client";
import { isRequestTimeoutError } from "@wcdraft/data/client";
import { shouldFetchSessionOnMount } from "@/lib/auth/auth-client-policy";

export interface AuthState {
  /** Ship-dark gate — surface sign-in UI only when true. */
  readonly authEnabled: boolean;
  /** Resolved session — null until the first fetch completes. */
  readonly session: SessionInfoResponse["session"];
  /** True once the first /api/auth/session call has resolved. */
  readonly ready: boolean;
  /** Honest session-read failure; timeout is separately actionable. */
  readonly sessionError: "timeout" | "unavailable" | null;
  /** True when signed in (session present AND not anonymous). */
  readonly isSignedIn: boolean;
  /** Refresh the session from the server (call after sign-in/sign-out). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({
  children,
  authEnabled,
}: {
  readonly children: React.ReactNode;
  readonly authEnabled: boolean;
}): React.ReactElement {
  const [session, setSession] = useState<SessionInfoResponse["session"]>(null);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState<AuthState["sessionError"]>(null);

  const refresh = useCallback(async () => {
    setReady(false);
    setSessionError(null);
    try {
      const r = await fetchSession();
      setSession(r.session);
    } catch (error) {
      // Honest-state: a network error means we don't actually know — leave
      // `session` unchanged. The next call will retry.
      setSessionError(isRequestTimeoutError(error) ? "timeout" : "unavailable");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    // F-3.6 ship-dark hardening — do NOT call /api/auth/session when auth
    // is disabled. The flag comes from /api/auth/config (root layout prop),
    // so we already know the answer client-side and a zero-call ship-dark
    // is the honest surface. Mark ready so consumers don't hang on the
    // first paint.
    if (!shouldFetchSessionOnMount(authEnabled)) {
      setReady(true);
      return;
    }
    void refresh();
  }, [authEnabled, refresh]);

  const value = useMemo<AuthState>(
    () => ({
      authEnabled,
      session,
      ready,
      sessionError,
      isSignedIn: session !== null && session.userId !== null,
      refresh,
    }),
    [authEnabled, session, ready, sessionError, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(AuthContext);
  if (!v) {
    // Render path without provider — return a sane default so a misplaced
    // import doesn't crash the page.
    return {
      authEnabled: false,
      session: null,
      ready: false,
      sessionError: null,
      isSignedIn: false,
      refresh: async () => {
        /* noop */
      },
    };
  }
  return v;
}
