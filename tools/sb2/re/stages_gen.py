"""Stage generation experiments.

    python3 stages_gen.py full            # ROM map before random soft-block removal
                                          # (patched ROM copy with the removal table
                                          # $C5EA4D zeroed; written to data/sb2/re/)
    python3 stages_gen.py random STAGE N  # N round starts of STAGE with different
                                          # pre-START delays -> soft-block layouts
Writes data/sb2/re/stages/full_XX.npy etc. One Snes per process (run modes separately).
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sb2lib import Snes, B, STATES_DIR, ROOT, GRID, poff, cell_of
import numpy as np

ROM = os.path.join(ROOT, 'data', 'roms', 'Super Bomberman 2 (USA).sfc')
OUT = os.path.join(ROOT, 'data', 'sb2', 're', 'stages')


def bright(S):
    return S.ppu()['brightness'] == 15 and not S.ppu()['forced_blank']


def to_match(S, stage, delay=0):
    S.load_state_file(os.path.join(STATES_DIR, 'stage_select.state'))
    S.run(delay)
    for _ in range(stage - 1):
        S.run(1, B.RIGHT)
        S.run(50)
    S.run(1, B.START)
    S.run(200)
    for i in range(700):
        S.run(1)
        if bright(S):
            return True
    return False


def grid(S):
    w = S.wram()
    return (w[GRID:GRID + 0x1000].view('<u2').reshape(32, 64) & 0xff).copy()


def show(g):
    return '\n'.join('%2d ' % cy + ' '.join('%02X' % g[cy, cx] for cx in range(1, 16)) for cy in range(3, 16))


def main():
    os.makedirs(OUT, exist_ok=True)
    mode = sys.argv[1]
    if mode == 'full':
        rom = bytearray(open(ROM, 'rb').read())
        for i in range(16):
            rom[0x5EA4D + 2 * i] = 0
            rom[0x5EA4D + 2 * i + 1] = 0
        p = os.path.join(ROOT, 'data', 'sb2', 're', 'rom_nosoftremove.sfc')
        open(p, 'wb').write(rom)
        S = Snes(rom=p, render=True)
        for st in range(1, 11):
            ok = to_match(S, st)
            g = grid(S)
            np.save(os.path.join(OUT, 'full_%02d.npy' % st), g)
            print('== stage %d full map (bright=%s)' % (st, ok))
            print(show(g))
    elif mode == 'random':
        st, n = int(sys.argv[2]), int(sys.argv[3])
        S = Snes(render=True)
        gs = []
        for k in range(n):
            to_match(S, st, delay=k * 7)
            g = grid(S)
            gs.append(g)
            soft = int(((g[4:15, 2:15]) == 0xC2).sum())
            print('== stage %d delay %d seed %04X soft=%d' % (st, k * 7, int(S.wram()[0xD6]) | int(S.wram()[0xD7]) << 8, soft))
            print(show(g))
        np.save(os.path.join(OUT, 'random_%02d.npy' % st), np.array(gs))


if __name__ == '__main__':
    main()
