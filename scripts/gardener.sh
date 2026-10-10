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
  evening) exec node src/display.mjs evening ;;
  night)   exec node src/display.mjs night ;;
  sync)    exec node src/display.mjs sync ;;
  plant)   exec node src/plant-server.mjs ;;   # locked-down PUBLIC surface (note page + feedback only)
  pad)     exec node src/pad.mjs ;;            # SN30 Pro controller → dashboard bridge
  tunnel)
    # Expose the PLANT server publicly. Prefer a PERMANENT ngrok static domain if
    # configured (.env: GARDENER_NGROK_DOMAIN); otherwise fall back to a free
    # cloudflared quick tunnel (rotating URL).
    set +e   # the cloudflared URL-scraping loop greps every log line; a non-match
             # must NOT abort the script under `set -e`/pipefail (that crash-looped it).
    URLFILE="$ROOT/data/public-url.txt"
    PP="$(grep -E '^GARDENER_PLANT_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"; PP="${PP:-8788}"
    for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PP/" >/dev/null 2>&1 && break; sleep 1; done
    NGROK_DOMAIN="$(grep -E '^GARDENER_NGROK_DOMAIN=' .env 2>/dev/null | cut -d= -f2 || true)"
    NGROK_TOKEN="$(grep -E '^GARDENER_NGROK_AUTHTOKEN=' .env 2>/dev/null | cut -d= -f2 || true)"
    if [ -n "$NGROK_DOMAIN" ] && [ -x "$HOME/.local/bin/ngrok" ]; then
      [ -n "$NGROK_TOKEN" ] && "$HOME/.local/bin/ngrok" config add-authtoken "$NGROK_TOKEN" >/dev/null 2>&1
      "$HOME/.local/bin/ngrok" http "$PP" --url="https://$NGROK_DOMAIN" --log stdout &
      NGPID=$!
      # Probe the public EDGE, not just the agent session: a free account that hit
      # its monthly limit (ERR_NGROK_727) keeps the session alive but 403s every
      # visitor. Only commit to ngrok if the edge actually serves the app.
      NGROK_OK=0
      for _ in $(seq 1 6); do
        sleep 3
        code="$(curl -s -o /dev/null -w '%{http_code}' -m 8 -H 'ngrok-skip-browser-warning: 1' "https://$NGROK_DOMAIN/" 2>/dev/null)"
        case "$code" in 2*) NGROK_OK=1; break ;; esac
        kill -0 "$NGPID" 2>/dev/null || break   # agent died (bad token etc.)
      done
      if [ "$NGROK_OK" = "1" ]; then
        printf 'https://%s\n' "$NGROK_DOMAIN" > "$URLFILE"   # stable URL
        wait "$NGPID"; exit $?   # stay attached; systemd restarts us if ngrok dies
      fi
      echo "ngrok edge not serving (limit/blocked, last code=$code) — falling back to cloudflared"
      kill "$NGPID" 2>/dev/null; wait "$NGPID" 2>/dev/null
    fi
    CF="$HOME/.local/bin/cloudflared"
    : > "$URLFILE"   # clear any stale URL while the quick tunnel is establishing
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
    # KIOSK ENGINE — chromium by default: measured on this Jetson, surf/WebKitGTK
    # CPU-paints every frame (~3.4Mpx/s; scrolling 4fps, fps ∝ painted area; no
    # GPU layer caching — engine limit, not tunable), while chromium is fully
    # GPU-composited and holds 60fps. Set GARDENER_KIOSK=surf to use the patched
    # memory-light surf instead (Esc works there too; scrolling will be choppy).
    # Free Super(Cmd)+Up/Down from GNOME's maximize/unmaximize window shortcuts so
    # they reach the kiosk page (the wall's Cmd+↑/↓ markdown editor) instead of
    # un-fullscreening the kiosk window. Idempotent; ignored if not on GNOME.
    export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"
    gsettings set org.gnome.desktop.wm.keybindings maximize "[]" 2>/dev/null || true
    gsettings set org.gnome.desktop.wm.keybindings unmaximize "[]" 2>/dev/null || true
    ENGINE="$(grep -E '^GARDENER_KIOSK=' .env 2>/dev/null | cut -d= -f2 || true)"
    if [ "$ENGINE" = "surf" ]; then
      export WEBKIT_FORCE_COMPOSITING_MODE=1
      SURF="$HOME/.local/bin/surf"; [ -x "$SURF" ] || SURF="surf"
      exec "$SURF" -F "http://127.0.0.1:$PORT"
    fi
    # GPU kiosk (2026-10-07): the SNAP chromium can't reach the Tegra NVIDIA libs
    # (snap confinement) and falls back to SwiftShader. A non-snap Chromium build
    # (Chrome for Testing arm64, copied to ~/.local/share/gardener-chrome) with
    # ANGLE on GLES/EGL gets the real GPU: "NVIDIA Tegra Orin (nvgpu), OpenGL ES 3.2".
    GPUCHROME="${GARDENER_GPU_CHROME:-$HOME/.local/share/gardener-chrome/chrome-linux-arm64/chrome}"
    # GARDENER_ANGLE (.env) picks ANGLE's backend: gles-egl | gl (GLX) | vulkan.
    ANGLE="$(grep -E '^GARDENER_ANGLE=' .env 2>/dev/null | cut -d= -f2 || true)"
    # GARDENER_CHROME_EXTRA (.env): extra space-separated Chrome flags (experiments).
    read -r -a EXTRA <<< "$(grep -E '^GARDENER_CHROME_EXTRA=' .env 2>/dev/null | cut -d= -f2- || true)"
    if [ "$ENGINE" != "snap" ] && [ -x "$GPUCHROME" ]; then
      # Never restore tabs: the kiosk is killed (not quit), so Chrome otherwise reopens
      # every previous tab on restart — N hidden copies of the wall, each listening to
      # the pad and running its own emulator (that was the Arcade stutter, 2026-10-08).
      rm -rf "$HOME/.config/gardener-kiosk-gpu/Default/Sessions"
      sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/' "$HOME/.config/gardener-kiosk-gpu/Default/Preferences" 2>/dev/null || true
      exec "$GPUCHROME" --kiosk "http://127.0.0.1:$PORT" \
        --user-data-dir="$HOME/.config/gardener-kiosk-gpu" \
        --ignore-gpu-blocklist --use-gl=angle --use-angle="${ANGLE:-gles-egl}" \
        --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required \
        --enable-gpu-rasterization \
        --noerrdialogs --disable-session-crashed-bubble --disable-infobars --test-type \
        --no-first-run --password-store=basic --disable-features=OverlayScrollbar \
        --remote-debugging-port=9223 \
        --window-position=0,0 --window-size=900,1600 "${EXTRA[@]}"
    fi
    exec /snap/bin/chromium --kiosk "http://127.0.0.1:$PORT" \
      --user-data-dir="$HOME/.config/gardener-kiosk-chrome" \
      --noerrdialogs --disable-session-crashed-bubble --disable-infobars \
      --no-first-run --password-store=basic \
      --disable-features=OverlayScrollbar \
      --enable-unsafe-swiftshader \
      --remote-debugging-port=9223 \
      --window-position=0,0 --window-size=900,1600 ;;
  *) echo "usage: gardener.sh {server|iterate|day|evening|night|sync|plant|tunnel|pad|kiosk}"; exit 2 ;;
esac
