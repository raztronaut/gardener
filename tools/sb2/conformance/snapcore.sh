#!/bin/bash
# snapcore.sh DIR [mine...]: copy the core to DIR, taking the files named as "mine" from
# the working tree and every other file from git HEAD (so half-written files of other
# agents don't break a test run). Then: SB2_CORE=DIR node run.mjs ...
set -e
cd "$(dirname "$0")/../../.."
D=$1; shift
rm -rf "$D"; mkdir -p "$D"
for f in $(git ls-tree --name-only HEAD public/arcade/sb2/core/); do
  b=$(basename $f); git show HEAD:$f > "$D/$b"
done
for m in "$@"; do cp public/arcade/sb2/core/$m "$D/$m"; done
