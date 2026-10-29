# suggest the best accent windows: loud bird-band activity over a quiet floor, no big low-band events
import sys, numpy as np, os
W = os.environ.get('AMB_WORK') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
k, L, n = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv) > 3 else 2
A = np.load(os.path.join(W, 'an', k + '.npy'))
bird = A[:, 4] - np.percentile(A[:, 4], 10); low = A[:, 2] - np.median(A[:, 2])
score = np.convolve(bird - 0.5 * np.clip(low, 0, None), np.ones(L) / L, 'valid')
out = []
for i in np.argsort(-score):
    if all(abs(i - j) >= L for j in out): out.append(int(i))
    if len(out) >= n: break
print(k, len(A), [(i, i + L, round(float(score[i]), 1)) for i in out])
