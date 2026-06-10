# q-004 — accounts activation (email sign-in)

- **Tier:** Red surface, but **Mode: HUMAN-ONLY** — agents must not perform any step.
- **Status:** OPEN — blocked on human-held credentials.

## Spec (for Paulo, not for agents)

Accounts (magic-link email auth) are shipped dark: code paths live since F-3.x, prod has
`AUTH_COOKIE_SECRET` + `DATABASE_URL` set, but the email path is dark because
`RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and `AUTH_BASE_URL` are unset in Vercel prod
(verified 2026-06-10).

Human steps:

1. Create/confirm the Resend API key and verify the sending domain in Resend.
2. Set `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `AUTH_BASE_URL` in Vercel prod (env-add →
   redeploy; watch the env-add/auto-deploy race).
3. Live sanity: request magic link, complete two-step verify, confirm session + claim flow.

## Done-when

A real account can sign in on www.wcdraft.com; STATE.md env table updated (names only).

## Evidence required

Live sanity transcript of the magic-link round-trip (request → two-step verify → session
established → claim flow), plus the updated STATE.md env table in the same change.

## Why HUMAN-ONLY

Credential issuance and domain verification are owner-identity actions; the standing
posture (prod-provisioning lane) records the Resend pair as human-only.
