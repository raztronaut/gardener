#!/bin/sh
# one line per run: time, pid, RSS MB, swap MB, uptime of the voice process (s)
P=$(systemctl --user show -p MainPID --value gardener-voice)
[ "$P" -gt 0 ] 2>/dev/null || exit 0
awk -v p="$P" -v t="$(date -Is)" -v up="$(ps -o etimes= -p "$P")" '/VmRSS/{r=int($2/1024)} /VmSwap/{s=int($2/1024)} END{print t, "pid=" p, "rss=" r, "swap=" s, "up=" up+0}' /proc/$P/status >> /home/talbot/gardener/data/voice/memory-samples.log
