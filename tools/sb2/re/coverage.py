"""Record which ROM code runs (and with which M/X flags) during battles.

    python3 coverage.py [frames_per_state]
Writes data/sb2/re/exec_mx.npy (uint8 per ROM offset, M/X combos seen) and
data/sb2/re/exec_counts.npy (uint32 per ROM offset). Used by dis65816.py.
Merges with existing files so repeated runs accumulate.
"""
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), HERE]
import numpy as np
from snes import Snes, B, STATES_DIR, ROOT
from hooks import Hooks

OUT = os.path.join(ROOT, 'data', 'sb2', 're')


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    states = sys.argv[2:] or (['title', 'battle_players', 'stage_select'] +
                              ['battle_stage%02d' % i for i in range(1, 11)])
    S = Snes(render=False)
    H = Hooks(S)
    H.enable(exec_counts=True)
    rnd = random.Random(1)
    dirs = [B.UP, B.DOWN, B.LEFT, B.RIGHT, 0]
    for st in states:
        S.load_state_file(os.path.join(STATES_DIR, st + '.state'))
        cur = 0
        for i in range(n):
            if i % 12 == 0:
                cur = rnd.choice(dirs) | (B.B if rnd.random() < 0.25 else 0) | \
                    (B.A if rnd.random() < 0.1 else 0) | (B.Y if rnd.random() < 0.05 else 0)
            S.step((cur, 0))
        print(st, int((H.exec_rom() > 0).sum()))
    os.makedirs(OUT, exist_ok=True)
    mx, cnt = H.exec_mx(), H.exec_rom()
    pm, pc = os.path.join(OUT, 'exec_mx.npy'), os.path.join(OUT, 'exec_counts.npy')
    if os.path.exists(pm):
        mx |= np.load(pm)
        cnt = cnt + np.load(pc)
    np.save(pm, mx)
    np.save(pc, cnt)
    print('total executed ROM bytes', int((mx > 0).sum()))


if __name__ == '__main__':
    main()
