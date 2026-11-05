#!/usr/bin/env bash
# Global keyboard binding: wake Garden OS for one hour, even over a game.
set -euo pipefail
exec curl --fail --silent --show-error --max-time 20 -X POST http://127.0.0.1:8787/api/display/snooze
