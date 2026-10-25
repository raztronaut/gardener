"""Summaries of recorded vectors (sanity checks used for SPEC.md numbers).
    python3 analyze_vectors.py items|chain|kick|throw|cpu|speed"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
VEC = os.path.join(ROOT, 'data', 'sb2', 'vectors')
KEYS = ['speed', 'speed_max', 'bombs_cap', 'bombs_hand', 'bombs_out', 'fire', 'btype', 'disease',
        'kick', 'glove', 'wallpass', 'bombpass', 'shield']


def load(n):
    return json.load(open(os.path.join(VEC, n + '.json')))


def items():
    for fn in sorted(os.listdir(VEC)):
        if not fn.startswith('item_') or fn == 'item_burn.json':
            continue
        v = load(fn[:-5])
        p0 = v['initial']['players'][0]
        pick = None
        for i, f in enumerate(v['frames']):
            for cx, cy, val in f['truth']['grid']:
                if (cx, cy) == (3, 4) and pick is None:
                    pick = i
        f = v['frames'][pick]['truth'] if pick is not None else None
        p1 = f['players'][0] if f else {}
        d = {k: (p0[k], p1.get(k)) for k in KEYS if p1 and p0[k] != p1[k]}
        x = p1.get('x')
        print('%-18s pick frame %s tick %s x=%s  changes %s' % (fn[5:-5], pick, f and f['tick'], x, d))
        # later: bombs placed and their range/type
        seen = {}
        for fr in v['frames']:
            for b in fr['truth']['bombs']:
                seen.setdefault(b[0], b)
        print('    bombs:', [('slot%d' % b[0], 'flags=%04X' % b[1], 'range=%d' % b[4]) for b in seen.values()],
              ' end:', {k: v['frames'][-1]['truth']['players'][0][k] for k in ('speed', 'bombs_hand', 'bombs_out', 'disease', 'x', 'y')})


def chain():
    v = load('bomb_chain')
    prev = None
    for i, f in enumerate(v['frames']):
        t = f['truth']
        bs = [(b[0], '%04X' % b[1], b[3]) for b in t['bombs']]
        fire = sorted((c, r) for c, r, val in t['grid'] if val == 1)
        if bs != prev or fire:
            print(i, t['tick'], bs, 'fire+', fire)
        prev = bs


def kick():
    v = load('kick')
    for i, f in enumerate(v['frames']):
        t = f['truth']
        if t['movers'] or t['grid']:
            print(i, t['tick'], 'P1', t['players'][0]['x'], t['players'][0]['y'], 'movers', t['movers'],
                  'grid', t['grid'], 'bombs', [(b[0], '%04X' % b[1], b[2], b[3]) for b in t['bombs']])


def cpu(name='cpu_round'):
    v = load(name)
    last = None
    for i, f in enumerate(v['frames']):
        t = f['truth']
        al = [p['f00'] for p in t['players']]
        if t['deaths'] or i % 600 == 0:
            print(i, t['tick'], 'deaths', t['deaths'], 'f00', ['%04X' % a for a in al], 'timer', t['timer'])


if __name__ == '__main__':
    globals()[sys.argv[1]](*sys.argv[2:])
