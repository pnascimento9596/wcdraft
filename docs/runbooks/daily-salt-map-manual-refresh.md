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

- Before merge: preserve the candidate diff and failed receipt, close its PR,
  then delete only that unmerged branch. Committed `main` is untouched.
- Never hand-edit salts to make an incident disappear. A missing date remains unavailable until a deterministically generated artifact is reviewed and shipped.

After a merged refresh fails live checks, export its exact squash commit as
`REFRESH_MERGE_SHA`. The following creates a fresh protected revert PR and
captures the exact previous artifact before changing anything:

```bash
set -euo pipefail
test -n "${REFRESH_MERGE_SHA:-}"
repo_root="$(git rev-parse --show-toplevel)"
git -C "$repo_root" fetch origin main
git -C "$repo_root" cat-file -e "$REFRESH_MERGE_SHA^{commit}"
git -C "$repo_root" merge-base --is-ancestor "$REFRESH_MERGE_SHA" origin/main
(cd "$repo_root" &&
  scripts/ci/validate-daily-salt-map-revert.sh target "$REFRESH_MERGE_SHA")

rollback_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
rollback_branch="ws-fix/daily-salt-map-revert-$rollback_stamp"
rollback_worktree="/tmp/wcdraft-daily-revert-$rollback_stamp"
rollback_receipt="$(mktemp -d /tmp/wcdraft-daily-revert-receipt.XXXXXX)"
umask 077
artifact_path='packages/data/src/generated/daily-seed-salt-map.compact.json'
git -C "$repo_root" show "$REFRESH_MERGE_SHA^:$artifact_path" \
  >"$rollback_receipt/expected-previous-daily-seed-salt-map.json"
expected_artifact_sha="$(shasum -a 256 \
  "$rollback_receipt/expected-previous-daily-seed-salt-map.json" | awk '{print $1}')"
printf '%s\n' "$expected_artifact_sha" \
  >"$rollback_receipt/expected-artifact-sha256.txt"

git -C "$repo_root" worktree add "$rollback_worktree" \
  -b "$rollback_branch" origin/main
cd "$rollback_worktree"
git revert --no-commit "$REFRESH_MERGE_SHA"
git add \
  packages/data/src/generated/daily-seed-salt-map.compact.json \
  packages/data/src/generated/manifest.json \
  packages/data/reports/compact-size.json

pnpm install --frozen-lockfile
pnpm --filter @wcdraft/data exec vitest run \
  test/daily-seed-salt-map.golden.test.ts
pnpm check:generated
git diff --cached --check
scripts/ci/validate-daily-salt-map-revert.sh post-revert
git commit -m 'fix(data): revert failed Daily salt refresh'
git push --set-upstream origin "$rollback_branch"
pr_url="$(gh pr create \
  --base main \
  --head "$rollback_branch" \
  --title 'fix(data): revert failed Daily salt refresh' \
  --body "Reverts failed refresh commit $REFRESH_MERGE_SHA through the protected exact-SHA workflow. Previous artifact SHA-256: $expected_artifact_sha")"
pr_number="$(gh pr view "$pr_url" --json number --jq .number)"
revert_head_sha="$(gh pr view "$pr_number" --json headRefOid --jq .headRefOid)"
printf 'rollback PR=%s head=%s\n' "$pr_number" "$revert_head_sha"
```

Any rebase or pushed change invalidates both CI and independent review. Run the
required checks and fresh-session RED review on the final head, record the
reviewed SHA as `REVIEWED_HEAD_SHA`, and then use the exact-SHA merge gate:

```bash
set -euo pipefail
gh pr checks "$pr_number" --required --watch --fail-fast
test -n "${REVIEWED_HEAD_SHA:-}"
test "$REVIEWED_HEAD_SHA" = "$revert_head_sha"
test "$(gh pr view "$pr_number" --json headRefOid --jq .headRefOid)" = \
  "$revert_head_sha"
git fetch origin main
test "$(git merge-base "$revert_head_sha" origin/main)" = \
  "$(git rev-parse origin/main)" || {
  echo 'STOP: main moved; rebase, rerun gates, and obtain fresh exact-head review.' >&2
  exit 1
}
gh pr merge "$pr_number" --squash --delete-branch \
  --match-head-commit "$revert_head_sha"
revert_merge_sha="$(gh pr view "$pr_number" --json mergeCommit --jq .mergeCommit.oid)"
test -n "$revert_merge_sha"
git fetch origin main
git merge-base --is-ancestor "$revert_merge_sha" origin/main
printf 'revert merge=%s\n' "$revert_merge_sha"
```

Finally, wait for the exact revert build and prove both health and the deployed
artifact bytes. A dashboard READY badge alone is not sufficient:

```bash
set -euo pipefail
deployed_sha=''
attempt=1
while [ "$attempt" -le 60 ]; do
  if curl --fail-with-body -sS \
    -o "$rollback_receipt/health-after-revert.json" \
    https://www.wcdraft.com/api/health; then
    deployed_sha="$(jq -r '.build.sha // empty' \
      "$rollback_receipt/health-after-revert.json")"
    if [ "$deployed_sha" = "$revert_merge_sha" ] &&
      jq -e '.ok == true and .db.status == "ready"' \
        "$rollback_receipt/health-after-revert.json" >/dev/null; then
      break
    fi
  fi
  sleep 10
  attempt=$((attempt + 1))
done
[ "$deployed_sha" = "$revert_merge_sha" ] || {
  echo 'STOP: exact revert build did not become healthy in time.' >&2
  exit 1
}

schema_version="$(jq -er '.data.schema_version' \
  "$rollback_receipt/health-after-revert.json")"
curl --fail-with-body -sS \
  "https://www.wcdraft.com/data/wcdraft/$schema_version/daily-seed-salt-map.compact.json" \
  >"$rollback_receipt/live-daily-seed-salt-map.json"
live_artifact_sha="$(shasum -a 256 \
  "$rollback_receipt/live-daily-seed-salt-map.json" | awk '{print $1}')"
[ "$live_artifact_sha" = "$expected_artifact_sha" ]
jq -e '.window.days == 45 and (.dates | length) == 45' \
  "$rollback_receipt/live-daily-seed-salt-map.json" >/dev/null
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health \
  | jq -e '.ok == true'
printf 'verified build=%s artifact_sha256=%s receipt=%s\n' \
  "$deployed_sha" "$live_artifact_sha" "$rollback_receipt"
```

Keep the receipt, revert PR, exact review SHA, merge SHA, health response, and
artifact hash together. Fix forward from freshly fetched `main` if any probe
fails.
