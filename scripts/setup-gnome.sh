#!/usr/bin/env bash
# The Gardener™ — make GNOME behave like a kiosk (no sudo needed).
# Stops GNOME from auto-blanking/locking/dimming/suspending so it never fights
# our scheduled DPMS day/night control. Run once.
set -uo pipefail
set() { gsettings set "$@" 2>/dev/null || echo "  (skipped: $*)"; }

echo "Configuring GNOME for kiosk use…"
set org.gnome.desktop.session idle-delay 'uint32 0'
set org.gnome.desktop.screensaver lock-enabled false
set org.gnome.desktop.screensaver idle-activation-enabled false
set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing'
set org.gnome.settings-daemon.plugins.power idle-dim false
set org.gnome.settings-daemon.plugins.power power-button-action 'nothing'
echo "Done. GNOME will no longer auto-blank or lock the screen."
