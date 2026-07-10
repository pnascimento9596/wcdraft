#!/usr/bin/env bash

set -euo pipefail

fail() {
  echo "production migration status: REFUSED: $1" >&2
  exit 1
}

[ "$#" -eq 6 ] || fail "usage: <pre|post> <receipt> <exit-code> <expected-index> <expected-tag> <expected-total>"

mode="$1"
receipt="$2"
status_rc="$3"
expected_index="$4"
expected_tag="$5"
expected_total="$6"

case "$mode" in
  pre | post) ;;
  *) fail "mode must be pre or post" ;;
esac

case "$status_rc:$expected_index:$expected_total" in
  *[!0-9:]* | *::* | :* | *:) fail "numeric arguments are malformed" ;;
esac

[[ "$expected_tag" =~ ^[0-9]{4}_[a-z0-9_]+$ ]] || fail "expected migration tag is malformed"

[ -f "$receipt" ] && [ ! -L "$receipt" ] || fail "protected receipt is missing or not a regular file"
receipt_mode="$(stat -f '%Lp' "$receipt" 2>/dev/null || stat -c '%a' "$receipt")"
[ "$receipt_mode" = 600 ] || fail "protected receipt mode must be 600"

# The raw receipt is deliberately never printed: a driver error may include a
# database endpoint or credential. Classification emits only an allowlisted
# count summary after every expected field has matched.
grep -Fq '[db:migrate:status] FAILED' "$receipt" && fail "status command reported a query error"
grep -Fq 'but this checkout only knows' "$receipt" && fail "database is ahead of this checkout"

summary_prefix='[db:migrate:status] applied='
summary_count="$(grep -Fc "$summary_prefix" "$receipt" || true)"
[ "$summary_count" -eq 1 ] || fail "receipt must contain exactly one status summary"

if [ "$mode" = pre ]; then
  [ "$status_rc" -eq 1 ] || fail "preflight must exit 1 for a pending migration"
  expected_applied=$((expected_total - 1))
  [ "$expected_index" -eq "$expected_applied" ] || fail "expected migration must be the journal tail"
  expected_summary="[db:migrate:status] applied=$expected_applied pending=1 total=$expected_total"
  grep -Fxq "$expected_summary" "$receipt" || fail "preflight count is not exact known-pending"
  pending_count="$(grep -Ec '^  pending [0-9]{4} [0-9]{4}_[a-z0-9_]+$' "$receipt" || true)"
  [ "$pending_count" -eq 1 ] || fail "preflight must list exactly one pending migration"
  printf -v expected_pending '  pending %04d %s' "$expected_index" "$expected_tag"
  grep -Fxq "$expected_pending" "$receipt" || fail "pending migration does not match the approved tag"
  printf '%s\n' "production migration status: known-pending applied=$expected_applied pending=1 total=$expected_total"
else
  [ "$status_rc" -eq 0 ] || fail "postflight status must exit 0"
  expected_summary="[db:migrate:status] applied=$expected_total pending=0 total=$expected_total"
  grep -Fxq "$expected_summary" "$receipt" || fail "postflight did not reach the exact journal head"
  pending_count="$(grep -Ec '^  pending [0-9]{4} [0-9]{4}_[a-z0-9_]+$' "$receipt" || true)"
  [ "$pending_count" -eq 0 ] || fail "postflight still lists a pending migration"
  printf '%s\n' "production migration status: complete applied=$expected_total pending=0 total=$expected_total"
fi
