"""Sudden-death measurement: poke the battle timer to 0:35, then log every arena cell
that becomes $C1 (falling block) with the tick it happened, plus round-state vars.
    python3 round_sd.py [state] [frames]   -> prints log; png contact sheet in data/sb2/re/round/
"""
import sys
from sb2lib import *   # noqa
from sheet import Sheet

state = sys.argv[1] if len(sys.argv) > 1 else 'battle_start'
frames = int(sys.argv[2]) if len(sys.argv) > 2 else 2600
G = Game(render=True)
G.load(state)
G.step()
G.w16(0x5E10, 0)
G.w16(0x5E12, 35)
G.w16(0x5E14, 0)
print('$1C68 =', G.r16(0x1C68))
sh = Sheet()
prevg = G.grid()
prev = None
t0 = None
order = []
for i in range(frames):
    G.step(0)
    v = (G.r16(0x5E10), G.r16(0x5E12), G.r16(0x5D0E), G.r16(0x5C54), G.r16(0x5E20), G.r16(0x5C56))
    if v != prev:
        print('f%d t%d  time %d:%02d  5D0E=%X 5C54=%X 5E20=%X 5C56=%X' % ((i, G.tick()) + v))
        prev = v
    g = G.grid()
    for cy, cx in np.argwhere((g != prevg) & ((g & 0xff) == 0xC1)):
        if t0 is None:
            t0 = G.tick()
        order.append((G.tick() - t0, int(cx), int(cy), int(prevg[cy, cx] & 0xff)))
    prevg = g
    if i % 120 == 0:
        sh.add(G.S, 'f%d %d:%02d' % (i, v[0], v[1]))
sh.save(os.path.join(ROOT, 'data', 'sb2', 're', 'round', 'sd_%s.png' % state), 6)
print('blocks', len(order))
print(order)
