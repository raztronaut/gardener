"""Per-stage code coverage: which ROM routines run only on one battle stage.
    python3 stages_cov.py [frames]  -> data/sb2/re/stages/cov_XX.npy + report of
    stage-unique code ranges (start addresses of executed runs)."""
import os
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sb2lib import Game, B, ROOT
from hooks import Hooks
import numpy as np

D = os.path.join(ROOT, 'data', 'sb2', 're', 'stages')


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 2400
    G = Game()
    H = Hooks(G.S)
    covs = []
    for st in range(1, 11):
        G.load('battle_stage%02d' % st)
        H.exec_clear()
        H.enable(exec_counts=True)
        rnd = random.Random(st)
        cur = 0
        for i in range(n):
            if i % 10 == 0:
                cur = rnd.choice([B.UP, B.DOWN, B.LEFT, B.RIGHT, 0]) | (B.A if rnd.random() < 0.2 else 0)
            G.step(cur)
        H.off()
        c = H.exec_rom()
        np.save(os.path.join(D, 'cov_%02d.npy' % st), c)
        covs.append(c > 0)
    covs = np.array(covs)
    for st in range(10):
        uniq = covs[st] & ~np.delete(covs, st, 0).any(0)
        idx = np.nonzero(uniq)[0]
        runs = []
        for i in idx:
            if runs and i - runs[-1][1] <= 4:
                runs[-1][1] = i
            else:
                runs.append([i, i])
        print('stage %d unique bytes %d runs: %s' % (st + 1, len(idx),
              ' '.join('%06X-%04X' % (0xC00000 | a, b & 0xffff) for a, b in runs[:60])))


if __name__ == '__main__':
    main()
