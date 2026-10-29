import json, os, numpy as np, glob
W = os.environ.get('AMB_WORK') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
b = json.load(open(os.path.join(W, 'built.json')))
print('%-34s %6s %6s %6s %7s %7s %6s %5s' % ('file', 'LUFS', 'TP', 'LRA', 'floor', 'hiss', 'flat', 'ev12'))
for name, s in b.items():
    A = np.load(os.path.join(W, 'an', 'out_' + name.replace('/', '_') + '.npy'))
    print('%-34s %6.1f %6.1f %6.1f %7.1f %7.1f %6.3f %5d' % (name, s['I'], s['TP'], s['LRA'], np.percentile(A[:, 0], 10), np.percentile(A[:, 5], 10), s['flat_med'], s['events12']))
