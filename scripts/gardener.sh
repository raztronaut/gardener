#!/usr/bin/env bash
# The Gardener™ — single entrypoint used by all systemd units.
# Ensures Node is on PATH (nvm), sets X env for GUI/display commands, dispatches.
set -euo pipefail

ROOT="/home/talbot/gardener"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# Put the nvm-managed node on PATH without sourcing nvm (avoids set -u issues).
for d in "$NVM_DIR"/versions/node/*/bin; do [ -d "$d" ] && PATH="$d:$PATH"; done
export PATH

cd "$ROOT"

# X environment for GUI (surf) and display (xset/xrandr) commands.
export DISPLAY="${DISPLAY:-:0}"
if [ -z "${XAUTHORITY:-}" ]; then
  for x in "/run/user/$(id -u)/gdm/Xauthority" "$HOME/.Xauthority"; do
    [ -f "$x" ] && export XAUTHORITY="$x" && break
  done
fi

PORT="$(grep -E '^GARDENER_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-8787}"

cmd="${1:-}"; shift || true
case "$cmd" in
  server)  exec node src/server.mjs ;;
  iterate) exec node src/iterate.mjs "${1:-scheduled}" ;;
  day)     exec node src/display.mjs day ;;
  night)   exec node src/display.mjs night ;;
  sync)    exec node src/display.mjs sync ;;
  kiosk)
    mkdir -p "$HOME/.surf/styles" 2>/dev/null || true
    : > "$HOME/.surf/styles/default.css" 2>/dev/null || true   # silence optional-stylesheet warning
    # Wait for the backend before opening the kiosk.
    for _ in $(seq 1 90); do
      if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
      sleep 1
    done
    exec surf -F "http://127.0.0.1:$PORT" ;;
  *) echo "usage: gardener.sh {server|iterate|day|night|sync|kiosk}"; exit 2 ;;
esac
