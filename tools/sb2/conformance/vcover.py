"""Exec coverage over every recorded vector (replaying its pads), merged into
data/sb2/re/exec_mx.npy / exec_counts.npy so dis65816.py / disall.py list all code the
vectors exercise. Also dumps each vector's start WRAM (after settle + pokes) to
data/sb2/conformance/start/<name>.wram (128 KiB), which the JS conformance runner uses
for the hidden state (AI plans, latches, RNG rotation) the JSON 'initial' lacks.

    python3 vcover.py [--no-cover] [names...]
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), os.path.join(HERE, '..', 're')]
import numpy as np
from snes import Snes, STATES_DIR, ROOT
from hooks import Hooks

VEC = os.path.join(ROOT, 'data', 'sb2', 'vectors')
OUT = os.path.join(ROOT, 'data', 'sb2', 'conformance', 'start')
RE = os.path.join(ROOT, 'data', 'sb2', 're')
MYSTATES = os.path.join(RE, 'states')


def load(S, st):
    for d in (STATES_DIR, MYSTATES):
        p = os.path.join(d, st + '.state')
        if os.path.exists(p):
            S.load_state_file(p); return
    raise FileNotFoundError(st)


def main():
    a = sys.argv[1:]
    cover = '--no-cover' not in a
    names = [x for x in a if not x.startswith('--')]
    mt = '--mt' in a
    if '--child' not in a:
        import subprocess
        for flag in (False, True):
            subprocess.check_call([sys.executable, __file__, '--child'] + (['--mt'] if flag else []) +
                                  (['--no-cover'] if not cover else []) + names)
        if cover:
            mx = np.load(os.path.join(RE, 'exec_mx.npy'))
            print('total executed ROM bytes', int((mx > 0).sum()))
        return
    os.makedirs(OUT, exist_ok=True)
    S = Snes(render=False, multitap=mt)
    H = Hooks(S)
    files = sorted(f for f in os.listdir(VEC) if f.endswith('.json'))
    for fn in files:
        v = json.load(open(os.path.join(VEC, fn)))
        if v['start']['multitap'] != mt or (names and v['name'] not in names):
            continue
        H.off()
        load(S, v['start']['state'])
        for _ in range(v['start']['settle_frames']):
            S.step(0)
        w = S.wram(live=True)
        for off, val, size in v['start']['pokes']:
            w[off] = val & 0xff
            if size == 2:
                w[off + 1] = (val >> 8) & 0xff
        S.wram().tofile(os.path.join(OUT, v['name'] + '.wram'))
        if cover:
            H.enable(exec_counts=True)
            for fr in v['frames']:
                S.step(tuple(fr['pads']))
        print(v['name'], int((H.exec_rom() > 0).sum()) if cover else '')
    if cover:
        mx, cnt = H.exec_mx(), H.exec_rom()
        pm, pc = os.path.join(RE, 'exec_mx.npy'), os.path.join(RE, 'exec_counts.npy')
        if os.path.exists(pm):
            mx |= np.load(pm); cnt = cnt + np.load(pc)
        np.save(pm, mx); np.save(pc, cnt)
        np.save(os.path.join(OUT, '..', 'vec_exec_%d.npy' % mt), H.exec_rom())


if __name__ == '__main__':
    main()
