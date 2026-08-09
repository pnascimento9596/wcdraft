#!/usr/bin/env bash
# shellcheck disable=SC1003,SC2016
set -euo pipefail

# Portable fixed-string search (rg_fixed preferred; grep fallback for lean images).
rg_fixed() {
  if command -v rg >/dev/null 2>&1; then
    rg "$@"
  else
    # Map common rg flags used in this script onto grep.
    # Supported here: -Fq, -nF, -F --count-matches
    args=()
    count=0
    fixed=0
    quiet=0
    line_num=0
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -Fq) quiet=1; fixed=1; shift ;;
        -nF) line_num=1; fixed=1; shift ;;
        -F) fixed=1; shift ;;
        --count-matches) count=1; shift ;;
        --) shift; break ;;
        -*) shift ;;
        *) break ;;
      esac
    done
    pattern="$1"; shift || true
    file="$1"; shift || true
    gargs=()
    [ "$fixed" -eq 1 ] && gargs+=(-F)
    [ "$quiet" -eq 1 ] && gargs+=(-q)
    [ "$line_num" -eq 1 ] && gargs+=(-n)
    [ "$count" -eq 1 ] && gargs+=(-c)
    grep "${gargs[@]}" -- "$pattern" "$file"
  fi
}


repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runbook="$repo_root/docs/runbooks/neon-restore-vercel-rollback.md"
diagnostics="$repo_root/scripts/ci/external-tool-diagnostics.sh"
workflow="$repo_root/.github/workflows/ci.yml"
combined_bash="$(mktemp)"
route_block_file="$(mktemp)"
traffic_config_block="$(mktemp)"
mutation_guard_block="$(mktemp)"
trap 'rm -f "$combined_bash" "$route_block_file" "$traffic_config_block" "$mutation_guard_block"' EXIT

awk '
  /^```bash$/ { inside = 1; next }
  /^```$/ && inside { inside = 0; print ""; next }
  inside { print }
' "$runbook" >"$combined_bash"
bash -n "$combined_bash"
test -r "$diagnostics"
bash -n "$diagnostics"

require_literal() {
  literal="$1"
  if command -v rg >/dev/null 2>&1; then
    rg_fixed -Fq -- "$literal" "$runbook" || {
      printf 'missing runbook contract: %s\n' "$literal" >&2
      exit 1
    }
  else
    grep -Fq -- "$literal" "$runbook" || {
      printf 'missing runbook contract: %s\n' "$literal" >&2
      exit 1
    }
  fi
}

require_count() {
  expected="$1"
  literal="$2"
  if command -v rg >/dev/null 2>&1; then
    actual="$(rg_fixed -F --count-matches -- "$literal" "$runbook" || true)"
  else
    actual="$(grep -F --count -- "$literal" "$runbook" || true)"
  fi
  [ "$actual" -eq "$expected" ] || {
    printf 'expected %s occurrence(s) of %s, found %s\n' \
      "$expected" "$literal" "$actual" >&2
    exit 1
  }
}

assert_route_order() {
  route="$1"
  shift
  sed -n "/# ROUTE $route/,/;;/p" "$runbook" >"$route_block_file"
  [ -s "$route_block_file" ] || {
    printf 'missing route block: %s\n' "$route" >&2
    exit 1
  }
  previous=0
  for literal in "$@"; do
    line="$(rg_fixed -nF -- "$literal" "$route_block_file" | head -1 | cut -d: -f1)"
    [ -n "$line" ] && [ "$line" -gt "$previous" ] || {
      printf 'route %s is missing or misorders: %s\n' "$route" "$literal" >&2
      exit 1
    }
    previous="$line"
  done
}

assert_inverse_route_order() {
  route="$1"
  shift
  sed -n "/# INVERSE ROUTE $route/,/;;/p" "$runbook" >"$route_block_file"
  [ -s "$route_block_file" ] || {
    printf 'missing inverse route block: %s\n' "$route" >&2
    exit 1
  }
  previous=0
  for literal in "$@"; do
    line="$(rg_fixed -nF -- "$literal" "$route_block_file" | head -1 | cut -d: -f1)"
    [ -n "$line" ] && [ "$line" -gt "$previous" ] || {
      printf 'inverse route %s is missing or misorders: %s\n' "$route" "$literal" >&2
      exit 1
    }
    previous="$line"
  done
}

assert_function_order() {
  function_name="$1"
  shift
  sed -n "/^$function_name() {/,/^}/p" "$runbook" >"$route_block_file"
  [ -s "$route_block_file" ] || {
    printf 'missing function block: %s\n' "$function_name" >&2
    exit 1
  }
  previous=0
  for literal in "$@"; do
    line="$(rg_fixed -nF -- "$literal" "$route_block_file" | head -1 | cut -d: -f1)"
    [ -n "$line" ] && [ "$line" -gt "$previous" ] || {
      printf 'function %s is missing or misorders: %s\n' \
        "$function_name" "$literal" >&2
      exit 1
    }
    previous="$line"
  done
}

require_literal 'Set COUPLED_ORDER=database-first, application-first, or traffic-stopped.'
require_literal 'COUPLED_ORDER is only valid with APPLICATION_PAIRING=rollback.'
require_literal 'TRAFFIC_SUSPENSION_EXPECTED_HTTP must be exactly 503.'
require_literal 'require_traffic_suspension_configuration() {'
require_literal 'require_traffic_suspension_configuration'
require_literal 'x-wcdraft-traffic-suspended'
require_literal 'https://www.wcdraft.com/api/health'
require_literal 'https://www.wcdraft.com/api/og/health'
require_literal '"$RESTORE_COMPATIBLE_DEPLOYMENT" application-first-alias'
require_literal '"$PRE_RESTORE_DEPLOYMENT" database-first-current-alias'
require_literal 'inverse-database-first-current-alias || return 1'
require_literal 'require_application_pairing_receipts \'
require_literal 'require_traffic_suspension_receipt traffic-stopped-before-neon'
require_literal 'require_traffic_suspension_receipt traffic-stopped-before-vercel'
require_literal 'TRAFFIC_RESUMED_ACK=yes'
require_literal 'Set INVERSE_COUPLED_ORDER=database-first, application-first, or traffic-stopped.'
require_literal 'INVERSE_TRAFFIC_RESUMED_ACK=yes'
require_literal 'pnpm --filter @wcdraft/db db:branch:verify'
require_literal 'neon.branch_id'
require_literal 'NEON_EPHEMERAL_BRANCH_ID'

sed -n \
  '/^require_traffic_suspension_configuration() {/,/^}/p' \
  "$runbook" >"$traffic_config_block"
bash -s -- "$traffic_config_block" <<'BASH'
set -euo pipefail
source "$1"

expect_rejected() {
  if require_traffic_suspension_configuration >/dev/null 2>&1; then
    echo 'traffic suspension configuration unexpectedly accepted.' >&2
    exit 1
  fi
}

TRAFFIC_SUSPENSION_EXPECTED_HTTP=503
TRAFFIC_SUSPENSION_MARKER=
expect_rejected
TRAFFIC_SUSPENSION_MARKER=too-short
expect_rejected
TRAFFIC_SUSPENSION_MARKER='invalid.marker-that-is-long-enough-123456'
expect_rejected
TRAFFIC_SUSPENSION_MARKER=valid_marker_0123456789abcdef0123456789
TRAFFIC_SUSPENSION_EXPECTED_HTTP=404
expect_rejected
TRAFFIC_SUSPENSION_EXPECTED_HTTP=503
require_traffic_suspension_configuration
BASH

{
  sed -n '/^cleanup_neon_api_curl() {/,/^}/p' "$runbook"
  sed -n '/^prepare_neon_api_curl() {/,/^}/p' "$runbook"
  sed -n '/^neon_api_curl() {/,/^}/p' "$runbook"
  sed -n '/^require_production_alias_receipt() {/,/^}/p' "$runbook"
  sed -n '/^require_application_pairing_receipts() {/,/^}/p' "$runbook"
  sed -n '/^require_traffic_suspension_configuration() {/,/^}/p' "$runbook"
  sed -n '/^require_traffic_suspension_receipt() {/,/^}/p' "$runbook"
  sed -n '/^restore_neon_primary() {/,/^}/p' "$runbook"
  sed -n '/^rollback_application() {/,/^}/p' "$runbook"
  sed -n '/^restore_neon_primary_from_preserved() {/,/^}/p' "$runbook"
  sed -n '/^promote_pre_restore_application() {/,/^}/p' "$runbook"
} >"$mutation_guard_block"
bash -s -- "$mutation_guard_block" "$diagnostics" <<'BASH'
set -euo pipefail
source "$1"
source "$2"
incident_dir="$(mktemp -d)"
mutation_log="$incident_dir/vendor-mutations.txt"

PRE_RESTORE_DEPLOYMENT=pre-restore-deployment
RESTORE_COMPATIBLE_DEPLOYMENT=rollback-compatible-deployment
APPLICATION_PAIRING=rollback
COUPLED_ORDER=database-first
INVERSE_COUPLED_ORDER=database-first
NEON_PROJECT_ID=test-project
NEON_PRIMARY_BRANCH_ID=test-primary
NEON_API_KEY=test-key
SIMULATED_NEON_SECRET="$NEON_API_KEY"
RESTORE_TIMESTAMP=2026-07-14T00:00:00Z

wait_for_production_alias() { return 0; }
vercel() {
  printf '%s\n' "$*" >>"$mutation_log"
  return 0
}
curl() {
  printf '%s\n' "$*" >>"$mutation_log"
  case "${SIMULATE_NEON_CURL_FAILURE:-no}" in
    authentication)
      printf 'response reflected credential fragment %s at https://sensitive.invalid/path\n' \
        "$SIMULATED_NEON_SECRET"
      printf 'curl: (22) 401 Unauthorized; Authorization: Bearer %s\n' \
        "$SIMULATED_NEON_SECRET" >&2
      return 22
      ;;
    unknown)
      printf 'opaque response credential=%s at https://private.example.test/path\n' \
        "$SIMULATED_NEON_SECRET"
      printf 'unmapped-provider-gibberish endpoint=private.example.test opaque=%s\n' \
        "$SIMULATED_NEON_SECRET" >&2
      return 23
      ;;
    *) return 0 ;;
  esac
}

prepare_neon_api_curl
trap 'cleanup_neon_api_curl; rm -rf "$incident_dir"' EXIT
[ "$(python3 -c 'import os,sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])' \
  "$NEON_CURL_CONFIG")" = 600 ] || {
  echo 'Neon curl config is not mode 0600.' >&2
  exit 1
}
[ -z "${NEON_API_KEY+x}" ] || {
  echo 'Neon API key remained available after curl config preparation.' >&2
  exit 1
}

SIMULATE_NEON_CURL_FAILURE=authentication
set +e
neon_api_curl --fail-with-body -sS \
  https://console.neon.tech/api/v2/projects/test-project/branches \
  >"$incident_dir/neon-failure.stdout" 2>"$incident_dir/neon-failure.stderr"
neon_failure_status="$?"
set -e
[ "$neon_failure_status" -ne 0 ] || {
  echo 'Simulated Neon API failure unexpectedly passed.' >&2
  exit 1
}
grep -Fq 'tool=curl phase=api-request status=22 category=authentication_failure retryable=false' \
  "$incident_dir/neon-failure.stderr"
grep -Fq 'diagnostic=remote_authentication_rejected' \
  "$incident_dir/neon-failure.stderr"
if grep -Fq -- "$SIMULATED_NEON_SECRET" "$mutation_log" || \
   grep -Fq -- "$SIMULATED_NEON_SECRET" "$incident_dir/neon-failure.stdout" || \
   grep -Fq -- "$SIMULATED_NEON_SECRET" "$incident_dir/neon-failure.stderr"; then
  echo 'Neon API credential escaped into argv or surfaced failure output.' >&2
  exit 1
fi
if grep -Eq 'https?://|sensitive[.]invalid|Authorization:|Bearer' \
  "$incident_dir/neon-failure.stdout" "$incident_dir/neon-failure.stderr"; then
  echo 'Neon API URI, host, or authorization shape escaped into surfaced failure output.' >&2
  exit 1
fi

SIMULATE_NEON_CURL_FAILURE=unknown
set +e
neon_api_curl --fail-with-body -sS \
  https://console.neon.tech/api/v2/projects/test-project/branches \
  >"$incident_dir/neon-unknown.stdout" 2>"$incident_dir/neon-unknown.stderr"
neon_unknown_status="$?"
set -e
[ "$neon_unknown_status" -eq 23 ] || {
  echo 'Unclassifiable Neon API status was not preserved.' >&2
  exit 1
}
grep -Fq 'tool=curl phase=api-request status=23 category=unknown retryable=false' \
  "$incident_dir/neon-unknown.stderr"
grep -Fq 'diagnostic=provider_output_withheld_unclassified' \
  "$incident_dir/neon-unknown.stderr"
if grep -Fq -- "$SIMULATED_NEON_SECRET" "$incident_dir/neon-unknown.stdout" || \
   grep -Fq -- "$SIMULATED_NEON_SECRET" "$incident_dir/neon-unknown.stderr" || \
   grep -Eq 'https?://|private[.]example[.]test' \
     "$incident_dir/neon-unknown.stdout" "$incident_dir/neon-unknown.stderr"; then
  echo 'Unclassifiable Neon API output escaped instead of degrading safely.' >&2
  exit 1
fi

SIMULATE_NEON_CURL_FAILURE=no
[ -z "$(neon_api_curl --fail-with-body -sS \
  https://console.neon.tech/api/v2/projects/test-project/branches)" ] || {
  echo 'Successful Neon API wrapper output changed.' >&2
  exit 1
}

assert_alias_failure_blocks_mutation() {
  function_name="$1"
  receipt_name="$2"
  for receipt_state in missing wrong; do
    rm -f "$incident_dir/$receipt_name.json" "$mutation_log"
    if [ "$receipt_state" = wrong ]; then
      jq -nc \
        '{id:"wrong-deployment",readyState:"READY",target:"production"}' \
        >"$incident_dir/$receipt_name.json"
    fi
    set +e
    "$function_name" guard-probe >/dev/null 2>&1
    status="$?"
    set -e
    [ "$status" -ne 0 ] || {
      echo "$function_name accepted a $receipt_state alias receipt." >&2
      exit 1
    }
    [ ! -s "$mutation_log" ] || {
      echo "$function_name reached a vendor mutation with a $receipt_state alias receipt." >&2
      exit 1
    }
  done
}

assert_alias_failure_blocks_mutation \
  rollback_application database-first-current-alias
assert_alias_failure_blocks_mutation \
  promote_pre_restore_application inverse-database-first-current-alias
COUPLED_ORDER=application-first
assert_alias_failure_blocks_mutation \
  restore_neon_primary application-first-alias
INVERSE_COUPLED_ORDER=application-first
assert_alias_failure_blocks_mutation \
  restore_neon_primary_from_preserved inverse-application-first-alias
COUPLED_ORDER=database-first
INVERSE_COUPLED_ORDER=database-first

write_alias_receipt() {
  receipt_name="$1"
  expected_deployment="$2"
  jq -nc --arg expected "$expected_deployment" \
    '{id:$expected,readyState:"READY",target:"production"}' \
    >"$incident_dir/$receipt_name.json"
}

write_pairing_receipts() {
  receipt_name="$1"
  expected_deployment="$2"
  failure="$3"
  manifest_deployment="$expected_deployment"
  health_ok=true
  og_ok=true
  case "$failure" in
    manifest) manifest_deployment=wrong-deployment ;;
    health) health_ok=false ;;
    og) og_ok=false ;;
  esac
  jq -nc --arg expected "$manifest_deployment" \
    '{expected_deployment:$expected,health_http:200,database_status:"ready",leaderboard_http:200,og_health_http:200}' \
    >"$incident_dir/$receipt_name-pairing.json"
  jq -nc --argjson ok "$health_ok" \
    '{ok:$ok,db:{status:"ready"}}' \
    >"$incident_dir/$receipt_name-health.json"
  jq -nc --argjson ok "$og_ok" '{ok:$ok}' \
    >"$incident_dir/$receipt_name-og-health.json"
}

assert_pairing_failure_blocks_mutation() {
  function_name="$1"
  alias_receipt="$2"
  pairing_receipt="$3"
  expected_deployment="$4"
  for failure in manifest health og; do
    rm -f "$mutation_log"
    write_alias_receipt "$alias_receipt" "$expected_deployment"
    write_pairing_receipts "$pairing_receipt" "$expected_deployment" "$failure"
    set +e
    "$function_name" guard-probe >/dev/null 2>&1
    status="$?"
    set -e
    [ "$status" -ne 0 ] || {
      echo "$function_name accepted a wrong $failure pairing receipt." >&2
      exit 1
    }
    [ ! -s "$mutation_log" ] || {
      echo "$function_name reached a vendor mutation with a wrong $failure pairing receipt." >&2
      exit 1
    }
  done
}

assert_pairing_failure_blocks_mutation \
  rollback_application database-first-current-alias \
  database-first-intermediate "$PRE_RESTORE_DEPLOYMENT"
assert_pairing_failure_blocks_mutation \
  promote_pre_restore_application inverse-database-first-current-alias \
  inverse-database-first-intermediate "$RESTORE_COMPATIBLE_DEPLOYMENT"
COUPLED_ORDER=application-first
assert_pairing_failure_blocks_mutation \
  restore_neon_primary application-first-alias \
  application-first-intermediate "$RESTORE_COMPATIBLE_DEPLOYMENT"
INVERSE_COUPLED_ORDER=application-first
assert_pairing_failure_blocks_mutation \
  restore_neon_primary_from_preserved inverse-application-first-alias \
  inverse-application-first-intermediate "$PRE_RESTORE_DEPLOYMENT"

TRAFFIC_SUSPENSION_EXPECTED_HTTP=503
TRAFFIC_SUSPENSION_MARKER=valid_marker_0123456789abcdef0123456789

write_suspension_receipts() {
  receipt_name="$1"
  bad_endpoint="$2"
  failure="$3"
  for endpoint in health og-health; do
    case "$endpoint" in
      health) probe_url='https://www.wcdraft.com/api/health' ;;
      og-health) probe_url='https://www.wcdraft.com/api/og/health' ;;
    esac
    receipt_url="$probe_url"
    expected_http=503
    observed_http=503
    header_marker="$TRAFFIC_SUSPENSION_MARKER"
    body_contains=true
    body_marker="$TRAFFIC_SUSPENSION_MARKER"
    if [ "$endpoint" = "$bad_endpoint" ]; then
      case "$failure" in
        url) receipt_url=https://wrong.example.invalid/not-canonical ;;
        expected) expected_http=404 ;;
        observed) observed_http=404 ;;
        header) header_marker=wrong-marker ;;
        body-json) body_contains=false ;;
        body-file) body_marker=wrong-marker ;;
      esac
    fi
    jq -nc \
      --arg url "$receipt_url" \
      --arg expected "$expected_http" \
      --arg observed "$observed_http" \
      --arg marker "$TRAFFIC_SUSPENSION_MARKER" \
      --arg header "$header_marker" \
      --argjson body_contains "$body_contains" \
      '{probe_url:$url,expected_http:$expected,observed_http:$observed,
        expected_marker:$marker,header_marker:$header,
        body_contains_marker:$body_contains}' \
      >"$incident_dir/$receipt_name-traffic-suspension-$endpoint.json"
    printf '%s\n' "$body_marker" \
      >"$incident_dir/$receipt_name-traffic-suspension-$endpoint-body.txt"
  done
}

assert_suspension_failure_blocks_mutation() {
  function_name="$1"
  receipt_name="$2"
  for bad_endpoint in health og-health; do
    for failure in url expected observed header body-json body-file; do
      rm -f "$mutation_log"
      write_suspension_receipts "$receipt_name" "$bad_endpoint" "$failure"
      set +e
      "$function_name" guard-probe >/dev/null 2>&1
      status="$?"
      set -e
      [ "$status" -ne 0 ] || {
        echo "$function_name accepted a wrong $bad_endpoint $failure suspension receipt." >&2
        exit 1
      }
      [ ! -s "$mutation_log" ] || {
        echo "$function_name reached a vendor mutation with a wrong $bad_endpoint $failure suspension receipt." >&2
        exit 1
      }
    done
  done
}

COUPLED_ORDER=traffic-stopped
assert_suspension_failure_blocks_mutation \
  rollback_application traffic-stopped-before-vercel
INVERSE_COUPLED_ORDER=traffic-stopped
assert_suspension_failure_blocks_mutation \
  promote_pre_restore_application inverse-traffic-stopped-before-vercel
COUPLED_ORDER=traffic-stopped
assert_suspension_failure_blocks_mutation \
  restore_neon_primary traffic-stopped-before-neon
INVERSE_COUPLED_ORDER=traffic-stopped
assert_suspension_failure_blocks_mutation \
  restore_neon_primary_from_preserved inverse-traffic-stopped-before-neon
BASH

if rg_fixed -Fq 'TRAFFIC_SUSPENSION_PROBE_URL' "$runbook"; then
  echo 'traffic suspension must use fixed canonical endpoints, not a caller-supplied URL.' >&2
  exit 1
fi

rg_fixed -Fq 'run: scripts/ci/neon-vercel-recovery-runbook.test.sh' "$workflow" || {
  echo 'recovery runbook contract must be registered in the static CI job.' >&2
  exit 1
}

require_count 2 'neon_api_curl --fail-with-body -sS --request POST \'
require_count 5 'neon_api_curl --fail-with-body -sS'
if rg_fixed -Fq 'Authorization: Bearer $NEON_API_KEY' "$runbook"; then
  echo 'Neon API credential must not be expanded into curl argv.' >&2
  exit 1
fi
require_count 3 'require_traffic_suspension_configuration'
require_count 1 'restore_neon_primary() {'
require_count 1 'restore_neon_primary_from_preserved() {'
require_count 1 'vercel rollback "$RESTORE_COMPATIBLE_DEPLOYMENT" \'
require_count 1 'vercel promote "$PRE_RESTORE_DEPLOYMENT" \'
require_count 1 '# ROUTE application-first'
require_count 1 '# ROUTE database-first'
require_count 1 '# ROUTE traffic-stopped'
require_count 1 '# INVERSE ROUTE application-first'
require_count 1 '# INVERSE ROUTE database-first'
require_count 1 '# INVERSE ROUTE traffic-stopped'

assert_route_order application-first \
  'rollback_application application-first' \
  'verify_application_pairing \' \
  'application-first-intermediate' \
  'restore_neon_primary'

assert_route_order database-first \
  'restore_neon_primary' \
  'wait_for_production_alias \' \
  'verify_application_pairing \' \
  'database-first-intermediate' \
  'rollback_application database-first'

assert_route_order traffic-stopped \
  'verify_traffic_suspended traffic-stopped-before-neon' \
  'restore_neon_primary' \
  'verify_traffic_suspended traffic-stopped-before-vercel' \
  'rollback_application traffic-stopped' \
  'verify_traffic_suspended traffic-stopped-after-vercel'

assert_inverse_route_order application-first \
  'promote_pre_restore_application inverse-application-first' \
  'verify_application_pairing \' \
  'inverse-application-first-intermediate' \
  'restore_neon_primary_from_preserved'

assert_inverse_route_order database-first \
  'restore_neon_primary_from_preserved' \
  'wait_for_production_alias \' \
  'verify_application_pairing \' \
  'inverse-database-first-intermediate' \
  'promote_pre_restore_application inverse-database-first'

assert_inverse_route_order traffic-stopped \
  'verify_traffic_suspended inverse-traffic-stopped-before-neon' \
  'restore_neon_primary_from_preserved' \
  'verify_traffic_suspended inverse-traffic-stopped-before-vercel' \
  'promote_pre_restore_application inverse-traffic-stopped' \
  'verify_traffic_suspended inverse-traffic-stopped-after-vercel'

assert_function_order rollback_application \
  '"$PRE_RESTORE_DEPLOYMENT" database-first-current-alias || return 1' \
  'database-first-intermediate "$PRE_RESTORE_DEPLOYMENT"' \
  'vercel rollback "$RESTORE_COMPATIBLE_DEPLOYMENT" \'

assert_function_order promote_pre_restore_application \
  'inverse-database-first-current-alias || return 1' \
  'inverse-database-first-intermediate \' \
  'vercel promote "$PRE_RESTORE_DEPLOYMENT" \'

printf '%s\n' \
  'neon-vercel recovery runbook contract: PASS (credential-safe curl failure, fixed suspension proof, 68 receipt-negative mutation cases under suppressed errexit across all 4 vendor sinks, forward/inverse fail-closed guards, 6 route orderings, single mutation definitions, CI registration)'
