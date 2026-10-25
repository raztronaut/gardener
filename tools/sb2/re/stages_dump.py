"""Dump the initial grids / spawns of the 10 battle stages.
    python3 stages_dump.py [frames_after_load]
Prints per stage: $7FC000 (collision) and $7FD000 (underlay) low bytes for the arena
(cols 1..15, rows 3..15) plus player positions/cells. Writes data/sb2/re/stages/*.npy."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sb2lib import Game, GRID, GRID_BASE, poff, cell_of, ROOT
import numpy as np

STAGES = ['battle_stage%02d' % i for i in range(1, 11)]
OUT = os.path.join(ROOT, 'data', 'sb2', 're', 'stages')


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    G = Game()
    os.makedirs(OUT, exist_ok=True)
    for k, st in enumerate(STAGES):
        G.load(st)
        G.S.run(n)
        w = G.S.wram()
        c = w[GRID:GRID + 0x1000].view('<u2').reshape(32, 64)
        d = w[GRID_BASE:GRID_BASE + 0x1000].view('<u2').reshape(32, 64)
        a = w[0x1A000:0x1A000 + 0x1000].view('<u2').reshape(32, 64)
        np.save(os.path.join(OUT, '%s_c.npy' % st), c)
        np.save(os.path.join(OUT, '%s_d.npy' % st), d)
        np.save(os.path.join(OUT, '%s_a.npy' % st), a)
        print('== stage %d (%s) $1A=%d' % (k + 1, st, G.r16(0x1A)))
        for cy in range(3, 16):
            print('%2d ' % cy + ' '.join('%02X' % (c[cy, cx] & 0xff) for cx in range(1, 16)) + '   |  ' +
                  ' '.join('%02X' % (d[cy, cx] & 0xff) for cx in range(1, 16)))
        for i in range(4):
            x, y = G.r16(poff(i, 0x10)), G.r16(poff(i, 0x18))
            print('  P%d x=%#x y=%#x cell=%s' % (i + 1, x, y, cell_of(x, y)))


if __name__ == '__main__':
    main()
