#!/usr/bin/env bash
# The Gardener™ — single entrypoint used by all systemd units.
# Ensures Node is on PATH (nvm), sets X env for GUI/display commands, dispatches.
set -euo pipefail

ROOT="/home/talbot/gardener"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# Put the nvm-managed node on PATH (highest installed version, deterministically).
NODE_BIN="$(ls -d "$NVM_DIR"/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$NODE_BIN" ] && PATH="$NODE_BIN:$PATH"
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
    # Wait for the X server to be ready (surf needs a live DISPLAY).
    for _ in $(seq 1 60); do
      if xset q >/dev/null 2>&1; then break; fi
      sleep 1
    done
    # Wait for the backend before opening the kiosk.
    for _ in $(seq 1 90); do
      if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
      sleep 1
    done
    # Prefer the patched surf (Escape unbound, built by scripts/build-surf.sh)
    # so the dashboard can use Esc; fall back to the system surf otherwise.
    SURF="$HOME/.local/bin/surf"; [ -x "$SURF" ] || SURF="surf"
    exec "$SURF" -F "http://127.0.0.1:$PORT" ;;
  *) echo "usage: gardener.sh {server|iterate|day|night|sync|kiosk}"; exit 2 ;;
esac
