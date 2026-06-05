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

# Always-on services
systemctl --user enable --now gardener-backend.service
systemctl --user enable --now gardener-plant.service || true     # public note page (tunnel target)
systemctl --user enable --now gardener-tunnel.service || true    # cloudflared quick tunnel
systemctl --user enable --now gardener-display-sync.service || true
systemctl --user enable --now gardener-kiosk.service || true

# Schedulers (PT, system TZ = America/Los_Angeles)
systemctl --user enable --now gardener-iterate.timer
systemctl --user enable --now gardener-night.timer
systemctl --user enable --now gardener-day.timer

echo
echo "=== installed. backend status ==="
systemctl --user --no-pager status gardener-backend.service | sed -n '1,6p' || true
echo
echo "=== timers ==="
systemctl --user list-timers --no-pager | grep -E "gardener|NEXT" || true
echo
echo "NOTE: for the kiosk to come up automatically after a REBOOT (with no one"
echo "logging in), enable GDM autologin once:  sudo $ROOT/scripts/setup-autologin.sh"
