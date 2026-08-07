# Unit C — Residue sweep + ranked binding closeout (2026-08-07)

## Outcome

**DONE.** Production residue deletes executed under dual attribution PASS + Neon
snapshot. Ranked attempt binding constraints left **NOT VALID** (historical
chezwizz exception; no fabricated attempt).

## Neon snapshot (rollback target)

| Field       | Value                                 |
| ----------- | ------------------------------------- |
| Branch id   | `br-dark-math-aqyfztzk`               |
| Branch name | `pre-unit-c-residue-20260807T225034Z` |
| Parent      | `br-blue-heart-aqcejtyf` (production) |
| Parent LSN  | `0/74CDBC0`                           |
| Created     | `2026-08-07T22:50:35Z`                |

Prior U2 snapshot retained: `br-autumn-hill-aqswkxii` /
`pre-u2-lb-residue-20260807T204810Z` (parent LSN `0/746A408`). **Do not delete
either** — owner call after restore window.

Rollback = Neon restore per `docs/runbooks/neon-restore-vercel-rollback.md`
(non-idempotent POST). Not `git revert`.

## Attribution (dual review PASS before mutation)

### Deleted leaderboard rows

| id                                     | alias          | criteria | notes                                                                                                                |
| -------------------------------------- | -------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `1b799d80-267b-46fe-9773-8dcd03e3f0d4` | `shipmqyoeu0c` | 4/5      | rid=`live-daily-2026-06-29-mqyoerw5`, ps=`wcdraft:daily:v1:2026-06-29`, tn=Daily XI, score −10, 2026-06-29T03:46:48Z |
| `289add68-e8b2-4d10-8e2a-c10d339e2c59` | `shipmqyohh7w` | 4/5      | rid=`live-daily-2026-06-29-mqyohenu`, same daily seed, score −10, 2026-06-29T03:48:50Z                               |

Independent token decode (payload fields only) confirmed by implementer and
fresh-context re-reviewer. Mechanism: direct `DELETE … RETURNING` pinned by
id + alias + null user + null attempt.

### Deleted accounts

| id           | email                                               | owned sessions/runs/lb/attempts |
| ------------ | --------------------------------------------------- | ------------------------------- |
| `5ff84f87-…` | `wcdraft+prodreview-claim-d5f7f10d@example.invalid` | all 0                           |
| `35048afa-…` | `wcdraft+prodreview-rerun-1bd002d7@example.invalid` | all 0                           |
| `ae2dea03-…` | `codex-live-hmod54@wcdraft.invalid`                 | all 0                           |

Also deleted 3 matching `magic_link_tokens` rows for those emails.

### Left (owner adjudication / historical)

| Subject                      | Reason                                      |
| ---------------------------- | ------------------------------------------- |
| `wow`                        | Not automation-shaped; leave-if-unsure      |
| `testt`                      | Leave-if-unsure                             |
| `team3`                      | Archive genuine-looking play                |
| chezwizz ranked `4dc1df8e-…` | Genuine user; sole ranked NULL `attempt_id` |
| `redacted@example.invalid`   | Not on dispatch delete list                 |

## Constraint C4 outcome

| Constraint                                       | convalidated | Action         |
| ------------------------------------------------ | ------------ | -------------- |
| `leaderboard_entries_ranked_attempt_chk`         | **f**        | left NOT VALID |
| `leaderboard_entries_ranked_attempt_binding_chk` | **f**        | left NOT VALID |
| `leaderboard_entries_ranked_attempt_binding_fk`  | **f**        | left NOT VALID |

`ranked_attempts` count remains **0**. Cannot legitimately reconstruct an
attempt for chezwizz without fabrication → **no VALIDATE**.

## Post integrity

| Table               | Before |  After |
| ------------------- | -----: | -----: |
| leaderboard_entries |      6 |  **4** |
| users               |      9 |  **6** |
| magic_link_tokens   |     21 | **18** |
| sessions            |    132 |    132 |
| saved_runs          |    317 |    317 |
| ranked_attempts     |      0 |      0 |

Remaining leaderboard: chezwizz ranked, wow, testt, team3. shipmqyo remaining: 0.

## Reviews

- Attribution re-review after independent token decode: **PASS** (a/b/c), mutation authorized
- Mutation executed only after PASS + snapshot
