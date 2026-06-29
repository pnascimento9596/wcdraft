# Leaderboard Season + Ranked Attempts - 2026-06-29

Branch: `ws-leaderboard/season-attempts-20260629`
Base: `origin/main` `acc0a82f4b768f7938e2cd4d116109d15d8809ce`
Risk: RED - leaderboard contract, migrations, ranked submit pipeline.

## Summary

This lane closes three leaderboard gaps:

- Submit response honesty: `field_size` now stays `null` when the route has no
  rank context instead of fabricating `0`.
- Aggregate Casual/Ranked season semantics: active season writes now use the
  explicit id `season-2026-summer` (`WCDRAFT_LEADERBOARD_SEASON_ID` may override)
  instead of the six-anchor version-hash key. Existing hash-key seasons remain
  readable archives.
- Ranked anti-grind: ranked draft creation now requests a server-issued,
  short-window parent seed from `POST /api/ranked/attempt`; ranked submit must
  consume a matching unexpired attempt bound to user, season, formation, and
  full board config, and persists `attempt_id`.

Daily is intentionally unchanged: it remains public casual best-of-many by UTC
date and never requires a ranked attempt.

## Season Contract

`apps/web/lib/leaderboard/season.ts` now treats six-anchor hash keys as archive
helpers only. New aggregate season submissions stamp:

- `season_key = season-2026-summer` by default.
- `rating_version = token.rv` on every accepted leaderboard row.

The submit-time six-anchor check is still enforced before replay/re-sim. That
check is runtime compatibility, not the aggregate season partition. The
leaderboard header surfaces the cross-version honesty note:

> Ratings can update during a season; entries are stamped at submit time.

## Ranked Attempt Flow

`POST /api/ranked/attempt` is account + CSRF gated and returns:

- `attempt_id`
- server-issued `parent_seed`
- `expires_at`
- active `season_key`
- formation + board config

The local ranked draft-creation hook passes that parent seed into
`createNewRunRecord` and stores local `ranked_attempt` metadata. Submit does not
trust that metadata; it replays the token, derives config from the token, then
inside one DB transaction:

1. Allows an exact duplicate retry only when a ranked row with non-null
   `attempt_id` already exists for that user/token/config.
2. Consumes one unexpired `ranked_attempts` row matching user, explicit season,
   formation, config, and token parent seed.
3. Inserts the accepted ranked entry with that `attempt_id`.

Casual and Daily inserts pass `attempt_id = null`.

## Migration Evidence

Migration `0009_ranked_attempt_binding`:

- Adds `season_key`, `formation_id`, `draft_mode`, `draft_order`, `era`, and
  `rating_basis` to `ranked_attempts`, with backfill for any pre-existing
  attempts.
- Adds attempt lookup indexes.
- Adds `leaderboard_entries_attempt_idx`.
- Adds unique non-null attempt enforcement for ranked rows.
- Adds `leaderboard_entries_ranked_attempt_chk` as `NOT VALID` in the migration
  so historical ranked rows with null `attempt_id` remain preserved/readable
  while new writes are constrained.

Ephemeral Neon gate:

- `gh secret list --repo pnascimento9596/wcdraft`: required secret names present
  for `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_API_KEY`, and
  `NEON_PROJECT_ID` (names only; values were not printed).
- Created disposable Neon branch from production parent; generated env file mode
  `0600`.
- `pnpm --filter @wcdraft/db db:migrate`: PASS.
- `pnpm --filter @wcdraft/db db:migrate:status`: PASS,
  `applied=10 pending=0 total=10`, including `0009_ranked_attempt_binding`.
- `pnpm --filter @wcdraft/db db:rollback-check`: PASS. The script confirmed the
  target branch was non-primary, applied migrations, checked DB constraints,
  ran all 10 down migrations in reverse, and asserted the public schema empty.
- `pnpm --filter @wcdraft/db db:branch:delete`: PASS. Disposable branch deleted.
- Removed the generated `/tmp` env file after branch deletion.

No database URLs or token values were printed or committed.

## Validation

Focused gates:

- `pnpm --filter @wcdraft/db test -- migrations.golden.test.ts pglite-runtime.test.ts schema-shapes.test.ts`:
  PASS, 3 files, 104 tests.
- `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-record.test.ts lib/leaderboard/__tests__/ranked-attempt-route.test.ts lib/leaderboard/__tests__/submit-route.test.ts lib/leaderboard/__tests__/board-route.test.ts lib/leaderboard/__tests__/claim.test.ts lib/leaderboard/__tests__/privacy-serializer.test.ts lib/leaderboard/__tests__/public-payload-email-sweep.test.ts lib/leaderboard/__tests__/validate.golden.test.ts lib/leaderboard/__tests__/validate.test.ts`:
  PASS, 9 files, 149 tests.

Fresh-context independent reviewer:

- Separate clone: `/tmp/wcdraft-leaderboard-review-bI1pIo`.
- Verdict: PASS, no blocker or warning findings.
- Reviewer re-executed:
  - `pnpm --filter @wcdraft/db test -- migrations.golden.test.ts pglite-runtime.test.ts schema-shapes.test.ts`:
    PASS, 3 files / 104 tests.
  - `pnpm --filter @wcdraft/web exec vitest run lib/game/__tests__/run-record.test.ts lib/leaderboard/__tests__/ranked-attempt-route.test.ts lib/leaderboard/__tests__/submit-route.test.ts lib/leaderboard/__tests__/board-route.test.ts lib/leaderboard/__tests__/claim.test.ts lib/leaderboard/__tests__/privacy-serializer.test.ts lib/leaderboard/__tests__/public-payload-email-sweep.test.ts lib/leaderboard/__tests__/validate.golden.test.ts lib/leaderboard/__tests__/validate.test.ts`:
    PASS, 9 files / 149 tests after the clean clone ran package build/pretest
    setup required for workspace package exports and public runtime data.
  - `git diff --check`: PASS.

Root gates:

- `pnpm typecheck`: PASS, 8/8 Turbo tasks.
- `pnpm lint`: PASS, 5/5 Turbo tasks.
- `pnpm test`: PASS, 8/8 Turbo tasks. Web re-executed: 71 files passed / 1
  skipped, 773 tests passed / 1 skipped, plus `game-flow-playwright: ok`. DB:
  3 files / 104 tests. Core: 23 files / 381 tests. Data: 11 files passed / 1
  skipped, 84 tests passed / 7 skipped. Marketing: 8 files / 67 tests.
- `pnpm build`: PASS, 4/4 Turbo tasks. Next emitted the pre-existing warning
  classes for circular chunks and edge-runtime static generation.

Golden gates:

- `pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core`:
  PASS, 2 files / 68 tests and 5 files / 40 tests.
- `pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data`:
  PASS, 2 files / 31 tests and 2 files / 22 tests.
- `pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web`: PASS,
  1 file / 6 tests. The fixture now pins `season-2026-summer`.

Regression coverage added:

- Ranked attempt issuance requires account + CSRF and persists a seed bound to
  season/config.
- Ranked submit without an issued attempt rejects `BAD_ATTEMPT`.
- Ranked submit with a mismatched issued seed rejects `BAD_ATTEMPT` and leaves
  the issued attempt unconsumed.
- Ranked submit success consumes the attempt and stores `attempt_id`.
- Duplicate ranked retry returns the existing row without consuming a second
  attempt.
- Anonymous ranked still rejects.
- Daily anonymous best-of-many still accepts and ranks.
- Hidden duplicate submit returns honest `rank = null`, `percentile = null`,
  and `field_size = null`.

## Risks / Review Focus

- Production migrations are explicit; Vercel deploy does not run them. Apply
  pending production migration `0009` after deploy readiness and before live
  ranked-attempt verification.
- The migration intentionally preserves historical ranked rows with null
  `attempt_id` by using a `NOT VALID` check for the new ranked-attempt
  invariant. New app writes and fresh databases enforce non-null attempts.
- The active explicit season id defaults in code. Production may set
  `WCDRAFT_LEADERBOARD_SEASON_ID=season-2026-summer`; if absent, the code
  default is the same value. `turbo.json` now includes that env var in build
  and test cache keys.
- Existing archived hash-key season rows, including the real anonymous casual
  "wow" row, are not deleted by this migration. Final proof still requires
  production readback after merge/migration.

## Ship Checklist

Pending at PR/merge time:

- Squash-merge pinned head to `main`.
- Wait for production Vercel deploy READY.
- Apply production DB migration explicitly.
- Live-verify on `https://www.wcdraft.com`:
  - Data anchors unchanged.
  - Active aggregate season id is `season-2026-summer`.
  - Prior hash-key season remains readable/archive-only.
  - Anonymous casual "wow" row is preserved.
  - Ranked submit with no issued attempt rejects.
  - Anonymous ranked rejects.
  - Daily anonymous best-of-many still accepts.
  - Boardless rank context returns `field_size: null`, not `0`.
