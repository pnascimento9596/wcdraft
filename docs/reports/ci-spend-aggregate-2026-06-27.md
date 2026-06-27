# CI spend aggregate lane - 2026-06-27

## Baseline recorded before edits

`origin/main` was `c569cae832a2007cbb5bddcc87e7451dca8912a5`.

`main` branch protection required checks, verbatim:

- `typecheck · lint · test · build`
- `golden RNG determinism`

Branch-protection status settings at baseline:

- `required_status_checks.strict`: `false`
- `enforce_admins.enabled`: `true`
- pull-request review requirement enabled with `required_approving_review_count: 0`
- no required signatures, linear history, force pushes, deletions, branch lock, or fork syncing

Billable GitHub-hosted jobs before this lane:

- CI: `typecheck · lint · test · build`
- CI: `golden RNG determinism`
- CI: `realism · asymmetric gate (N=2000 × 3 policies)`
- CI: `db · path filter`
- CI: `db · ephemeral branch · apply → anon-dedupe → rollback round-trip`
- CI: `ETL rating · lint · golden determinism`
- CI: `secrets · incremental scan`
- ETL: `ingest · identity-QA · determinism`
- ETL: `rating lock · Python 3.11`
- ETL: `rating lock · Python 3.12`
- ETL: `rating lock · Python 3.13`
- scheduled/manual marketing pack

External checks observed on PRs, not billed as GitHub Actions minutes:

- Vercel
- Vercel Preview Comments
- GitGuardian Security Checks

Pre-lane path filtering:

- `ci.yml` had no workflow-level path filter.
- Only the DB rollback job used an internal path filter.
- `etl.yml` used workflow-level `paths:` for `etl/**` and `.github/workflows/etl.yml`.
- Required checks were individual CI jobs, so applying `paths:` directly to them would risk pending-check deadlock.

## Implemented CI contract

`ci.yml` now has a tiny `changes · path detector` job and a single always-reporting
`required · aggregate gates` job. Heavy jobs are gated by detector outputs, and
the aggregate fails on any failed/cancelled needed job while passing skipped-or-passed jobs.

CI-config changes (`.github/**` or `turbo.json`) force the heavy gates to run.

The aggregate directly covers:

- typecheck/lint/test/build
- golden determinism
- heavy realism when applicable
- full ETL ingest/identity-QA/determinism when applicable
- DB rollback check when applicable
- ETL rating fast gate when applicable
- incremental secret scan when applicable

Heavy realism moved out of ordinary PR churn. It runs for CI-config PRs, relevant
`main` pushes, and the nightly heavy workflow. The realism job shards the three
policies into separate worker processes on one runner, with each shard preserving
the same `N`, seed prefix, and per-policy golden run-count assertions. The
unsharded package script still works.

The Python 3.11/3.12/3.13 rating-lock matrix is limited to CI-config PRs,
relevant `main` pushes, and the nightly heavy workflow.

`AGENTS.md` and `CLAUDE.md` were updated in the same lane so the repo operating
contract matches the new heavy-realism schedule. Contract-only edits are included
in the CI path detector and still run `typecheck · lint · test · build`, because
that job owns the `check:agent-contracts` drift check.

`astral-sh/setup-uv` is pinned to `fac544c07dec837d0ccb6301d7b5580bf5edae39`
(`v8.2.0`), whose `action.yml` declares `runs.using: node24`.

The remaining dead `LEADERBOARD_REQUIRE_ACCOUNT` test-only env reference was
removed. Production code had no live read of that env var.

## Local validation

Workflow/static checks:

- `/tmp/actionlint-1.7.12/actionlint .github/workflows/ci.yml .github/workflows/etl.yml .github/workflows/nightly-heavy.yml .github/workflows/marketing-x.yml` passed.
- Ruby YAML load of all workflow files passed.
- `pnpm exec prettier --check ...` passed.
- `git diff --check` passed.

Root gates:

- `pnpm typecheck`: 8/8 successful.
- `pnpm lint`: 5/5 successful.
- `pnpm test`: 8/8 successful.
  - `@wcdraft/core`: 381 passed.
  - `@wcdraft/data`: 84 passed / 7 skipped.
  - `@wcdraft/db`: 90 passed.
  - `@wcdraft/marketing-x`: 67 passed.
  - `@wcdraft/web`: 730 passed / 1 skipped; game-flow Playwright smoke passed.
- `pnpm build`: 4/4 successful.

Realism gates:

- Parallel policy shards passed:
  - `autoDraft`: 7 passed.
  - `strategicAutoDraft`: 7 passed.
  - `greedyOverallAutoDraft`: 7 passed.
- Legacy unsharded `pnpm --filter @wcdraft/data test:realism:heavy` passed: 7 passed.

ETL gate:

- Pinned Fjelstul World Cup checkout verified at `f41e9437a007498bdbf3751305818101f96cb6fb`.
- `uv sync --locked --extra dev` passed.
- `uv run ruff check src tests` passed.
- `uv run python -m wcdraft_etl.supplement.fetch --verify` passed.
- `uv run --project etl python -m wcdraft_etl` rebuilt 9 tables / 56,743 rows with no tracked output drift.
- `uv run --project etl python -m wcdraft_etl.rating` preserved ratings lock
  `1084f74194c7d46c66892f4d0328d3d90a728a8cec43956564cffd2ec651f0a0`.
- `uv run --project etl python -m wcdraft_etl.ingest_2026` preserved tracked outputs.
- `uv run python -m pytest -q`: 309 passed.

## Required remote verification before ship

1. Open this lane PR and let its own CI run the new aggregate. Because this PR changes `.github/**`, all heavy gates should run.
2. Update branch protection only after the PR's aggregate has reported successfully.
3. Make `required · aggregate gates` the only required status check.
4. Open a throwaway docs-only PR: verify heavy jobs skip, the aggregate reports, and the PR is mergeable.
5. Open or reuse a code PR: verify relevant heavy jobs run and the aggregate gates correctly.
6. Restore the baseline required checks immediately if either no-deadlock verification fails.
