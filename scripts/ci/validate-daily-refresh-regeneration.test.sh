#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
probe_root="$(mktemp -d "${TMPDIR:-/tmp}/wcdraft-daily-refresh-regen.XXXXXX")"
probe_worktree="$probe_root/worktree"
actual_paths="$probe_root/actual-paths.txt"
expected_paths="$repo_root/packages/data/test/fixtures/daily-refresh-changed-paths-2026-07-11.txt"

cleanup() {
  git -C "$repo_root" worktree remove --force "$probe_worktree" >/dev/null 2>&1 || true
  rm -rf -- "$probe_root"
}
trap cleanup EXIT

git -C "$repo_root" worktree add --detach "$probe_worktree" HEAD >/dev/null
cd "$probe_worktree"

pnpm install --frozen-lockfile --offline >/dev/null
node packages/data/scripts/ensure-generated-artifacts.mjs >/dev/null
pnpm --filter @wcdraft/data exec tsx scripts/build-daily-seed-salt-map.mts \
  --start-date 2026-07-11 \
  --window-days 45 \
  --population 1 \
  --max-salt-attempts 1 >/dev/null
pnpm --filter @wcdraft/data run build:compact >/dev/null
node packages/data/scripts/ensure-generated-artifacts.mjs >/dev/null

git status --porcelain=v1 --untracked-files=all | cut -c4- | LC_ALL=C sort -u \
  >"$actual_paths"
node "$repo_root/packages/data/scripts/daily-seed-runway.mjs" validate-refresh-paths \
  --paths-file "$actual_paths" >/dev/null
cmp "$expected_paths" "$actual_paths"

node --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { brotliDecompressSync } from "node:zlib";
  const dir = "packages/data/src/generated";
  const daily = readFileSync(`${dir}/daily-seed-salt-map.compact.json`);
  const dailyBr = readFileSync(`${dir}/daily-seed-salt-map.compact.json.br`);
  const manifest = readFileSync(`${dir}/manifest.json`);
  const manifestBr = readFileSync(`${dir}/manifest.json.br`);
  const parsed = JSON.parse(daily.toString("utf8"));
  if (parsed.window?.start_date !== "2026-07-11" || parsed.window?.days !== 45) {
    throw new Error("future Daily fixture did not retain the captured 2026-07-11 window");
  }
  if (!brotliDecompressSync(dailyBr).equals(daily)) {
    throw new Error("future Daily canonical Brotli sidecar does not match its JSON");
  }
  if (!brotliDecompressSync(manifestBr).equals(manifest)) {
    throw new Error("future manifest canonical Brotli sidecar does not match its JSON");
  }
'

printf 'daily refresh regeneration contract: PASS (2026-07-11, 5 exact generator outputs)\n'
