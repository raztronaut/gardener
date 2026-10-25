"""Text maps of the 10 battle stages for notes-stages.md.
Needs data/sb2/re/stages/{full_XX,battle_stageXX_c,battle_stageXX_d}.npy (stages_dump.py,
stages_gen.py full). Prints, per stage, the inner 13x11 field (cols 2..14, rows 4..14):
the ROM map before random soft-block removal and the round-1 map (seed 0), plus symmetry."""
import os
import sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sb2lib import ROOT

D = os.path.join(ROOT, 'data', 'sb2', 're', 'stages')
CH = {0x00: '.', 0xC5: '#', 0xC6: '#', 0xC2: 's', 0x07: '.', 0x08: ',', 0x0A: ',', 0x49: 'O',
      0x0E: 'f', 0x14: '*', 0x50: 'T', 0x0F: 'P', 0x12: 'D', 0x13: 'S',
      0x17: '>', 0x18: '<', 0x19: '^', 0x1A: 'v', 0x1B: 'v', 0x1C: '<', 0x1D: '>', 0x1E: '^',
      0x3C: 'U', 0x3D: 'V', 0x3E: 'R', 0x3F: 'L'}
SPAWN = {4: [(6, 8), (10, 10), (10, 8), (6, 10)]}
DEFAULT = [(2, 4), (14, 14), (14, 4), (2, 14)]


def show(st, g, d):
    out = []
    sp = SPAWN.get(st, DEFAULT)
    for cy in range(3, 16):
        row = ''
        for cx in range(1, 16):
            v = int(g[cy, cx]) & 0xff
            u = int(d[cy, cx]) & 0xff
            c = CH.get(v, '?')
            if v == 0xC2 and u not in (0, 7):
                c = 's'
            if (cx, cy) in sp:
                c = '1234'[sp.index((cx, cy))]
            row += c
        out.append('%2d %s' % (cy, row))
    return out


def main():
    for st in range(1, 11):
        full = np.load(os.path.join(D, 'full_%02d.npy' % st))
        c = np.load(os.path.join(D, 'battle_stage%02d_c.npy' % st)) & 0xff
        d = np.load(os.path.join(D, 'battle_stage%02d_d.npy' % st)) & 0xff
        a, b = show(st, full, d), show(st, c, d)
        u = show(st, d, d)
        inner = full[3:16, 1:16]
        lr = (inner == inner[:, ::-1]).all()
        tb = (inner == inner[::-1, :]).all()
        rot = (inner == inner[::-1, ::-1]).all()
        print('stage %d  (full ROM map | round 1, seed 0 | underlay $7FD000)   mirror L/R=%s T/B=%s rot180=%s soft full=%d round1=%d' % (
            st, lr, tb, rot, int((full[4:15, 2:15] == 0xC2).sum()), int((c[4:15, 2:15] == 0xC2).sum())))
        print('    ' + ''.join('%X' % (cx % 16) for cx in range(1, 16)) + '     ' + ''.join('%X' % (cx % 16) for cx in range(1, 16)))
        for x, y, z in zip(a, b, u):
            print(x + '   ' + y[3:] + '   ' + z[3:])
        print()


if __name__ == '__main__':
    main()
