"""Extra display scenarios for the visual conformance (things the logic vectors never
reach): recorded like tools/sb2/re/vectors.py (same format, same Rec recorder) into
data/sb2/conformance/visual_vectors/ with their start WRAM in .../visual_vectors/start/
(like vcover.py), so run.mjs / visual.py replay them with
    SB2_VECTORS=data/sb2/conformance/visual_vectors SB2_START=data/sb2/conformance/visual_vectors/start

    python3 tools/sb2/conformance/visual_extra.py            # record
    python3 tools/sb2/conformance/visual_extra.py --check    # record + run.mjs + visual.py on them
    python3 tools/sb2/conformance/visual_extra.py --check --norecord

Scenarios:
  hurry_cpu      4 COM on stage 1, clock poked to 0:41: "Hurry!" banner at 0:38, sudden
                 death from 0:33 with the COMs still playing, deaths, round end
  hurry_stage04  same on stage 4 (centre spawns, fuse track) and stage 6 (teleporters)
  hurry_stage06
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), os.path.join(HERE, '..', 're')]
import vectors  # noqa: E402
from snes import ROOT  # noqa: E402

OUT = os.path.join(ROOT, 'data', 'sb2', 'conformance', 'visual_vectors')
START = os.path.join(OUT, 'start')
CLOCK_041 = lambda R: [(0x5E10, 0, 2), (0x5E12, 41, 2), (0x5E14, 0, 2)]  # noqa: E731

SCEN = [
    dict(name='hurry_cpu', desc='4 COM, stage 1, clock 0:41 -> Hurry, sudden death, round end',
         state='com4_stage01', pads=[[0] * 5] * 3000, setup=[CLOCK_041], multitap=False),
    dict(name='hurry_stage04', desc='4 COM, stage 4, clock 0:41', state='com4_stage04',
         pads=[[0] * 5] * 2600, setup=[CLOCK_041], multitap=False),
    dict(name='hurry_stage06', desc='4 COM, stage 6, clock 0:41', state='com4_stage06',
         pads=[[0] * 5] * 2600, setup=[CLOCK_041], multitap=False),
]


def record():
    os.makedirs(START, exist_ok=True)
    vectors.ensure_states()
    R = vectors.Rec(False)
    for s in SCEN:
        v = R.record(s)
        with open(os.path.join(OUT, s['name'] + '.json'), 'w') as f:
            json.dump(v, f, separators=(',', ':'))
        # start WRAM after settle + pokes (+ the frames that complete a lagged tick), as vcover.py
        R.load(s['state'])
        for _ in range(v['start']['settle_frames']):
            R.S.step(0)
        for off, val, size in v['start']['pokes']:
            R.poke(off, val, size)
        t0 = v['initial']['globals']['tick']
        skip = 0
        while skip < len(v['frames']) and v['frames'][skip]['truth']['tick'] == t0:
            R.S.step(tuple(v['frames'][skip]['pads']))
            skip += 1
        R.S.wram().tofile(os.path.join(START, s['name'] + '.wram'))
        json.dump({'skip': skip}, open(os.path.join(START, s['name'] + '.meta.json'), 'w'))
        print('%-16s %5d frames' % (s['name'], len(v['frames'])))


if __name__ == '__main__':
    if '--norecord' not in sys.argv:
        record()
    if '--check' in sys.argv:
        env = dict(os.environ, SB2_VECTORS=OUT, SB2_START=START)
        subprocess.call(['node', os.path.join(HERE, 'run.mjs')] + [s['name'] for s in SCEN], env=env, cwd=ROOT)
        subprocess.check_call([sys.executable, os.path.join(HERE, 'visual.py')] + [s['name'] for s in SCEN] + ['--n', '60'], env=env, cwd=ROOT)
