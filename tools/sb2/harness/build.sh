#!/usr/bin/env bash
# Build the instrumented snes9x libretro core for the sb2 harness.
#   tools/sb2/harness/build.sh            # clone (if needed), patch, build
#   SNES9X_REV=<sha> tools/sb2/harness/build.sh   # pin a revision
# Output: data/sb2/build/snes9x_sb2_libretro.so (gitignored)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
BUILD="$ROOT/data/sb2/build"
SRC="$BUILD/snes9x"
# Revision the harness was built + verified against (2026-10-25).
REV="${SNES9X_REV:-fae2fea08f74180759ef540ee94259213f503480}"
mkdir -p "$BUILD"
if [ ! -d "$SRC/.git" ]; then
  git clone https://github.com/libretro/snes9x.git "$SRC"
fi
cd "$SRC"
if [ "$(git rev-parse HEAD)" != "$REV" ]; then
  git fetch --depth 1 origin "$REV" 2>/dev/null || git fetch origin
  git checkout -q "$REV"
fi
# (re)apply the one-line Makefile patch + the hook call sites + drop the shim in
git checkout -q -- libretro/Makefile.common cpuexec.cpp getset.h
git apply "$HERE/snes9x-sb2.patch"
# exec/memory hook call sites (phase 2b; inert unless retro_sb2_hook_set_flags != 0)
git apply "$HERE/snes9x-sb2-hooks.patch"
cp "$HERE/sb2_shim.cpp" libretro/sb2_shim.cpp
cd libretro
nice -n 10 make -j4 "$@"
# copy + rename so processes that have the old .so mapped keep a valid file
cp snes9x_libretro.so "$BUILD/.snes9x_sb2_libretro.so.tmp"
mv -f "$BUILD/.snes9x_sb2_libretro.so.tmp" "$BUILD/snes9x_sb2_libretro.so"
echo "built $BUILD/snes9x_sb2_libretro.so"
