# Daily Draft Fresh RED Review - 2026-06-29

Outcome: no blockers remain in the reviewed working-tree diff against
`origin/main`.

Reviewed branch: `ws-f4/daily-draft-20260629`
Reviewed HEAD: `797fefa8a68edb0449f46199917e4d4b0e83d4d6`
Reviewed base: `origin/main` at `797fefa8a68edb0449f46199917e4d4b0e83d4d6` after
`git fetch origin`
Scope reviewed: dirty working-tree delta, including untracked Daily Draft files
and migration `0008`.

## Blockers

None found.

## Prior Blocker Checks

1. Daily validation now enforces the canonical Daily Draft config including
   `formation_id`.
   - Canonical config pins Classic / Squad First / All-time / Career / `4-3-3`
     in `apps/web/lib/game/daily.ts`.
   - `isCanonicalDailyConfig` checks `formationId` as well as mode, draft
     order, era, and rating basis.
   - Submit validation passes `token.fid` into that check.
   - Negative coverage rejects a valid same-seed daily token built for
     `formationId: "4-2-3-1"`.

2. Daily submissions are casual-only at both API and DB trust boundaries.
   - The submit route rejects `challenge: "daily"` with `mode !== "casual"`
     before identity, rate-limit, or replay work.
   - The schema and migration add `leaderboard_entries_daily_mode_chk`.
   - Route coverage asserts daily ranked returns `400 INVALID_BODY` and writes
     no row.
   - PGlite coverage asserts direct daily ranked inserts fail even with a user
     present.

3. Migration `0008` rollback succeeds after valid same-token daily rows across
   identities while preserving season rows.
   - The down migration drops daily indexes, deletes daily rows, drops daily
     columns/checks, and restores the old dedupe constraint.
   - Runtime coverage applies through `0008`, inserts two valid daily rows with
     the same token across two sessions plus a season survivor row, runs the
     down migration, verifies the season row remains, verifies the daily rows
     are gone, and verifies `leaderboard_entries_dedupe_uq` is restored.

## RED Contract Sanity

- Deterministic UTC daily seed is `wcdraft:daily:v1:<YYYY-MM-DD>` and validated
  as a real UTC date.
- `/play/daily` creates the run with the shared daily parent seed and daily
  challenge metadata; repeated devices share the same daily draft draw pairs.
- Ordinary non-daily first drafts still use per-device nonce behavior.
- Run-token v2 carries daily `{ kind, date, seed }` metadata and token-loaded
  virtual records preserve it.
- Validation requires daily token metadata, matching submitted date,
  `ch.s === token.ps`, `token.ps === deriveDailySeed(date)`, and the canonical
  daily config including formation.
- Anonymous daily submit returns rank, percentile, and field size.
- Daily best-of-many write behavior updates an existing visible identity row
  only on better score.
- Claim-time daily identity conflicts merge the better score into the user row.
- Accepted rows stamp explicit season id plus token `rating_version`.
- Daily board reads are public, casual-only, date-scoped, and canonical-config
  scoped.
- Share captions use the daily date and recipient CTAs route back to
  `/play/daily?date=<date>`.
- Applying `0008` preserves an existing pre-daily anonymous casual row as a
  season row with null challenge date.

## Warnings

1. The `0008` rollback succeeds by deleting daily challenge rows before
   restoring the pre-daily uniqueness shape. That satisfies the requested
   rollback condition and preserves season rows, but it is intentionally
   data-destructive for daily rows. Any production rollback plan should call
   that out explicitly.

2. Review-time warning resolved after review: `STATE.md` referenced
   `docs/reports/daily-draft-2026-06-29.md` before that implementation report
   existed. The file now exists in the current worktree.

## Gates Run

```text
pnpm --dir apps/web exec vitest run lib/game/__tests__/run-record.test.ts lib/game/__tests__/run-token-v2.test.ts lib/game/__tests__/share-adapters-intent.test.ts lib/leaderboard/__tests__/validate.test.ts lib/leaderboard/__tests__/validate.golden.test.ts lib/leaderboard/__tests__/submit-route.test.ts lib/leaderboard/__tests__/board-route.test.ts lib/leaderboard/__tests__/claim.test.ts lib/leaderboard/__tests__/claim-tx-seam.test.ts
```

Result: passed. Test files: 9 passed. Tests: 182 passed.

```text
pnpm --filter @wcdraft/db test -- migrations.golden.test.ts pglite-runtime.test.ts schema-shapes.test.ts
```

Result: passed. Test files: 3 passed. Tests: 99 passed.

## Not Performed

The fresh reviewer did not perform Neon apply/rollback. It did not stage,
commit, merge, deploy, or run live production verification.
