#!/usr/bin/env bash
# Production live-verify — NON-WRITING.
#
# Standing constraint (docs/runbooks/production-live-verify.md, STATE.md):
# production live-verify must never create leaderboard rows, ranked attempts,
# or accounts. Accepting-path coverage lives pre-merge on disposable substrate.
#
# Probe: cookie-less anonymous POST /api/leaderboard/submit with the committed
# shipped_pre_basis_t3 skew fixture → expect 409 DIFFERENT_BUILD, board ids
# unchanged.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${BASE_URL:-https://www.wcdraft.com}"
FIXTURE="${ROOT}/apps/web/lib/game/__tests__/fixtures/run-token-skew.json"
RECEIPT_DIR="${RECEIPT_DIR:-$(mktemp -d /tmp/wcdraft-live-verify.XXXXXX)}"
ARCHIVE_SEASON="${ARCHIVE_SEASON:-season-2026-manager-attrition}"

umask 077
mkdir -p "$RECEIPT_DIR"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "live-verify: missing required command: $1" >&2
    exit 1
  }
}

require_cmd curl
require_cmd jq
require_cmd python3

if [[ ! -f "$FIXTURE" ]]; then
  echo "live-verify: skew fixture missing at $FIXTURE" >&2
  exit 1
fi

PROBE_TOKEN="$(
  python3 - "$FIXTURE" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path, encoding="utf-8"))
token = data["shipped_pre_basis_t3"]["token"]
if not isinstance(token, str) or not token.startswith("t"):
    raise SystemExit("shipped_pre_basis_t3.token missing or malformed")
print(token)
PY
)"

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
    exit 1
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

echo "live-verify: base=${BASE_URL}"
echo "live-verify: receipt=${RECEIPT_DIR}"

# ── 1. Health + anchors ─────────────────────────────────────────────────────
health_http="$(curl -sS -o "$RECEIPT_DIR/health.json" -w '%{http_code}' \
  "${BASE_URL}/api/health")"
if [[ "$health_http" != "200" ]]; then
  echo "live-verify: /api/health HTTP ${health_http}" >&2
  cat "$RECEIPT_DIR/health.json" >&2 || true
  exit 1
fi
jq -e '
  .ok == true
  and .db.status == "ready"
  and .auth.status == "ready"
  and (.data.schema_version | type == "string")
  and (.data.engine_version | type == "string")
  and (.data.dataset_version | type == "string")
  and (.data.rating_version_historical | type == "string")
  and (.data.rating_version_projected | type == "string")
  and (.data.ruleset_version | type == "string")
  and (.data.draft_pool_sha256 | type == "string")
  and (.leaderboard.season_key | type == "string")
' "$RECEIPT_DIR/health.json" >/dev/null

echo "live-verify: health ok"
jq -c '{
  sha: .build.sha,
  season: .leaderboard.season_key,
  schema: .data.schema_version,
  engine: .data.engine_version,
  dataset: .data.dataset_version,
  db: .db.status,
  auth: .auth.status
}' "$RECEIPT_DIR/health.json"

# ── 1b. CSRF bootstrap (cookie-less; no durable session mint) ───────────────
csrf_http="$(curl -sS -D "$RECEIPT_DIR/csrf.hdr" -o "$RECEIPT_DIR/csrf.json" -w '%{http_code}' \
  "${BASE_URL}/api/auth/csrf")"
if [[ "$csrf_http" != "200" ]]; then
  echo "live-verify: GET /api/auth/csrf HTTP ${csrf_http}" >&2
  cat "$RECEIPT_DIR/csrf.json" >&2 || true
  exit 1
fi
jq -e '
  (.csrfToken | type == "string" and length > 0)
  and .csrfCookieName == "wcdraft_csrf"
  and .isAuthenticated == false
' "$RECEIPT_DIR/csrf.json" >/dev/null || {
  echo "live-verify: CSRF body missing bootstrap fields" >&2
  cat "$RECEIPT_DIR/csrf.json" >&2 || true
  exit 1
}
# Bootstrap cookies: Max-Age=300 (five-minute). Durable sessions use 30d.
if ! grep -qiE 'set-cookie:.*wcdraft_csrf=.*max-age=300' "$RECEIPT_DIR/csrf.hdr"; then
  echo "live-verify: CSRF missing 300s wcdraft_csrf bootstrap cookie" >&2
  cat "$RECEIPT_DIR/csrf.hdr" >&2 || true
  exit 1
fi
# Cookie-less bootstrap must not mint a durable 30-day sid (Max-Age >> 300).
if grep -qiE 'set-cookie:.*wcdraft_sid=.*max-age=(1[0-9]{6,}|[2-9][0-9]{5,})' "$RECEIPT_DIR/csrf.hdr"; then
  echo "live-verify: CSRF issued durable-looking wcdraft_sid (expected ≤300s bootstrap)" >&2
  cat "$RECEIPT_DIR/csrf.hdr" >&2 || true
  exit 1
fi
echo "live-verify: CSRF bootstrap 200 / 300s cookie / no durable session ok"

# ── 2. Board snapshots (before) ─────────────────────────────────────────────
before_classic="$(board_snapshot classic-casual \
  'mode=casual&draft_mode=classic&limit=100')"
before_memory="$(board_snapshot memory-casual \
  'mode=casual&draft_mode=hidden&limit=100')"
before_ranked="$(board_snapshot classic-ranked \
  'mode=ranked&draft_mode=classic&limit=100')"
before_archive="$(board_snapshot archive-classic \
  "season=${ARCHIVE_SEASON}&mode=casual&draft_mode=classic&limit=100")"

printf 'live-verify: board before classic=%s memory=%s ranked=%s archive=%s\n' \
  "$(jq -c '{n,ids}' <<<"$before_classic")" \
  "$(jq -c '{n,ids}' <<<"$before_memory")" \
  "$(jq -c '{n,ids}' <<<"$before_ranked")" \
  "$(jq -c '{season_key,n,ids}' <<<"$before_archive")"

# ── 3. Deliberate rejection probe (cookie-less, no alias) ───────────────────
# Cookie-less anonymous path: identity gate returns null session/user without
# minting a durable session row. No display_alias — nothing to persist on accept.
probe_body="$(jq -nc --arg t "$PROBE_TOKEN" \
  '{token:$t, claimed_score:0, draft_mode:"classic", mode:"casual"}')"
probe_http="$(curl -sS -o "$RECEIPT_DIR/probe.json" -w '%{http_code}' \
  -X POST "${BASE_URL}/api/leaderboard/submit" \
  -H 'content-type: application/json' \
  -H "origin: ${BASE_URL}" \
  --data-binary "$probe_body")"

if [[ "$probe_http" != "409" ]]; then
  echo "live-verify: probe expected HTTP 409, got ${probe_http}" >&2
  cat "$RECEIPT_DIR/probe.json" >&2 || true
  exit 1
fi
jq -e '.error == "DIFFERENT_BUILD"' "$RECEIPT_DIR/probe.json" >/dev/null || {
  echo "live-verify: probe expected error=DIFFERENT_BUILD" >&2
  cat "$RECEIPT_DIR/probe.json" >&2 || true
  exit 1
}
echo "live-verify: probe 409 DIFFERENT_BUILD ok"
jq -c '{error, mismatched_anchors}' "$RECEIPT_DIR/probe.json"

# ── 4. Board snapshots (after) — ids must be byte-identical sets ────────────
after_classic="$(board_snapshot classic-casual-after \
  'mode=casual&draft_mode=classic&limit=100')"
after_memory="$(board_snapshot memory-casual-after \
  'mode=casual&draft_mode=hidden&limit=100')"
after_ranked="$(board_snapshot classic-ranked-after \
  'mode=ranked&draft_mode=classic&limit=100')"
after_archive="$(board_snapshot archive-classic-after \
  "season=${ARCHIVE_SEASON}&mode=casual&draft_mode=classic&limit=100")"

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
    exit 1
  fi
}

assert_ids_unchanged classic-casual "$before_classic" "$after_classic"
assert_ids_unchanged memory-casual "$before_memory" "$after_memory"
assert_ids_unchanged classic-ranked "$before_ranked" "$after_ranked"
assert_ids_unchanged archive-classic "$before_archive" "$after_archive"
echo "live-verify: board row ids unchanged on all four boards"

# ── 5. Archive read-only surface (HTML) ─────────────────────────────────────
page_http="$(curl -sS -o "$RECEIPT_DIR/leaderboard.html" -w '%{http_code}' \
  "${BASE_URL}/leaderboard")"
if [[ "$page_http" != "200" ]]; then
  echo "live-verify: /leaderboard HTTP ${page_http}" >&2
  exit 1
fi
if ! grep -q 'Season closed' "$RECEIPT_DIR/leaderboard.html"; then
  # Archive copy is client-rendered for the selected season; the page shell must
  # at least expose the leaderboard surface. Soft-check: API already proved the
  # archive season is readable. Hard-fail only if the page itself is broken.
  if ! grep -qi 'leaderboard' "$RECEIPT_DIR/leaderboard.html"; then
    echo "live-verify: /leaderboard page missing leaderboard surface" >&2
    exit 1
  fi
  echo "live-verify: note — 'Season closed' not in SSR HTML (client-rendered archive copy); API archive read ok"
else
  echo "live-verify: archive 'Season closed' copy present in page HTML"
fi

# ── 6. OG health (read-only, no write) ──────────────────────────────────────
og_http="$(curl -sS -o "$RECEIPT_DIR/og-health.json" -w '%{http_code}' \
  "${BASE_URL}/api/og/health")"
if [[ "$og_http" != "200" ]]; then
  echo "live-verify: /api/og/health HTTP ${og_http}" >&2
  cat "$RECEIPT_DIR/og-health.json" >&2 || true
  exit 1
fi
jq -e '.ok == true' "$RECEIPT_DIR/og-health.json" >/dev/null
echo "live-verify: og health ok"

echo "live-verify: PASS (non-writing)"
echo "live-verify: receipts in ${RECEIPT_DIR}"
