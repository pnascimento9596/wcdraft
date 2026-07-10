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
test -n "${PRE_RESTORE_DEPLOYMENT:-}"
case "${APPLICATION_PAIRING:-}" in
  current) ;;
  rollback) test -n "${RESTORE_COMPATIBLE_DEPLOYMENT:-}" ;;
  *)
    echo 'Set APPLICATION_PAIRING=current or rollback before restoring.' >&2
    exit 1
    ;;
esac
```

`RESTORE_TIMESTAMP` must be an ISO-8601 UTC timestamp inside Neon's restore
window. Record the exact deployment currently serving production as
`PRE_RESTORE_DEPLOYMENT`; this is the compatible application target for an
inverse restore. Set `APPLICATION_PAIRING=current` only when the current code
supports the restore point. Otherwise set it to `rollback` and record the
preselected compatible deployment as `RESTORE_COMPATIBLE_DEPLOYMENT` before
changing either system.

## Decide

- Code regression with healthy data: Vercel rollback only; do not restore Neon.
- Data corruption with unchanged compatible schema: restore Neon, then keep or redeploy the current code only after `/api/health` is ready.
- Coupled migration/code regression: choose both a restore timestamp and a Vercel deployment with compatible expected/actual migrations. If compatibility is unknown, restore to a separate investigative branch first and do not attach production compute.

## Restore the production branch

The API call below preserves the pre-restore branch under a unique name. Save the response at mode 0600 and do not blindly retry a timed-out POST; first inspect Neon operations/state.

```bash
set -euo pipefail
umask 077

wait_for_neon_operations() {
  response_path="$1"
  receipt_prefix="$2"
  operation_ids="$incident_dir/$receipt_prefix-operation-ids.txt"

  jq -er '.operations | select(length > 0) | .[].id' \
    "$response_path" >"$operation_ids"
  while IFS= read -r operation_id; do
    attempt=1
    while [ "$attempt" -le 60 ]; do
      operation_receipt="$incident_dir/$receipt_prefix-operation-$operation_id.json"
      curl --fail-with-body -sS \
        "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/operations/$operation_id" \
        --header "Authorization: Bearer $NEON_API_KEY" >"$operation_receipt"
      operation_status="$(jq -er '.operation.status' "$operation_receipt")"
      printf 'Neon operation %s status=%s\n' "$operation_id" "$operation_status"
      case "$operation_status" in
        finished) break ;;
        scheduling|running|cancelling)
          sleep 5
          attempt=$((attempt + 1))
          ;;
        failed|error|cancelled|skipped)
          echo "Neon operation $operation_id did not finish successfully." >&2
          return 1
          ;;
        *)
          echo "Unknown Neon operation status: $operation_status" >&2
          return 1
          ;;
      esac
    done
    [ "$operation_status" = "finished" ] || {
      echo "Timed out waiting for Neon operation $operation_id." >&2
      return 1
    }
  done <"$operation_ids"
}

capture_preserved_branch_id() {
  expected_name="$1"
  id_file="$2"
  receipt_prefix="$3"
  branches_receipt="$incident_dir/$receipt_prefix-branches.json"
  branch_receipt="$incident_dir/$receipt_prefix-branch.json"

  curl --fail-with-body -sS --get \
    "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
    --header "Authorization: Bearer $NEON_API_KEY" \
    --data-urlencode "search=$expected_name" \
    --data-urlencode 'limit=100' >"$branches_receipt"
  preserved_id="$(jq -er --arg name "$expected_name" '
    [.branches[] | select(.name == $name)]
    | if length == 1 then .[0].id
      else error("expected exactly one preserved branch") end
  ' "$branches_receipt")"

  curl --fail-with-body -sS \
    "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$preserved_id" \
    --header "Authorization: Bearer $NEON_API_KEY" >"$branch_receipt"
  jq -e --arg id "$preserved_id" --arg name "$expected_name" '
    .branch.id == $id and .branch.name == $name and
    .branch.current_state == "ready"
  ' "$branch_receipt" >/dev/null
  printf '%s\n' "$preserved_id" >"$id_file"
  printf 'Captured preserved branch id=%s name=%s\n' \
    "$preserved_id" "$expected_name"
}

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
jq -e --arg primary "$NEON_PRIMARY_BRANCH_ID" \
  '.branch.id == $primary and (.operations | length > 0)' \
  "$response_file" >/dev/null
jq '{branch:{id:.branch.id,name:.branch.name,current_state:.branch.current_state},operations:[.operations[]|{id,action,status}]}' \
  "$response_file"
wait_for_neon_operations "$response_file" restore
capture_preserved_branch_id \
  "$preserve_name" "$incident_dir/preserved-branch-id.txt" pre-restore
```

The response's `.branch` is the restored target, not proof of the preserved
branch ID. The procedure therefore waits on every returned operation, searches
the live branch list, requires exactly one exact-name match, reads that branch
back by ID, and saves the ID separately. Neon documents the current restore,
branch-list, and operation-detail contracts at
<https://api-docs.neon.tech/reference/restoreprojectbranch>,
<https://api-docs.neon.tech/reference/listprojectbranches>, and
<https://api-docs.neon.tech/reference/getprojectoperation>.

## Pair the application deployment

Apply the application pairing selected before the restore:

```bash
case "$APPLICATION_PAIRING" in
  current)
    echo 'Keeping the current production deployment as the selected pairing.'
    ;;
  rollback)
    vercel rollback "$RESTORE_COMPATIBLE_DEPLOYMENT" \
      --scope pnascimento9596s-projects --yes
    vercel rollback status wcdraft-web --scope pnascimento9596s-projects
    ;;
esac
```

Vercel Instant Rollback can retain older build-time configuration, so verify environment-dependent behavior rather than assuming current project settings were applied. See <https://vercel.com/docs/instant-rollback>.

## Verify

Wait for Neon operations and the Vercel rollback to finish, then run:

```bash
set -euo pipefail
curl --fail-with-body -sS https://www.wcdraft.com/api/health \
  | tee "$incident_dir/health-after.json" | jq -e '.ok == true and .db.status == "ready"'
leaderboard_status="$(curl -sS -o "$incident_dir/leaderboard-after.json" -w '%{http_code}' \
  'https://www.wcdraft.com/api/leaderboard?limit=1')"
case "$leaderboard_status" in
  200) jq . "$incident_dir/leaderboard-after.json" ;;
  404) echo 'Leaderboard remains intentionally ship-dark (HTTP 404).' ;;
  *) echo "Unexpected leaderboard HTTP $leaderboard_status" >&2; exit 1 ;;
esac
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health \
  | jq -e '.ok == true'
```

Perform a readback of the incident-specific rows/counts using an approved read-only query. Keep the preserved pre-restore branch until the receipt is reviewed.

## Rollback the rollback

Do not delete the preserved branch during the incident. If the restore point
was wrong, restore the primary branch from the captured preserved branch's
head. Preserve the failed restore under a second unique name, wait for API
operations, capture that second branch from API truth, and promote the exact
deployment that was serving before the restore:

```bash
set -euo pipefail
preserved_branch_id="$(tr -d '\r\n' <"$incident_dir/preserved-branch-id.txt")"
test -n "$preserved_branch_id"
failed_restore_name="failed-restore-$(date -u +%Y%m%dT%H%M%SZ)"
inverse_response="$incident_dir/neon-inverse-restore-response.json"
inverse_payload="$(jq -nc \
  --arg source "$preserved_branch_id" \
  --arg preserve "$failed_restore_name" \
  '{source_branch_id:$source,preserve_under_name:$preserve}')"

curl --fail-with-body -sS --request POST \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$NEON_PRIMARY_BRANCH_ID/restore" \
  --header "Authorization: Bearer $NEON_API_KEY" \
  --header 'Content-Type: application/json' \
  --data "$inverse_payload" >"$inverse_response"
jq -e --arg primary "$NEON_PRIMARY_BRANCH_ID" \
  '.branch.id == $primary and (.operations | length > 0)' \
  "$inverse_response" >/dev/null
wait_for_neon_operations "$inverse_response" inverse-restore
capture_preserved_branch_id \
  "$failed_restore_name" "$incident_dir/failed-restore-branch-id.txt" failed-restore

vercel promote "$PRE_RESTORE_DEPLOYMENT" \
  --scope pnascimento9596s-projects --yes
vercel promote status wcdraft-web --scope pnascimento9596s-projects

curl --fail-with-body -sS https://www.wcdraft.com/api/health \
  | tee "$incident_dir/health-after-inverse.json" \
  | jq -e '.ok == true and .db.status == "ready"'
curl --fail-with-body -sS https://www.wcdraft.com/api/og/health \
  | jq -e '.ok == true'
```

Omitting a timestamp in the inverse request intentionally restores the target
from the preserved source branch's head. Delete neither preservation branch
until incident-specific data readback, health, and deployment receipts are
approved.
