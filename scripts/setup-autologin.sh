#!/usr/bin/env bash
# The Gardener™ — enable GDM autologin for 'talbot' so the kiosk starts at boot
# with no human logging in. Run ONCE with sudo:  sudo ./scripts/setup-autologin.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

CONF=/etc/gdm3/custom.conf
[ -f "$CONF" ] || { echo "GDM config not found at $CONF"; exit 1; }
cp -n "$CONF" "$CONF.gardener.bak"

python3 - "$CONF" <<'PY'
import sys, configparser
p = sys.argv[1]
c = configparser.ConfigParser()
c.optionxform = str           # preserve key case
c.read(p)
if not c.has_section('daemon'):
    c.add_section('daemon')
c.set('daemon', 'AutomaticLoginEnable', 'true')
c.set('daemon', 'AutomaticLogin', 'talbot')
with open(p, 'w') as f:
    c.write(f)
print("autologin enabled for talbot in", p)
PY

echo "Done. A reboot will now auto-login 'talbot' and start The Gardener kiosk."
echo "Backup saved at $CONF.gardener.bak"
