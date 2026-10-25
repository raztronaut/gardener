"""Shared paths/helpers for the sb2 asset extractors (phase 2a).

Every extractor is a script that boots ONE Snes (one per process), loads a harness
state from data/sb2/states/ (rebuilt from the ROM by tools/sb2/harness/paths.py) or a
derived state built here (see `ensure_states`), drives inputs, and writes into
data/sb2/assets/.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.abspath(os.path.join(HERE, '..', 'harness'))
sys.path.insert(0, HARNESS)
sys.path.insert(0, HERE)

from snes import Snes, B, STATES_DIR, ROOT  # noqa: E402,F401

ASSETS = os.path.join(ROOT, 'data', 'sb2', 'assets')
CACHE = os.path.join(ASSETS, 'cache')          # derived savestates (rebuildable)
PREVIEW = os.path.join(ASSETS, 'preview')
NSTAGES = 10

# P1..P4 = white, black, red, blue (measured in NOTES-harness.md).  With the multitap,
# pads tuple index: 0 = P1, 1 = P2 (black), 2 = P3 (red), 3 = P4 (blue).
COLOURS = ['white', 'black', 'red', 'blue']


def mkdir(*parts):
    p = os.path.join(*parts)
    os.makedirs(p, exist_ok=True)
    return p


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1, sort_keys=False)
    return path


def read_json(path):
    with open(path) as f:
        return json.load(f)


def save_rgba(path, rgba, scale=1):
    from PIL import Image
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im = Image.fromarray(rgba, 'RGBA' if rgba.shape[-1] == 4 else 'RGB')
    if scale != 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    im.save(path)
    return path


def state_path(name):
    """Harness states live in data/sb2/states/, derived ones in assets/cache/."""
    p = os.path.join(STATES_DIR, name + '.state')
    if os.path.exists(p):
        return p
    return os.path.join(CACHE, name + '.state')


def bright(S):
    p = S.ppu()
    return p['brightness'] == 15 and not p['forced_blank']


def tap(S, pads, hold=1, after=20):
    S.run(hold, pads)
    S.run(after, 0)


def mt_stage_state_name(stage):
    return 'mt4_stage%02d' % stage


def build_mt_stage_states(force=False):
    """Derived states: 4 HUMAN bombers (multitap) on each of the 10 stages, at the
    first fully bright frame.  Nobody moves unless we press something, so these are
    quiet worlds for clean captures.  From `stage_select_4p_mt` (harness): RIGHT x
    (stage-1) with 50-frame gaps, START, wait for brightness 15 (same as paths.py)."""
    mkdir(CACHE)
    todo = [s for s in range(1, NSTAGES + 1)
            if force or not os.path.exists(os.path.join(CACHE, mt_stage_state_name(s) + '.state'))]
    if not todo:
        return
    S = Snes(multitap=True)
    S.load_state_file(state_path('stage_select_4p_mt'))
    base = S.save_state()
    for st in todo:
        S.load_state(base)
        for _ in range(st - 1):
            tap(S, B.RIGHT, 1, 50)
        tap(S, B.START, 1, 200)
        for _ in range(900):
            if bright(S) and S.frame().mean() > 20:
                break
            S.step(0)
        else:
            raise RuntimeError('stage %d never faded in' % st)
        S.save_state_file(os.path.join(CACHE, mt_stage_state_name(st) + '.state'))
        print('built', mt_stage_state_name(st), 'frame', S.frame_count)


def com4_stage_state_name(stage):
    return 'com4_stage%02d' % stage


def build_com4_stage_states(force=False):
    """Derived states: ALL FOUR bombers COM (COM LEVEL 5) on each stage, first bright
    frame.  From harness `battle_players` (cursor on 1P): RIGHT (1P -> COM), DOWN,
    RIGHT (2P -> COM), START (rules, defaults), START (stage select), RIGHT x (stage-1),
    START, wait for brightness 15.  The game then plays itself: every colour bombs,
    kicks, throws, dies and wins."""
    mkdir(CACHE)
    todo = [s for s in range(1, NSTAGES + 1)
            if force or not os.path.exists(os.path.join(CACHE, com4_stage_state_name(s) + '.state'))]
    if not todo:
        return
    S = Snes()
    S.load_state_file(state_path('battle_players'))
    S.run(5)
    tap(S, B.RIGHT, 1, 20)
    tap(S, B.DOWN, 1, 10)
    tap(S, B.RIGHT, 1, 10)
    tap(S, B.START, 1, 160)
    tap(S, B.START, 1, 200)
    base = S.save_state()
    for st in todo:
        S.load_state(base)
        for _ in range(st - 1):
            tap(S, B.RIGHT, 1, 50)
        tap(S, B.START, 1, 200)
        for _ in range(900):
            if bright(S) and S.frame().mean() > 20:
                break
            S.step(0)
        else:
            raise RuntimeError('stage %d never faded in' % st)
        S.save_state_file(os.path.join(CACHE, com4_stage_state_name(st) + '.state'))
        print('built', com4_stage_state_name(st), 'frame', S.frame_count)


if __name__ == '__main__':
    if 'com4' in sys.argv:
        build_com4_stage_states(force='--force' in sys.argv)
    else:
        build_mt_stage_states(force='--force' in sys.argv)
