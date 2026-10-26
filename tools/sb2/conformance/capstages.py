"""Capture the original's round-1 init for every battle stage (used to build and check
core/layout.js and core/setup.js).

    python3 capstages.py [--nosoft]
For each setup (4 COM level 5 on stages 1..10; 1 human + 3 COM on stage 1 (stage_select);
4 humans (multitap) on stage 1) it drives the menus to START and records:
  seed  = $D6 at the first frame of the round init ($18 = $FFFF),
  wram  = WRAM at the end of the frame where the init completed ($18 back to 0, before
          the first tick).
--nosoft uses data/sb2/re/rom_nosoftremove.sfc (random soft-block removal disabled) to
get the stage maps before the removal.
Output: data/sb2/conformance/init/stages[_nosoft].npz (names, seeds, wram).
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), os.path.join(HERE, '..', 're')]
import numpy as np
from snes import Snes, B, STATES_DIR, ROOT

OUT = os.path.join(ROOT, 'data', 'sb2', 'conformance', 'init')


def w16(S, a):
    w = S.wram(live=True)
    return int(w[a]) | int(w[a + 1]) << 8


def to_init(S, nright):
    for _ in range(nright):
        S.run(1, B.RIGHT)
        S.run(50, 0)
    S.run(1, B.START)
    seed = None
    started = False
    for i in range(3000):
        S.step(0)
        if w16(S, 0x18) == 0xFFFF and (w16(S, 0xB9) & 0x8000):
            if seed is None:
                seed = w16(S, 0xD6)
            started = True
        elif started and w16(S, 0x18) == 0:
            return seed, S.wram()
    raise RuntimeError('init not reached')


def run(nosoft, mt):
    rom = os.path.join(ROOT, 'data', 'sb2', 're', 'rom_nosoftremove.sfc') if nosoft else None
    S = Snes(rom=rom, render=False, multitap=mt) if rom else Snes(render=False, multitap=mt)
    names, seeds, wr = [], [], []
    if not mt:
        S.load_state_file(os.path.join(STATES_DIR, 'battle_players.state'))
        for n, pad in [(1, B.RIGHT), (10, 0), (1, B.DOWN), (10, 0), (1, B.RIGHT), (10, 0),
                       (1, B.START), (160, 0), (1, B.START), (200, 0)]:
            S.run(n, pad)
        base = S.save_state()
        for st in range(1, 11):
            S.load_state(base)
            s, w = to_init(S, st - 1)
            names.append('com4_stage%02d' % st); seeds.append(s); wr.append(w)
        S.load_state_file(os.path.join(STATES_DIR, 'stage_select.state'))
        s, w = to_init(S, 0)
        names.append('1p_stage01'); seeds.append(s); wr.append(w)
    else:
        S.load_state_file(os.path.join(STATES_DIR, 'stage_select_4p_mt.state'))
        s, w = to_init(S, 0)
        names.append('mt4_stage01'); seeds.append(s); wr.append(w)
    return names, seeds, wr


def main():
    nosoft = '--nosoft' in sys.argv
    if '--child' not in sys.argv:
        import subprocess
        for mt in (0, 1):
            subprocess.check_call([sys.executable, __file__, '--child', str(mt)] + (['--nosoft'] if nosoft else []))
        return
    mt = int(sys.argv[sys.argv.index('--child') + 1])
    names, seeds, wr = run(nosoft, mt)
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, 'stages%s_%d.npz' % ('_nosoft' if nosoft else '', mt))
    np.savez_compressed(p, names=np.array(names), seeds=np.array(seeds), wram=np.array(wr))
    for n, s in zip(names, seeds):
        print(n, '%04X' % s)


if __name__ == '__main__':
    main()
