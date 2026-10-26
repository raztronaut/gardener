"""Capture the original's round-init: replay a vector to frame A, then record the WRAM at
the end of every frame A..B and every WRAM write (pc, addr, value) in that window.

    python3 capinit.py <vector> A B [out]   -> data/sb2/conformance/init/<out>.npz
npz: wram[k] (frame A+k), writes (pc, addr, val, old, tag=frame).
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), os.path.join(HERE, '..', 're')]
import numpy as np
from snes import Snes, STATES_DIR, ROOT
from hooks import Hooks

VEC = os.path.join(ROOT, 'data', 'sb2', 'vectors')
OUT = os.path.join(ROOT, 'data', 'sb2', 'conformance', 'init')
MYSTATES = os.path.join(ROOT, 'data', 'sb2', 're', 'states')


def main():
    name, A, B = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    out = sys.argv[4] if len(sys.argv) > 4 else '%s_%d' % (name, A)
    v = json.load(open(os.path.join(VEC, name + '.json')))
    S = Snes(render=False, multitap=v['start']['multitap'])
    H = Hooks(S)
    st = v['start']['state']
    for d in (STATES_DIR, MYSTATES):
        p = os.path.join(d, st + '.state')
        if os.path.exists(p):
            S.load_state_file(p); break
    for _ in range(v['start']['settle_frames']):
        S.step(0)
    w = S.wram(live=True)
    for off, val, size in v['start']['pokes']:
        w[off] = val & 0xff
        if size == 2:
            w[off + 1] = (val >> 8) & 0xff
    for i in range(A):
        S.step(tuple(v['frames'][i]['pads']))
    H.watch_write(0, 0x20000)
    H.enable(write=True)
    wr = []
    snaps = []
    for i in range(A, B + 1):
        H.set_tag(i)
        S.step(tuple(v['frames'][i]['pads']))
        wr.append(H.writes())
        snaps.append(S.wram())
    H.off()
    os.makedirs(OUT, exist_ok=True)
    np.savez_compressed(os.path.join(OUT, out + '.npz'), wram=np.array(snaps), writes=np.concatenate(wr))
    print(out, len(snaps), sum(len(x) for x in wr))


if __name__ == '__main__':
    main()
