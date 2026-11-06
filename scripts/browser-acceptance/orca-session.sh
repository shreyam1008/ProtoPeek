#!/usr/bin/env bash
set -euo pipefail

# This runs only inside a fresh CI VM, D-Bus session, and Xvfb display.
export XDG_CONFIG_HOME="$RUNNER_TEMP/orca-config"
export XDG_CACHE_HOME="$RUNNER_TEMP/orca-cache"
export XDG_DATA_HOME="$RUNNER_TEMP/orca-data"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"
printf '%s\n' 'Orca session did not reach the browser test.' > "$PROTOPEEK_ORCA_REPORT"
gsettings set org.gnome.desktop.a11y.applications screen-reader-enabled true
gsettings set org.gnome.desktop.interface toolkit-accessibility true
pulseaudio --start --exit-idle-time=-1
openbox >/dev/null 2>&1 &
window_pid=$!
orca --disable=braille --enable=speech --debug-file="$PROTOPEEK_ORCA_LOG" >/dev/null 2>&1 &
orca_pid=$!
trap 'kill "$orca_pid" "$window_pid" 2>/dev/null || true; pulseaudio --kill 2>/dev/null || true' EXIT
for ((i=0; i<100; i++)); do
  if [[ -f "$PROTOPEEK_ORCA_LOG" ]] && grep -q 'ORCA: User Settings Loaded' "$PROTOPEEK_ORCA_LOG"; then
    node scripts/browser-acceptance/orca-acceptance.mjs
    exit
  fi
  if ! kill -0 "$orca_pid" 2>/dev/null; then
    printf '%s\n' 'Orca exited before loading its settings.' > "$PROTOPEEK_ORCA_REPORT"
    exit 1
  fi
  sleep 0.2
done
printf '%s\n' 'Orca did not load its settings within 20 seconds.' > "$PROTOPEEK_ORCA_REPORT"
exit 1
