#!/usr/bin/env bash
# Production live-verify — artifact-safe under the corrected non-writing policy.
#
# Forbidden: leaderboard entries, ranked attempts, accounts, saved runs,
# magic-link tokens, or active (non-expired) durable sessions may be created or
# removed by this gate. Ordinary anonymous-request maintenance is permitted:
# expired-session reaping, rate-limit accounting, and 300s stateless CSRF
# bootstrap cookies. See docs/runbooks/production-live-verify.md.
#
# Probe: cookie-less anonymous POST /api/leaderboard/submit with the committed
# shipped_pre_basis_t3 skew fixture -> expect 409 DIFFERENT_BUILD. That shape is
# rejected by validateSubmissionCheap before rateLimiter.checkSubmit, bounding
# the probe's rate-limit exposure at zero while the current gate order holds.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-https://www.wcdraft.com}"
FIXTURE="${ROOT}/apps/web/lib/game/__tests__/fixtures/run-token-skew.json"
RECEIPT_DIR="${RECEIPT_DIR:-}"
ARCHIVE_SEASON="${ARCHIVE_SEASON:-season-2026-manager-attrition}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "live-verify: missing required command: $1" >&2
    return 1
  }
}

run_readonly_sql() {
  local sql="$1"
  PGOPTIONS="${PGOPTIONS:+${PGOPTIONS} }-c default_transaction_read_only=on -c statement_timeout=8000" \
    psql "$LIVE_VERIFY_DATABASE_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$sql"
}

capture_database_snapshot() {
  local out="$1"
  local raw
  raw="$(run_readonly_sql "
    SELECT jsonb_build_object(
      'database', jsonb_build_object(
        'project_id', current_setting('neon.project_id', true),
        'branch_id', current_setting('neon.branch_id', true)
      ),
      'forbidden_counts', jsonb_build_object(
        'leaderboard_entries', (SELECT count(*) FROM leaderboard_entries),
        'ranked_attempts', (SELECT count(*) FROM ranked_attempts),
        'accounts', (SELECT count(*) FROM users),
        'saved_runs', (SELECT count(*) FROM saved_runs),
        'magic_link_tokens', (SELECT count(*) FROM magic_link_tokens),
        'active_sessions', (
          SELECT count(*) FROM sessions WHERE expires_at > clock_timestamp()
        )
      ),
      'permitted_observations', jsonb_build_object(
        'expired_sessions', (
          SELECT count(*) FROM sessions WHERE expires_at <= clock_timestamp()
        ),
        'rate_limit_rows', (SELECT count(*) FROM auth_rate_limits),
        'rate_limit_events', (
          SELECT coalesce(sum(count), 0)::bigint FROM auth_rate_limits
        )
      )
    );
  ")"

  if ! jq -e \
    --arg project "$LIVE_VERIFY_EXPECTED_NEON_PROJECT_ID" \
    --arg branch "$LIVE_VERIFY_EXPECTED_NEON_BRANCH_ID" '
      .database == {project_id: $project, branch_id: $branch}
      and (.forbidden_counts | keys | sort) == ([
        "accounts",
        "active_sessions",
        "leaderboard_entries",
        "magic_link_tokens",
        "ranked_attempts",
        "saved_runs"
      ] | sort)
      and ([.forbidden_counts[]] | all(type == "number" and . >= 0 and floor == .))
      and (.permitted_observations | keys | sort) == ([
        "expired_sessions",
        "rate_limit_events",
        "rate_limit_rows"
      ] | sort)
      and ([.permitted_observations[]] | all(type == "number" and . >= 0 and floor == .))
    ' <<<"$raw" >/dev/null; then
    echo "live-verify: database snapshot was malformed or targeted the wrong Neon branch" >&2
    return 1
  fi
  jq -S '.' <<<"$raw" >"${out}.tmp"
  mv "${out}.tmp" "$out"
}

assert_forbidden_counts_unchanged() {
  local before="$1"
  local after="$2"
  local before_counts after_counts
  before_counts="$(jq -S -c '.forbidden_counts' "$before")"
  after_counts="$(jq -S -c '.forbidden_counts' "$after")"
  if [[ "$before_counts" != "$after_counts" ]]; then
    echo "live-verify: forbidden-set counts changed" >&2
    jq -n --slurpfile before "$before" --slurpfile after "$after" '{
      before: $before[0].forbidden_counts,
      after: $after[0].forbidden_counts
    }' >&2
    return 1
  fi
}

board_snapshot() {
  local label="$1"
  local qs="$2"
  local out="$RECEIPT_DIR/board-${label}.json"
  local http
  http="$(curl -sS -o "$out" -w '%{http_code}' \
    "${BASE_URL}/api/leaderboard?${qs}")"
  if [[ "$http" != "200" ]]; then
    echo "live-verify: board ${label} HTTP ${http}" >&2
    cat "$out" >&2 || true
    return 1
  fi
  jq -c '{
    season_key,
    current_season_key,
    mode,
    draft_mode,
    n: (.entries | length),
    ids: [.entries[].id]
  }' "$out"
}

assert_ids_unchanged() {
  local label="$1"
  local before="$2"
  local after="$3"
  local b_ids a_ids
  b_ids="$(jq -c '.ids | sort' <<<"$before")"
  a_ids="$(jq -c '.ids | sort' <<<"$after")"
  if [[ "$b_ids" != "$a_ids" ]]; then
    echo "live-verify: board ${label} ids changed after probe" >&2
    echo "  before: $b_ids" >&2
    echo "  after:  $a_ids" >&2
    return 1
  fi
}

redact_cookie_headers() {
  local headers="$1"
  python3 - "$headers" <<'PY'
import os
import sys

path = sys.argv[1]
temporary = f"{path}.redacted"
with open(path, encoding="utf-8") as source, open(temporary, "w", encoding="utf-8") as target:
    for line in source:
        if line.lower().startswith("set-cookie:") and "=" in line:
            prefix, remainder = line.split("=", 1)
            attributes = remainder[remainder.find(";") :] if ";" in remainder else "\n"
            line = f"{prefix}=[redacted]{attributes}"
        target.write(line)
os.replace(temporary, path)
PY
}

redact_csrf_body() {
  local body="$1"
  if jq -e 'type == "object" and has("csrfToken")' "$body" >/dev/null 2>&1; then
    jq '.csrfToken = "[redacted]"' "$body" >"${body}.redacted"
    mv "${body}.redacted" "$body"
  fi
}

assert_bootstrap_cookie_ttls() {
  local headers="$1"
  if ! grep -qiE 'set-cookie:.*wcdraft_csrf=.*max-age=300([;[:space:]]|$)' "$headers"; then
    echo "live-verify: CSRF missing 300s wcdraft_csrf bootstrap cookie" >&2
    return 1
  fi
  # The stateless bootstrap currently reuses the wcdraft_sid cookie name with
  # the same 300s TTL. It is permitted because it has no sessions-table row.
  # A durable sid cookie (anything other than Max-Age 0/300) is forbidden.
  if grep -iE 'set-cookie:.*wcdraft_sid=' "$headers" \
    | grep -qviE 'max-age=(0|300)([;[:space:]]|$)'; then
    echo "live-verify: CSRF issued a durable-looking wcdraft_sid cookie" >&2
    return 1
  fi
}

assert_probe_precedes_rate_limit() {
  local submit_source="$1"
  python3 - "$submit_source" <<'PY'
import sys

source = open(sys.argv[1], encoding="utf-8").read()
cheap = source.find("const cheapVerdict = validateSubmissionCheap")
limiter = source.find("const decision = await deps.rateLimiter.checkSubmit")
if cheap < 0 or limiter < 0:
    raise SystemExit("live-verify: submit gate-order markers missing at target SHA")
if cheap >= limiter:
    raise SystemExit(
        "live-verify: target SHA no longer rejects DIFFERENT_BUILD before the submit limiter"
    )
PY
}

prepare_expected_anchors() {
  local target_sha="$1"
  local manifest="$RECEIPT_DIR/expected-manifest.json"
  local season_source="$RECEIPT_DIR/expected-season.ts"
  local submit_source="$RECEIPT_DIR/expected-submit-route.ts"

  git show "${target_sha}:packages/data/src/generated/manifest.json" >"$manifest"
  git show "${target_sha}:apps/web/lib/leaderboard/season.ts" >"$season_source"
  git show "${target_sha}:apps/web/lib/leaderboard/submit-route.ts" >"$submit_source"
  assert_probe_precedes_rate_limit "$submit_source"

  EXPECTED_SEASON="$({
    python3 - "$season_source" <<'PY'
import re
import sys

source = open(sys.argv[1], encoding="utf-8").read()
match = re.search(
    r'export const DEFAULT_LEADERBOARD_SEASON_ID\s*=\s*"([^"]+)"\s+as const',
    source,
)
if match is None:
    raise SystemExit("DEFAULT_LEADERBOARD_SEASON_ID not found")
print(match.group(1))
PY
  } )"

  jq -e '{
    schema_version,
    dataset_version,
    engine_version,
    rating_version_historical,
    rating_version_projected,
    ruleset_version,
    draft_pool_sha256: (.bundles.draft_pool.raw_sha256 // .bundles.draft_pool.sha256)
  } | all(.[]; type == "string" and length > 0)' "$manifest" >/dev/null

  jq '{
    schema_version,
    dataset_version,
    engine_version,
    rating_version_historical,
    rating_version_projected,
    ruleset_version,
    draft_pool_sha256: (.bundles.draft_pool.raw_sha256 // .bundles.draft_pool.sha256)
  }' "$manifest" >"$RECEIPT_DIR/expected-anchors.json"
}

finalize_database_assertion() {
  local original_status=$?
  local final_status="$original_status"
  trap - EXIT
  set +e

  if ! capture_database_snapshot "$RECEIPT_DIR/database-after.json"; then
    echo "live-verify: failed to capture the required after-count snapshot" >&2
    final_status=1
  elif ! assert_forbidden_counts_unchanged \
    "$RECEIPT_DIR/database-before.json" \
    "$RECEIPT_DIR/database-after.json"; then
    final_status=1
  else
    echo "live-verify: forbidden-set counts unchanged (sessions count active expires_at > clock_timestamp() only)"
    jq -nc \
      --slurpfile before "$RECEIPT_DIR/database-before.json" \
      --slurpfile after "$RECEIPT_DIR/database-after.json" '{
        before: $before[0],
        after: $after[0]
      }'
  fi

  if [[ "$final_status" -eq 0 ]]; then
    echo "live-verify: PASS (artifact-safe; permitted maintenance observed but not asserted unchanged)"
    echo "live-verify: receipts in ${RECEIPT_DIR}"
  else
    echo "live-verify: FAIL; receipts in ${RECEIPT_DIR}" >&2
  fi
  exit "$final_status"
}

main() {
  local requested_sha="${EXPECTED_SHA:-}"
  if [[ "$#" -gt 1 ]]; then
    echo "usage: $0 [expected-deploy-sha]" >&2
    return 2
  fi
  if [[ "$#" -eq 1 ]]; then
    if [[ -n "$requested_sha" && "$requested_sha" != "$1" ]]; then
      echo "live-verify: positional SHA and EXPECTED_SHA disagree" >&2
      return 2
    fi
    requested_sha="$1"
  fi

  require_cmd curl
  require_cmd git
  require_cmd jq
  require_cmd psql
  require_cmd python3

  : "${LIVE_VERIFY_DATABASE_URL:?live-verify: LIVE_VERIFY_DATABASE_URL is required}"
  : "${LIVE_VERIFY_EXPECTED_NEON_PROJECT_ID:?live-verify: LIVE_VERIFY_EXPECTED_NEON_PROJECT_ID is required}"
  : "${LIVE_VERIFY_EXPECTED_NEON_BRANCH_ID:?live-verify: LIVE_VERIFY_EXPECTED_NEON_BRANCH_ID is required}"

  if [[ ! -f "$FIXTURE" ]]; then
    echo "live-verify: skew fixture missing at $FIXTURE" >&2
    return 1
  fi

  umask 077
  if [[ -z "$RECEIPT_DIR" ]]; then
    RECEIPT_DIR="$(mktemp -d /tmp/wcdraft-live-verify.XXXXXX)"
  fi
  mkdir -p "$RECEIPT_DIR"

  echo "live-verify: base=${BASE_URL}"
  echo "live-verify: receipt=${RECEIPT_DIR}"

  # Capture the forbidden set before any production HTTP request. The SQL
  # session is read-only and also proves the counter URL reaches the declared
  # production Neon project/branch.
  capture_database_snapshot "$RECEIPT_DIR/database-before.json"
  trap finalize_database_assertion EXIT

  # -- 1. Health + SHA-derived anchors ---------------------------------------
  local health_http health_sha target_sha
  health_http="$(curl -sS -o "$RECEIPT_DIR/health.json" -w '%{http_code}' \
    "${BASE_URL}/api/health")"
  if [[ "$health_http" != "200" ]]; then
    echo "live-verify: /api/health HTTP ${health_http}" >&2
    cat "$RECEIPT_DIR/health.json" >&2 || true
    return 1
  fi
  jq -e '
    .ok == true
    and .db.status == "ready"
    and .auth.status == "ready"
    and (.build.sha | type == "string" and test("^[0-9a-f]{40}$"))
  ' "$RECEIPT_DIR/health.json" >/dev/null
  health_sha="$(jq -r '.build.sha' "$RECEIPT_DIR/health.json")"

  if [[ -n "$requested_sha" ]]; then
    if [[ ! "$requested_sha" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
      echo "live-verify: expected deploy SHA is malformed" >&2
      return 1
    fi
    target_sha="$(git rev-parse --verify "${requested_sha}^{commit}")"
  else
    target_sha="$health_sha"
    git cat-file -e "${target_sha}^{commit}"
  fi
  if [[ "$health_sha" != "$target_sha" ]]; then
    echo "live-verify: health build SHA ${health_sha} != expected ${target_sha}" >&2
    return 1
  fi

  prepare_expected_anchors "$target_sha"
  jq -e \
    --arg sha "$target_sha" \
    --arg season "$EXPECTED_SEASON" \
    --slurpfile anchors "$RECEIPT_DIR/expected-anchors.json" '
      .build.sha == $sha
      and .leaderboard.season_key == $season
      and .data.schema_version == $anchors[0].schema_version
      and .data.dataset_version == $anchors[0].dataset_version
      and .data.engine_version == $anchors[0].engine_version
      and .data.rating_version_historical == $anchors[0].rating_version_historical
      and .data.rating_version_projected == $anchors[0].rating_version_projected
      and .data.ruleset_version == $anchors[0].ruleset_version
      and .data.draft_pool_sha256 == $anchors[0].draft_pool_sha256
    ' "$RECEIPT_DIR/health.json" >/dev/null

  echo "live-verify: health + SHA-derived anchors ok"
  jq -c '{
    sha: .build.sha,
    season: .leaderboard.season_key,
    schema: .data.schema_version,
    engine: .data.engine_version,
    dataset: .data.dataset_version,
    db: .db.status,
    auth: .auth.status
  }' "$RECEIPT_DIR/health.json"

  # -- 1b. CSRF bootstrap (stateless; may reap expired sessions) -------------
  local csrf_http
  csrf_http="$(curl -sS -D "$RECEIPT_DIR/csrf.hdr" -o "$RECEIPT_DIR/csrf.json" -w '%{http_code}' \
    "${BASE_URL}/api/auth/csrf")"
  redact_cookie_headers "$RECEIPT_DIR/csrf.hdr"
  if [[ "$csrf_http" != "200" ]]; then
    echo "live-verify: GET /api/auth/csrf HTTP ${csrf_http}" >&2
    redact_csrf_body "$RECEIPT_DIR/csrf.json"
    cat "$RECEIPT_DIR/csrf.json" >&2 || true
    return 1
  fi
  jq -e '
    (.csrfToken | type == "string" and length > 0)
    and .csrfCookieName == "wcdraft_csrf"
    and .isAuthenticated == false
  ' "$RECEIPT_DIR/csrf.json" >/dev/null || {
    echo "live-verify: CSRF body missing bootstrap fields" >&2
    redact_csrf_body "$RECEIPT_DIR/csrf.json"
    cat "$RECEIPT_DIR/csrf.json" >&2 || true
    return 1
  }
  redact_csrf_body "$RECEIPT_DIR/csrf.json"
  if ! assert_bootstrap_cookie_ttls "$RECEIPT_DIR/csrf.hdr"; then
    cat "$RECEIPT_DIR/csrf.hdr" >&2 || true
    return 1
  fi
  echo "live-verify: CSRF bootstrap 200 / 300s stateless cookies / no durable session ok"

  # -- 2. Board snapshots (before) ------------------------------------------
  local before_classic before_memory before_ranked before_archive
  before_classic="$(board_snapshot classic-casual \
    'mode=casual&draft_mode=classic&limit=100')"
  before_memory="$(board_snapshot memory-casual \
    'mode=casual&draft_mode=hidden&limit=100')"
  before_ranked="$(board_snapshot classic-ranked \
    'mode=ranked&draft_mode=classic&limit=100')"
  before_archive="$(board_snapshot archive-classic \
    "season=${ARCHIVE_SEASON}&mode=casual&draft_mode=classic&limit=100")"

  jq -e --arg current "$EXPECTED_SEASON" '.current_season_key == $current' \
    <<<"$before_classic" >/dev/null
  jq -e --arg archive "$ARCHIVE_SEASON" '.season_key == $archive' \
    <<<"$before_archive" >/dev/null
  printf 'live-verify: board before classic=%s memory=%s ranked=%s archive=%s\n' \
    "$(jq -c '{n,ids}' <<<"$before_classic")" \
    "$(jq -c '{n,ids}' <<<"$before_memory")" \
    "$(jq -c '{n,ids}' <<<"$before_ranked")" \
    "$(jq -c '{season_key,n,ids}' <<<"$before_archive")"

  # -- 3. Deliberate rejection probe (cookie-less, no alias) ----------------
  local probe_token probe_body probe_http
  probe_token="$({
    python3 - "$FIXTURE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
token = data["shipped_pre_basis_t3"]["token"]
if not isinstance(token, str) or not token.startswith("t"):
    raise SystemExit("shipped_pre_basis_t3.token missing or malformed")
print(token)
PY
  } )"
  probe_body="$(jq -nc --arg t "$probe_token" \
    '{token:$t, claimed_score:0, draft_mode:"classic", mode:"casual"}')"
  probe_http="$(curl -sS -o "$RECEIPT_DIR/probe.json" -w '%{http_code}' \
    -X POST "${BASE_URL}/api/leaderboard/submit" \
    -H 'content-type: application/json' \
    -H "origin: ${BASE_URL}" \
    --data-binary "$probe_body")"

  if [[ "$probe_http" != "409" ]]; then
    echo "live-verify: probe expected HTTP 409, got ${probe_http}" >&2
    cat "$RECEIPT_DIR/probe.json" >&2 || true
    return 1
  fi
  jq -e '.error == "DIFFERENT_BUILD"' "$RECEIPT_DIR/probe.json" >/dev/null || {
    echo "live-verify: probe expected error=DIFFERENT_BUILD" >&2
    cat "$RECEIPT_DIR/probe.json" >&2 || true
    return 1
  }
  echo "live-verify: probe 409 DIFFERENT_BUILD ok"
  jq -c '{error, mismatched_anchors}' "$RECEIPT_DIR/probe.json"

  # -- 4. Board snapshots (after) -------------------------------------------
  local after_classic after_memory after_ranked after_archive
  after_classic="$(board_snapshot classic-casual-after \
    'mode=casual&draft_mode=classic&limit=100')"
  after_memory="$(board_snapshot memory-casual-after \
    'mode=casual&draft_mode=hidden&limit=100')"
  after_ranked="$(board_snapshot classic-ranked-after \
    'mode=ranked&draft_mode=classic&limit=100')"
  after_archive="$(board_snapshot archive-classic-after \
    "season=${ARCHIVE_SEASON}&mode=casual&draft_mode=classic&limit=100")"

  assert_ids_unchanged classic-casual "$before_classic" "$after_classic"
  assert_ids_unchanged memory-casual "$before_memory" "$after_memory"
  assert_ids_unchanged classic-ranked "$before_ranked" "$after_ranked"
  assert_ids_unchanged archive-classic "$before_archive" "$after_archive"
  echo "live-verify: board row ids unchanged on all four boards"

  # -- 5. Archive read-only surface (HTML) ----------------------------------
  local page_http
  page_http="$(curl -sS -o "$RECEIPT_DIR/leaderboard.html" -w '%{http_code}' \
    "${BASE_URL}/leaderboard")"
  if [[ "$page_http" != "200" ]]; then
    echo "live-verify: /leaderboard HTTP ${page_http}" >&2
    return 1
  fi
  if ! grep -q 'Season closed' "$RECEIPT_DIR/leaderboard.html"; then
    if ! grep -qi 'leaderboard' "$RECEIPT_DIR/leaderboard.html"; then
      echo "live-verify: /leaderboard page missing leaderboard surface" >&2
      return 1
    fi
    echo "live-verify: note - 'Season closed' not in SSR HTML (client-rendered archive copy); API archive read ok"
  else
    echo "live-verify: archive 'Season closed' copy present in page HTML"
  fi

  # -- 6. OG health (read-only) ---------------------------------------------
  local og_http
  og_http="$(curl -sS -o "$RECEIPT_DIR/og-health.json" -w '%{http_code}' \
    "${BASE_URL}/api/og/health")"
  if [[ "$og_http" != "200" ]]; then
    echo "live-verify: /api/og/health HTTP ${og_http}" >&2
    cat "$RECEIPT_DIR/og-health.json" >&2 || true
    return 1
  fi
  jq -e '.ok == true' "$RECEIPT_DIR/og-health.json" >/dev/null
  echo "live-verify: og health ok"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
