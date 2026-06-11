/**
 * Build identifier surfaced in the hamburger-menu footer so a real device can
 * always be checked against the deploy it should be serving (the SW is
 * cache-first — without this there is no way to tell a stale build apart).
 *
 * Resolved at build time: `VERCEL_GIT_COMMIT_SHA` is a Vercel system env var
 * present during `next build` (declared in root turbo.json build env — strict
 * env strips undeclared vars). The date is captured at server-module eval,
 * which for the statically-rendered root layout is the build itself.
 * Honest-state: when the env var is absent (local dev), render "dev" — never
 * a fabricated SHA.
 */
const BUILT_AT = new Date().toISOString().slice(0, 10);

export function getBuildStamp(env: Record<string, string | undefined> = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return sha ? `${sha.slice(0, 7)} · ${BUILT_AT}` : "dev";
}
