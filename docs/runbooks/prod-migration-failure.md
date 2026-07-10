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

Start from the exact approved commit. Load the direct URL from the approved secret store into the environment without echoing it.

```bash
test -n "${DATABASE_URL_UNPOOLED:-}"
pnpm install --frozen-lockfile
pnpm --filter @wcdraft/db db:migrate:status
printf 'migration-status exit=%s\n' "$?"
```

Inspect the status receipt. Continue only when it reports known pending
migrations from this checkout; a database-ahead or query error needs a
compatible-code decision, not a blind migrate. Then run:

```bash
set -euo pipefail
test -n "${DATABASE_URL_UNPOOLED:-}"
pnpm --filter @wcdraft/db db:migrate
pnpm --filter @wcdraft/db db:migrate:status
```

The first status command exits non-zero when migrations are pending. Save that receipt; do not suppress an unexpected "database ahead" result.

## Verify

```bash
set -euo pipefail
curl --fail-with-body -sS https://www.wcdraft.com/api/health | jq -e '
  .ok == true and .db.status == "ready" and
  .schema.actual.index >= .schema.expected.minimum.index and
  .schema.actual.index <= .schema.expected.maximum.index
'
curl --fail-with-body -sS 'https://www.wcdraft.com/api/leaderboard?limit=1' | jq .
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health | jq .
```

Verification must use the production domain after Vercel reports the target deployment READY.

## Rollback

For a code-only regression, select the last known-good production deployment from the captured list and run:

```bash
vercel rollback '<deployment-id-or-url>' --scope pnascimento9596s-projects --yes
vercel rollback status wcdraft-web --scope pnascimento9596s-projects
curl --fail-with-body -sS https://www.wcdraft.com/api/health | jq .
```

If database state must also move backward, stop here and follow `neon-restore-vercel-rollback.md`; the code deployment and restored schema must be selected as a compatible pair. Vercel documents `vercel rollback <deployment-id-or-url>` at <https://vercel.com/docs/cli>.
