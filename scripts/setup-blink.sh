#!/usr/bin/env bash
# Set up the Blink camera sidecar: a Python venv with blinkpy (the only viable
# Blink client — there is no keyless HTTP API). Idempotent; safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

VENV="data/blink/venv"
mkdir -p data/blink

if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating venv at $VENV ..."
  python3 -m venv "$VENV"
fi

echo "Installing/upgrading blinkpy ..."
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet --upgrade "blinkpy>=0.22"

echo
"$VENV/bin/python" - <<'PY'
import blinkpy, aiohttp
print(f"blinkpy {blinkpy.__version__} ready (aiohttp {aiohttp.__version__})")
PY

echo
echo "Next: log in to Blink (one time):"
echo "    $VENV/bin/python src/blink/blink_login.py"
echo "Then enable the poller:"
echo "    systemctl --user enable --now gardener-blink.service"
