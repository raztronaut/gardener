"""Capture a G-BOMBER round init: from data/sb2/re/round/match_end.state (end of a CPU
match), press START now and then through VICTORY / roulette / menus until the next
match's round init completes. Writes data/sb2/conformance/init/gold.wram and prints the
champion ($1CAF), roulette result ($1CB1) and seed at init start.
    python3 capgold.py"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), os.path.join(HERE, '..', 're')]
from snes import Snes, B, ROOT


def w16(S, a):
    w = S.wram(live=True)
    return int(w[a]) | int(w[a + 1]) << 8


S = Snes(render=False)
S.load_state_file(os.path.join(ROOT, 'data', 'sb2', 're', 'round', 'match_end.state'))
seed = None
started = False
for i in range(20000):
    pad = B.START if (i % 90) == 0 else 0
    S.step(pad)
    if w16(S, 0x18) == 0xFFFF and (w16(S, 0xB9) & 0x8000):
        if seed is None:
            seed = w16(S, 0xD6)
            info = dict(champ=w16(S, 0x1CAF), bonus=w16(S, 0x1CB1), stage=w16(S, 0x1A), frame=i,
                        com=[w16(S, 0x5C4C + 2 * k) for k in range(4)], lvl=w16(S, 0x1CA5),
                        battle=w16(S, 0x1CA7), time=w16(S, 0x1CA9), gold=w16(S, 0x1CAB))
        started = True
    elif started and w16(S, 0x18) == 0:
        S.wram().tofile(os.path.join(ROOT, 'data', 'sb2', 'conformance', 'init', 'gold.wram'))
        print('seed %04X' % seed, info)
        break
else:
    print('not reached', w16(S, 0xB9), w16(S, 0x18))
