# Daily Draft Implementation Report - 2026-06-29

Outcome: local RED implementation is complete in the working tree, but it is not shipped.

Branch: `ws-f4/daily-draft-20260629`
Base and HEAD during local validation: `797fefa8a68edb0449f46199917e4d4b0e83d4d6`
Fresh reviewer report: `docs/reports/daily-draft-fresh-review-2026-06-29.md`

## What Changed

- Added a UTC Daily Draft seed contract: `deriveDailySeed(date)` returns
  `wcdraft:daily:v1:<YYYY-MM-DD>` after strict UTC date validation.
- Added canonical Daily Draft config: Classic, Squad First, All-time, Career,
  `4-3-3`, team name `Daily XI`.
- Routed `/play/daily` through the shared daily parent seed so the per-device
  first-draft nonce does not apply to Daily Draft.
- Extended run-token v2 metadata with daily challenge date/seed fields and
  preserved that metadata when loading token-backed virtual records.
- Added daily replay validation: token challenge metadata must match the
  submitted date, token parent seed must match the date-derived seed, and the
  token config must match the canonical Daily Draft config including formation.
- Added public casual daily leaderboard reads and writes, rank/percentile
  response fields, and best-of-many per visible identity/day/config.
- Added migration `0008_leaderboard_daily_challenge` with `challenge_type`,
  `challenge_date`, `rating_version`, daily indexes, season-only token dedupe,
  daily identity uniqueness, and DB-level daily-casual enforcement.
- Decoupled the active aggregate season id from runtime/rating version hashes
  via `WCDRAFT_LEADERBOARD_SEASON_ID` with a pinned default.
- Stamped accepted leaderboard rows with token `rating_version`.
- Updated Daily Draft share/caption routing so daily token recipients land on
  the same dated daily draft.
- Updated docs and `STATE.md` to reflect the local RED lane and explicit season
  id semantics.

## Migration Evidence

Local PGlite coverage was added and passed:

- Applying `0008` preserves an existing anonymous casual row with alias `wow`,
  score `35`, `challenge_type = 'season'`, and `challenge_date = NULL`.
- Daily rows can share the same token across different anonymous sessions.
- Direct `challenge_type = 'daily'` plus `mode = 'ranked'` inserts are rejected
  by `leaderboard_entries_daily_mode_chk`, even when `user_id` is present.
- Rolling back `0008` after two valid same-token daily rows succeeds by deleting
  daily rows before restoring the pre-daily `leaderboard_entries_dedupe_uq`
  constraint; the season survivor row remains.

Neon apply/rollback was not run. The required credentials were absent in this
shell:

```text
NEON_API_KEY=
NEON_PROJECT_ID=
DATABASE_URL=
DATABASE_URL_UNPOOLED=
NEON_EPHEMERAL_BRANCH_ID=
```

PGlite proves the migration shape locally, but it does not replace the required
ephemeral Neon RED gate.

## Validation

Focused post-fix web gate:

```text
pnpm --dir apps/web exec vitest run lib/game/__tests__/run-record.test.ts lib/game/__tests__/run-token-v2.test.ts lib/game/__tests__/share-adapters-intent.test.ts lib/leaderboard/__tests__/validate.test.ts lib/leaderboard/__tests__/validate.golden.test.ts lib/leaderboard/__tests__/submit-route.test.ts lib/leaderboard/__tests__/board-route.test.ts lib/leaderboard/__tests__/claim.test.ts lib/leaderboard/__tests__/claim-tx-seam.test.ts
```

Result: 9 files passed, 182 tests passed.

Focused post-fix DB gate:

```text
pnpm --filter @wcdraft/db test -- migrations.golden.test.ts pglite-runtime.test.ts schema-shapes.test.ts
```

Result: 3 files passed, 99 tests passed.

Root gate:

```text
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Results:

- `pnpm typecheck`: 8 tasks successful.
- `pnpm lint`: 5 tasks successful.
- `pnpm test`: 8 tasks successful.
  - `@wcdraft/core`: 23 files passed, 381 tests passed.
  - `@wcdraft/data`: 11 files passed / 1 skipped, 84 tests passed / 7 skipped.
  - `@wcdraft/db`: 3 files passed, 99 tests passed.
  - `@wcdraft/marketing-x`: 8 files passed, 67 tests passed.
  - `@wcdraft/web`: 70 files passed / 1 skipped, 766 tests passed / 1 skipped.
  - `game-flow-playwright`: ok for draft setup, position-first target,
    lock-pick, manager guard, review simulate, results, and share.
- `pnpm build`: 4 tasks successful. Next.js build completed with existing-style
  warnings for circular chunk dependencies and Edge runtime disabling static
  generation for affected pages.

Explicit golden gates:

```text
pnpm exec turbo run test:golden test:golden:draft --filter=@wcdraft/core
pnpm exec turbo run test:golden:data test:golden:integration --filter=@wcdraft/data
pnpm exec turbo run test:golden:leaderboard --filter=@wcdraft/web
```

Results:

- Core `test:golden`: 2 files passed, 68 tests passed.
- Core `test:golden:draft`: 5 files passed, 40 tests passed.
- Data `test:golden:integration`: 2 files passed, 22 tests passed.
- Data `test:golden:data`: 2 files passed, 31 tests passed.
- Web `test:golden:leaderboard`: 1 file passed, 6 tests passed.

Other checks:

- `git diff --check`: passed.
- Fresh-context RED review: no blockers found; focused web and DB gates rerun
  by reviewer and passed with 9 files / 182 tests and 3 files / 99 tests.

## Anti-Cheat And Negative Coverage

- Two daily runs for the same UTC date use the same `parent_seed` and produce
  identical draft draw pairs.
- Ordinary non-daily first drafts still use per-device nonce behavior and
  produce distinct first draws.
- Daily token metadata round-trips into token-loaded virtual records.
- Daily token posted to the season board is rejected.
- Forged daily date/seed metadata is rejected before replay.
- Illegal daily picks still fail through the replay keystone.
- Non-canonical daily rating basis is rejected.
- Same-seed daily tokens built for non-`4-3-3` formations are rejected.
- Anonymous daily submit succeeds for today's UTC date and returns rank,
  percentile, and field size.
- Past daily submit is rejected as read-only after verification.
- Same daily identity updates an existing lower score instead of appending.
- Daily ranked submit is rejected before auth or validation and writes no row.
- Direct DB daily ranked insert is rejected by the schema check.

## Risks And Carryovers

- External Neon apply/rollback is still blocked by missing credentials.
- The rollback migration intentionally deletes daily rows before restoring the
  pre-daily season-only token uniqueness shape. That is the compatible rollback
  path, but production rollback communication must call out the daily-row loss.
- The daily board is date-scoped and rows are stamped with `rating_version`.
  A same-UTC-day rating/runtime deployment could display multiple
  `rating_version` stamps for that date unless a later policy splits or hides
  old-version rows. This lane did not change rating/data anchors.
- No merge, production deploy, or live www.wcdraft.com readback was performed.
- Current v5 ship gates were not completed in this local implementation
  closeout.

## Release Gates Still Required

Before shipping this RED lane:

- Run ephemeral Neon migration apply/rollback with credentials and keep the
  evidence.
- Reconfirm branch SHA after any rebase or fix-forward.
- Obtain a fresh-context reviewer PASS pinned to the final SHA.
- Squash-merge only after reviewer PASS and passing CI, using
  `--match-head-commit`.
- Wait for the Vercel production deployment to be READY.
- Live-verify on `www.wcdraft.com`:
  - data anchors unchanged;
  - two fresh Daily Draft sessions get identical daily teams;
  - two ordinary first drafts still differ;
  - anonymous daily post succeeds and returns rank/percentile;
  - anonymous ranked remains blocked;
  - default leaderboard landing is today's Daily board;
  - existing casual alias `wow` remains present;
  - daily challenge links route recipients to the same dated daily draft;
  - share/OG route still renders the run card;
  - server re-sim rejects claimed-score mismatch.
