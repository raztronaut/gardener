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
  plant)   exec node src/plant-server.mjs ;;   # locked-down PUBLIC surface (note page + feedback only)
  tunnel)
    # Open a free cloudflared quick tunnel (no account/token) to the PLANT server
    # only, and write the rotating public URL where the backend picks it up.
    set +e   # the URL-scraping loop below greps every log line; a non-match must
             # NOT abort the script under `set -e`/pipefail (that crash-looped it).
    CF="$HOME/.local/bin/cloudflared"
    URLFILE="$ROOT/data/public-url.txt"
    PP="$(grep -E '^GARDENER_PLANT_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"; PP="${PP:-8788}"
    : > "$URLFILE"   # clear any stale URL while the tunnel is establishing
    for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PP/" >/dev/null 2>&1 && break; sleep 1; done
    "$CF" tunnel --no-autoupdate --url "http://localhost:$PP" 2>&1 | while IFS= read -r line; do
      printf '%s\n' "$line"
      u="$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)"
      [ -n "$u" ] && printf '%s\n' "$u" > "$URLFILE"
    done ;;
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
    # Force WebKitGTK's accelerated-compositing path so CSS transform/opacity
    # animations run on the Jetson GPU instead of being CPU-rasterized (which
    # made them choppy, especially with the cards' box-shadows + gradients).
    export WEBKIT_FORCE_COMPOSITING_MODE=1
    # Prefer the patched surf (Escape unbound, built by scripts/build-surf.sh)
    # so the dashboard can use Esc; fall back to the system surf otherwise.
    SURF="$HOME/.local/bin/surf"; [ -x "$SURF" ] || SURF="surf"
    exec "$SURF" -F "http://127.0.0.1:$PORT" ;;
  *) echo "usage: gardener.sh {server|iterate|day|night|sync|plant|tunnel|kiosk}"; exit 2 ;;
esac
