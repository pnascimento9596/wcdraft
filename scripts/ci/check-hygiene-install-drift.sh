#!/usr/bin/env bash
# Fail CI when the LaunchAgent-installed runner hygiene scripts diverge from
# repository HEAD (or when a simulated fixture injects drift for the red control).
#
# Exit semantics:
#   0  — installed scripts match repo sources (or check skipped offline)
#   1  — HYGIENE_INSTALL_DRIFT (or missing expected install when required)
#   2  — usage / configuration error
#
# Override paths for tests via:
#   WCDRAFT_RUNNER_ROOT              default: /Users/paulo/actions-runner-wcdraft
#   WCDRAFT_HYGIENE_INSTALL_ROOT     default: $WCDRAFT_RUNNER_ROOT/wcdraft-maintenance
#   WCDRAFT_HYGIENE_DRIFT_FIXTURE    optional dir with drifted installed copies
#   WCDRAFT_HYGIENE_DRIFT_REQUIRE    0|1 — when 1, missing install is hard fail
#                                    (default 1 on self-hosted label paths; 0 if
#                                    install root is unreachable so GH-hosted
#                                    runners do not false-red)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
configured_runner_root="${WCDRAFT_RUNNER_ROOT:-/Users/paulo/actions-runner-wcdraft}"
install_root="${WCDRAFT_HYGIENE_INSTALL_ROOT:-$configured_runner_root/wcdraft-maintenance}"
fixture_root="${WCDRAFT_HYGIENE_DRIFT_FIXTURE:-}"
require_install="${WCDRAFT_HYGIENE_DRIFT_REQUIRE:-}"

tracked_scripts=(
  "self-hosted-runner-hygiene.sh"
  "runner-disk-maintenance.sh"
)

sha256_file() {
  local path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{ print $1 }'
  else
    sha256sum "$path" | awk '{ print $1 }'
  fi
}

fail_drift() {
  local script="$1"
  local repo_sha="$2"
  local installed_sha="$3"
  local installed_path="$4"
  echo "HYGIENE_INSTALL_DRIFT script=$script repo_sha=$repo_sha installed_sha=$installed_sha path=$installed_path" >&2
  echo "::error::HYGIENE_INSTALL_DRIFT: installed $script diverges from repository HEAD. Re-run scripts/ci/install-runner-disk-maintenance.sh install." >&2
  exit 1
}

if [ -n "$fixture_root" ]; then
  install_root="$fixture_root"
fi

if [ -z "$require_install" ]; then
  if [ -d "$install_root" ]; then
    require_install=1
  else
    require_install=0
  fi
fi

if [ ! -d "$install_root" ]; then
  if [ "$require_install" = "1" ]; then
    echo "HYGIENE_INSTALL_DRIFT reason=missing-install-root path=$install_root" >&2
    echo "::error::HYGIENE_INSTALL_DRIFT: install root missing at $install_root" >&2
    exit 1
  fi
  echo "hygiene-install-drift: SKIP install_root_unreachable path=$install_root"
  exit 0
fi

for script in "${tracked_scripts[@]}"; do
  repo_path="$repo_root/scripts/ci/$script"
  installed_path="$install_root/$script"

  if [ ! -f "$repo_path" ]; then
    echo "hygiene-install-drift: configuration error: missing repo source $repo_path" >&2
    exit 2
  fi

  if [ ! -f "$installed_path" ]; then
    if [ "$require_install" = "1" ]; then
      echo "HYGIENE_INSTALL_DRIFT reason=missing-installed-script path=$installed_path" >&2
      echo "::error::HYGIENE_INSTALL_DRIFT: installed script missing: $installed_path" >&2
      exit 1
    fi
    echo "hygiene-install-drift: SKIP missing-installed path=$installed_path"
    continue
  fi

  if [ -L "$installed_path" ]; then
    echo "HYGIENE_INSTALL_DRIFT reason=installed-is-symlink path=$installed_path" >&2
    echo "::error::HYGIENE_INSTALL_DRIFT: installed script must be a real file, not a symlink: $installed_path" >&2
    exit 1
  fi

  repo_sha="$(sha256_file "$repo_path")"
  installed_sha="$(sha256_file "$installed_path")"
  if [ "$repo_sha" != "$installed_sha" ]; then
    fail_drift "$script" "$repo_sha" "$installed_sha" "$installed_path"
  fi
  echo "hygiene-install-drift: ok script=$script sha=$repo_sha"
done

echo "hygiene-install-drift: PASS"
