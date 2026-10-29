#!/bin/bash
# spec.sh <infile> <out.png> [ss] [t]
in=$1; out=$2; a=()
[ -n "$3" ] && a+=(-ss "$3"); [ -n "$4" ] && a+=(-t "$4")
nice -n 10 ffmpeg -hide_banner -nostdin -loglevel error -threads 2 -y "${a[@]}" -i "$in" -ac 1 -ar 32000 \
  -lavfi "showspectrumpic=s=1400x360:legend=1:fscale=lin:stop=14000:color=intensity" "$out"
