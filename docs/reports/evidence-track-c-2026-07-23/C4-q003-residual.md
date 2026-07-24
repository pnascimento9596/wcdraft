# C4 — q-003 residual ranked rows (read-only)

**Date:** 2026-07-23  
**Base:** `a1beaaaaa2fe0377128d0b1434aa47d2bda5adca`  
**Risk:** Green — read-only production-derived count; no DDL, no VALIDATE, no writes  

## Method

1. Source Neon API credentials from the local agent config (not printed).
2. `pnpm --filter @wcdraft/db db:branch:create` → ephemeral branch forked from production primary (`ws-f-rollback-…` pattern; create ~seconds).
3. Read-only `psql` against `DATABASE_URL_UNPOOLED` on that branch.
4. Immediate `db:branch:delete` teardown — production left as inventory-only; zero production mutation.

Residual definition = rows that **fail** the structural binding CHECK predicate from migration `0012_ranked_attempt_structural_binding.sql`:

```sql
mode = 'ranked'
AND NOT (
  attempt_id IS NOT NULL
  AND user_id IS NOT NULL
  AND attempt_formation_id IS NOT NULL
  AND draft_order IS NOT NULL
  AND era IS NOT NULL
  AND rating_basis IS NOT NULL
  AND attempt_consumed_at IS NOT NULL
)
```

## Count

| Metric | Value |
| ------ | ----: |
| **residual_count** | **1** |
| ranked_total | 1 |
| casual_total | 5 |
| ranked_null_attempt | 1 |
| ranked_null_formation | 1 |
| ranked_null_consumed | 1 |
| ranked_null_user | 0 |

### The residual row

| Column | Value |
| ------ | ----- |
| id | `4dc1df8e-530d-47c3-9364-5e6beea571a2` |
| user_id | `e912451e-4fb6-4fa3-ba86-ddf7199ad826` |
| attempt_id | **NULL** |
| attempt_formation_id | **NULL** |
| attempt_consumed_at | **NULL** |
| draft_order | `squad_first` |
| era | `all_time` |
| rating_basis | `career` |
| created_at | `2026-06-21T21:17:55.346Z` |

Pre-binding ranked submission: has a user, no server-issued attempt binding witnesses.

### Constraint validation state (branch = production schema)

All three binding constraints remain **`NOT VALID`** (`convalidated = false`):

- `leaderboard_entries_ranked_attempt_chk`
- `leaderboard_entries_ranked_attempt_binding_chk`
- `leaderboard_entries_ranked_attempt_binding_fk`

## Verdict

**NON-ZERO ⇒ docs-only for VALIDATE CONSTRAINT.** A controlled `VALIDATE CONSTRAINT` window is **not** safe until this one residual ranked row is remediated (delete, backfill from a recoverable attempt, or explicit grandfather policy with a different constraint shape).

Raw JSON: `c4-residual-raw.json`.

## q-003 queue entry verification

**Before rewrite:** `docs/queue/q-003-f4-remaining.md` still said server-issued ranked attempts (`/api/ranked/attempt`) were **deferred**.

**Verification against code (not impression):**

- Route exists: `apps/web/app/api/ranked/attempt/route.ts` — “POST /api/ranked/attempt — server-issued ranked parent seed.”
- Client: `apps/web/lib/leaderboard/client.ts` → `requestRankedAttempt`
- Season 1 audits: `docs/reports/audit-s1-b1-b2-ranked-attempt-lifecycle-2026-07-11.md` shipped B1+B2
- STATE.md records ranked drafts minting server-issued seeds

**Conclusion:** the “deferred” claim is **stale**. Entry updated in the same change set to reflect shipped issuance and to point residual-VALIDATE work at this count (still dispatch-only Red).
