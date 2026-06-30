# Accounts and Auth Hub

Date: 2026-06-30  
Branch: `ws-fix/accounts-auth-hub`  
Base: `995b11a70054278ab716a7667486eb91bafcbe6a`  
Risk tier: RED (`users` schema migration, auth/session behavior, account data access, user-facing account UI)

## Outcome

Implemented locally and committed. Fresh independent review passed. Not shipped.

This lane remains RED-tier because merge to `main` deploys production. The attached lane prompt requested autonomous ship, but the checked-in repo contract requires explicit human approval for RED production merge/deploy. This report records the completed build/review evidence and the remaining ship gate honestly.

## What Changed

- Added optional password auth on top of existing magic links.
- Added nullable `users.password_hash` and `users.password_set_at` columns with matching down migration.
- Added Argon2id password hashing via `@node-rs/argon2`, generic password-login failures, per-email/per-IP password rate limits, and a dummy hash path for missing/null hashes.
- Shared authenticated session issuance between magic-link verify and password login.
- Added a short-lived recent-magic proof cookie so password set/change can require either the current password or a fresh magic-link session.
- Added `/account` as the signed-in account hub with identity, password set/change, sign-out, delete account, all saved account runs, server stats, posted-to-leaderboard badges, and honest empty/null states.
- Added `/api/account/runs`, `/api/account/password`, `/api/account`, and `/api/auth/password-login`.
- Extended saved-run summaries with account-history display metadata while preserving anonymous recent-run eviction and retaining all account-owned runs.
- Made `/play/history` the recent-runs shortcut and `/account` the canonical complete server-backed account history.
- Updated the header account affordance: signed-out users get a visible sign-in CTA; signed-in users get an Account menu in desktop and mobile surfaces.

## Design Decisions

- KDF: `argon2id` through `@node-rs/argon2`. Auth routes run in the Vercel Node runtime, and this package gives a supported native Argon2id verifier/hash path without putting password work on an edge runtime.
- Password reset: no separate reset-token system. "Forgot password" sends the existing prefetch-safe magic link with `next=/account`; after that fresh magic-link session, the user can set a new password from `/account`.
- Runs endpoint shape: `GET /api/account/runs?limit=<1..50>&offset=<n>` returns `{ identity, runs, stats, page }` for the caller only. The API does not accept a user id selector.
- History reconciliation: `/account` is canonical for complete server-backed signed-in history. `/play/history` remains a recent-runs shortcut and cross-links to Account for the full set.
- Email privacy: `/account` shows the caller their own email. Session/header APIs and public leaderboard/profile/runs surfaces do not serialize email.

## Validation

- `pnpm install`: PASS.
- `pnpm exec turbo run build --filter=@wcdraft/core --filter=@wcdraft/data --filter=@wcdraft/db`: PASS, 3/3 tasks.
- `pnpm --filter @wcdraft/db test -- test/schema-shapes.test.ts test/migrations.golden.test.ts`: PASS, 3 files, 106 tests.
- `pnpm --filter @wcdraft/web exec vitest run lib/auth/__tests__/passwords.test.ts lib/auth/__tests__/recent-magic.test.ts lib/game/__tests__/account-runs.test.ts lib/game/__tests__/saved-runs-store.test.ts`: PASS, 4 files, 30 tests.
- `pnpm --filter @wcdraft/web exec vitest run lib/leaderboard/__tests__/public-payload-email-sweep.test.ts lib/auth/__tests__/passwords.test.ts lib/game/__tests__/account-runs.test.ts`: PASS, 3 files, 6 tests.
- `pnpm --filter @wcdraft/web lint`: PASS.
- `pnpm --filter @wcdraft/db lint`: PASS.
- `pnpm --filter @wcdraft/web typecheck`: PASS.
- `pnpm --filter @wcdraft/db typecheck`: PASS.
- `pnpm --filter @wcdraft/web test`: PASS, 76 files passed / 1 skipped; 800 tests passed / 1 skipped; `game-flow-playwright: ok`.
- `pnpm --filter @wcdraft/db test`: PASS, 3 files, 106 tests.
- Neon temporary branch migration proof on project `rapid-wind-87431051`, branch `br-twilight-glade-aqwxg369`: PASS.
  - Inserted a pre-existing magic-link-style user before the migration.
  - Applied `0010_account_password.sql`.
  - Verified `password_hash` and `password_set_at` exist and are nullable.
  - Verified the pre-existing user retained `NULL` password fields.
  - Applied `0010_account_password.down.sql`.
  - Verified both password columns were removed.
  - Deleted the temporary branch.
- `pnpm typecheck`: PASS, 8/8 tasks.
- `pnpm lint`: PASS, 5/5 tasks.
- `pnpm test`: PASS, 8/8 tasks; notable counts: core 23/383, db 3/106, data 11 passed + 1 skipped / 84 passed + 7 skipped, marketing 8/67, web 76 passed + 1 skipped / 800 passed + 1 skipped, plus `game-flow-playwright: ok`.
- `pnpm build`: PASS, 4/4 tasks. Next emitted webpack circular-chunk warnings and the edge-runtime static-generation warning, but exited 0.
- `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`: PASS, 2 tasks; golden counts 68 + 42 tests.
- `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data`: PASS, 3 tasks; integration 22 tests, compact data/integrity 31 tests.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`: PASS, 4 tasks; 6 tests.
- No-core-change proof:
  - `git diff/status` showed no changes under `packages/core`, `packages/data`, token, sim, engine, codec, or leaderboard validation paths.
  - Only the DB migration golden test changed; no deterministic game golden fixture changed.
- Local browser UI check through `webapp-testing` helper and Playwright:
  - `/sign-in` dual form at 390x844 and 360x800: PASS.
  - Signed-in mobile header account menu at 390x844 and 360x800: PASS.
  - axe-core: 0 violations on checked pages/states.
  - New auth controls checked for 44px tap targets.
  - Screenshots stored locally at `/tmp/wcdraft-auth-ui/`.
- `git diff --check`: PASS.
- `git status --short`: clean after implementation commit.

## Fresh Review

Independent reviewer `019f19a3-0d50-71a1-8201-213ada8dab96` cloned into `/private/tmp/wcdraft-accounts-auth-review-Y6jQd4` and reported PASS for commit `5803d8830ce1b15110a21516ea0ddb044aa277e2`.

Reviewer gates included:

- Fresh clone plus `pnpm install --frozen-lockfile`.
- Dependency package builds for core/data/db.
- No-diff proof under `packages/core`, `packages/data`, and `etl`.
- Focused web auth/account/privacy tests: 7 files, 67 tests.
- DB migration/schema/runtime subset: 3 files, 106 tests.
- Web/db lint and typecheck.
- Full web Vitest: 76 files passed / 1 skipped; 800 tests passed / 1 skipped.
- DB package test script: 3 files, 106 tests.
- Web production build.
- `git diff --check`.

Reviewer not-run items:

- Reviewer did not run Neon branch proof because that subagent environment did not expose Neon env vars. The main agent completed the Neon temporary-branch proof listed above through the Neon connector.
- Reviewer did not run the full root sequence or all goldens as one command; the main agent completed those gates listed above.

## Carryovers

- No PR merge, production deploy, or live wcdraft.com verification has been performed.
- RED-tier production merge/deploy requires explicit human approval under the checked-in repo contract.
- Live checks still required after approved merge/deploy: `/sign-in`, `/account` redirect and signed-in render, magic-link-only flow, password set/login/delete with a throwaway account, `/api/runs` anon 401, `/api/account/runs` auth scoping, and public leaderboard email sweep.
