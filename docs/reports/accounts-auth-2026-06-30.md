# Accounts and Auth Hub

Date: 2026-06-30
Branch: `ws-fix/accounts-auth-hub`
Original PR base: `995b11a70054278ab716a7667486eb91bafcbe6a`
Rebased onto: `origin/main` `11ef02afd754c553533858d3efd61f2ed7554b85`
Risk tier: RED (`users` schema migration, auth/session behavior, account data access, user-facing account UI)

## Outcome

Rebased implementation and local RED validation are complete on the PR branch. The branch now also reconciles the checked-in RED contract to the owner v5 model: autonomous ship after implementer/reviewer separation, gate re-execution, SHA-pinned merge, deploy observation, live verification, and auto-revert on any failed live check.

No production merge or live production verification is recorded in this pre-merge report. Those checks are post-merge closeout gates because `main` deploys directly to production.

## Contract Reconciliation

The prior checked-in RED contract included a human-gate step between
fresh-context review and SHA-pinned merge. That step was removed from the
current contract in favor of implementer/reviewer separation, machine gates,
SHA pinning, deploy observation, live verification, and auto-revert.

Reconciled wording:

> fresh-SESSION independent reviewer who RE-EXECUTES the gates (a sub-agent diff read does NOT qualify) -> fix-forward to PASS -> squash pinned via `gh pr merge --squash --match-head-commit <sha>` -> deploy -> live-verify on `www.wcdraft.com` -> auto-revert on any failed live check

Reconciled SHA-pinning paragraph:

> Fix-forward -> re-review loops on Red are normal, not a failure. Review PASS is SHA-pinned: any commit pushed after review voids it - re-verify, re-pin. There is no human approval gate at any tier. Safety comes from implementer/reviewer separation, machine-adjudicated gates, SHA-pinned merge, deploy observation, and live-verify-with-auto-revert.

Also updated current `STATE.md`, `docs/queue/q-002-mv2-12-candidate.md`, `docs/queue/q-006-draft-config.md`, `docs/plans/draft-config-2026-06-10.md`, and `docs/plans/merit-v3-design-2026-06-11.md` so active queue/plan surfaces no longer encode a RED human-approval gate.

## What Changed

- Added optional password auth on top of existing magic links.
- Added nullable `users.password_hash` and `users.password_set_at` columns with matching down migration.
- Added Argon2id password hashing via `@node-rs/argon2`, generic password-login failures, per-email/per-IP password rate limits, and a dummy hash path for missing/null hashes.
- Shared authenticated session issuance between magic-link verify and password login.
- Added a short-lived recent-magic proof cookie so password set/change can require either the current password or a fresh magic-link session.
- Added `/account` as the signed-in account hub with identity, password set/change, sign-out, delete account, all saved account runs, server stats, posted-to-leaderboard badges, and honest empty/null states.
- Added `/api/account/runs`, `/api/account/password`, `/api/account`, and `/api/auth/password-login`.
- Aligned anonymous account API access to 401 `SESSION_INVALID` instead of 403 `ANON_FORBIDDEN`.
- Extended saved-run summaries with account-history display metadata while preserving anonymous recent-run eviction and retaining all account-owned runs.
- Added a deterministic clock seam to account-run stats reads so `todayBest` tests do not depend on the wall-clock date while production keeps the current UTC-day default.
- Made `/play/history` the recent-runs shortcut and `/account` the canonical complete server-backed account history.
- Updated the header account affordance: signed-out users get a visible sign-in CTA; signed-in users get an Account menu in desktop and mobile surfaces.
- Fixed the mobile `/sign-in` form rows so the email/password inputs and action buttons stack at narrow widths instead of clipping horizontally.

## Rebase Notes

- Rebase onto `origin/main` `11ef02afd754c553533858d3efd61f2ed7554b85` completed without conflicts.
- Migration numbering remains valid: `0010_account_password.sql` follows `0009_ranked_attempt_binding.sql` and is additive/nullable.
- Header conflict watch-point was clean; the account menu changes coexist with the current `SiteHeader`.
- OG/leaderboard adjacency was clean: no `/api/og/*`, `run-og-server`, `packages/core`, `packages/data`, token codec, sim, engine, or leaderboard-validation files changed.

## Validation

- `pnpm install --frozen-lockfile`: PASS.
- Dependency builds for fresh clone package exports:
  - `pnpm --filter @wcdraft/core build`: PASS.
  - `pnpm --filter @wcdraft/db build`: PASS.
  - `pnpm --filter @wcdraft/data build`: PASS.
- Focused DB/auth/account tests:
  - `pnpm --filter @wcdraft/db test`: PASS, 3 files / 106 tests.
  - `pnpm --filter @wcdraft/web exec vitest run lib/auth/__tests__/account-routes.test.ts lib/auth/__tests__/passwords.test.ts lib/auth/__tests__/recent-magic.test.ts lib/game/__tests__/account-runs.test.ts lib/game/__tests__/saved-runs-store.test.ts lib/leaderboard/__tests__/public-payload-email-sweep.test.ts`: PASS, 6 files / 35 tests.
- Ephemeral Neon branch on project `rapid-wind-87431051`: PASS.
  - Created disposable branch from production.
  - Confirmed `password_hash` did not exist before migration.
  - Inserted a throwaway pre-migration magic-link-only user.
  - Ran `pnpm --filter @wcdraft/db db:migrate`.
  - Verified the pre-existing user still had `password_hash IS NULL`.
  - Completed magic-link request -> token consume -> authenticated session issuance for that same user with `next=/account`.
  - Ran `pnpm --filter @wcdraft/db db:rollback-check`: PASS, 11 down migrations, empty public schema.
  - Deleted the disposable Neon branch.
- Root gates:
  - `pnpm typecheck`: PASS, 8/8 Turbo tasks.
  - `pnpm lint`: PASS, 5/5 Turbo tasks.
  - `pnpm test`: PASS, 8/8 Turbo tasks. Counts: core 23 files / 384 tests; db 3 files / 106 tests; data 11 files passed + 1 skipped / 84 passed + 7 skipped; marketing 8 files / 67 tests; web 79 files passed + 1 skipped / 831 passed + 1 skipped; `game-flow-playwright: ok`.
  - `pnpm build`: PASS, 4/4 Turbo tasks. Next emitted the existing circular chunk warnings and edge-runtime static-generation warning, then exited 0.
- Explicit goldens:
  - `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`: PASS, 2 tasks; 2 files / 68 tests and 5 files / 42 tests.
  - `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data`: PASS, 3 tasks; data golden/integrity 2 files / 31 tests; integration 2 files / 22 tests.
  - `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`: PASS, 4 tasks; 1 file / 6 tests.
- UI/browser proof through Playwright against `next start`:
  - `/sign-in` dual magic-link/password form at 390x844 and 360x800: PASS.
  - Signed-in mobile header drawer/account menu at 390x844 and 360x800: PASS.
  - axe-core 4.10.2: 0 violations on checked states.
  - 44px auth controls: PASS.
  - `/account` destructive action contrast: PASS, 5.11:1 light / 6.19:1 dark using existing `--loss`/`--bg` tokens.
  - Screenshots and JSON summary: `/tmp/wcdraft-auth-ui/`.
- No-core-change proof:
  - Diff contains no changes under `packages/core`, `packages/data`, `etl`, token codec, sim, engine, OG route/server, or leaderboard-validation paths.
  - Only DB migration tests changed; no deterministic game golden fixture changed.

## Remaining Ship Closeout

Before merge, a fresh-context reviewer must re-execute the requested gates on the final pushed head and the squash merge must use `--match-head-commit`.

After merge/deploy, live production checks still required:

- `/account` anonymous redirect to `/sign-in`.
- Throwaway signed-in `/account` render with runs/stats/account management.
- `/sign-in` 200 with magic-link and password paths present.
- Forgot-password magic link sends and lands in an authenticated `/account` session.
- Existing magic-link-only login completes end-to-end.
- Password set -> login -> delete-account works with a throwaway account and leaves no residue.
- `/api/runs` anonymous request returns 401.
- `/api/account/runs` returns only caller-owned runs.
- Header shows discoverable signed-in/signed-out account affordance.
- No email on public surfaces: leaderboard, session/header, or public payloads.
