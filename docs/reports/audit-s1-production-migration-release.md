# Audit S1 B3 production migration release workflow

Date: 2026-07-10

Risk: RED operations/security

Base: `86bba8d71360dad634bbe6c4d7a799e1399675dc`

## Outcome

Ready for independent exact-head review and CI. This lane adds a manual,
fail-closed GitHub Actions path for applying the single production migration
left pending after B3 shipped. It does not apply the migration itself and does
not change product code, schema, migration SQL, runtime data, rating,
simulation, or ETL artifacts.

Production remains on healthy D2 code while the database remains at `0011`.
B3 production live verification remains incomplete until this workflow is
reviewed, merged, dispatched from the exact then-current main SHA for
`0012_ranked_attempt_structural_binding`, and the B3 deployment passes live
checks.

## Safety contract

- Manual dispatch only, repository/default-branch only, read-only GitHub token.
- Caller input, dispatch SHA, checkout SHA, and current remote-main SHA must be
  the same exact lowercase 40-character commit.
- After exact known-pending preflight, the workflow queries live remote main a
  second time immediately before migration and reasserts the dispatch SHA,
  checkout HEAD, and clean tree. A merge during setup, target resolution, or
  preflight therefore stops the workflow before mutation.
- The caller-supplied migration must be the checked-out contiguous journal
  tail.
- Neon credentials enter exactly once through step-scoped environment
  variables. The API resolver requires exactly one branch flagged
  primary/default and exactly one `read_write` endpoint on it.
- The resolved URI must be direct, unpooled Neon PostgreSQL. It is written only
  to a mode-0600 runner-temp file and never to a GitHub output or artifact.
- Preflight accepts only exit 1 with exactly one named pending tail. Ready,
  database-ahead, query-error, wrong-tag, and multiple-pending receipts all
  stop before migration.
- Raw preflight, migration, and postflight output remains protected. The
  postflight must report the exact journal head and zero pending migrations.
- An `always()` step removes the URL and all raw receipts.

## Validation

- `scripts/ci/production-migration-workflow.test.sh`: PASS, 8 classifier cases,
  14 workflow/runbook bindings, plus secret-flow and safety-order guards.
- `actionlint` 1.7.12: PASS for the new workflow and `ci.yml`.
- Bash syntax, targeted Prettier, generated-artifact check, and `git diff
--check`: PASS.
- Forced root validation with isolated Turbo cache: typecheck 8/8, lint 5/5,
  test 8/8 in 8m35.931s, build 4/4, zero cache hits.
  - Core: 391/391.
  - Data: 162 passed / 9 skipped.
  - DB: 119/119.
  - Marketing: 68/68.
  - Web: 933 passed / 1 skipped; game-flow Playwright PASS; responsive shell
    84 desktop + 56 mobile + 40 interaction metrics, 0 failures.
  - Production build: 40/40 pages.
- Heavy realism: 9/9 PASS.

## Independent review fix-forward

Independent exact-head Red review returned FAIL at
`38718e5f3d0582d9094f71429c2d4af19674b7cf`. The workflow's initial exact-main
check could become stale while setup, Neon resolution, and database preflight
ran. A concurrent merge could therefore leave the old checkout at the mutation
boundary even though the early check had passed.

The fix-forward adds a second live `git ls-remote` query after successful exact
known-pending classification and immediately before the migration step. It
again requires the live default ref, dispatch SHA, and checkout HEAD to equal
`EXPECTED_MAIN_SHA`, and requires a clean checkout. The contract now proves
there are exactly two live remote queries and checkout bindings, and proves the
strict order preflight -> final revalidation -> migration with no intervening
workflow step. Migration-hash validation and crash-recovery cleanup were noted
as non-blocking future hardening and intentionally remain outside this minimal
release-blocker fix.

Narrow fix-forward validation passed the executable workflow contract, Bash
parse, actionlint 1.7.12, full repository Prettier check, and `git diff
--check`. The earlier full root results remain evidence for the unchanged
repository baseline, not exact-head approval for this fix; broad PR CI and the
fresh Red reviewer must re-execute the new head before merge.

The first root attempt is not counted: an interrupted sibling task left a
generated-artifact lock and the untracked raw draft bundle absent. The lane
removed only its stale lock/processes, regenerated and fingerprint-checked the
canonical artifacts, and then re-executed all reported root gates with an
isolated cache and no concurrent root/browser task.
