// F-3.5 — ship-dark gate for the auth feature.
//
// Auth is only "enabled" when a real email sender is configured: both
// RESEND_API_KEY and AUTH_EMAIL_FROM must be present (and non-empty). In
// production without these, the sign-in UI is HIDDEN — there's no broken
// flow exposed to a user who'd then never receive a magic link.
//
// Setting RESEND_API_KEY + AUTH_EMAIL_FROM in the Vercel project env
// flips the gate. Build/test runs without them use the LogEmailSender
// (which would still authenticate the in-test code paths) but the UI
// stays dark in prod.
//
// This file is server-only — it reads process.env directly. The flag is
// exposed to the client either via the root layout passing it as a prop
// (the canonical path) or via the dedicated /api/auth/config GET endpoint
// (the runtime read).

/**
 * True when the deployment can actually send sign-in emails. Pure read of
 * process.env; never throws.
 *
 * - `RESEND_API_KEY` — the Resend API key. The placeholder/empty/whitespace
 *   string counts as unset (defence against a half-configured deploy).
 * - `AUTH_EMAIL_FROM` — the verified from-address. Same treatment.
 *
 * NEVER returns `true` when either is missing or blank.
 */
export function isAuthEnabled(): boolean {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromAddress = (process.env.AUTH_EMAIL_FROM ?? "").trim();
  if (!apiKey || !fromAddress) return false;
  return true;
}

/**
 * Stable shape consumed by the client. Keep it minimal — no secret data,
 * no env var values, just the gate state. Future flags (e.g. F-4
 * leaderboard rollout) can extend this.
 */
export interface AuthConfig {
  readonly authEnabled: boolean;
}

export function getAuthConfig(): AuthConfig {
  return { authEnabled: isAuthEnabled() };
}
