# Production migration failure and code-schema skew

Use this when a deploy fails a migration, `/api/health` reports `schema_mismatch`, or a DB-backed route starts returning errors after a deploy. Never run a down migration against production as the first response.

## Capture evidence

```bash
set -euo pipefail
umask 077
incident_dir="$(mktemp -d /tmp/wcdraft-migration-incident.XXXXXX)"
health_status="$(curl -sS -o "$incident_dir/health.json" -w '%{http_code}' \
  https://www.wcdraft.com/api/health)"
printf 'health HTTP %s\n' "$health_status"
jq . "$incident_dir/health.json"
git fetch origin main
git rev-parse origin/main | tee "$incident_dir/main-sha.txt"
vercel list wcdraft-web --environment production --status READY \
  --scope pnascimento9596s-projects | tee "$incident_dir/vercel-ready.txt"
```

Do not copy connection strings, API keys, or Vercel environment values into the incident directory.

## Decide

- `db.status == "ready"`: schema skew is not the cause. Keep the health receipt and investigate the failing route/deployment.
- `db.status == "unconfigured"`: production lost `DATABASE_URL`; restore the environment binding, create a new deployment, and verify health before re-enabling traffic-dependent work.
- `db.status == "schema_mismatch"` and `schema.actual.index` is below `schema.expected.minimum.index`: the database is behind. Apply pending up migrations from the exact deployed/approved commit using the direct Neon URL.
- Actual schema ahead of `schema.expected.maximum`: roll the application forward to compatible code or roll Vercel back to a build that supports the actual schema. Do not guess a production down migration.
- `db.status == "error"`: verify Neon availability and credentials without printing them. If the latest migration was destructive or data is suspect, use `neon-restore-vercel-rollback.md`.

## Apply a behind migration

The preferred production path is the manually dispatched
`production-db-migrate.yml` workflow on the repository default branch. It is
the only repository workflow permitted to resolve the Neon primary branch and
apply production migrations. Dispatch it with both values copied exactly from
the current `origin/main` checkout:

```bash
git fetch origin main
EXPECTED_MAIN_SHA="$(git rev-parse origin/main)"
gh workflow run production-db-migrate.yml \
  --ref main \
  -f expected_main_sha="$EXPECTED_MAIN_SHA" \
  -f expected_pending_migration=0013_audit_s1_auth_abuse
```

The workflow refuses a moving or non-default ref, any mismatch among the
caller-supplied SHA, dispatch SHA, checkout SHA, and current remote-main SHA,
more or fewer than one Neon branch flagged primary/default, more or fewer than
one direct `read_write` endpoint on that branch, and any status other than the
single exact journal-tail migration named by the caller. It keeps raw status
and migration output in a mode-0600 runner directory, prints only allowlisted
count summaries, and deletes the connection URL and receipts in an `always()`
step. After a successful run, wait for production deployment/live verification
before restoring traffic to the migrated build.

The ephemeral CI path has a separate mandatory identity assertion. After the
branch env file is loaded, run the read-only assertion before any branch write:

```bash
set -a
. "$RUNNER_TEMP/neon-ephemeral.env"
set +a
export NEON_MUTATION_TARGET=ephemeral
pnpm --filter @wcdraft/db db:branch:verify
pnpm --filter @wcdraft/db db:migrate
```

`db:branch:verify` queries Neon server identity through the open direct handle
and cross-checks the endpoint and branch through the Neon API. `db:migrate`
repeats the same assertion on the handle it will mutate, so a DSN that resolves
to production or an identity that cannot be determined fails closed. Never set
`NEON_EPHEMERAL_BRANCH_ID` for the deliberate production migration workflow;
that workflow has its own exact-primary resolver and is not an ephemeral target.

The shell procedure below is break-glass guidance only. It requires an
independently resolved direct URL and must preserve the same exact-SHA and
known-pending evidence as the workflow.

Start from the exact approved commit. Load the direct URL from the approved secret store into the environment without echoing it.

```bash
set -euo pipefail
umask 077
test -n "${DATABASE_URL_UNPOOLED:-}"
export NEON_MUTATION_TARGET=production
pnpm install --frozen-lockfile
status_receipt="$incident_dir/migration-status.txt"

# Pending migrations deliberately make db:migrate:status exit 1. Disable
# errexit only around that command so an inherited `set -e` cannot discard the
# receipt or skip classification.
set +e
pnpm --filter @wcdraft/db db:migrate:status >"$status_receipt" 2>&1
status_rc=$?
set -e
printf 'migration-status exit=%s receipt=%s\n' "$status_rc" "$status_receipt"

# SECURITY: the caught driver error can contain endpoint/connection details.
# Never cat or otherwise echo the raw receipt. Print only an allowlisted count
# summary after classification; query-error output stays in the mode-0600 file.
safe_summary="$(
  grep -Eo '\[db:migrate:status\] applied=[0-9]+ pending=[0-9]+ total=[0-9]+' \
    "$status_receipt" | tail -n 1 || true
)"

if [ "$status_rc" -eq 0 ] &&
  grep -Eq '\[db:migrate:status\] applied=[0-9]+ pending=0 total=[0-9]+' "$status_receipt"; then
  migration_decision=ready
elif [ "$status_rc" -eq 1 ] &&
  grep -Eq '\[db:migrate:status\] applied=[0-9]+ pending=[1-9][0-9]* total=[0-9]+' "$status_receipt" &&
  ! grep -Fq '[db:migrate:status] FAILED' "$status_receipt"; then
  migration_decision=known-pending
elif grep -Fq 'but this checkout only knows' "$status_receipt"; then
  migration_decision=database-ahead
else
  migration_decision=query-error
fi

printf 'migration decision: %s\n' "$migration_decision"
if [ -n "$safe_summary" ] && [ "$migration_decision" != "query-error" ]; then
  printf '%s\n' "$safe_summary"
fi
case "$migration_decision" in
  known-pending)
    # This is the only decision that may reach the migration command below.
    ;;
  ready)
    echo 'STOP: database is already at this checkout; no migration is needed.'
    exit 0
    ;;
  database-ahead)
    echo 'STOP: database is ahead; select compatible code instead of migrating.' >&2
    exit 1
    ;;
  query-error)
    echo 'STOP: status was not a verified known-pending receipt; investigate the query/error.' >&2
    exit 1
    ;;
esac

migrate_receipt="$incident_dir/migrate.txt"
set +e
pnpm --filter @wcdraft/db db:migrate >"$migrate_receipt" 2>&1
migrate_rc=$?
set -e
printf 'migration exit=%s receipt=%s\n' "$migrate_rc" "$migrate_receipt"
[ "$migrate_rc" -eq 0 ] || {
  echo 'STOP: migration failed; inspect the protected receipt without echoing it.' >&2
  exit 1
}

post_status_receipt="$incident_dir/migration-status-after.txt"
set +e
pnpm --filter @wcdraft/db db:migrate:status >"$post_status_receipt" 2>&1
post_status_rc=$?
set -e
post_safe_summary="$(
  grep -Eo '\[db:migrate:status\] applied=[0-9]+ pending=0 total=[0-9]+' \
    "$post_status_receipt" | tail -n 1 || true
)"
if [ "$post_status_rc" -ne 0 ] || [ -z "$post_safe_summary" ] ||
  grep -Fq '[db:migrate:status] FAILED' "$post_status_receipt"; then
  echo "STOP: post-migration status failed; protected receipt=$post_status_receipt" >&2
  exit 1
fi
printf '%s\n' "$post_safe_summary"
```

The preflight accepts only the command's exact known-pending summary with exit
code `1`. Ready, database-ahead, and query/error output all stop before
migration. Preflight status, migration, and postflight status stdout/stderr
remain in the mode-0600 incident directory. Raw receipts are never echoed
because driver error text can include endpoint details.

## Verify

```bash
set -euo pipefail
curl --fail-with-body -sS https://www.wcdraft.com/api/health | jq -e '
  .ok == true and .db.status == "ready" and
  .schema.actual.index >= .schema.expected.minimum.index and
  .schema.actual.index <= .schema.expected.maximum.index
'
leaderboard_receipt="$incident_dir/leaderboard-after.json"
leaderboard_status="$(curl -sS -o "$leaderboard_receipt" -w '%{http_code}' \
  'https://www.wcdraft.com/api/leaderboard?limit=1')"
case "$leaderboard_status" in
  200) jq . "$leaderboard_receipt" ;;
  404) echo 'Leaderboard remains intentionally ship-dark (HTTP 404).' ;;
  *) echo "Unexpected leaderboard HTTP $leaderboard_status" >&2; exit 1 ;;
esac
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health \
  | jq -e '.ok == true'
```

Verification must use the production domain after Vercel reports the target deployment READY.

## Rollback

For a code-only regression, select the last known-good production deployment from the captured list and run:

```bash
test -n "${ROLLBACK_DEPLOYMENT:-}"
vercel rollback "$ROLLBACK_DEPLOYMENT" --scope pnascimento9596s-projects --yes
vercel rollback status wcdraft-web --scope pnascimento9596s-projects
curl --fail-with-body -sS https://www.wcdraft.com/api/health \
  | jq -e '.ok == true and .db.status == "ready"'
```

If database state must also move backward, stop here and follow `neon-restore-vercel-rollback.md`; the code deployment and restored schema must be selected as a compatible pair. Vercel documents `vercel rollback <deployment-id-or-url>` at <https://vercel.com/docs/cli>.
