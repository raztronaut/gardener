"""Regenerate every sb2 battle asset from the ROM (phase 2a).

    python3 tools/sb2/extract/all.py [--jobs 3] [--skip-obs]

Needs the harness core + states (tools/sb2/harness/build.sh, paths.py, paths.py
--multitap).  Steps (each in its own process: one Snes per process):
  1. derived states: 4-human (multitap) and 4-COM states for the 10 stages
  2. observation runs (observe.py): idle + COM per stage, bomb lab
  3. stages.py   -> data/sb2/assets/stages/stageNN/
  4. sprites.py  -> data/sb2/assets/sprites/
     hud.py      -> data/sb2/assets/hud/
     sound.py    -> data/sb2/assets/audio/
  5. preview.py  -> data/sb2/assets/preview/
  6. menus.py    -> data/sb2/assets/menus/ (+ menu music / SFX into audio/)
"""
import argparse
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable


def run(args):
    print('>>', ' '.join(args), flush=True)
    t = time.time()
    subprocess.check_call(['nice', '-n', '10', PY] + args, cwd=HERE)
    print('   done in %.0fs' % (time.time() - t), flush=True)


def parallel(cmds, jobs):
    procs = []
    for c in cmds:
        while len([p for p in procs if p.poll() is None]) >= jobs:
            time.sleep(0.5)
        print('>>', ' '.join(c), flush=True)
        procs.append(subprocess.Popen(['nice', '-n', '10', PY] + c, cwd=HERE))
    bad = [p.args for p in procs if p.wait() != 0]
    if bad:
        raise SystemExit('failed: %s' % bad)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', type=int, default=3)
    ap.add_argument('--skip-obs', action='store_true', help='reuse cached observation runs')
    a = ap.parse_args()
    run(['common.py'])            # 4-human states
    run(['common.py', 'com4'])    # 4-COM states
    if not a.skip_obs:
        cmds = [['observe.py', str(s), '--kind', 'idle'] for s in range(1, 11)]
        cmds += [['observe.py', str(s), '--kind', 'com'] for s in range(1, 11)]
        cmds += [['observe.py', '1', '--kind', 'bombs']]
        parallel(cmds, a.jobs)
    run(['stages.py'])
    parallel([['sprites.py'], ['hud.py'], ['sound.py']], a.jobs)
    run(['preview.py'])
    run(['menus.py', '--sound'])


if __name__ == '__main__':
    main()
