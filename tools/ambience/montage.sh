#!/bin/bash
# montage.sh out.png in1.png in2.png ...
out=$1; shift; args=(); fc=""; i=0
for f in "$@"; do args+=(-i "$f"); fc+="[$i:v]scale=1400:340,setsar=1[v$i];"; i=$((i+1)); done
for ((j=0;j<i;j++)); do fc+="[v$j]"; done
nice -n 10 ffmpeg -hide_banner -loglevel error -y "${args[@]}" -filter_complex "${fc}vstack=$i" "$out"
