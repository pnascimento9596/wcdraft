#!/usr/bin/env bash

set -euo pipefail

operation="${1:-install}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
configured_runner_root="${WCDRAFT_RUNNER_ROOT:-/Users/paulo/actions-runner-wcdraft}"
runner_root="$(cd "$configured_runner_root" && pwd -P)"
configured_user_root="${WCDRAFT_USER_ROOT:-$(dirname "$runner_root")}"
user_root="$(cd "$configured_user_root" && pwd -P)"
install_root="$runner_root/wcdraft-maintenance"
launch_agents_root="$user_root/Library/LaunchAgents"
logs_root="$user_root/Library/Logs/com.wcdraft.runner-disk-maintenance"
plist="$launch_agents_root/com.wcdraft.runner-disk-maintenance.plist"
label="com.wcdraft.runner-disk-maintenance"
launchctl_bin="${WCDRAFT_LAUNCHCTL_BIN:-/bin/launchctl}"
gui_domain="gui/$(id -u)"

if [ "$runner_root" != "$user_root/actions-runner-wcdraft" ]; then
  echo "runner disk maintenance: runner root must be the user's exact actions-runner-wcdraft directory" >&2
  exit 1
fi

case "$runner_root:$user_root" in
  *'&'*|*'<'*|*'>'*)
    echo "runner disk maintenance: XML-unsafe install path" >&2
    exit 1
    ;;
esac

if [ "${WCDRAFT_MAINTENANCE_ALLOW_FAKE_RUNNER:-0}" != "1" ] &&
  [ ! -x "$runner_root/runsvc.sh" ]; then
  echo "runner disk maintenance: runner service root is invalid: $runner_root" >&2
  exit 1
fi

case "$operation" in
  install)
    mkdir -p "$install_root/recovery" "$launch_agents_root" "$logs_root"
    stamp="$(date -u +'%Y%m%dT%H%M%SZ')"
    for existing in \
      "$install_root/self-hosted-runner-hygiene.sh" \
      "$install_root/runner-disk-maintenance.sh" \
      "$plist"; do
      [ -e "$existing" ] || continue
      if [ -L "$existing" ]; then
        echo "runner disk maintenance: refusing to replace symlink: $existing" >&2
        exit 1
      fi
      cp -p "$existing" "$install_root/recovery/$stamp-$(basename "$existing")"
    done

    install -m 0755 "$script_dir/self-hosted-runner-hygiene.sh" \
      "$install_root/self-hosted-runner-hygiene.sh"
    install -m 0755 "$script_dir/runner-disk-maintenance.sh" \
      "$install_root/runner-disk-maintenance.sh"
    sed \
      -e "s|__RUNNER_ROOT__|$runner_root|g" \
      -e "s|__USER_ROOT__|$user_root|g" \
      "$script_dir/runner-disk-maintenance.plist.template" >"$plist"
    plutil -lint "$plist" >/dev/null

    "$launchctl_bin" bootout "$gui_domain" "$plist" >/dev/null 2>&1 || true
    "$launchctl_bin" bootstrap "$gui_domain" "$plist"
    "$launchctl_bin" kickstart "$gui_domain/$label"
    echo "runner disk maintenance: installed label=$label interval_seconds=900 plist=$plist"
    ;;
  uninstall)
    "$launchctl_bin" bootout "$gui_domain" "$plist" >/dev/null 2>&1 || true
    find "$plist" -type f -delete 2>/dev/null || true
    find "$install_root/self-hosted-runner-hygiene.sh" \
      "$install_root/runner-disk-maintenance.sh" -type f -delete 2>/dev/null || true
    echo "runner disk maintenance: uninstalled label=$label; recovery receipts retained in $install_root/recovery"
    ;;
  *)
    echo "usage: $0 [install|uninstall]" >&2
    exit 2
    ;;
esac
