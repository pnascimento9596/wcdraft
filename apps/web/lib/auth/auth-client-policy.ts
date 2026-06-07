// F-3.6 (ship-dark hardening) — pure client-side policy helpers.
//
// Extracted from `components/auth-context.tsx` so the decision logic can be
// unit-tested without a React renderer. The web package's vitest setup is
// node-only (no jsdom, no @testing-library/react), so any test that depends
// on rendering AuthProvider would need new dev-deps. Keeping the rule pure
// gets us the same coverage with zero new packages.
//
// Contract: the AuthProvider issues a GET /api/auth/session call on mount
// ONLY when the ship-dark gate says auth is live. With the gate dark the
// provider stays silent so the network panel is empty and the server sees
// zero anonymous session probes per page load.

/**
 * Should the AuthProvider issue its mount-time /api/auth/session fetch?
 *
 * Returns true ONLY when the deployment has auth enabled. The gate value
 * comes from /api/auth/config (server-side `isAuthEnabled()`) and is passed
 * to AuthProvider as a prop by the root layout.
 */
export function shouldFetchSessionOnMount(authEnabled: boolean): boolean {
  return authEnabled === true;
}
