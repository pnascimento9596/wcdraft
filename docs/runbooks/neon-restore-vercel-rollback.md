# Neon instant restore paired with Vercel rollback

Use this only for confirmed production data/schema corruption or a migration that cannot be fixed forward safely. A Vercel rollback does not undo database writes; a Neon restore does not change application code. Treat them as one compatibility decision.

## Preconditions and evidence

```bash
set -euo pipefail
umask 077
incident_dir="$(mktemp -d /tmp/wcdraft-restore-incident.XXXXXX)"
health_status="$(curl -sS -o "$incident_dir/health-before.json" -w '%{http_code}' \
  https://www.wcdraft.com/api/health)"
printf 'health HTTP %s\n' "$health_status"
jq . "$incident_dir/health-before.json"
vercel list wcdraft-web --environment production --status READY \
  --scope pnascimento9596s-projects | tee "$incident_dir/deployments.txt"
test -n "${NEON_API_KEY:-}"
test -n "${NEON_PROJECT_ID:-}"
test -n "${NEON_PRIMARY_BRANCH_ID:-}"
test -n "${RESTORE_TIMESTAMP:-}"
```

`RESTORE_TIMESTAMP` must be an ISO-8601 UTC timestamp inside Neon's restore window. Identify the last known-good Vercel deployment whose schema range matches the restore point before changing either system.

## Decide

- Code regression with healthy data: Vercel rollback only; do not restore Neon.
- Data corruption with unchanged compatible schema: restore Neon, then keep or redeploy the current code only after `/api/health` is ready.
- Coupled migration/code regression: choose both a restore timestamp and a Vercel deployment with compatible expected/actual migrations. If compatibility is unknown, restore to a separate investigative branch first and do not attach production compute.

## Restore the production branch

The API call below preserves the pre-restore branch under a unique name. Save the response at mode 0600 and do not blindly retry a timed-out POST; first inspect Neon operations/state.

```bash
set -euo pipefail
umask 077
preserve_name="pre-restore-$(date -u +%Y%m%dT%H%M%SZ)"
response_file="$incident_dir/neon-restore-response.json"
payload="$(jq -nc \
  --arg source "$NEON_PRIMARY_BRANCH_ID" \
  --arg timestamp "$RESTORE_TIMESTAMP" \
  --arg preserve "$preserve_name" \
  '{source_branch_id:$source,source_timestamp:$timestamp,preserve_under_name:$preserve}')"
curl --fail-with-body -sS --request POST \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$NEON_PRIMARY_BRANCH_ID/restore" \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "$payload" >"$response_file"
jq '{branch,operations}' "$response_file"
```

Neon's current restore endpoint and required `source_branch_id` plus timestamp/LSN contract are documented at <https://api-docs.neon.tech/reference/restoreprojectbranch>.

## Pair the application deployment

If the current build does not support the restored migration, immediately roll back to the preselected compatible deployment:

```bash
vercel rollback '<compatible-deployment-id-or-url>' \
  --scope pnascimento9596s-projects --yes
vercel rollback status wcdraft-web --scope pnascimento9596s-projects
```

Vercel Instant Rollback can retain older build-time configuration, so verify environment-dependent behavior rather than assuming current project settings were applied. See <https://vercel.com/docs/instant-rollback>.

## Verify

Wait for Neon operations and the Vercel rollback to finish, then run:

```bash
set -euo pipefail
curl --fail-with-body -sS https://www.wcdraft.com/api/health \
  | tee "$incident_dir/health-after.json" | jq -e '.ok == true and .db.status == "ready"'
curl --fail-with-body -sS 'https://www.wcdraft.com/api/leaderboard?limit=1' | jq .
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health | jq .
```

Perform a readback of the incident-specific rows/counts using an approved read-only query. Keep the preserved pre-restore branch until the receipt is reviewed.

## Rollback the rollback

Do not delete the preserved branch during the incident. If the restore point was wrong, use the same Neon restore endpoint with that preserved branch as `source_branch_id`, then promote a compatible Vercel deployment:

```bash
vercel promote '<deployment-id-or-url>' --scope pnascimento9596s-projects --yes
curl --fail-with-body -sS https://www.wcdraft.com/api/health | jq .
```

Delete preserved/orphaned branches only after data, health, and deployment receipts are approved.
