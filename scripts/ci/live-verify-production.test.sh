#!/usr/bin/env bash
# Structure contract for the non-writing production live-verify script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/live-verify-production.sh"
RUNBOOK="$ROOT/docs/runbooks/production-live-verify.md"

test -x "$SCRIPT" || { echo "FAIL: script not executable"; exit 1; }
test -f "$RUNBOOK" || { echo "FAIL: runbook missing"; exit 1; }
bash -n "$SCRIPT"

# Must refuse accepting-path patterns and pin DIFFERENT_BUILD + cookie-less.
grep -q 'DIFFERENT_BUILD' "$SCRIPT"
grep -q 'shipped_pre_basis_t3' "$SCRIPT"
grep -q 'never create leaderboard rows' "$SCRIPT" || grep -q 'NON-WRITING' "$SCRIPT"
# Probe body must not include a display alias field (comments mentioning the
# forbidden field are fine; the JSON body keys are not).
if grep -E '"display_alias"|"display_name"' "$SCRIPT"; then
  echo "FAIL: script must not send display_alias/display_name in the probe body"
  exit 1
fi
# Ensure we do not use accepting current-build golden tokens
if grep -Eq 'current_classic|leaderboard-validate-golden' "$SCRIPT"; then
  echo "FAIL: script must not use accepting current-build golden tokens"
  exit 1
fi

grep -q 'Production live-verify must never create leaderboard rows' "$RUNBOOK"
grep -q 'DIFFERENT_BUILD' "$RUNBOOK"
grep -q 'OWNER RATIFICATION' "$RUNBOOK"

# STATE.md standing constraint
grep -q 'Production live-verify must never create leaderboard rows' "$ROOT/STATE.md"

echo "live-verify-production structure: PASS"
