#!/usr/bin/env bash
# shellcheck disable=SC1003,SC2016
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runbook="$repo_root/docs/runbooks/neon-restore-vercel-rollback.md"
workflow="$repo_root/.github/workflows/ci.yml"
combined_bash="$(mktemp)"
route_block_file="$(mktemp)"
trap 'rm -f "$combined_bash" "$route_block_file"' EXIT

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

require_literal 'Set COUPLED_ORDER=database-first, application-first, or traffic-stopped.'
require_literal 'COUPLED_ORDER is only valid with APPLICATION_PAIRING=rollback.'
require_literal 'TRAFFIC_SUSPENSION_EXPECTED_HTTP must be exactly 503.'
require_literal 'x-wcdraft-traffic-suspended'
require_literal 'https://www.wcdraft.com/api/health'
require_literal 'https://www.wcdraft.com/api/og/health'
require_literal '"$RESTORE_COMPATIBLE_DEPLOYMENT" application-first-alias'
require_literal 'require_application_pairing_receipts \'
require_literal 'require_traffic_suspension_receipt traffic-stopped-before-neon'
require_literal 'require_traffic_suspension_receipt traffic-stopped-before-vercel'
require_literal 'TRAFFIC_RESUMED_ACK=yes'
require_literal 'Set INVERSE_COUPLED_ORDER=database-first, application-first, or traffic-stopped.'
require_literal 'INVERSE_TRAFFIC_RESUMED_ACK=yes'

if rg -Fq 'TRAFFIC_SUSPENSION_PROBE_URL' "$runbook"; then
  echo 'traffic suspension must use fixed canonical endpoints, not a caller-supplied URL.' >&2
  exit 1
fi

rg -Fq 'run: scripts/ci/neon-vercel-recovery-runbook.test.sh' "$workflow" || {
  echo 'recovery runbook contract must be registered in the static CI job.' >&2
  exit 1
}

require_count 2 'curl --fail-with-body -sS --request POST \'
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

printf '%s\n' \
  'neon-vercel recovery runbook contract: PASS (bash syntax, fixed suspension proof, forward/inverse fail-closed guards, 6 route orderings, single mutation definitions, CI registration)'
