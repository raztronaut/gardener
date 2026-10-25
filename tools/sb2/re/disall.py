"""Disassemble every executed ROM range (per data/sb2/re/exec_mx.npy) into one listing.
    python3 disall.py > data/sb2/re/dis/all.txt"""
import numpy as np
from dis65816 import Dis

D = Dis()
mx = D.mx
ex = np.nonzero(mx)[0]
# group into runs (gap <= 8 bytes joins)
runs = []
start = prev = int(ex[0])
for o in ex[1:]:
    o = int(o)
    if o - prev > 8:
        runs.append((start, prev))
        start = o
    prev = o
runs.append((start, prev))
for a, b in runs:
    pc = 0xC00000 | a
    end = 0xC00000 | (b + 1)
    lines, _ = D.sweep(pc, end=end)
    print('\n'.join(lines))
    print('        ----')
