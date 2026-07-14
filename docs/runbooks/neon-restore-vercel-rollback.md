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
test "$health_status" = 200
jq -e '.ok == true and .db.status == "ready"' \
  "$incident_dir/health-before.json" >/dev/null
og_health_status="$(curl -sS -o "$incident_dir/og-health-before.json" -w '%{http_code}' \
  https://www.wcdraft.com/api/og/health)"
printf 'OG health HTTP %s\n' "$og_health_status"
test "$og_health_status" = 200
jq -e '.ok == true' "$incident_dir/og-health-before.json" >/dev/null
vercel list wcdraft-web --environment production --status READY \
  --scope pnascimento9596s-projects | tee "$incident_dir/deployments.txt"
test -n "${NEON_API_KEY:-}"
test -n "${NEON_PROJECT_ID:-}"
test -n "${NEON_PRIMARY_BRANCH_ID:-}"
test -n "${RESTORE_TIMESTAMP:-}"
test -n "${PRE_RESTORE_DEPLOYMENT:-}"
case "${APPLICATION_PAIRING:-}" in
  current)
    test -z "${COUPLED_ORDER:-}" || {
      echo 'COUPLED_ORDER is only valid with APPLICATION_PAIRING=rollback.' >&2
      exit 1
    }
    ;;
  rollback)
    test -n "${RESTORE_COMPATIBLE_DEPLOYMENT:-}"
    case "${COUPLED_ORDER:-}" in
      database-first | application-first) ;;
      traffic-stopped)
        test "${TRAFFIC_SUSPENSION_EXPECTED_HTTP:-}" = 503 || {
          echo 'TRAFFIC_SUSPENSION_EXPECTED_HTTP must be exactly 503.' >&2
          exit 1
        }
        case "${TRAFFIC_SUSPENSION_MARKER:-}" in
          *[!A-Za-z0-9_-]* | '')
            echo 'TRAFFIC_SUSPENSION_MARKER must use only A-Z, a-z, 0-9, _ or -.' >&2
            exit 1
            ;;
        esac
        [ "${#TRAFFIC_SUSPENSION_MARKER}" -ge 32 ] || {
          echo 'TRAFFIC_SUSPENSION_MARKER must be an incident-unique value of at least 32 characters.' >&2
          exit 1
        }
        ;;
      *)
        echo 'Set COUPLED_ORDER=database-first, application-first, or traffic-stopped.' >&2
        exit 1
        ;;
    esac
    ;;
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
changing either system. A coupled rollback also requires an explicit
`COUPLED_ORDER=database-first|application-first|traffic-stopped`; the command
blocks below enforce that selection instead of silently defaulting to database
first.

Resolve the live alias rather than assuming the newest READY deployment is
current, and prove the selected rollback target is eligible before an incident
mutation:

```bash
vercel inspect https://www.wcdraft.com --format=json \
  --scope pnascimento9596s-projects --wait --timeout 30s \
  >"$incident_dir/current-deployment.json"
jq -e '.readyState == "READY" and .target == "production"' \
  "$incident_dir/current-deployment.json" >/dev/null
current_deployment_id="$(jq -er '.id' "$incident_dir/current-deployment.json")"
test "$PRE_RESTORE_DEPLOYMENT" = "$current_deployment_id"

if [ "$APPLICATION_PAIRING" = rollback ]; then
  vercel inspect "$RESTORE_COMPATIBLE_DEPLOYMENT" --format=json \
    --scope pnascimento9596s-projects --wait --timeout 30s \
    >"$incident_dir/rollback-candidate.json"
  jq -e --arg expected "$RESTORE_COMPATIBLE_DEPLOYMENT" '
    .id == $expected and .readyState == "READY" and .target == "production"
  ' \
    "$incident_dir/rollback-candidate.json" >/dev/null
fi
```

`vercel inspect` proves identity and READY production provenance, but it does
not expose rollback eligibility. Also save Vercel API/connector or dashboard
evidence that the exact candidate has `isRollbackCandidate=true`. Do not use a
preview deployment or infer eligibility from age/order alone.

## Decide

- Code regression with healthy data: Vercel rollback only; do not restore Neon.
- Data corruption with unchanged compatible schema: restore Neon, then keep or redeploy the current code only after `/api/health` is ready.
- Coupled migration/code regression: choose both a restore timestamp and a Vercel deployment with compatible expected/actual migrations. If compatibility is unknown, restore to a separate investigative branch first and do not attach production compute.

For a coupled rollback, there is no universally safe DB-first or code-first
order. Preselect and verify both artifacts, then choose the order whose first
state remains compatible with the still-current half. Minimize and measure the
mismatch window. If neither intermediate pairing is safe, select
`traffic-stopped`, execute an approved traffic-suspension procedure outside
this runbook, and configure that control to return HTTP 503 from both canonical
`/api/health` and `/api/og/health` endpoints with the same incident-unique
marker in the `x-wcdraft-traffic-suspended` response header and body. Set that
value as `TRAFFIC_SUSPENSION_MARKER`; it must be at least 32 URL-safe
characters. This runbook does not know how to stop or resume traffic. It first
records that both canonical endpoints served healthy HTTP 200 responses, then
refuses to mutate until both return the control-specific 503 marker.

## Define guarded recovery operations

The Neon operation below preserves the pre-restore branch under a unique name.
Receipts remain mode 0600 under the incident directory. Do not blindly retry a
timed-out restore POST; first inspect Neon operations and live branch state.

Before using this section in an incident, rehearse the same restore/reset
mechanism on a production-derived child branch. Write only an unmistakable
branch-local probe, capture its pre-mutation timestamp/LSN and aggregate
coherence counts, restore/reset only that child, prove the later probe is gone,
and delete every rehearsal/preservation branch. Never substitute the primary
branch ID into a rehearsal command.

```bash
set -euo pipefail
umask 077

require_production_alias_receipt() {
  local expected_deployment="$1"
  local receipt_name="$2"
  local receipt="$incident_dir/$receipt_name.json"
  jq -e --arg expected "$expected_deployment" '
    .id == $expected and .readyState == "READY" and .target == "production"
  ' "$receipt" >/dev/null
}

wait_for_production_alias() {
  local expected_deployment="$1"
  local receipt_name="$2"
  local receipt="$incident_dir/$receipt_name.json"
  local attempt=1
  while [ "$attempt" -le 60 ]; do
    if vercel inspect https://www.wcdraft.com --format=json \
      --scope pnascimento9596s-projects --wait --timeout 30s >"$receipt"; then
      if require_production_alias_receipt "$expected_deployment" "$receipt_name"; then
        printf 'Production alias verified at deployment %s\n' "$expected_deployment"
        return 0
      fi
    fi
    sleep 5
    attempt=$((attempt + 1))
  done
  echo "Production alias did not reach $expected_deployment." >&2
  return 1
}

require_application_pairing_receipts() {
  local receipt_name="$1"
  local expected_deployment="$2"
  local manifest="$incident_dir/$receipt_name-pairing.json"
  jq -e --arg expected "$expected_deployment" '
    .expected_deployment == $expected and
    .health_http == 200 and .database_status == "ready" and
    (.leaderboard_http == 200 or .leaderboard_http == 404) and
    .og_health_http == 200
  ' "$manifest" >/dev/null
  jq -e '.ok == true and .db.status == "ready"' \
    "$incident_dir/$receipt_name-health.json" >/dev/null
  jq -e '.ok == true' "$incident_dir/$receipt_name-og-health.json" >/dev/null
}

verify_application_pairing() {
  local receipt_name="$1"
  local expected_deployment="$2"
  local alias_receipt_name="$3"
  local health_http leaderboard_http og_health_http
  require_production_alias_receipt "$expected_deployment" "$alias_receipt_name"

  health_http="$(curl -sS -o "$incident_dir/$receipt_name-health.json" -w '%{http_code}' \
    https://www.wcdraft.com/api/health)"
  test "$health_http" = 200
  jq -e '.ok == true and .db.status == "ready"' \
    "$incident_dir/$receipt_name-health.json" >/dev/null

  leaderboard_http="$(curl -sS -o "$incident_dir/$receipt_name-leaderboard.json" \
    -w '%{http_code}' 'https://www.wcdraft.com/api/leaderboard?limit=1')"
  case "$leaderboard_http" in
    200) jq . "$incident_dir/$receipt_name-leaderboard.json" >/dev/null ;;
    404) ;;
    *) echo "Unexpected leaderboard HTTP $leaderboard_http" >&2; return 1 ;;
  esac

  og_health_http="$(curl -sS -o "$incident_dir/$receipt_name-og-health.json" \
    -w '%{http_code}' https://www.wcdraft.com/api/og/health)"
  test "$og_health_http" = 200
  jq -e '.ok == true' "$incident_dir/$receipt_name-og-health.json" >/dev/null

  jq -nc \
    --arg expected "$expected_deployment" \
    --argjson health "$health_http" \
    --argjson leaderboard "$leaderboard_http" \
    --argjson og "$og_health_http" \
    '{expected_deployment:$expected,health_http:$health,database_status:"ready",leaderboard_http:$leaderboard,og_health_http:$og}' \
    >"$incident_dir/$receipt_name-pairing.json"
  require_application_pairing_receipts "$receipt_name" "$expected_deployment"
}

require_traffic_suspension_configuration() {
  test "${TRAFFIC_SUSPENSION_EXPECTED_HTTP:-}" = 503 || {
    echo 'TRAFFIC_SUSPENSION_EXPECTED_HTTP must be exactly 503.' >&2
    return 1
  }
  case "${TRAFFIC_SUSPENSION_MARKER:-}" in
    *[!A-Za-z0-9_-]* | '')
      echo 'TRAFFIC_SUSPENSION_MARKER must use only A-Z, a-z, 0-9, _ or -.' >&2
      return 1
      ;;
  esac
  [ "${#TRAFFIC_SUSPENSION_MARKER}" -ge 32 ] || {
    echo 'TRAFFIC_SUSPENSION_MARKER must be an incident-unique value of at least 32 characters.' >&2
    return 1
  }
}

require_traffic_suspension_receipt() {
  local receipt_name="$1"
  local endpoint expected_url receipt
  require_traffic_suspension_configuration
  for endpoint in health og-health; do
    case "$endpoint" in
      health) expected_url='https://www.wcdraft.com/api/health' ;;
      og-health) expected_url='https://www.wcdraft.com/api/og/health' ;;
    esac
    receipt="$incident_dir/$receipt_name-traffic-suspension-$endpoint.json"
    jq -e \
      --arg url "$expected_url" \
      --arg marker "$TRAFFIC_SUSPENSION_MARKER" '
        .probe_url == $url and .expected_http == "503" and
        .observed_http == "503" and .expected_marker == $marker and
        .header_marker == $marker and .body_contains_marker == true
      ' "$receipt" >/dev/null
    grep -Fq -- "$TRAFFIC_SUSPENSION_MARKER" \
      "$incident_dir/$receipt_name-traffic-suspension-$endpoint-body.txt"
  done
}

probe_traffic_suspension_endpoint() {
  local receipt_name="$1"
  local endpoint="$2"
  local probe_url="$3"
  local headers="$incident_dir/$receipt_name-traffic-suspension-$endpoint-headers.txt"
  local body="$incident_dir/$receipt_name-traffic-suspension-$endpoint-body.txt"
  local observed_http header_marker body_contains_marker
  require_traffic_suspension_configuration
  observed_http="$(curl -sS \
    --proto '=https' --tlsv1.2 --max-time 30 \
    --dump-header "$headers" --output "$body" \
    --write-out '%{http_code}' "$probe_url")"
  header_marker="$(tr -d '\r' <"$headers" | awk -F ': *' '
    tolower($1) == "x-wcdraft-traffic-suspended" { print $2 }
  ' | tail -1)"
  body_contains_marker=false
  if grep -Fq -- "$TRAFFIC_SUSPENSION_MARKER" "$body"; then
    body_contains_marker=true
  fi
  jq -nc \
    --arg url "$probe_url" \
    --arg expected '503' \
    --arg observed "$observed_http" \
    --arg marker "$TRAFFIC_SUSPENSION_MARKER" \
    --arg header "$header_marker" \
    --argjson body_contains "$body_contains_marker" \
    '{probe_url:$url,expected_http:$expected,observed_http:$observed,
      expected_marker:$marker,header_marker:$header,
      body_contains_marker:$body_contains}' \
    >"$incident_dir/$receipt_name-traffic-suspension-$endpoint.json"
}

verify_traffic_suspended() {
  local receipt_name="$1"
  probe_traffic_suspension_endpoint \
    "$receipt_name" health https://www.wcdraft.com/api/health
  probe_traffic_suspension_endpoint \
    "$receipt_name" og-health https://www.wcdraft.com/api/og/health
  require_traffic_suspension_receipt "$receipt_name"
}

wait_for_neon_operations() {
  local response_path="$1"
  local receipt_prefix="$2"
  local operation_ids="$incident_dir/$receipt_prefix-operation-ids.txt"
  local operation_id attempt operation_receipt operation_status

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
  local expected_name="$1"
  local id_file="$2"
  local receipt_prefix="$3"
  local branches_receipt="$incident_dir/$receipt_prefix-branches.json"
  local branch_receipt="$incident_dir/$receipt_prefix-branch.json"
  local preserved_id

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

restore_neon_primary() {
  local preserve_name response_file payload
  case "$APPLICATION_PAIRING:${COUPLED_ORDER:-}" in
    current: | rollback:database-first) ;;
    rollback:application-first)
      require_production_alias_receipt \
        "$RESTORE_COMPATIBLE_DEPLOYMENT" application-first-alias
      require_application_pairing_receipts \
        application-first-intermediate "$RESTORE_COMPATIBLE_DEPLOYMENT"
      ;;
    rollback:traffic-stopped)
      require_traffic_suspension_receipt traffic-stopped-before-neon
      ;;
    *) echo 'Invalid recovery route; refusing Neon restore.' >&2; return 1 ;;
  esac

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
}

rollback_application() {
  local receipt_prefix="$1"
  case "$COUPLED_ORDER" in
    application-first)
      require_production_alias_receipt "$PRE_RESTORE_DEPLOYMENT" current-deployment
      ;;
    database-first)
      require_application_pairing_receipts \
        database-first-intermediate "$PRE_RESTORE_DEPLOYMENT"
      ;;
    traffic-stopped)
      require_traffic_suspension_receipt traffic-stopped-before-vercel
      ;;
    *) echo 'Invalid coupled order; refusing Vercel rollback.' >&2; return 1 ;;
  esac

  vercel rollback "$RESTORE_COMPATIBLE_DEPLOYMENT" \
    --scope pnascimento9596s-projects --yes --timeout 3m --no-color \
    | tee "$incident_dir/$receipt_prefix-vercel-rollback.txt"
  vercel rollback status wcdraft-web \
    --scope pnascimento9596s-projects --timeout 30s --no-color \
    | tee "$incident_dir/$receipt_prefix-vercel-rollback-status.txt"
  wait_for_production_alias \
    "$RESTORE_COMPATIBLE_DEPLOYMENT" "$receipt_prefix-alias"
}
```

The response's `.branch` is the restored target, not proof of the preserved
branch ID. The procedure therefore waits on every returned operation, searches
the live branch list, requires exactly one exact-name match, reads that branch
back by ID, and saves the ID separately. Neon documents the current restore,
branch-list, and operation-detail contracts at
<https://api-docs.neon.tech/reference/restoreprojectbranch>,
<https://api-docs.neon.tech/reference/listprojectbranches>, and
<https://api-docs.neon.tech/reference/getprojectoperation>.

## Execute the selected order

Run exactly one route. Each mutation function rechecks the receipt produced by
the required intermediate verification; jumping directly to the second
mutation therefore fails closed.

```bash
case "$APPLICATION_PAIRING:${COUPLED_ORDER:-}" in
  # ROUTE current-application
  current:)
    restore_neon_primary
    ;;

  # ROUTE application-first
  rollback:application-first)
    rollback_application application-first
    verify_application_pairing \
      application-first-intermediate \
      "$RESTORE_COMPATIBLE_DEPLOYMENT" application-first-alias
    restore_neon_primary
    ;;

  # ROUTE database-first
  rollback:database-first)
    restore_neon_primary
    wait_for_production_alias \
      "$PRE_RESTORE_DEPLOYMENT" database-first-current-alias
    verify_application_pairing \
      database-first-intermediate \
      "$PRE_RESTORE_DEPLOYMENT" database-first-current-alias
    rollback_application database-first
    ;;

  # ROUTE traffic-stopped
  rollback:traffic-stopped)
    verify_traffic_suspended traffic-stopped-before-neon
    restore_neon_primary
    verify_traffic_suspended traffic-stopped-before-vercel
    rollback_application traffic-stopped
    verify_traffic_suspended traffic-stopped-after-vercel
    ;;

  *)
    echo 'Invalid recovery route; no mutation executed.' >&2
    exit 1
    ;;
esac
```

The `traffic-stopped` route deliberately contains no suspension or resumption
command. An operator must suspend traffic through an approved external control
before running it. The route records and revalidates the incident-marked 503
from both canonical health endpoints before Neon restore, before Vercel
rollback, and after Vercel rollback. Resume
traffic externally only after both mutations and incident-specific database
readback are complete. Save that readback under the incident directory, then
resume through the approved external control, set `TRAFFIC_RESUMED_ACK=yes`,
and run the final verification below.

Vercel Instant Rollback can retain older build-time configuration, so verify
environment-dependent behavior rather than assuming current project settings
were applied. See <https://vercel.com/docs/instant-rollback>.

## Verify

Wait for Neon operations and any Vercel rollback to finish. For the
`traffic-stopped` route, resume traffic using the approved external control
first; the acknowledgement only unlocks these positive serving checks and is
not itself treated as proof.

```bash
set -euo pipefail
if [ "${COUPLED_ORDER:-}" = traffic-stopped ]; then
  test "${TRAFFIC_RESUMED_ACK:-}" = yes || {
    echo 'Resume traffic externally and set TRAFFIC_RESUMED_ACK=yes.' >&2
    exit 1
  }
fi

case "$APPLICATION_PAIRING" in
  current) final_deployment="$PRE_RESTORE_DEPLOYMENT" ;;
  rollback) final_deployment="$RESTORE_COMPATIBLE_DEPLOYMENT" ;;
  *) echo 'Invalid application pairing.' >&2; exit 1 ;;
esac
wait_for_production_alias "$final_deployment" final-alias
verify_application_pairing final "$final_deployment" final-alias
```

Perform a readback of the incident-specific rows/counts using an approved
read-only query. For `traffic-stopped`, this receipt must already exist before
traffic is resumed. Keep the preserved pre-restore branch until the receipt is
reviewed.

## Rollback the rollback

Do not delete the preserved branch during the incident. If the restore point
was wrong, first select `INVERSE_COUPLED_ORDER=database-first`,
`application-first`, or `traffic-stopped` using the same compatibility test as
the forward recovery. When the forward recovery did not change the application
(`APPLICATION_PAIRING=current`), leave `INVERSE_COUPLED_ORDER` unset and only
the database is restored. Preserve the failed restore under a second unique
name, wait for API operations, and capture that second branch from API truth.
The guarded dispatcher below requires an exact alias plus application-health
receipt after the first inverse mutation before it permits the second one.

```bash
set -euo pipefail
case "$APPLICATION_PAIRING:${INVERSE_COUPLED_ORDER:-}" in
  current:) ;;
  rollback:database-first | rollback:application-first | rollback:traffic-stopped) ;;
  *)
    echo 'Set INVERSE_COUPLED_ORDER=database-first, application-first, or traffic-stopped.' >&2
    exit 1
    ;;
esac

restore_neon_primary_from_preserved() {
  local preserved_branch_id failed_restore_name inverse_response inverse_payload
  case "$APPLICATION_PAIRING:${INVERSE_COUPLED_ORDER:-}" in
    current: | rollback:database-first) ;;
    rollback:application-first)
      require_production_alias_receipt \
        "$PRE_RESTORE_DEPLOYMENT" inverse-application-first-alias
      require_application_pairing_receipts \
        inverse-application-first-intermediate "$PRE_RESTORE_DEPLOYMENT"
      ;;
    rollback:traffic-stopped)
      require_traffic_suspension_receipt inverse-traffic-stopped-before-neon
      ;;
    *) echo 'Invalid inverse route; refusing Neon restore.' >&2; return 1 ;;
  esac

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
}

promote_pre_restore_application() {
  local receipt_prefix="$1"
  case "$INVERSE_COUPLED_ORDER" in
    application-first)
      require_production_alias_receipt "$RESTORE_COMPATIBLE_DEPLOYMENT" final-alias
      require_application_pairing_receipts final "$RESTORE_COMPATIBLE_DEPLOYMENT"
      ;;
    database-first)
      require_application_pairing_receipts \
        inverse-database-first-intermediate "$RESTORE_COMPATIBLE_DEPLOYMENT"
      ;;
    traffic-stopped)
      require_traffic_suspension_receipt inverse-traffic-stopped-before-vercel
      ;;
    *) echo 'Invalid inverse order; refusing Vercel promotion.' >&2; return 1 ;;
  esac

  vercel promote "$PRE_RESTORE_DEPLOYMENT" \
    --scope pnascimento9596s-projects --yes \
    | tee "$incident_dir/$receipt_prefix-vercel-promote.txt"
  vercel promote status wcdraft-web --scope pnascimento9596s-projects \
    | tee "$incident_dir/$receipt_prefix-vercel-promote-status.txt"
  wait_for_production_alias \
    "$PRE_RESTORE_DEPLOYMENT" "$receipt_prefix-alias"
}

case "$APPLICATION_PAIRING:${INVERSE_COUPLED_ORDER:-}" in
  # INVERSE ROUTE current-application
  current:)
    restore_neon_primary_from_preserved
    ;;

  # INVERSE ROUTE application-first
  rollback:application-first)
    promote_pre_restore_application inverse-application-first
    verify_application_pairing \
      inverse-application-first-intermediate \
      "$PRE_RESTORE_DEPLOYMENT" inverse-application-first-alias
    restore_neon_primary_from_preserved
    ;;

  # INVERSE ROUTE database-first
  rollback:database-first)
    restore_neon_primary_from_preserved
    wait_for_production_alias \
      "$RESTORE_COMPATIBLE_DEPLOYMENT" inverse-database-first-current-alias
    verify_application_pairing \
      inverse-database-first-intermediate \
      "$RESTORE_COMPATIBLE_DEPLOYMENT" inverse-database-first-current-alias
    promote_pre_restore_application inverse-database-first
    ;;

  # INVERSE ROUTE traffic-stopped
  rollback:traffic-stopped)
    verify_traffic_suspended inverse-traffic-stopped-before-neon
    restore_neon_primary_from_preserved
    verify_traffic_suspended inverse-traffic-stopped-before-vercel
    promote_pre_restore_application inverse-traffic-stopped
    verify_traffic_suspended inverse-traffic-stopped-after-vercel
    ;;
esac

if [ "${INVERSE_COUPLED_ORDER:-}" = traffic-stopped ]; then
  test "${INVERSE_TRAFFIC_RESUMED_ACK:-}" = yes || {
    echo 'Resume traffic externally and set INVERSE_TRAFFIC_RESUMED_ACK=yes.' >&2
    exit 1
  }
fi
wait_for_production_alias "$PRE_RESTORE_DEPLOYMENT" inverse-final-alias
verify_application_pairing inverse-final "$PRE_RESTORE_DEPLOYMENT" inverse-final-alias
```

Omitting a timestamp in the inverse request intentionally restores the target
from the preserved source branch's head. Delete neither preservation branch
until incident-specific data readback, health, and deployment receipts are
approved. For an inverse `traffic-stopped` route, keep the same marker-bearing
control active through both mutations, perform the data readback, then resume
externally before setting `INVERSE_TRAFFIC_RESUMED_ACK=yes`; the final positive
serving checks remain authoritative.
