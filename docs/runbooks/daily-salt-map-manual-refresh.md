# Manual Daily salt-map refresh

Use this if nightly automation misses its awake window, its branch cannot be updated safely, or the committed runway approaches the 14-day fail-closed floor. Capture the UTC date once and use it for the whole run.

## Inspect and decide

```bash
set -euo pipefail
captured_date="$(date -u +%F)"
node packages/data/scripts/daily-seed-runway.mjs inspect \
  --artifact packages/data/src/generated/daily-seed-salt-map.compact.json \
  --today "$captured_date"
```

- At least 22 covered days remain: no refresh is required; record the receipt.
- 14–21 days remain: refresh now and open/update the automation PR.
- Fewer than 14 days remain: treat as urgent; Daily intentionally fails closed outside committed coverage.

## Regenerate

Work in a fresh branch from current main. Preserve the old artifact for overlap comparison.

```bash
set -euo pipefail
runner_temp="${RUNNER_TEMP:-/tmp}"
cp packages/data/src/generated/daily-seed-salt-map.compact.json \
  "$runner_temp/committed-daily-seed-salt-map.json"
pnpm install --frozen-lockfile
pnpm --filter @wcdraft/data run build:compact
pnpm --filter @wcdraft/data run build:score-distribution
pnpm --filter @wcdraft/data run build:compact
pnpm --filter @wcdraft/data run build:daily-seed-salt-map \
  --start-date "$captured_date" --window-days 45
pnpm --filter @wcdraft/data run build:compact
node packages/data/scripts/daily-seed-runway.mjs compare-overlap \
  --committed "$runner_temp/committed-daily-seed-salt-map.json" \
  --generated packages/data/src/generated/daily-seed-salt-map.compact.json
```

Do not change salt policy, sample size, degeneracy bands, or generation order during an operational refresh.

## Verify and publish

```bash
set -euo pipefail
pnpm --filter @wcdraft/data exec vitest run test/daily-seed-salt-map.golden.test.ts
pnpm check:generated
git diff --check
git add \
  packages/data/src/generated/daily-seed-salt-map.compact.json \
  packages/data/src/generated/manifest.json \
  packages/data/reports/compact-size.json
git diff --cached --check
```

Confirm those are the only changed paths, commit conventionally, push with an exact lease, and open/update the dedicated refresh PR. Protected CI, independent RED review, merge, deployment READY, and live manifest/hash checks still apply.

After deployment:

```bash
schema_version="$(
  curl --fail-with-body -sS https://www.wcdraft.com/api/health \
    | tee /tmp/wcdraft-daily-health.json \
    | jq -er '.data.schema_version'
)"
curl --fail-with-body -sS \
  "https://www.wcdraft.com/data/wcdraft/$schema_version/daily-seed-salt-map.compact.json" \
  | jq '.window, (.dates | length)'
```

## Rollback

- Before merge: delete only the unmerged refresh branch after preserving its diff/receipt; committed main is untouched.
- After merge with failed live checks: revert the refresh PR through the protected workflow, verify the previous artifact and `/api/health`, then fix forward on a new branch.
- Never hand-edit salts to make an incident disappear. A missing date remains unavailable until a deterministically generated artifact is reviewed and shipped.
