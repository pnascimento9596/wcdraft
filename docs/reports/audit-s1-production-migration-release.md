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
- Both live-main checks call the authenticated repository Git-ref API with
  `${{ github.token }}` supplied only to that step's environment. Checkout
  credentials remain disabled, and the token never enters command arguments,
  Git config, workflow outputs, summaries, or application logs.
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

The fix-forward adds a second live default-ref query after successful exact
known-pending classification and immediately before the migration step. It
again requires the live default ref, dispatch SHA, and checkout HEAD to equal
`EXPECTED_MAIN_SHA`, and requires a clean checkout. The contract proves there
are exactly two live remote queries and checkout bindings, and proves the
strict order preflight -> final revalidation -> migration with no intervening
workflow step. Migration-hash validation and crash-recovery cleanup were noted
as non-blocking future hardening and intentionally remain outside this minimal
release-blocker fix.

Narrow fix-forward validation passed the executable workflow contract, Bash
parse, actionlint 1.7.12, full repository Prettier check, and `git diff
--check`. The earlier full root results remain evidence for the unchanged
repository baseline, not exact-head approval for this fix; broad PR CI and the
fresh Red reviewer must re-execute the new head before merge.

The Git-integrated Vercel preview for fix head `a33de06`, deployment
`dpl_6rGDpuxsikQSzc6p8awSNj51Rc2e`, and its single preview redeploy
`dpl_4YQa2Sjf7MVnu5Pdofbb5r3Tbm2K` both failed before dependency installation
or an application build command. Replacement evidence head `edf83c6`
independently reproduced the same failure in
`dpl_796UKnmeaNTJdzee2beXNZpUpAyf`. Human-readable `vercel inspect --logs`
output stopped after the Git clone line and displayed no error code or message.
The authoritative authenticated Vercel `/v13/deployments/<id>` records for all
three report `readyState=ERROR`, `errorStep=build-container-init`,
`errorCode=sts_credentials_fetch_failed`, and `errorMessage=null`;
`gitSource.sha` is `a33de06a45504e35eb18f0954c4aa479a2f3d4ba` for the first two and
`edf83c6961948ebc6b723844d4e8bfbe6ef74768` for the third. These are Vercel
build-container credential-initialization failures, not product-build evidence.
The exact-head Vercel check remains externally failed. No further manual preview
retry or trigger-only commit is performed.

## Post-merge dispatch auth fix-forward

PR #238 squash-merged as
`95c4cd99d91e5353476e8b465a67b69077151433`. Production migration dispatch run
`29125250786` then failed safely in `Bind checkout and remote main to approved
SHA`: the unauthenticated `git ls-remote origin` returned exit 128 because the
private-repository checkout correctly retained `persist-credentials:false`.
Every step from package setup through Neon target resolution, database
preflight, migration, and postflight was skipped. Protected-receipt cleanup
passed. The workflow never reached Neon and made no database mutation;
production remained at migration `0011`.

The auth fix-forward starts from exact current main `95c4cd9` in a fresh
worktree and branch. Both live-main bindings now invoke a small Node GitHub
Git-ref reader. `${{ github.token }}` enters only the two query step
environments under the existing workflow-level `contents: read` permission;
checkout credentials remain disabled. The helper sends the token only in the
in-memory `Authorization` header, never a command argument, Git config, output,
summary, or log. It fails closed on a missing token, non-success HTTP status,
wrong ref identity, malformed/missing object SHA, or malformed repository/ref
input. The workflow contract rejects any residual `git ls-remote`, requires
exactly two authenticated API calls and token scopes in the existing safety
order, and runs a helper test covering success plus five refusal cases.

Narrow auth-fix validation passed the ref-helper matrix, the full executable
production-migration workflow contract, Node and Bash syntax, actionlint
1.7.12, full repository Prettier, and `git diff --check`. No product, schema,
migration, runtime-data, rating, simulation, or ETL file changed. Broad
exact-head CI and fresh independent Red review remain required before merge.

The first root attempt is not counted: an interrupted sibling task left a
generated-artifact lock and the untracked raw draft bundle absent. The lane
removed only its stale lock/processes, regenerated and fingerprint-checked the
canonical artifacts, and then re-executed all reported root gates with an
isolated cache and no concurrent root/browser task.
