#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2016
# Structure + forbidden-set behavior contract for production live-verify.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/live-verify-production.sh"
RUNBOOK="$ROOT/docs/runbooks/production-live-verify.md"
SUBMIT_ROUTE="$ROOT/apps/web/lib/leaderboard/submit-route.ts"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

test -x "$SCRIPT" || fail "script not executable"
test -f "$RUNBOOK" || fail "runbook missing"
bash -n "$SCRIPT"

# Probe remains a cookie-less stale-anchor rejection, never an accepting token.
grep -q 'DIFFERENT_BUILD' "$SCRIPT"
grep -q 'shipped_pre_basis_t3' "$SCRIPT"
grep -q 'active (non-expired) durable sessions' "$SCRIPT"
if grep -E '"display_alias"|"display_name"' "$SCRIPT"; then
  fail "script must not send display_alias/display_name in the probe body"
fi
if grep -Eq 'current_classic|leaderboard-validate-golden' "$SCRIPT"; then
  fail "script must not use accepting current-build golden tokens"
fi

# Expected build and anchors come from the passed/live SHA's Git tree. The
# literal source snippets intentionally contain unexpanded shell variables.
grep -Fq 'git show "${target_sha}:packages/data/src/generated/manifest.json"' "$SCRIPT"
grep -Fq 'git show "${target_sha}:apps/web/lib/leaderboard/season.ts"' "$SCRIPT"
grep -Fq 'git show "${target_sha}:apps/web/lib/leaderboard/submit-route.ts"' "$SCRIPT"
grep -Fq '.build.sha == $sha' "$SCRIPT"
grep -Fq '.auth.status == "ready"' "$SCRIPT"

# Sessions in the forbidden set are active rows only. Rate limits and expired
# sessions are observable but outside the equality assertion.
grep -Fq 'SELECT count(*) FROM sessions WHERE expires_at > clock_timestamp()' "$SCRIPT"
grep -Fq "'permitted_observations', jsonb_build_object(" "$SCRIPT"
grep -Fq "'rate_limit_rows', (SELECT count(*) FROM auth_rate_limits)" "$SCRIPT"
grep -Fq "jq -S -c '.forbidden_counts'" "$SCRIPT"

# The probe's bounded-exposure argument depends on locked route ordering:
# stale anchors must reject before the submit limiter is consulted.
cheap_line="$(grep -n 'const cheapVerdict = validateSubmissionCheap' "$SUBMIT_ROUTE" | cut -d: -f1)"
limit_line="$(grep -n 'const decision = await deps.rateLimiter.checkSubmit' "$SUBMIT_ROUTE" | cut -d: -f1)"
test -n "$cheap_line" && test -n "$limit_line" || fail "submit gate-order markers missing"
(( cheap_line < limit_line )) || fail "DIFFERENT_BUILD preflight no longer precedes rate limiter"

# Corrected policy and owner-ratification language are locked in both in-repo
# authorities. Canonical owner docs are intentionally outside this diff.
grep -Fq 'would a single anonymous visitor' "$RUNBOOK"
grep -Fq 'active, non-expired sessions only' "$RUNBOOK"
grep -Fq 'OWNER RATIFICATION' "$RUNBOOK"
grep -Fq 'not the original' "$RUNBOOK"
grep -Fq 'corrected non-writing definition' "$ROOT/STATE.md"
grep -Fq 'expires_at > clock_timestamp()' "$ROOT/STATE.md"

# Source the pure snapshot/assertion functions without running production HTTP.
# The mock keeps a hidden total-session dimension so the first case proves an
# expired row can be reaped mid-run while active-session equality still passes.
# It also moves rate-limit observations to prove they are not in the assertion.
# SCRIPT is the absolute path computed from this checkout.
# shellcheck source=../live-verify-production.sh
source "$SCRIPT"

TEST_TMP="$(mktemp -d /tmp/wcdraft-live-verify-contract.XXXXXX)"
trap 'rm -rf "$TEST_TMP"' EXIT

# The live bootstrap uses a 300s stateless value under the wcdraft_sid name.
# That is permitted; a durable 30-day sid is not. Redaction must preserve the
# TTL evidence without retaining either cookie value or the CSRF token.
printf '%s\n' \
  'set-cookie: wcdraft_sid=short-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_csrf=csrf-secret; Path=/; Max-Age=300' \
  >"$TEST_TMP/bootstrap.hdr"
assert_bootstrap_cookie_ttls "$TEST_TMP/bootstrap.hdr"
redact_cookie_headers "$TEST_TMP/bootstrap.hdr"
grep -Fq 'wcdraft_sid=[redacted]; Path=/; Max-Age=300' "$TEST_TMP/bootstrap.hdr"
grep -Fq 'wcdraft_csrf=[redacted]; Path=/; Max-Age=300' "$TEST_TMP/bootstrap.hdr"
if rg -q 'short-secret|csrf-secret' "$TEST_TMP/bootstrap.hdr"; then
  fail "cookie receipt retained a short-lived secret"
fi
printf '%s\n' \
  'set-cookie: wcdraft_sid=durable-secret; Path=/; Max-Age=2592000; HttpOnly' \
  'set-cookie: wcdraft_csrf=csrf-secret; Path=/; Max-Age=300' \
  >"$TEST_TMP/durable.hdr"
if assert_bootstrap_cookie_ttls "$TEST_TMP/durable.hdr" 2>"$TEST_TMP/durable-failure.log"; then
  fail "durable session cookie was accepted"
fi
grep -Fq 'durable-looking wcdraft_sid' "$TEST_TMP/durable-failure.log"

printf '%s\n' \
  'set-cookie: wcdraft_sid=short-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_csrf=csrf-secret; Path=/; Max-Age=3000' \
  >"$TEST_TMP/wrong-csrf-ttl.hdr"
if assert_bootstrap_cookie_ttls \
  "$TEST_TMP/wrong-csrf-ttl.hdr" 2>"$TEST_TMP/wrong-csrf-ttl.log"; then
  fail "CSRF Max-Age=3000 was accepted as an exact 300-second bootstrap"
fi
grep -Fq 'missing 300s wcdraft_csrf bootstrap cookie' "$TEST_TMP/wrong-csrf-ttl.log"

printf '%s\n' '{"csrfToken":"body-secret","csrfCookieName":"wcdraft_csrf"}' \
  >"$TEST_TMP/csrf.json"
redact_csrf_body "$TEST_TMP/csrf.json"
test "$(jq -r '.csrfToken' "$TEST_TMP/csrf.json")" = "[redacted]"

assert_probe_precedes_rate_limit "$SUBMIT_ROUTE"
printf '%s\n' \
  'const decision = await deps.rateLimiter.checkSubmit();' \
  'const cheapVerdict = validateSubmissionCheap();' \
  >"$TEST_TMP/reversed-submit-route.ts"
if assert_probe_precedes_rate_limit \
  "$TEST_TMP/reversed-submit-route.ts" 2>"$TEST_TMP/reversed-gate-order.log"; then
  fail "reversed submit limiter order was accepted"
fi
grep -Fq 'no longer rejects DIFFERENT_BUILD before the submit limiter' \
  "$TEST_TMP/reversed-gate-order.log"

LIVE_VERIFY_EXPECTED_NEON_PROJECT_ID="project-test"
LIVE_VERIFY_EXPECTED_NEON_BRANCH_ID="branch-production-test"
mock_accounts=6
mock_active_sessions=44
mock_expired_sessions=1
mock_rate_limit_rows=66
mock_rate_limit_events=120

run_readonly_sql() {
  jq -nc \
    --arg project "$LIVE_VERIFY_EXPECTED_NEON_PROJECT_ID" \
    --arg branch "$LIVE_VERIFY_EXPECTED_NEON_BRANCH_ID" \
    --argjson accounts "$mock_accounts" \
    --argjson active "$mock_active_sessions" \
    --argjson expired "$mock_expired_sessions" \
    --argjson rate_rows "$mock_rate_limit_rows" \
    --argjson rate_events "$mock_rate_limit_events" '{
      database: {project_id: $project, branch_id: $branch},
      forbidden_counts: {
        leaderboard_entries: 4,
        ranked_attempts: 0,
        accounts: $accounts,
        saved_runs: 317,
        magic_link_tokens: 18,
        active_sessions: $active
      },
      permitted_observations: {
        expired_sessions: $expired,
        rate_limit_rows: $rate_rows,
        rate_limit_events: $rate_events
      }
    }'
}

capture_database_snapshot "$TEST_TMP/before.json"
before_total_sessions=$((mock_active_sessions + mock_expired_sessions))

# Permitted mid-run changes: one expired session is reaped and rate-limit
# accounting advances. Neither may deadlock the forbidden-set assertion.
mock_expired_sessions=0
mock_rate_limit_rows=67
mock_rate_limit_events=123
capture_database_snapshot "$TEST_TMP/after-permitted.json"
after_total_sessions=$((mock_active_sessions + mock_expired_sessions))
test "$before_total_sessions" -ne "$after_total_sessions" \
  || fail "expired-session reap fixture did not move total sessions"
test "$(jq -r '.permitted_observations.expired_sessions' "$TEST_TMP/before.json")" = "1"
test "$(jq -r '.permitted_observations.expired_sessions' "$TEST_TMP/after-permitted.json")" = "0"
assert_forbidden_counts_unchanged "$TEST_TMP/before.json" "$TEST_TMP/after-permitted.json"

# Forbidden movement must fail even though the permitted observations remain
# outside the comparison.
mock_accounts=7
capture_database_snapshot "$TEST_TMP/after-forbidden.json"
if assert_forbidden_counts_unchanged \
  "$TEST_TMP/after-permitted.json" \
  "$TEST_TMP/after-forbidden.json" 2>"$TEST_TMP/expected-failure.log"; then
  fail "forbidden-set movement was accepted"
fi
grep -Fq 'forbidden-set counts changed' "$TEST_TMP/expected-failure.log"

echo "live-verify-production contract: PASS (expired reap allowed; forbidden movement rejected)"
