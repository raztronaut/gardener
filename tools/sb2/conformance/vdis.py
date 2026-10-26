"""Listing of every ROM byte executed while replaying the vectors (vcover.py), with
per-instruction exec counts (sum over all vectors), into
data/sb2/conformance/dis_battle.txt. Count column: how often that instruction ran
(0 = a not-taken path inside an executed run)."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 're')]
import numpy as np
from dis65816 import Dis, rom_off
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
C = os.path.join(ROOT, 'data', 'sb2', 'conformance')
cnt = np.load(os.path.join(C, 'vec_exec_0.npy')).astype(np.int64) + np.load(os.path.join(C, 'vec_exec_1.npy'))
D = Dis()
ex = np.nonzero(cnt)[0]
runs = []
start = prev = int(ex[0])
for o in ex[1:]:
    o = int(o)
    if o - prev > 12:
        runs.append((start, prev)); start = o
    prev = o
runs.append((start, prev))
out = []
for a, b in runs:
    pc = 0xC00000 | a
    end = 0xC00000 | (b + 1)
    lines, _ = D.sweep(pc, end=end)
    for ln in lines:
        p = int(ln[:6], 16)
        out.append('%8d %s' % (cnt[rom_off(p)], ln))
    out.append('         ----')
open(os.path.join(C, 'dis_battle.txt'), 'w').write('\n'.join(out) + '\n')
print(len(out))
