"""Re-implementation of the battle soft-block removal (C0F50D) to check it against
the emulator.  python3 stages_softsim.py  -> finds the RNG seed that reproduces every
stage's round-1 layout from its full ROM map (data/sb2/re/stages/full_XX.npy)."""
import os
import sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sb2lib import ROOT

D = os.path.join(ROOT, 'data', 'sb2', 're', 'stages')
REMOVE = {1: 12, 2: 16, 3: 0, 4: 0, 5: 30, 6: 0, 7: 23, 8: 0, 9: 8, 10: 0}   # $C5EA4D[$1A]


def rng(seed):
    """C00CAA: returns (new_seed, value) - value = (new * (old & 0xFF)) >> 16."""
    new = ((seed | 1) * 0x383) & 0xFFFF
    return new, (new * (seed & 0xFF)) >> 16


def remove_soft(full, count, seed, base=None):
    g = full.copy()
    if base is None:                          # underlay ($7FD000): floor unless given
        base = np.where(g == 0xC2, 0, g)
    if count == 0:
        return g, seed
    x = y = 0
    while True:
        cx, cy = (x + 8) >> 4, (y + 0x17) >> 4
        if (g[cy, cx] & 0x3F) == 2:
            seed, v = rng(seed)
            if v >= 0x80:
                g[cy, cx] = base[cy, cx]
                count -= 1
                if count == 0:
                    return g, seed
        x = (x + 0x10) & 0xF0
        if x == 0:
            y = (y + 0x10) & 0xF0


def main():
    for st in (1, 2, 5, 9):
        full = np.load(os.path.join(D, 'full_%02d.npy' % st))
        real = np.load(os.path.join(D, 'battle_stage%02d_c.npy' % st)) & 0xFF
        base = np.load(os.path.join(D, 'battle_stage%02d_d.npy' % st)) & 0xFF
        hits = []
        for s in range(0x10000):
            g, _ = remove_soft(full, REMOVE[st], s, base)
            if (g[4:15, 2:15] == real[4:15, 2:15]).all():
                hits.append(s)
                if len(hits) > 3:
                    break
        print('stage', st, 'seeds reproducing round-1 layout:', ['%04X' % h for h in hits])


if __name__ == '__main__':
    main()
