#!/bin/sh
# Regenerate the ROM-derived tables the sb2 core needs at runtime. They are decoded from
# the user's own ROM and are NOT committed (gitignored): run this once after a fresh clone.
set -e
cd "$(dirname "$0")/../.."
( cd tools/sb2/conformance && python3 gen_animdata.py )   # → public/arcade/sb2/core/animdata.js
python3 tools/sb2/conformance/gen/mover_tables.py          # → public/arcade/sb2/core/movers_tables.js
