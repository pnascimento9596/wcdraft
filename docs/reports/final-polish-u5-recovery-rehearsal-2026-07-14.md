# Final-polish U5 recovery rehearsal — 2026-07-14

## Verdict

PASS for the non-destructive production-derived recovery rehearsal and Vercel
rollback dry-run. Neon restore/reset was exercised only on a child branch,
post-restore data coherence was verified, both temporary branches were deleted,
and final inventory contained only the unchanged production branch. Vercel
current/prior READY production deployments and rollback eligibility were
verified without invoking rollback or promote.

No production Neon restore, reset, branch delete, SQL write, compute reassignment,
Vercel rollback, or Vercel promotion occurred.

## Scope and safety boundary

- Neon project: `rapid-wind-87431051` (`WCdraft`).
- Production primary/default: `production` / `br-blue-heart-aqcejtyf`.
- Rehearsal target: `final-polish-recovery-20260714` /
  `br-damp-bird-aqtx44wm`, created as a child of production.
- Preserved pre-reset branch: `final-polish-pre-reset-20260714` /
  `br-sweet-lake-aqvqw2n4`.
- Every SQL request supplied the rehearsal branch ID explicitly. Production was
  used only as the read-only branch source/inventory anchor.
- No credentials, connection strings, user rows, session values, or tokens were
  printed or committed. Verification used aggregate counts only.

## Neon timed lifecycle

| Step                                                                   | Result                                           | Wall time |
| ---------------------------------------------------------------------- | ------------------------------------------------ | --------: |
| Create production-derived child                                        | ready, correct production parent                 |   1.207 s |
| Describe branch/schema                                                 | expected `neondb` schema and seven public tables |   2.193 s |
| Initial aggregate coherence query                                      | eight relation counts returned                   |   1.436 s |
| Restore/reset child from production parent with pre-reset preservation | success                                          |   1.174 s |
| Post-restore aggregate/probe verification                              | success                                          |     3.0 s |
| Delete preserved branch                                                | success                                          |   1.035 s |
| Delete rehearsal target                                                | success                                          |   0.988 s |

The branch-only probe was intentionally distinguishable from application data:
`public._final_polish_recovery_probe`. A `baseline` row was committed, the
branch clock was captured at `2026-07-14T14:05:56.870Z`, and a
`post-restore-sentinel` row was committed afterward. Pre-restore count was two.

Production-derived aggregate baseline before the probe:

| Relation              | Rows |
| --------------------- | ---: |
| `auth_rate_limits`    |   52 |
| `drizzle_migrations`  |   14 |
| `leaderboard_entries` |    6 |
| `magic_link_tokens`   |   18 |
| `ranked_attempts`     |    0 |
| `saved_runs`          |  254 |
| `sessions`            |  149 |
| `users`               |    7 |

The connector-supported restore/reset targeted only the rehearsal branch and
preserved its prior state under a separate branch name. Neon reported the
restored branch at parent LSN `0/58F6D00`, parent timestamp
`2026-07-14T10:32:49Z`, and `last_reset_at=2026-07-14T14:07:40Z`. The parent
timestamp was earlier than both branch-only probe commits.

After restore/reset:

- `to_regclass('public._final_polish_recovery_probe') IS NULL` was true.
- `saved_runs=254`, `sessions=149`, `users=7`, and `drizzle_migrations=14`.
- These counts matched the pre-probe production-derived branch state for the
  same relations.
- The preserved branch had no compute endpoint; a direct read correctly returned
  `endpoint not found`. The two-marker pre-reset state had already been recorded
  on the original branch before reset, so no compute was created solely to repeat
  that proof.
- Final project inventory showed exactly one branch: production
  `br-blue-heart-aqcejtyf`, ready and still primary/default.

### Failed path retained honestly

Before using the connector reset operation, the timestamp-specific CLI form was
tested against the rehearsal branch:

```text
neonctl branches restore br-damp-bird-aqtx44wm \
  ^self@2026-07-14T14:05:56.870Z \
  --project-id rapid-wind-87431051 --output json --no-color
```

Neon CLI 2.32.0 exited 1 before mutation with
`The request could not be authorized due to an internal error`. A read-only
`branches list` in the same CLI OAuth context returned the same authorization
failure. The working in-session Neon connector remained authorized, so the
rehearsal continued through its supported child-branch reset-from-parent
operation. This is evidence for the connector restore/reset path; it is not a
claim that arbitrary-timestamp CLI authorization worked in this session.

## Vercel rollback dry-run

- Team: `pnascimento9596s-projects` /
  `team_UcazzacLGnW6w4OjIU2njYFM`.
- Project: `wcdraft-web` / `prj_MXJxM5wTyp4rqnHPqA1Z9Ncvc17K`.
- Current READY production at rehearsal time:
  `dpl_DthG9fnes3KT9o6xPmjPuw5cS32c`, commit
  `c102142deffcfbe72bef7b1456d5e091e5869462`, with
  `www.wcdraft.com` among its aliases.
- Prior READY production target:
  `dpl_CDN5wHxGYxfogiVehbAh7QwU5w3n`, commit
  `777096ec6bcf7d189c62dc90fcc0d89b19e9af11`.
- Live Vercel API/connector inventory reported that exact prior deployment as
  `isRollbackCandidate=true`.

Vercel CLI 52.2.1 successfully exercised the read-only pieces of the runbook:

- `vercel list wcdraft-web --environment production --status READY ...`
- `vercel inspect <current> --format=json --wait --timeout 30s ...`
- `vercel inspect <prior> --format=json --wait --timeout 30s ...`
- `vercel rollback --help`
- `vercel promote --help`
- `vercel rollback status wcdraft-web --scope pnascimento9596s-projects --timeout 30s --no-color`

Rollback status reported no deployment rollback in progress. Neither the
rollback nor promote mutation command was run. Official Vercel behavior remains
important to the incident decision: Instant Rollback reassigns production to an
already-served deployment without rebuilding its environment, and `promote` is
the inverse action that restores normal production assignment behavior.

## Runbook corrections

Validated and corrected
`docs/runbooks/neon-restore-vercel-rollback.md`:

1. Resolve `www.wcdraft.com` with `vercel inspect` and bind
   `PRE_RESTORE_DEPLOYMENT` to the exact returned deployment ID. Newest READY is
   not sufficient evidence of current alias ownership.
2. Inspect the rollback target as READY production and separately require
   Vercel API/connector/dashboard evidence that
   `isRollbackCandidate=true`. CLI inspect does not expose eligibility.
3. Added exact tested `--format=json`, `--wait`, and `--timeout 30s` syntax.
4. Removed any implication that a coupled database/application rollback is
   always DB-first. Order is compatibility-dependent; preselect both artifacts,
   minimize the mismatch window, and stop traffic if neither intermediate pair
   is safe.
5. Added the required production-derived child-branch rehearsal boundary:
   branch-local probe, timestamp/LSN and aggregate capture, child-only restore,
   post-restore readback, and complete temporary-branch teardown.
6. Made `COUPLED_ORDER=database-first|application-first|traffic-stopped`
   mandatory for paired rollback and reject it for a current-application restore.
7. Added executable receipt gates for every route: application-first proves the
   production alias and intermediate endpoints before Neon restore;
   database-first proves the current-code/restored-database endpoints before
   Vercel rollback; traffic-stopped is bound to the canonical health and OG
   health endpoints and requires an incident-unique marker in both a fixed
   response header and body with exact HTTP 503 before and between mutations.
   A normal unrelated-path 404 cannot satisfy this proof.
8. Added compatibility-selected and receipt-gated application-first,
   database-first, and traffic-stopped routes for the inverse recovery. The
   second inverse mutation cannot run until the exact alias and health receipts
   for the first intermediate pairing pass.
9. Registered the Bash syntax and structural-order contract in the required
   static CI job. It enforces six forward/inverse route orderings, fixed
   suspension endpoints, single mutation definitions, CI registration, and
   four negative cases proving that missing or wrong database-first alias
   receipts cannot reach either Vercel mutation.

Existing safety controls were retained: mode-0600 receipts, exact preserved
branch resolution, operation polling, no blind retry after ambiguous restore
POSTs, inverse restore using the preserved branch ID, exact deployment promote,
and production health/readback before cleanup.

## Live read-only baseline

At rehearsal time:

- `GET /api/health`: HTTP 200, `ok=true`, `db.status=ready`.
- `GET /api/og/health`: HTTP 200, `ok=true`.
- `GET /api/leaderboard?limit=1`: HTTP 200.

## Risk and rollback

The remaining operational risk is credential-surface asymmetry: the Neon MCP
connector could create/reset/delete child branches while the local Neon CLI OAuth
context could not authorize the project. During a real incident, use the
credentialed REST workflow already documented by the runbook or the verified
connector surface, and do not switch tools mid-operation without reading live
branch/operation state first.

This report, runbook, and static runbook contract are operations evidence only.
The contract is registered in CI, but it does not change schema, migrations,
application runtime, draft/simulation/rating, tokens, auth, or production
deployment configuration. Rollback is a normal documentation/test/workflow
revert; it does not undo or repeat the already-completed rehearsal.

## Out of scope

Still elective or separately blocked, not surfaced debt in this lane:
merit-v4.2 declustering, richer manager-quality tiers, iOS M1b enrollment,
shared marketing replay/token authority, god-module splits, analytics,
leaderboard seeding/growth, women's mode, monetization, and OG-card layout
changes. Playwright WebKit closes the engine gap in U3, but a literal physical
iPhone Safari smoke remains the one irreducible owner check.
