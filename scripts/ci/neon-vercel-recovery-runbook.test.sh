#!/usr/bin/env bash
# shellcheck disable=SC1003,SC2016
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runbook="$repo_root/docs/runbooks/neon-restore-vercel-rollback.md"
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

require_literal() {
  literal="$1"
  rg -Fq -- "$literal" "$runbook" || {
    printf 'missing runbook contract: %s\n' "$literal" >&2
    exit 1
  }
}

require_count() {
  expected="$1"
  literal="$2"
  actual="$(rg -F --count-matches -- "$literal" "$runbook" || true)"
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
    line="$(rg -nF -- "$literal" "$route_block_file" | head -1 | cut -d: -f1)"
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
    line="$(rg -nF -- "$literal" "$route_block_file" | head -1 | cut -d: -f1)"
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
    line="$(rg -nF -- "$literal" "$route_block_file" | head -1 | cut -d: -f1)"
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
  sed -n '/^require_production_alias_receipt() {/,/^}/p' "$runbook"
  sed -n '/^rollback_application() {/,/^}/p' "$runbook"
  sed -n '/^promote_pre_restore_application() {/,/^}/p' "$runbook"
} >"$mutation_guard_block"
bash -s -- "$mutation_guard_block" <<'BASH'
set -euo pipefail
source "$1"
incident_dir="$(mktemp -d)"
mutation_log="$incident_dir/vendor-mutations.txt"
trap 'rm -rf "$incident_dir"' EXIT

PRE_RESTORE_DEPLOYMENT=pre-restore-deployment
RESTORE_COMPATIBLE_DEPLOYMENT=rollback-compatible-deployment
COUPLED_ORDER=database-first
INVERSE_COUPLED_ORDER=database-first

require_application_pairing_receipts() { return 0; }
wait_for_production_alias() { return 0; }
vercel() {
  printf '%s\n' "$*" >>"$mutation_log"
  return 0
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
BASH

if rg -Fq 'TRAFFIC_SUSPENSION_PROBE_URL' "$runbook"; then
  echo 'traffic suspension must use fixed canonical endpoints, not a caller-supplied URL.' >&2
  exit 1
fi

rg -Fq 'run: scripts/ci/neon-vercel-recovery-runbook.test.sh' "$workflow" || {
  echo 'recovery runbook contract must be registered in the static CI job.' >&2
  exit 1
}

require_count 2 'curl --fail-with-body -sS --request POST \'
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
  'neon-vercel recovery runbook contract: PASS (bash syntax, fixed suspension proof, 4 alias-negative mutation cases, forward/inverse fail-closed guards, 6 route orderings, single mutation definitions, CI registration)'
