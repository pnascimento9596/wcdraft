#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
check_script="$repo_root/scripts/ci/check-hygiene-install-drift.sh"
probe_root="$(mktemp -d "${TMPDIR:-/tmp}/wcdraft-hygiene-install-drift.XXXXXX")"
probe_root="$(cd "$probe_root" && pwd -P)"

cleanup() {
  find "$probe_root" -depth -delete
}
trap cleanup EXIT

fail() {
  echo "hygiene-install-drift contract: FAIL: $1" >&2
  exit 1
}

bash -n "$check_script"
[ -x "$check_script" ] || fail "check script must be executable"

matched_root="$probe_root/matched"
mkdir -p "$matched_root"
cp "$repo_root/scripts/ci/self-hosted-runner-hygiene.sh" \
  "$matched_root/self-hosted-runner-hygiene.sh"
cp "$repo_root/scripts/ci/runner-disk-maintenance.sh" \
  "$matched_root/runner-disk-maintenance.sh"

if ! WCDRAFT_HYGIENE_INSTALL_ROOT="$matched_root" \
  WCDRAFT_HYGIENE_DRIFT_REQUIRE=1 \
  "$check_script" >"$probe_root/match.out" 2>"$probe_root/match.err"; then
  fail "matched install must PASS"
fi
grep -Fq 'hygiene-install-drift: PASS' "$probe_root/match.out" ||
  fail "matched install missing PASS line"

# Negative control: simulated drift via fixture — never mutates the live install.
drifted_root="$probe_root/drifted"
mkdir -p "$drifted_root"
cp "$repo_root/scripts/ci/self-hosted-runner-hygiene.sh" \
  "$drifted_root/self-hosted-runner-hygiene.sh"
cp "$repo_root/scripts/ci/runner-disk-maintenance.sh" \
  "$drifted_root/runner-disk-maintenance.sh"
printf '\n# simulated drift fixture — not installed live\n' \
  >>"$drifted_root/self-hosted-runner-hygiene.sh"

set +e
WCDRAFT_HYGIENE_DRIFT_FIXTURE="$drifted_root" \
  WCDRAFT_HYGIENE_DRIFT_REQUIRE=1 \
  "$check_script" >"$probe_root/drift.out" 2>"$probe_root/drift.err"
drift_rc=$?
set -e
[ "$drift_rc" -eq 1 ] || fail "simulated drift must exit 1 (got $drift_rc)"
grep -Fq 'HYGIENE_INSTALL_DRIFT' "$probe_root/drift.err" ||
  fail "simulated drift must emit HYGIENE_INSTALL_DRIFT"
grep -Fq 'self-hosted-runner-hygiene.sh' "$probe_root/drift.err" ||
  fail "simulated drift must name the drifted script"

# Missing install root with require=0 is skip (cloud runners).
set +e
WCDRAFT_HYGIENE_INSTALL_ROOT="$probe_root/does-not-exist" \
  WCDRAFT_HYGIENE_DRIFT_REQUIRE=0 \
  "$check_script" >"$probe_root/skip.out" 2>"$probe_root/skip.err"
skip_rc=$?
set -e
[ "$skip_rc" -eq 0 ] || fail "unreachable install with require=0 must skip cleanly"
grep -Fq 'SKIP' "$probe_root/skip.out" || fail "skip path missing SKIP marker"

# Missing install root with require=1 is hard red.
set +e
WCDRAFT_HYGIENE_INSTALL_ROOT="$probe_root/does-not-exist" \
  WCDRAFT_HYGIENE_DRIFT_REQUIRE=1 \
  "$check_script" >"$probe_root/missing.out" 2>"$probe_root/missing.err"
missing_rc=$?
set -e
[ "$missing_rc" -eq 1 ] || fail "missing install with require=1 must exit 1"
grep -Fq 'HYGIENE_INSTALL_DRIFT' "$probe_root/missing.err" ||
  fail "missing install must emit HYGIENE_INSTALL_DRIFT"

echo "hygiene-install-drift contract: PASS (match, simulated-drift red control, skip-when-unreachable, require-missing)"
