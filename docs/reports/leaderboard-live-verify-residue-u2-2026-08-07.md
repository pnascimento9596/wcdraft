# U2 — Leaderboard live-verify residue cleanup (2026-08-07)

## Outcome

**DONE.** Production `leaderboard_entries` row `1cac61ff-6b2e-46b9-b71f-419fb426f0e5`
(`display_alias=live_verify_xi`, PR #340 accepting live-verify residue) deleted via
direct `DELETE … RETURNING` under reviewed attribution. No schema/constraint changes.
No account cascade. Post-delete integrity green; non-writing live-verify PASS.

U1 (policy) already shipped as PR #342 / main `8654798` before this mutation.

## Neon snapshot (rollback target)

| Field       | Value                                         |
| ----------- | --------------------------------------------- |
| Branch id   | `br-autumn-hill-aqswkxii`                     |
| Branch name | `pre-u2-lb-residue-20260807T204810Z`          |
| Parent      | `br-blue-heart-aqcejtyf` (production primary) |
| Parent LSN  | `0/746A408`                                   |
| Created     | `2026-08-07T20:48:11Z`                        |

**Rollback semantics:** if post-mutation verification had failed, recovery is a
**Neon restore from this snapshot** (not `git revert`). Restore POSTs are
non-idempotent — follow `docs/runbooks/neon-restore-vercel-rollback.md` exactly;
reconcile operations/branch state before any second attempt. Runbook was read
and applied for the snapshot-before-mutation step.

## Pre-delete full candidate set (all 7 leaderboard rows)

### `4dc1df8e-530d-47c3-9364-5e6beea571a2` — decision **SKIP**

- alias: `None`
- season/mode: `engine-2026.06.16-merit-v4.4_...` / `ranked` / `classic`
- created_at: `2026-06-21T21:17:55.346Z`
- reason: Genuine ranked user entry ([redacted-real-user-email] / chezwizz); outside arc window; no automation alias

### `05003ad4-23d7-44c5-b9db-95e156774fad` — decision **SKIP**

- alias: `wow`
- season/mode: `engine-2026.06.17-merit-v4.5_...` / `casual` / `None`
- created_at: `2026-06-25T07:46:27.913Z`
- reason: Outside #336-#340 window; alias not automation-shaped; leave-if-unsure

### `593619a9-d78d-4869-b615-edcc896542ab` — decision **SKIP**

- alias: `testt`
- season/mode: `engine-2026.06.17-merit-v4.5_...` / `casual` / `None`
- created_at: `2026-06-28T08:01:52.116Z`
- reason: Alias weakly test-like but outside #336-#340 window and not linked to this arc; leave-if-unsure for owner

### `1b799d80-267b-46fe-9773-8dcd03e3f0d4` — decision **SKIP**

- alias: `shipmqyoeu0c`
- season/mode: `engine-2026.06.28-merit-v4.6_...` / `None` / `None`
- created_at: `2026-06-29T03:46:48.196Z`
- reason: Older ship/live-daily alias; outside #336-#340 arc window

### `289add68-e8b2-4d10-8e2a-c10d339e2c59` — decision **SKIP**

- alias: `shipmqyohh7w`
- season/mode: ``/`None`/`None`
- created_at: `2026-06-29T03:48:50.947Z`
- reason: Older ship/live-daily alias; outside #336-#340 arc window

### `4e637c2c-c806-4d5a-b712-37e2e2124132` — decision **SKIP**

- alias: `team3`
- season/mode: `season-2026-manager-attrition` / `casual` / `hidden`
- created_at: `2026-07-03T16:13:08.942Z`
- reason: Archive-season entry; not automation-shaped; outside arc; genuine-looking play

### `1cac61ff-6b2e-46b9-b71f-419fb426f0e5` — decision **DELETE**

- alias: `live_verify_xi`
- season/mode: `season-2026-squad-depth` / `casual` / `classic`
- created_at: `2026-08-07T18:36:28.415Z`
- U2b criteria met: **4** (1,3,4,5 true; 2 N/A; contradictions none)
  - Alias live*verify_xi matches automation pattern live_verify*\*
  - created_at 2026-08-07T18:36:28Z is during PR #340 post-merge live-verify (merge 18:33Z)
  - PR #340 residue confirmed via /tmp/lv-submit-current2.json entry id match
  - Token rid=f4-u2-classic / parent_seed=wcdraft:f4-u2-golden:classic:1 is the leaderboard golden fixture, not genuine play
  - No user_id, session_id, attempt_id, or matching saved_runs — pure anonymous casual insert from scripted submit

## Deleted row (pre-delete snapshot fields)

| Field                            | Value                                                                  |
| -------------------------------- | ---------------------------------------------------------------------- |
| id                               | `1cac61ff-6b2e-46b9-b71f-419fb426f0e5`                                 |
| table                            | `leaderboard_entries`                                                  |
| season_key                       | `season-2026-squad-depth`                                              |
| mode / draft_mode                | `casual` / `classic`                                                   |
| draft_order / era / rating_basis | `squad_first` / `all_time` / `career`                                  |
| display_alias                    | `live_verify_xi`                                                       |
| verified_score                   | `-1`                                                                   |
| user_id                          | `NULL`                                                                 |
| session_id                       | `NULL`                                                                 |
| attempt_id                       | `NULL`                                                                 |
| created_at                       | `2026-08-07 18:36:28.415+00`                                           |
| token_prefix                     | `t3.[redacted-jwt-body-prefix]…`                    |
| token decode                     | rid=`f4-u2-classic` ps=`wcdraft:f4-u2-golden:classic:1` tn=`Golden XI` |

## Skipped rows (owner adjudication)

| id          | alias          | reason                                                                                                    |
| ----------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `4dc1df8e…` | `—`            | Genuine ranked user entry ([redacted-real-user-email] / chezwizz); outside arc window; no automation alias      |
| `05003ad4…` | `wow`          | Outside #336-#340 window; alias not automation-shaped; leave-if-unsure                                    |
| `593619a9…` | `testt`        | Alias weakly test-like but outside #336-#340 window and not linked to this arc; leave-if-unsure for owner |
| `1b799d80…` | `shipmqyoeu0c` | Older ship/live-daily alias; outside #336-#340 arc window                                                 |
| `289add68…` | `shipmqyohh7w` | Older ship/live-daily alias; outside #336-#340 arc window                                                 |
| `4e637c2c…` | `team3`        | Archive-season entry; not automation-shaped; outside arc; genuine-looking play                            |

Older automation **accounts** (no current-season board rows; not deleted):
`wcdraft+prodreview-*@example.invalid` (2026-06-15), `codex-live-hmod54@wcdraft.invalid` (2026-06-17).

## Deletion mechanism

Direct:

```sql
DELETE FROM leaderboard_entries
WHERE id = '1cac61ff-6b2e-46b9-b71f-419fb426f0e5'
  AND display_alias = 'live_verify_xi'
  AND user_id IS NULL
  AND session_id IS NULL
  AND attempt_id IS NULL
  AND season_key = 'season-2026-squad-depth'  -- current write season
RETURNING id, display_alias, verified_score;
```

Result: **DELETE 1**. Legal under existing schema: no `ranked_attempt_binding_fk`
(null attempt), no user cascade needed, no session to clear. Inbound FKs onto
`leaderboard_entries(id)`: **0**. Account deletion was **not** used.

## Post-mutation integrity

| Check                                 | Result                                    |
| ------------------------------------- | ----------------------------------------- |
| remaining target id                   | 0                                         |
| `live_verify%` aliases                | 0                                         |
| leaderboard_entries                   | 6 (was 7)                                 |
| ranked_attempts                       | 0                                         |
| users                                 | 9 (unchanged)                             |
| sessions                              | 132 (unchanged)                           |
| saved_runs                            | 317 (unchanged)                           |
| Public classic casual current         | empty (n=0)                               |
| Public memory/ranked current          | empty                                     |
| Archive `team3` (hidden/modern)       | still present                             |
| `/api/health` anchors                 | unchanged; sha `8654798…`; db ready       |
| `./scripts/live-verify-production.sh` | PASS (409 DIFFERENT_BUILD, ids unchanged) |

Pre-existing note: one historical ranked row (chezwizz, 2026-06-21) has null
`attempt_id` from before binding enforcement — **not** introduced by U2; left alone.

## Reviews (precede mutation)

| Review                    | Result |
| ------------------------- | ------ |
| Fresh-context attribution | PASS   |
| GLM 5.2 cross-model       | PASS   |

## Ordering

U1 (PR #342, non-writing live-verify policy) merged and live-verified **before**
this DELETE, so a policy-side auto-revert would not have left an irreversible
mutation behind a reverted probe.
