#!/usr/bin/env bash

set -euo pipefail

db_paths_changed="${DB_PATHS_CHANGED:-false}"
api_key="${NEON_API_KEY:-}"
project_id="${NEON_PROJECT_ID:-}"
github_output="${GITHUB_OUTPUT:-}"

if [ -z "$github_output" ]; then
  echo "::error::GITHUB_OUTPUT is required" >&2
  exit 2
fi

case "$db_paths_changed" in
  true|false) ;;
  *)
    echo "::error::DB_PATHS_CHANGED must be true or false" >&2
    exit 2
    ;;
esac

if [ -n "$api_key" ] && [ -n "$project_id" ]; then
  echo "skip=false" >>"$github_output"
  echo "[gate] Neon credentials present (key length=${#api_key}, project id length=${#project_id})"
  exit 0
fi

echo "skip=true" >>"$github_output"
if [ "$db_paths_changed" = "true" ]; then
  echo "::error::DB or migration paths changed, but NEON_API_KEY and NEON_PROJECT_ID are both required for the protected ephemeral migration gate." >&2
  exit 1
fi

echo "::warning::Neon credentials are absent; non-DB change keeps the ephemeral migration gate skip-is-green."
