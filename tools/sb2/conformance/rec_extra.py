"""Extra vectors recorded from the original for rules the stock vectors never reach.
    python3 rec_extra.py      -> data/sb2/vectors/<name>.json (gitignored)
then: python3 vcover.py --no-cover <name>; python3 wtrace.py <name>
  stage03_sudden_death: 4 COMs on stage 3, clock poked to 0:35 -> sudden death closes
                        the four border tunnels (C0D52B + cell-animation list C0DA60).
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), os.path.join(HERE, '..', 're')]
import vectors as V

CLOCK35 = lambda R: [(0x5E10, 0, 2), (0x5E12, 35, 2), (0x5E14, 0, 2)]
SCEN = [
    dict(name='stage03_sudden_death', state='com4_stage03', multitap=False, setup=[CLOCK35],
         desc='Stage 3, 4 COMs, clock poked to 0:35: sudden death incl. the tunnel closing.',
         pads=[[0, 0]] * 2700),
]

if __name__ == '__main__':
    R = V.Rec(False)
    for s in SCEN:
        v = R.record(dict(s, settle=1))
        json.dump(v, open(os.path.join(V.OUT, s['name'] + '.json'), 'w'), separators=(',', ':'))
        print(s['name'], len(v['frames']), 'frames')
