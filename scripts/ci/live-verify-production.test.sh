#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2016
# Structure + forbidden-set behavior contract for production live-verify.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/live-verify-production.sh"
DIAGNOSTICS="$ROOT/scripts/ci/external-tool-diagnostics.sh"
RUNBOOK="$ROOT/docs/runbooks/production-live-verify.md"
SUBMIT_ROUTE="$ROOT/apps/web/lib/leaderboard/submit-route.ts"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

test -x "$SCRIPT" || fail "script not executable"
test -r "$DIAGNOSTICS" || fail "external-tool diagnostics helper missing"
test -f "$RUNBOOK" || fail "runbook missing"
bash -n "$SCRIPT"
bash -n "$DIAGNOSTICS"

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

# The database URI is consumed over stdin by a constant-error parser, then
# removed before psql runs. libpq receives only discrete non-secret settings
# plus a mode-0600 password file. Failed streams are classified in place and
# rendered through a fixed allowlist; no raw provider byte is surfaced.
TEST_DB_PASSWORD="npg_${RANDOM}_credential_shape_only"
TEST_DB_HOST="ep-test-credential-shape.us-east-2.aws.neon.tech"
LIVE_VERIFY_DATABASE_URL="postgresql://unit_user:${TEST_DB_PASSWORD}@${TEST_DB_HOST}/unit_db?sslmode=require&channel_binding=require"
prepare_psql_credentials
test -z "${LIVE_VERIFY_DATABASE_URL+x}" || fail "database URI remained available after parsing"
test "$(python3 -c 'import os,sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])' \
  "$LIVE_VERIFY_PGPASSFILE")" = 600 || fail "PGPASSFILE is not mode 0600"
grep -Fq -- "$TEST_DB_PASSWORD" "$LIVE_VERIFY_PGPASSFILE" \
  || fail "PGPASSFILE did not receive the parsed password"

PSQL_ARGV_LOG="$TEST_TMP/psql-argv.txt"
PSQL_ENV_LOG="$TEST_TMP/psql-env.txt"
PSQL_FAILURE_MODE=no
PSQL_FAIL_UNTIL=0
PSQL_CALLS=0
psql() {
  PSQL_CALLS=$((PSQL_CALLS + 1))
  printf '%s\n' "$@" >"$PSQL_ARGV_LOG"
  printf 'uri=%s\npassfile=%s\nconnect_timeout=%s\n' \
    "${LIVE_VERIFY_DATABASE_URL+present}" \
    "${PGPASSFILE:+present}" \
    "${PGCONNECT_TIMEOUT:-}" >"$PSQL_ENV_LOG"
  test -r "$PGPASSFILE"
  if [[ "$PSQL_CALLS" -le "$PSQL_FAIL_UNTIL" ]]; then
    case "$PSQL_FAILURE_MODE" in
      connection_refused)
        printf 'partial output containing postgresql://unit_user:%s@%s/unit_db\n' \
          "$TEST_DB_PASSWORD" "$TEST_DB_HOST"
        printf 'psql: connection to server at "%s" failed: Connection refused; password=%s\n' \
          "$TEST_DB_HOST" "$TEST_DB_PASSWORD" >&2
        return 41
        ;;
      unknown)
        printf 'opaque stream postgresql://unit_user:%s@%s/unit_db\n' \
          "$TEST_DB_PASSWORD" "$TEST_DB_HOST"
        printf 'unmapped-provider-gibberish credential=%s endpoint=%s\n' \
          "$TEST_DB_PASSWORD" "$TEST_DB_HOST" >&2
        return 42
        ;;
      query_error)
        printf 'query fragment postgresql://unit_user:%s@%s/unit_db\n' \
          "$TEST_DB_PASSWORD" "$TEST_DB_HOST"
        printf 'ERROR: syntax error in protected query; credential=%s\n' \
          "$TEST_DB_PASSWORD" >&2
        return 43
        ;;
    esac
  fi
  printf '{"probe":"ok"}\n'
}

run_readonly_sql 'SELECT 1' >"$TEST_TMP/psql-success.stdout"
test "$(<"$TEST_TMP/psql-success.stdout")" = '{"probe":"ok"}'
grep -Fxq 'uri=' "$PSQL_ENV_LOG"
grep -Fq 'passfile=present' "$PSQL_ENV_LOG"
grep -Fxq 'connect_timeout=10' "$PSQL_ENV_LOG"
if grep -Eq 'postgres(ql)?://|npg_' "$PSQL_ARGV_LOG"; then
  fail "psql argv retained a credential-bearing connection value"
fi

PSQL_CALLS=0
PSQL_FAIL_UNTIL=1
PSQL_FAILURE_MODE=connection_refused
set +e
run_readonly_sql 'SELECT simulated_failure' snapshot \
  >"$TEST_TMP/psql-failure.stdout" 2>"$TEST_TMP/psql-failure.stderr"
psql_failure_status=$?
set -e
if [[ "$psql_failure_status" -eq 0 ]]; then
  fail "simulated psql failure unexpectedly passed"
fi
test "$psql_failure_status" -eq 41 || fail "simulated psql status was not preserved"
grep -Fq 'tool=psql phase=snapshot status=41 category=connection_refused retryable=true' \
  "$TEST_TMP/psql-failure.stderr"
grep -Fq 'diagnostic=remote_connection_refused_or_reset' \
  "$TEST_TMP/psql-failure.stderr"
if rg -q 'postgres(ql)?://|npg_|credential_shape|ep-test-credential-shape' \
  "$TEST_TMP/psql-failure.stdout" "$TEST_TMP/psql-failure.stderr"; then
  fail "simulated psql failure emitted a credential or credential fragment"
fi

PSQL_CALLS=0
PSQL_FAIL_UNTIL=1
PSQL_FAILURE_MODE=unknown
set +e
run_readonly_sql 'SELECT simulated_unknown' snapshot \
  >"$TEST_TMP/psql-unknown.stdout" 2>"$TEST_TMP/psql-unknown.stderr"
psql_unknown_status=$?
set -e
test "$psql_unknown_status" -eq 42 || fail "unknown psql status was not preserved"
grep -Fq 'tool=psql phase=snapshot status=42 category=unknown retryable=false' \
  "$TEST_TMP/psql-unknown.stderr"
grep -Fq 'diagnostic=provider_output_withheld_unclassified' \
  "$TEST_TMP/psql-unknown.stderr"
if rg -q 'postgres(ql)?://|npg_|credential_shape|ep-test-credential-shape' \
  "$TEST_TMP/psql-unknown.stdout" "$TEST_TMP/psql-unknown.stderr"; then
  fail "unclassifiable psql failure emitted a credential or credential fragment"
fi

# Every required category is selected only by quiet, known-safe pattern matches,
# and rendering every classified stream is independent of its captured bytes.
assert_safe_classified_diagnostic() {
  local expected="$1"
  local safe_pattern="$2"
  local actual

  printf '%s credential=%s endpoint=%s\n' \
    "$safe_pattern" "$TEST_DB_PASSWORD" "$TEST_DB_HOST" \
    >"$TEST_TMP/classifier.stdout"
  printf '%s\n' opaque >"$TEST_TMP/classifier.stderr"
  actual="$(classify_external_tool_failure \
    "$TEST_TMP/classifier.stdout" "$TEST_TMP/classifier.stderr")"
  test "$actual" = "$expected" || fail "classifier did not select $expected"
  emit_sanitized_external_tool_failure \
    live-verify psql snapshot 44 "$actual" \
    >"$TEST_TMP/classifier-diagnostic.stdout"
  grep -Fq "status=44 category=${expected}" \
    "$TEST_TMP/classifier-diagnostic.stdout"
  if grep -Fq -- "$TEST_DB_PASSWORD" "$TEST_TMP/classifier-diagnostic.stdout" || \
    grep -Fq -- "$TEST_DB_HOST" "$TEST_TMP/classifier-diagnostic.stdout"; then
    fail "classified $expected diagnostic reflected captured bytes"
  fi
}

assert_safe_classified_diagnostic connection_refused 'connection refused'
assert_safe_classified_diagnostic timeout 'timeout expired'
assert_safe_classified_diagnostic authentication_failure 'password authentication failed'
assert_safe_classified_diagnostic tls 'SSL error: certificate verify failed'
assert_safe_classified_diagnostic dns 'could not translate host name'
assert_safe_classified_diagnostic permission_denied 'permission denied'
assert_safe_classified_diagnostic query_error 'ERROR: syntax error'
assert_safe_classified_diagnostic unknown 'opaque provider failure token=opaque'

# Even caller-supplied metadata is allowlisted rather than reflected.
TEST_METADATA_SECRET="metadata_${RANDOM}_credential_shape_only"
emit_sanitized_external_tool_failure \
  "$TEST_METADATA_SECRET" "$TEST_METADATA_SECRET" "$TEST_METADATA_SECRET" 47 timeout \
  >"$TEST_TMP/metadata-diagnostic.stdout"
grep -Fq \
  'external-tool: external-tool failure tool=unknown phase=unknown status=47 category=timeout retryable=true' \
  "$TEST_TMP/metadata-diagnostic.stdout"
if grep -Fq -- "$TEST_METADATA_SECRET" "$TEST_TMP/metadata-diagnostic.stdout"; then
  fail "external-tool diagnostic reflected caller metadata"
fi

# Bounded retry belongs only to the connection warm-up. Snapshot/assertion SQL
# calls run once even when their failure category would otherwise be transient.
sleep() { :; }
PSQL_CALLS=0
PSQL_FAIL_UNTIL=2
PSQL_FAILURE_MODE=connection_refused
warm_database_connection \
  >"$TEST_TMP/warmup.stdout" 2>"$TEST_TMP/warmup.stderr"
test "$PSQL_CALLS" -eq 3 || fail "connection warm-up was not bounded at three attempts"
grep -Fq 'database connection warm-up ok (attempt 3/3)' "$TEST_TMP/warmup.stdout"
test "$(grep -Fc 'retrying connection warm-up' "$TEST_TMP/warmup.stderr")" -eq 2 \
  || fail "connection warm-up backoff count changed"

PSQL_CALLS=0
PSQL_FAIL_UNTIL=99
PSQL_FAILURE_MODE=query_error
set +e
run_readonly_sql 'SELECT broken_assertion' assertion \
  >"$TEST_TMP/assertion.stdout" 2>"$TEST_TMP/assertion.stderr"
assertion_status=$?
set -e
test "$assertion_status" -eq 43 || fail "query assertion status was not preserved"
test "$PSQL_CALLS" -eq 1 || fail "assertion SQL was retried"
grep -Fq 'phase=assertion status=43 category=query_error retryable=false' \
  "$TEST_TMP/assertion.stderr"
PSQL_FAILURE_MODE=no
PSQL_FAIL_UNTIL=0

private_dir_before_cleanup="$LIVE_VERIFY_PSQL_PRIVATE_DIR"
cleanup_psql_credentials
test ! -e "$private_dir_before_cleanup" || fail "private psql credential directory was retained"

# The live bootstrap uses a 300s stateless value under the wcdraft_sid name.
# That is permitted; a durable 30-day sid is not. Redaction must preserve the
# TTL evidence without retaining either cookie value or the CSRF token.
printf '%s\n' \
  'set-cookie: wcdraft_bootstrap=bootstrap-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_sid=short-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_csrf=csrf-secret; Path=/; Max-Age=300' \
  >"$TEST_TMP/bootstrap.hdr"
assert_bootstrap_cookie_ttls "$TEST_TMP/bootstrap.hdr"
redact_cookie_headers "$TEST_TMP/bootstrap.hdr"
grep -Fq 'wcdraft_bootstrap=[redacted]; Path=/; Max-Age=300' "$TEST_TMP/bootstrap.hdr"
grep -Fq 'wcdraft_sid=[redacted]; Path=/; Max-Age=300' "$TEST_TMP/bootstrap.hdr"
grep -Fq 'wcdraft_csrf=[redacted]; Path=/; Max-Age=300' "$TEST_TMP/bootstrap.hdr"
if rg -q 'bootstrap-secret|short-secret|csrf-secret' "$TEST_TMP/bootstrap.hdr"; then
  fail "cookie receipt retained a short-lived secret"
fi
printf '%s\n' \
  'set-cookie: wcdraft_bootstrap=bootstrap-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_sid=durable-secret; Path=/; Max-Age=2592000; HttpOnly' \
  'set-cookie: wcdraft_csrf=csrf-secret; Path=/; Max-Age=300' \
  >"$TEST_TMP/durable.hdr"
if assert_bootstrap_cookie_ttls "$TEST_TMP/durable.hdr" 2>"$TEST_TMP/durable-failure.log"; then
  fail "durable session cookie was accepted"
fi
grep -Fq 'durable-looking wcdraft_sid' "$TEST_TMP/durable-failure.log"

printf '%s\n' \
  'set-cookie: wcdraft_bootstrap=bootstrap-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_sid=short-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_csrf=csrf-secret; Path=/; Max-Age=3000' \
  >"$TEST_TMP/wrong-csrf-ttl.hdr"
if assert_bootstrap_cookie_ttls \
  "$TEST_TMP/wrong-csrf-ttl.hdr" 2>"$TEST_TMP/wrong-csrf-ttl.log"; then
  fail "CSRF Max-Age=3000 was accepted as an exact 300-second bootstrap"
fi
grep -Fq 'missing 300s wcdraft_csrf bootstrap cookie' "$TEST_TMP/wrong-csrf-ttl.log"

printf '%s\n' \
  'set-cookie: wcdraft_sid=short-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_csrf=csrf-secret; Path=/; Max-Age=300' \
  >"$TEST_TMP/missing-bootstrap.hdr"
if assert_bootstrap_cookie_ttls \
  "$TEST_TMP/missing-bootstrap.hdr" 2>"$TEST_TMP/missing-bootstrap.log"; then
  fail "two-cookie CSRF bootstrap was accepted"
fi
grep -Fq 'missing 300s wcdraft_bootstrap cookie' "$TEST_TMP/missing-bootstrap.log"

printf '%s\n' \
  'set-cookie: wcdraft_bootstrap=bootstrap-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_sid=short-secret; Path=/; Max-Age=300; HttpOnly' \
  'set-cookie: wcdraft_csrf=csrf-secret; Path=/; Max-Age=300' \
  'set-cookie: unrelated=opaque; Path=/; Max-Age=300' \
  >"$TEST_TMP/extra-cookie.hdr"
if assert_bootstrap_cookie_ttls \
  "$TEST_TMP/extra-cookie.hdr" 2>"$TEST_TMP/extra-cookie.log"; then
  fail "four-cookie CSRF bootstrap was accepted"
fi
grep -Fq 'expected exactly three bootstrap cookies, got 4' "$TEST_TMP/extra-cookie.log"

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

echo "live-verify-production contract: PASS (credential-safe psql failure; expired reap allowed; forbidden movement rejected)"
