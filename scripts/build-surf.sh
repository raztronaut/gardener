#!/usr/bin/env bash
# Build a patched surf (the plain-Escape→stop keybinding removed, so the dashboard
# can use Esc to close panels) and install it to ~/.local/bin — NO sudo.
#
# One-time prerequisite (needs sudo ONCE — surf links webkit2gtk-4.0 here):
#   sudo apt-get install -y libwebkit2gtk-4.0-dev libgtk-3-dev libgcr-3-dev
#
# The Gardener kiosk (scripts/gardener.sh) prefers ~/.local/bin/surf automatically.
set -euo pipefail

SRC="$HOME/surf-build/surf-2.1"
[ -d "$SRC" ] || { echo "ERROR: surf source not found at $SRC"; exit 1; }

# Verify the dev headers are present before trying to compile.
miss=""
for pc in gtk+-3.0 gcr-3 webkit2gtk-4.0 webkit2gtk-web-extension-4.0; do
  pkg-config --exists "$pc" 2>/dev/null || miss="$miss $pc"
done
if [ -n "$miss" ]; then
  echo "Missing dev headers for:$miss"
  echo
  echo "Run this ONCE, then re-run this script:"
  echo "  sudo apt-get install -y libwebkit2gtk-4.0-dev libgtk-3-dev libgcr-3-dev"
  exit 2
fi

# Confirm the Escape binding really is gone from the source we're building.
if grep -q 'GDK_KEY_Escape, *stop' "$SRC/config.def.h"; then
  echo "WARNING: plain-Escape→stop binding still present; removing it now."
  sed -i '/{ 0,  *GDK_KEY_Escape, *stop/d' "$SRC/config.def.h"
fi
rm -f "$SRC/config.h"   # force regenerate from the patched config.def.h

cd "$SRC"
make clean >/dev/null 2>&1 || true
make PREFIX="$HOME/.local" -j"$(nproc)"
make PREFIX="$HOME/.local" install

echo
echo "Installed patched surf → $HOME/.local/bin/surf"
"$HOME/.local/bin/surf" -v 2>&1 | head -1 || true
echo "Restart the kiosk to use it:  systemctl --user restart gardener-kiosk.service"
