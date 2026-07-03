# Password-First Auth + Ranked Verification

Date: 2026-07-03
Branch: `ws-auth/password-first-20260703`
Base: `ebfac96` (`origin/main` at lane start)
Risk tier: RED (`auth`, `db migration`, ranked gate behavior)

## Shipped-vs-Target Reconciliation

PR #193 shipped the right substrate: signed sessions, magic-link sign-in with
prefetch-safe consume, optional passwords, `/account`, account-owned runs, and
password set/change/delete-account routes. The owner-facing defect was the
product model: `/sign-in` still presented magic links as the primary path, there
was no first-class sign-up screen, and ranked gating did not distinguish
signed-in-but-unverified accounts.

This lane keeps the #193 substrate and changes the model around it:

- Sign-up is now username + email + password, with signup-time username grammar,
  blocklist, and uniqueness validation.
- Sign-in is now username-or-email + password as the primary form.
- The email-link flow remains as the secondary sign-in path for magic-only
  accounts.
- Forgot password sends a reset-purpose magic link and lands on
  `/account?set_new_password=1`.
- `/account` surfaces identity, username, verification, change password,
  reset-link set-new-password, and delete-account controls.
- Ranked attempt/submit require `users.email_verified_at`; casual play and
  casual/daily posts do not.
- Consuming any magic link sets `email_verified_at`, so magic-link sign-in
  inherently verifies inbox control.

## Migration Evidence

Migration `0011_email_verification` is additive:

- Up: `ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;`
- Down: `ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified_at";`

Ephemeral Neon proof on project `rapid-wind-87431051`:

- Created branch from production (`br-gentle-waterfall-aqocx3wk`, deleted).
- Ran `pnpm --filter @wcdraft/db exec tsx scripts/migrate.ts`.
- Ran `pnpm --filter @wcdraft/db exec tsx scripts/rollback-check.ts`.
- Rollback executed 12 down migrations in reverse, including
  `0011_email_verification.down.sql`.
- Rollback ended with an empty public schema and no drizzle bookkeeping schema.
- The branch delete guard confirmed the target branch was non-primary before
  deletion.

## Test Matrix

Sign-up:

- Valid username/email/password creates a normalized private account, hashes the
  password with argon2id, leaves `email_verified_at` null, sends a verification
  link, and issues a signed session.
- Duplicate email, duplicate username, blocklisted username, and weak password
  are rejected with explicit route/domain errors.

Login:

- Username + password succeeds.
- Email + password succeeds.
- Wrong password, unknown identifier, and passwordless account + password all
  return generic invalid-credentials behavior.
- Existing rate limits still cover the normalized identifier and IP bucket.
- Magic-link sign-in still succeeds and now marks the user verified.

Verification gate:

- Anonymous ranked attempt remains `401 AUTH_REQUIRED`.
- Signed-in unverified ranked attempt/submit returns
  `403 VERIFICATION_REQUIRED` with a resend affordance.
- Verified ranked attempt/submit proceeds through the existing ranked path.
- Casual submissions remain available while unverified.

Reset/change password:

- Password reset request is non-enumerating for unknown valid emails.
- Existing-account reset sends a reset-purpose magic link.
- Unknown reset requests still take the same local token-write/floor path but
  do not send; existing-account sender failures are deferred and still return
  the same generic `202`.
- Fresh magic-link proof can set/change a password without the old password.
- Normal change-password still accepts the current password.
- The reset landing surface hides the current-password field and labels the
  action "Set new password."

Access/privacy:

- Account routes still require signed-in sessions.
- Public payload email sweep covers the new auth routes and remains clean.
- Account email remains private to `/account`; public boards continue to use
  username or per-run alias.

No-core-change proof:

- No `packages/core`, runtime compact data, rating, sim, or ETL files changed.
- Core/data/web golden gates passed.

## Local Gates

- `pnpm --filter @wcdraft/db test`: 3 files, 108 tests passed.
- Focused auth/leaderboard suite:
  `pnpm --filter @wcdraft/web pretest && pnpm --filter @wcdraft/web exec vitest run ...`:
  8 files, 130 tests passed.
- `pnpm typecheck`: 8 tasks passed.
- `pnpm lint`: 5 tasks passed.
- `pnpm test`: 8 tasks passed; core 389, data 101 passed / 9 skipped, db 108,
  marketing 68, web 895 passed / 1 skipped, plus `game-flow-playwright`.
- `pnpm build`: web production build passed with the repo's existing Next
  webpack circular-chunk and edge-runtime static-generation warnings.
- `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`:
  2 tasks passed.
- `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data`:
  3 tasks passed.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`:
  4 tasks passed, 6 tests passed.
- `git diff --check`: clean.

## Browser Proof

Local production `next start` proof used a disposable Neon branch and a seeded
unverified account/session. The branch was deleted after capture.

Pages captured:

- `sign-in`: password-first username/email form, forgot password, secondary
  email-link form.
- `sign-up`: username + email + password.
- `account-verification-change-password`: unverified email banner/resend plus
  normal change-password form.
- `account-reset-set-new-password`: reset landing state with current-password
  field hidden.

Coverage:

- Viewports: 390x844 and 360x800.
- Themes: light and dark.
- Screenshots: 16 PNGs in this directory.
- Axe: 0 violations.
- Browser errors: 0.
- Horizontal overflow: 0.

Machine-readable proof: `browser-proof.json`.

## Risks / Review Focus

- Auth and leaderboard now share a new private `email_verified_at` account
  field; reviewers should focus on route/session consistency and ranked-only
  enforcement.
- Resend verification and reset reuse the magic-link rate limits; reset now
  keeps provider failure out of the observable response path, while sign-up can
  still create an unverified account even if the follow-up email send fails.
- Magic-link sign-in now verifies the email by design. That is intentional
  because the consumed one-time link proves inbox control.
