"use client";

// F-3.5 — account-menu (header slot).
//
// Three states, controlled by the AuthContext:
//   1. authEnabled === false  → nothing (ship-dark gate).
//   2. signed out             → "Sign in" CTA → /sign-in.
//   3. signed in              → button + popover with identity + sign-out.
//
// Sign-out → DELETE /api/auth/session (CSRF via the F-2 helpers). On
// success, refresh() the AuthContext + push to /.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-context";
import { deleteCsrf } from "@/lib/auth/client";

export function AccountMenu(): React.ReactElement | null {
  const { authEnabled, isSignedIn, session, ready, refresh } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await deleteCsrf("/api/auth/session");
    } catch {
      /* honest-state — best-effort; refresh below will re-read */
    }
    await refresh();
    setSigningOut(false);
    setOpen(false);
    router.push("/");
    router.refresh();
  }, [refresh, router]);

  if (!authEnabled) return null;

  if (!isSignedIn) {
    return (
      <Link href="/sign-in" className="signin-stub signin-stub--live" aria-label="Sign in">
        <span className="signin-stub__dot" aria-hidden="true" />
        Sign in
      </Link>
    );
  }

  // Skeleton — render while we haven't loaded yet so layout doesn't shift.
  if (!ready) {
    return <span className="account-chip account-chip--loading" aria-hidden="true" />;
  }

  const identity = session?.userId ? shortenId(session.userId) : "me";
  return (
    <div ref={wrapRef} className="account-menu" data-open={open || undefined}>
      <button
        type="button"
        className="account-chip"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="account-chip__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
            <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4.5 20c1.5-3.5 4.4-5 7.5-5s6 1.5 7.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
        <span className="account-chip__label">Account</span>
      </button>

      {open ? (
        <div className="account-pop" role="menu" aria-label="Account menu">
          <div className="account-pop__row account-pop__row--id">
            <span className="account-pop__eyebrow">signed in as</span>
            <span className="account-pop__id mono">{identity}</span>
          </div>
          <Link href="/play/history" role="menuitem" className="account-pop__link" onClick={() => setOpen(false)}>
            View history
          </Link>
          <Link href="/settings" role="menuitem" className="account-pop__link" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className="account-pop__signout"
            onClick={signOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function shortenId(id: string): string {
  // user_id is a uuid; show first/last 4 chars so the user can identify
  // their session at a glance without us trying to fake an email or name.
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}
