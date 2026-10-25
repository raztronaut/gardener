"""Play a whole match from a battle state with idle humans (CPUs decide) and log the
round flow: round start (tick counter reset), round-over flag ($B9 b14), main-loop exit,
winner ($5C3E), win counters ($5E66+2p), and what screen follows.
    python3 round_match.py [state] [max_frames]
"""
import sys
from sb2lib import *   # noqa
from hooks import Hooks

state = sys.argv[1] if len(sys.argv) > 1 else 'battle_start'
maxf = int(sys.argv[2]) if len(sys.argv) > 2 else 40000
G = Game(render=False)
H = Hooks(G.S)
G.load(state)
H.trace_config(0xC0FBA6, 0xC0FBA6, 1000)
H.enable(trace=True)
prev_b9 = G.r16(0xB9)
prev_tick = G.tick()
last = {}
for f in range(maxf):
    G.step(0)
    b9, t = G.r16(0xB9), G.tick()
    if (b9 ^ prev_b9) & 0xC000:
        print('f%-6d t%-5d B9 %04X -> %04X  time %d:%02d  dying=%s' % (
            f, t, prev_b9, b9, G.r16(0x5E10), G.r16(0x5E12),
            ''.join('1' if G.r16(poff(p, 0)) & 0x800 else '0' for p in range(4))))
    if t < prev_tick:
        print('f%-6d new round (tick reset)  wins=%s stage=%X' % (f, [G.r16(0x5E66 + 2 * p) for p in range(4)], G.r16(0x1A)))
    if len(H.trace(clear=True)):
        print('f%-6d t%-5d main loop exit -> results' % (f, t))
        last['exit'] = f
    if 'exit' in last and f == last['exit'] + 2:
        print('        winner $5C3E=%X wins=%s' % (G.r16(0x5C3E), [G.r16(0x5E66 + 2 * p) for p in range(4)]))
    prev_b9, prev_tick = b9, t
