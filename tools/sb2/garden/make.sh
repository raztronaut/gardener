#!/bin/sh
# Garden Edition: build the whole skin (overlay + pictures) into public/arcade/sb2/garden/.
# Needs the runtime pack (data/sb2/assets/pack/, tools/sb2/extract/pack.py) and node.
set -e
cd "$(dirname "$0")/../../.."
nice -n 10 python3 tools/sb2/garden/build.py "$@"
nice -n 10 node tools/sb2/garden/minimaps.mjs
nice -n 10 node tools/sb2/garden/menushots.mjs --cover --cover-y 76 --out data/sb2/garden
