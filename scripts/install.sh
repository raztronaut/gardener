#!/usr/bin/env bash
# The Gardener™ — install & enable all systemd user units (no sudo needed).
# Starts the backend + kiosk now, and schedules the daily tending + day/night.
set -euo pipefail

ROOT="/home/talbot/gardener"
UD="$HOME/.config/systemd/user"

chmod +x "$ROOT"/scripts/*.sh
mkdir -p "$UD"
cp "$ROOT"/systemd/*.service "$ROOT"/systemd/*.timer "$UD"/

systemctl --user daemon-reload

# Enable LINGER so the user's systemd instance starts at BOOT and keeps these
# --user services running across reboots WITHOUT an interactive login. Without
# this, everything below (backend, kiosk, and the Roots/plant app) only comes up
# once someone logs in — which is why Roots had to be restarted by hand after a
# reboot. Idempotent; safe to re-run.
loginctl enable-linger "$(whoami)" || echo "WARN: could not enable linger (may need: sudo loginctl enable-linger $(whoami))"

# Always-on services
systemctl --user enable --now gardener-backend.service
systemctl --user enable --now gardener-plant.service || true     # public note page (tunnel target)
systemctl --user enable --now gardener-pad.service || true       # SN30 Pro controller bridge
systemctl --user enable --now gardener-tunnel.service || true    # cloudflared quick tunnel
systemctl --user enable --now gardener-display-sync.service || true
systemctl --user enable --now gardener-kiosk.service || true

# Schedulers (PT, system TZ = America/Los_Angeles)
systemctl --user enable --now gardener-iterate.timer
systemctl --user enable --now gardener-night.timer
systemctl --user enable --now gardener-day.timer
systemctl --user enable --now gardener-evening.timer
# Monthly: restart the tunnel so it re-probes the permanent ngrok domain
# (reclaims it automatically after the free-tier quota resets).
systemctl --user enable --now gardener-tunnel-reprobe.timer || true

echo
echo "=== installed. backend status ==="
systemctl --user --no-pager status gardener-backend.service | sed -n '1,6p' || true
echo
echo "=== timers ==="
systemctl --user list-timers --no-pager | grep -E "gardener|NEXT" || true
echo
echo "NOTE: for the kiosk to come up automatically after a REBOOT (with no one"
echo "logging in), enable GDM autologin once:  sudo $ROOT/scripts/setup-autologin.sh"
