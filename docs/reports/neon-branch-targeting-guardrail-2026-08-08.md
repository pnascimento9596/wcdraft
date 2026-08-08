# Neon branch-targeting guardrail and mutation reconciliation

Date: 2026-08-08

Production baseline: `c4311b3`, schema `runtime-data-2.11.0`, engine
`engine-2026.07.18-basis-aware-tiering`, season `season-2026-squad-depth`.

Read-only `GET https://www.wcdraft.com/api/health` confirmed build SHA
`c4311b3`, schema `runtime-data-2.11.0`, engine
`engine-2026.07.18-basis-aware-tiering`, season `season-2026-squad-depth`,
`db=ready`, and `auth=ready`.

## Unit A: failure characterization

The installed CLI is `neonctl 2.22.0`. Its `connection-string` command is
declared as `connection-string [branch]`; the branch is positional. The exact
reported invocation was reproduced read-only:

```text
neonctl connection-string --branch-id br-autumn-hill-aqswkxii --project-id rapid-wind-87431051 --output json
```

It exited successfully but returned the production endpoint. The correct
positional invocation returned the child endpoint:

```text
neonctl connection-string br-autumn-hill-aqswkxii --project-id rapid-wind-87431051 --output json
```

Omitting the branch also returned the production endpoint. The CLI source
confirms why: it reads `props.branch`, resolves no branch when the unsupported
`--branch-id` option is supplied, and `branchIdFromProps` then selects the
project's default branch. `--branch-id` was not listed by `neonctl connection-string --help`.

The project inventory at verification time had one ready production branch and
two retained ready child branches. Each had one read-write endpoint; the child
endpoints were idle before the read-only probes. No branch, endpoint, snapshot,
or database row was created, changed, restored, or deleted in this unit. A
still-initializing/no-endpoint branch was therefore not manufactured. The CLI
source and Neon API contract indicate that a positional branch with no matching
endpoint fails with `No ... endpoint found`; it does not select the project's
default branch. That state was not runtime-exercised under the read-only
constraint.

Read-only PostgreSQL identity queries on production and both retained child
branches returned matching values for:

```sql
SELECT
  current_database(),
  current_setting('neon.endpoint_id', true),
  current_setting('neon.branch_id', true),
  current_setting('neon.project_id', true),
  pg_is_in_recovery();
```

The guard uses these server-reported values from the open connection, then
cross-checks the endpoint's project/branch/type and branch's current state,
default/protected/name metadata using Neon API GETs. The DSN that opened the
connection is not used as branch identity. API or server-query failure is
indeterminate and fails closed.

As a read-only robustness check, a connection startup attempt that tried to
override `neon.branch_id` with a fake value was rejected by Neon as a server
parameter that cannot be changed without restarting the server. The guard does
not trust client-supplied branch settings.

## Tooling inventory

- `packages/db/scripts/migrate.ts`: ephemeral DB write; guarded before
  `migrate(...)` when `NEON_MUTATION_TARGET=ephemeral` declares an ephemeral
  target. The production release workflow explicitly sets
  `NEON_MUTATION_TARGET=production` and retains its exact-primary resolver.
- `packages/db/scripts/rollback-check.ts`: destructive DB write; the complete
  apply/probe/purge/down-migration callback runs only after the shared guard.
- `packages/db/scripts/verify-neon-branch.ts`: read-only assertion command used
  by CI and DR rehearsal procedures.
- `packages/db/scripts/migrate-status.ts`: read-only migration status; no guard
  added.
- `packages/db/scripts/neon-branch-create.ts`: Neon API branch/endpoint/URI
  lifecycle writes; it does not open a database connection. Its generated URL
  is now consumed by guarded DB paths before any SQL write.
- `packages/db/scripts/neon-branch-delete.ts`: Neon API branch deletion; it
  does not open a database connection. Its primary/default API check remains a
  separate lifecycle safety check.
- `.github/workflows/ci.yml`: ephemeral branch create, read-only assertion,
  guarded migration, read-only status, guarded rollback-check, and cleanup.
- `.github/workflows/production-db-migrate.yml`: intentional production write;
  its exact-primary resolver remains separate from the ephemeral guard.
- `docs/runbooks/prod-migration-failure.md`: explicit ephemeral assertion step
  and production/non-production distinction.
- `docs/runbooks/neon-restore-vercel-rollback.md`: explicit child-branch
  assertion before DR rehearsal writes; production restore remains an
  intentional primary operation.
- Application runtime `getDb()` consumers: deliberately unchanged. Runtime
  writes are production writes and are not part of this guard.

The actual assertion command was exercised read-only against retained child
branch `br-autumn-hill-aqswkxii` and passed. The same command against the
production direct connection while declaring that child sentinel failed closed.
No migration, rollback-check, branch creation, branch deletion, or production
write was run for this exercise.

## Unit C: claimed versus actual

All database reads below were direct, read-only SELECTs against production and
the two retained child branches. Snapshot comparison is the evidence for
deletes because the live schema has no application audit log for historical
row deletion.

### Current production state

| Table                 | Rows | Earliest timestamp   | Latest timestamp     |                     Additional read-only signal |
| --------------------- | ---: | -------------------- | -------------------- | ----------------------------------------------: |
| `leaderboard_entries` |    4 | 2026-06-21 21:17:55Z | 2026-07-03 16:13:08Z |                           0 current-season rows |
| `users`               |    6 | 2026-06-12 15:49:12Z | 2026-07-20 22:42:39Z |                                3 verified users |
| `sessions`            |   46 | 2026-06-21 20:23:50Z | 2026-08-07 20:30:36Z | 2 expired at query time; 4 created in PR window |
| `ranked_attempts`     |    0 | none                 | none                 |                                      0 consumed |
| `saved_runs`          |  317 | 2026-06-10 21:30:30Z | 2026-08-06 22:32:44Z |                          0 created in PR window |
| `magic_link_tokens`   |   18 | 2026-06-12 06:16:33Z | 2026-07-20 22:42:12Z |                                     10 consumed |
| `auth_rate_limits`    |   66 | 2026-08-01 23:01:27Z | 2026-08-07 18:36:28Z |                         12 updated in PR window |

The production-only row set was empty when compared with both retained
snapshots. The 12 rate-limit updates are activity, not deletes; the row set is
identical in both snapshots and production.

### Snapshot deltas

| Comparison                                                            | `leaderboard_entries` | `users` | `sessions` | `ranked_attempts` | `saved_runs` | `magic_link_tokens` | `auth_rate_limits` |
| --------------------------------------------------------------------- | --------------------: | ------: | ---------: | ----------------: | -----------: | ------------------: | -----------------: |
| U2 snapshot `br-autumn-hill-aqswkxii` rows absent in production       |                     3 |       3 |         86 |                 0 |            0 |                   3 |                  0 |
| Pre-Unit-C snapshot `br-dark-math-aqyfztzk` rows absent in production |                     2 |       3 |         86 |                 0 |            0 |                   3 |                  0 |

The U2 snapshot was created before the one-row `live_verify_xi` deletion and
before the later Unit C cleanup. Its three missing leaderboard rows are exactly
that one row plus the two `shipmqyo*` rows. The pre-Unit-C snapshot was created
after U2 and before the Unit C mutation; its two missing leaderboard rows are
exactly the two `shipmqyo*` rows.

### PR reconciliation

| PR/lane                     | Reported production mutation                                                                                                             | Read-only reconciliation                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #336-#339                   | No production data mutation claimed                                                                                                      | No snapshot-only delta attributable to another table or lane                                                                                                                                                           |
| #340/#342/#343 U2           | One `leaderboard_entries` row (`live_verify_xi`) deleted; no account cascade                                                             | Exactly one additional leaderboard row is absent from the pre-U2 snapshot; users, sessions, saved runs, ranked attempts, magic links, and rate limits otherwise match the claimed ordering                             |
| #344 Unit C                 | Two `leaderboard_entries` rows, three `users`, and three `magic_link_tokens` rows deleted; sessions/saved runs/ranked attempts unchanged | Pre-Unit-C snapshot differs by exactly 2, 3, 3, 0, 0, and 0 rows respectively; no discrepancy                                                                                                                          |
| #345 investigation artifact | 86 non-poison expired `sessions` rows deleted; poison retained; boards/users intact                                                      | Both retained snapshots have exactly 86 session IDs absent from production; no production-only session IDs and no corresponding users, leaderboard, saved-run, ranked-attempt, magic-link, or rate-limit row-set delta |

No discrepancy was found between the lane reports and the retained snapshot
evidence. PostgreSQL `pg_stat_user_tables.n_tup_del` was also read, but its
counters are cumulative and not a PR-window audit trail, so they were not used
to attribute historical deletes. Without continuous audit/WAL receipts, an
arbitrary mutation that occurred before the retained snapshots and left no row
or timestamp evidence cannot be proven from the live schema alone; that
limitation is not hidden by the reconciliation.
