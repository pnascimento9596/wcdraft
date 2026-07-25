#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
classifier="$repo_root/scripts/ci/classify-production-migration-status.sh"
workflow="$repo_root/.github/workflows/production-db-migrate.yml"
runbook="$repo_root/docs/runbooks/prod-migration-failure.md"
probe_root="$(mktemp -d "${TMPDIR:-/tmp}/wcdraft-prod-migrate-contract.XXXXXX")"
trap 'rm -rf -- "$probe_root"' EXIT

fail() {
  echo "production migration workflow contract: FAIL: $1" >&2
  exit 1
}

assert_contains() {
  grep -Fq -- "$2" "$1" || fail "$1 missing contract binding: $2"
}

run_case() {
  name="$1"
  expected_rc="$2"
  shift 2
  set +e
  "$classifier" "$@" >"$probe_root/$name.log" 2>&1
  rc=$?
  set -e
  [ "$rc" -eq "$expected_rc" ] || fail "$name exited $rc, expected $expected_rc"
}

pre="$probe_root/pre.txt"
cat >"$pre" <<'EOF'
[db:migrate:status] applied=12 pending=1 total=13
  applied 0011 0011_email_verification (db id=12, created_at=2026-07-10T00:00:00.000Z)
  pending 0012 0012_ranked_attempt_structural_binding
EOF
chmod 600 "$pre"
run_case exact-pre 0 pre "$pre" 1 12 0012_ranked_attempt_structural_binding 13

post="$probe_root/post.txt"
cat >"$post" <<'EOF'
[db:migrate:status] applied=13 pending=0 total=13
  applied 0012 0012_ranked_attempt_structural_binding (db id=13, created_at=2026-07-10T00:01:00.000Z)
EOF
chmod 600 "$post"
run_case exact-post 0 post "$post" 0 12 0012_ranked_attempt_structural_binding 13

cp "$pre" "$probe_root/wrong-tag.txt"
sed -i.bak 's/0012_ranked_attempt_structural_binding/0012_wrong_migration/' "$probe_root/wrong-tag.txt"
run_case wrong-tag 1 pre "$probe_root/wrong-tag.txt" 1 12 0012_ranked_attempt_structural_binding 13

cp "$pre" "$probe_root/two-pending.txt"
printf '  pending 0013 0013_unapproved\n' >>"$probe_root/two-pending.txt"
run_case two-pending 1 pre "$probe_root/two-pending.txt" 1 12 0012_ranked_attempt_structural_binding 13

cp "$pre" "$probe_root/query-error.txt"
printf '[db:migrate:status] FAILED Error: redacted\n' >>"$probe_root/query-error.txt"
run_case query-error 1 pre "$probe_root/query-error.txt" 1 12 0012_ranked_attempt_structural_binding 13

run_case already-current 1 pre "$post" 0 12 0012_ranked_attempt_structural_binding 13
run_case post-still-pending 1 post "$pre" 1 12 0012_ranked_attempt_structural_binding 13

cp "$pre" "$probe_root/world-readable.txt"
chmod 644 "$probe_root/world-readable.txt"
run_case world-readable 1 pre "$probe_root/world-readable.txt" 1 12 0012_ranked_attempt_structural_binding 13

node "$repo_root/scripts/ci/read-github-ref.test.mjs"

resolver_source="$probe_root/neon-resolver-source.mjs"
resolver_probe="$probe_root/neon-resolver-probe.mjs"
resolver_output="$probe_root/neon-direct-url"
sed -n "/^          node <<'NODE'$/,/^          NODE$/p" "$workflow" |
  sed '1d;$d;s/^          //' >"$resolver_source"
[ -s "$resolver_source" ] || fail "could not extract inline Neon resolver"

{
  cat <<'NODE'
globalThis.__neonResponses = [
  {
    branches: [
      {
        id: "br-primary",
        name: "main",
        default: true,
        primary: true,
      },
    ],
  },
  { endpoints: [{ branch_id: "br-primary", type: "read_write" }] },
  {
    roles: [
      { branch_id: "br-primary", name: "neondb_owner" },
      { branch_id: "br-primary", name: "readonly" },
    ],
  },
  { uri: "postgresql://user:test-password@ep-contract.neon.tech/neondb?sslmode=require" },
];
globalThis.__neonRequests = [];
globalThis.fetch = async (url, init) => {
  globalThis.__neonRequests.push({ url, init });
  const payload = globalThis.__neonResponses.shift();
  if (!payload) throw new Error("unexpected extra Neon request");
  return { ok: true, status: 200, json: async () => payload };
};
NODE
  cat "$resolver_source"
  cat <<'NODE'
if (globalThis.__neonRequests.length !== 4) throw new Error("expected exactly four Neon requests");
if (!globalThis.__neonRequests[0].url.endsWith("/projects/test-project/branches")) {
  throw new Error("branches request path mismatch");
}
if (!globalThis.__neonRequests[1].url.endsWith("/projects/test-project/endpoints")) {
  throw new Error("endpoints request path mismatch");
}
if (!globalThis.__neonRequests[2].url.endsWith("/projects/test-project/branches/br-primary/roles")) {
  throw new Error("roles request path mismatch");
}
const connectionRequest = new URL(globalThis.__neonRequests[3].url);
if (connectionRequest.pathname !== "/api/v2/projects/test-project/connection_uri") {
  throw new Error("connection request path mismatch");
}
const expectedParams = {
  branch_id: "br-primary",
  database_name: "neondb",
  role_name: "neondb_owner",
  pooled: "false",
};
if (connectionRequest.searchParams.size !== Object.keys(expectedParams).length) {
  throw new Error("connection request parameter count mismatch");
}
for (const [name, value] of Object.entries(expectedParams)) {
  if (connectionRequest.searchParams.get(name) !== value) {
    throw new Error(`connection request ${name} mismatch`);
  }
}
for (const request of globalThis.__neonRequests) {
  if (request.init.headers.Authorization !== "Bearer test-neon-key") {
    throw new Error("Neon bearer binding mismatch");
  }
}
NODE
} >"$resolver_probe"

NEON_API_KEY=test-neon-key \
  NEON_PROJECT_ID=test-project \
  CONNECTION_FILE="$resolver_output" \
  node <"$resolver_probe"
[ -f "$resolver_output" ] || fail "inline Neon resolver did not write its direct URL"
[ "$(cat "$resolver_output")" = 'postgresql://user:test-password@ep-contract.neon.tech/neondb?sslmode=require' ] ||
  fail "inline Neon resolver wrote the wrong URL"
if resolver_mode="$(stat -c '%a' "$resolver_output" 2>/dev/null)"; then
  :
elif resolver_mode="$(stat -f '%Lp' "$resolver_output" 2>/dev/null)"; then
  :
else
  fail "unable to read inline Neon resolver output mode"
fi
resolver_mode="$((10#$resolver_mode))"
[ "$resolver_mode" -eq 600 ] || fail "inline Neon resolver output mode must be 600 (got $resolver_mode)"

for refusal in missing ambiguous; do
  refusal_probe="$probe_root/neon-resolver-$refusal.mjs"
  refusal_output="$probe_root/neon-direct-url-$refusal"
  refusal_log="$probe_root/neon-resolver-$refusal.log"
  if [ "$refusal" = missing ]; then
    roles='[
      { branch_id: "br-primary", name: "readonly" },
      { branch_id: "br-other", name: "neondb_owner" },
    ]'
    expected_count=0
  else
    roles='[
      { branch_id: "br-primary", name: "neondb_owner" },
      { branch_id: "br-primary", name: "neondb_owner" },
    ]'
    expected_count=2
  fi
  {
    cat <<NODE
globalThis.__neonResponses = [
  { branches: [{ id: "br-primary", default: true, primary: true }] },
  { endpoints: [{ branch_id: "br-primary", type: "read_write" }] },
  { roles: $roles },
];
globalThis.fetch = async () => {
  const payload = globalThis.__neonResponses.shift();
  if (!payload) throw new Error("unexpected extra Neon request");
  return { ok: true, status: 200, json: async () => payload };
};
NODE
    cat "$resolver_source"
  } >"$refusal_probe"
  set +e
  NEON_API_KEY=test-neon-key \
    NEON_PROJECT_ID=test-project \
    CONNECTION_FILE="$refusal_output" \
    node <"$refusal_probe" >"$refusal_log" 2>&1
  refusal_rc=$?
  set -e
  [ "$refusal_rc" -ne 0 ] || fail "$refusal role case unexpectedly succeeded"
  grep -Fq "refusing neondb_owner role ambiguity: found $expected_count on primary" "$refusal_log" ||
    fail "$refusal role case did not fail for the expected reason"
  [ ! -e "$refusal_output" ] || fail "$refusal role case wrote a connection file"
done

assert_contains "$workflow" "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)"
assert_contains "$workflow" 'EXPECTED_MAIN_SHA: ${{ inputs.expected_main_sha }}'
assert_contains "$workflow" 'git rev-parse HEAD'
assert_contains "$workflow" 'node scripts/ci/read-github-ref.mjs'
assert_contains "$workflow" 'primaryCandidates.length !== 1'
assert_contains "$workflow" 'typeof primary.id !== "string" || primary.id.length === 0'
assert_contains "$workflow" 'endpoint.type === "read_write"'
assert_contains "$workflow" '/branches/${encodedBranch}/roles'
assert_contains "$workflow" 'role.branch_id === primary.id && role.name === "neondb_owner"'
assert_contains "$workflow" 'expectedRoles.length !== 1'
assert_contains "$workflow" 'pooled: "false"'
assert_contains "$workflow" 'const { writeFileSync } = await import("node:fs");'
assert_contains "$workflow" '::add-mask::'
assert_contains "$workflow" 'umask 077'
assert_contains "$workflow" 'classify-production-migration-status.sh pre'
assert_contains "$workflow" 'classify-production-migration-status.sh post'
assert_contains "$workflow" 'rm -rf -- "$RECEIPT_DIR"'
assert_contains "$workflow" 'DATABASE_URL_UNPOOLED='
assert_contains "$runbook" 'production-db-migrate.yml'

# Operator defaults/examples must follow the committed journal tail. Keep the
# classifier's 0012 fixtures above: they prove the classifier is generic over a
# supplied migration, while these bindings prove current operator truth.
journal_tail="$(
  node -e '
    const journal = require(process.argv[1]);
    const tail = journal.entries.at(-1)?.tag;
    if (typeof tail !== "string" || tail.length === 0) process.exit(1);
    process.stdout.write(tail);
  ' "$repo_root/packages/db/migrations/meta/_journal.json"
)" || fail "could not derive committed migration journal tail"
workflow_default="$(
  awk '
    /expected_pending_migration:/ { in_input = 1; next }
    in_input && /^[[:space:]]+default:/ {
      sub(/^[[:space:]]+default:[[:space:]]*/, ""); print; exit
    }
  ' "$workflow"
)"
[ "$workflow_default" = "$journal_tail" ] ||
  fail "workflow pending-migration default $workflow_default does not match journal tail $journal_tail"
assert_contains "$runbook" "expected_pending_migration=$journal_tail"

api_query_count="$(grep -Fc 'node scripts/ci/read-github-ref.mjs' "$workflow")"
token_scope_count="$(grep -Fc 'GITHUB_REF_TOKEN: ${{ github.token }}' "$workflow")"
default_branch_count="$(grep -Fc 'GITHUB_DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}' "$workflow")"
head_query_count="$(grep -Fc 'git rev-parse HEAD' "$workflow")"
event_binding_count="$(grep -Fc 'event_sha="$GITHUB_SHA"' "$workflow")"
clean_tree_count="$(grep -Fc 'git status --porcelain=v1 --untracked-files=all' "$workflow")"
[ "$api_query_count" -eq 2 ] || fail "workflow must query authenticated GitHub ref API exactly twice"
[ "$token_scope_count" -eq 2 ] || fail "GitHub token must enter exactly two ref-query step environments"
[ "$default_branch_count" -eq 2 ] || fail "default branch must bind exactly two ref-query steps"
[ "$head_query_count" -eq 2 ] || fail "workflow must bind the checkout HEAD exactly twice"
[ "$event_binding_count" -eq 2 ] || fail "workflow must bind the dispatch SHA exactly twice"
[ "$clean_tree_count" -eq 2 ] || fail "workflow must prove a clean checkout exactly twice"

grep -Fq 'git ls-remote' "$workflow" && fail "unauthenticated git ls-remote is forbidden"
grep -Fq 'require("node:fs")' "$resolver_source" &&
  fail "inline Neon resolver may not mix CommonJS require with top-level await"
github_token_refs="$(grep -Fc '${{ github.token }}' "$workflow")"
[ "$github_token_refs" -eq 2 ] || fail "GitHub token must appear only in the two ref-query env bindings"
contents_read_count="$(grep -Fc '  contents: read' "$workflow")"
[ "$contents_read_count" -eq 1 ] || fail "workflow token permissions must remain contents:read only"
if grep -E '(GITHUB_REF_TOKEN|github\.token).*(GITHUB_OUTPUT|GITHUB_STEP_SUMMARY|git config)' "$workflow"; then
  fail "GitHub token may not enter outputs, summaries, or git config"
fi

api_key_refs="$(grep -Fc '${{ secrets.NEON_API_KEY }}' "$workflow")"
project_id_refs="$(grep -Fc '${{ secrets.NEON_PROJECT_ID }}' "$workflow")"
[ "$api_key_refs" -eq 1 ] && [ "$project_id_refs" -eq 1 ] ||
  fail "Neon secrets must each enter exactly once through the resolver step env"
if grep -E '(NEON_API_KEY|NEON_PROJECT_ID|direct_url|CONNECTION_FILE).*(GITHUB_OUTPUT|GITHUB_STEP_SUMMARY)' "$workflow"; then
  fail "secret or connection material may not enter workflow outputs or summaries"
fi

sha_line="$(grep -nF 'Bind checkout and remote main to approved SHA' "$workflow" | cut -d: -f1)"
primary_line="$(grep -nF 'Resolve unique Neon primary direct connection' "$workflow" | cut -d: -f1)"
preflight_line="$(grep -nF 'Exact known-pending preflight' "$workflow" | cut -d: -f1)"
revalidate_line="$(grep -nF 'Revalidate live main immediately before mutation' "$workflow" | cut -d: -f1)"
migrate_line="$(grep -nF 'Apply exact checked-out migrations' "$workflow" | cut -d: -f1)"
if ! [ "$sha_line" -lt "$primary_line" ] || ! [ "$primary_line" -lt "$preflight_line" ] || ! [ "$preflight_line" -lt "$revalidate_line" ] || ! [ "$revalidate_line" -lt "$migrate_line" ]; then
  fail "exact SHA, primary identity, preflight, final revalidation, and migration steps are out of safety order"
fi

steps_between="$(sed -n "$((revalidate_line + 1)),$((migrate_line - 1))p" "$workflow" | grep -Ec '^      - name:' || true)"
[ "$steps_between" -eq 0 ] || fail "final live-main revalidation must be immediately adjacent to migration"

echo "production migration workflow contract: PASS (8 classifier cases + GitHub ref success/5 refusals + Node 22 inline Neon resolver execution/2 role refusals + 18 bindings + two authenticated live-main checks + secret/order guards)"
