"""Extra vectors for gimmicks the 4-COM vectors never trigger (stage 7 stop pad).
Recorded with vectors.py's recorder into data/sb2/vectors/<name>.json (gitignored), then
run vcover.py --no-cover <name> and wtrace.py <name> for the conformance tools.

    python3 rec_stage47.py
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), os.path.join(HERE, '..', 're')]
import vectors as V
from snes import B

SCEN = [
    dict(name='stage07_stoppad', state='battle_stage07', multitap=False,
         desc='Stage 7, P1 (human) walks (2,4) -> (2,9) -> over the (3,9) pad -> (6,9) -> (6,10) '
              '-> (8,10) -> up onto the centre stop pad (8,9): 128-tick freeze; 3 COMs.',
         pads=[[B.DOWN, 0]] * 66 + [[B.RIGHT, 0]] * 56 + [[B.DOWN, 0]] * 14 + [[B.RIGHT, 0]] * 27 +
              [[B.UP, 0]] * 16 + [[0, 0]] * 200 + [[B.LEFT, 0]] * 40),
]

if __name__ == '__main__':
    R = V.Rec(False)
    for s in SCEN:
        spec = dict(s, setup=[], settle=1)
        v = R.record(spec)
        p = os.path.join(V.OUT, s['name'] + '.json')
        json.dump(v, open(p, 'w'), separators=(',', ':'))
        fr = v['frames']
        on = [i for i, f in enumerate(fr) if f['truth']['players'][0]['f52'] & 1]
        print(s['name'], len(fr), 'frames; P1 busy frames:', (on[0], on[-1], len(on)) if on else None,
              'P1 final', fr[-1]['truth']['players'][0]['x'], fr[-1]['truth']['players'][0]['y'])
