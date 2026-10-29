"""Stage 10 jump (Y) scenarios recorded from the ORIGINAL (4 humans on stage 10, multitap),
in the vectors.py format, so run.mjs replays them through the JS core tick by tick and
jumpreport.mjs prints what the original did (NOTES-core-ai.md "Stage 10 jump").

    python3 tools/sb2/conformance/jump_vectors.py            # record (+ mt4_stage10 state)
    python3 tools/sb2/conformance/jump_vectors.py --check    # record + run.mjs on them
    python3 tools/sb2/conformance/jump_vectors.py --check --norecord

Output (gitignored, derived from the ROM): data/sb2/conformance/jump_vectors/<name>.json and
start/<name>.wram (+ meta), replay with
    SB2_VECTORS=data/sb2/conformance/jump_vectors SB2_START=data/sb2/conformance/jump_vectors/start

Pads may be a function (R, i) -> entry, decided per frame from the original's WRAM (e.g.
"press Y n ticks after the fire reached this cell"); the vector stores the pads used.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), os.path.join(HERE, '..', 're')]
import numpy as np  # noqa: E402
import vectors as V  # noqa: E402
from snes import Snes, B, STATES_DIR, ROOT  # noqa: E402

OUT = os.path.join(ROOT, 'data', 'sb2', 'conformance', 'jump_vectors')
START = os.path.join(OUT, 'start')
STATE = 'mt4_stage10'
PB = 0x8000
U, D, L, R, Y, A = B.UP, B.DOWN, B.LEFT, B.RIGHT, B.Y, B.A


def ensure_state(S):
    p = os.path.join(V.MYSTATES, STATE + '.state')
    if os.path.exists(p):
        return
    S.load_state_file(os.path.join(STATES_DIR, 'stage_select_4p_mt.state'))
    S.run(1, (B.LEFT, 0, 0, 0, 0))       # stage 1 -> 10 (wraps)
    S.run(50, 0)
    S.run(1, (B.START, 0, 0, 0, 0))
    V.wait_bright(S)
    S.save_state_file(p)
    print('built', p)


def pos(i, cx, cy, dx=0, dy=0):
    """poke bomber i to cell (cx, cy) (+ px offset)."""
    return lambda R: [(PB + 0x100 * i + 0x10, 16 * cx + dx, 2), (PB + 0x100 * i + 0x18, 16 * cy - 16 + dy, 2)]


def seq(*parts):
    """[(n, (p1, p2, p3, p4)), ...] -> per-frame entries."""
    out = []
    for n, p in parts:
        p = p if isinstance(p, tuple) else (p,)
        out += [list(p) + [0] * (5 - len(p))] * n
    return out


def cell_code(R, cx, cy):
    return R.r(V.GRID + V.gi(cx, cy), 1)


class FireJump:
    """each player: bomb at its cell (frame 1), walk 1 cell aside, then press Y (dirs[i])
    `off[i]` frames after the fire reached its cell (negative: before; then the bomb's own
    fuse is used: Y when the fuse byte hits a value)."""
    def __init__(self, walk, off, dirs, fuse_at=None):
        self.walk, self.off, self.dirs, self.fuse_at = walk, off, dirs, fuse_at
        self.fire_seen = [None] * 4
        self.home = [None] * 4

    def __call__(self, R, i):
        e = [0] * 5
        for k in range(4):
            if i == 0:
                e[k] = A
                continue
            if i <= 13:
                e[k] = self.walk[k]
                continue
            b = PB + 0x100 * k
            x, y = R.r(b + 0x10, 2), R.r(b + 0x18, 2)
            cx, cy = (x + 8) >> 4, (y + 23) >> 4
            if self.fire_seen[k] is None and cell_code(R, cx, cy) == 0x01:
                self.fire_seen[k] = i
            if self.fuse_at is not None and self.fire_seen[k] is None:
                # the bomb's fuse (+04) of this player's bomb: press Y when it reaches fuse_at[k]
                for s in range(40):
                    bb = 0x12000 + 0x100 * s
                    if R.r(bb, 2) & 0x8000 and R.r(bb + 6, 1) & 3 == k and R.r(bb + 4, 1) == self.fuse_at[k]:
                        e[k] = Y | self.dirs[k]
            elif self.fire_seen[k] is not None and i - self.fire_seen[k] == self.off[k]:
                e[k] = Y | self.dirs[k]
        return e


SCEN = [
    dict(name='jump_wrap', desc='All four jump outward from their spawns at once: P1 LEFT, P2 '
         'RIGHT, P3 UP, P4 DOWN (border cell -> hop -> wrap to the far side); then P1..P4 the '
         'other outward direction.',
         pads=seq((1, (L | Y, R | Y, U | Y, D | Y)), (130, 0), (1, (U | Y, D | Y, R | Y, L | Y)), (130, 0))),
    dict(name='jump_hop_hard', desc='P1 jumps RIGHT three times from (2,4): (3,4), (4,4), then '
         'onto the rock (5,4) -> hop through the rock and the soft blocks (6..10,4) and rock '
         '(11,4) to (12,4). P2 jumps UP from (14,14) twice (13 soft, 12 floor...).',
         pads=seq((1, (R | Y, U | Y)), (45, 0), (1, (R | Y, U | Y)), (45, 0), (1, (R | Y, U | Y)), (260, 0))),
    dict(name='jump_down', desc='P1 walks to (2,6) then jumps DOWN onto soft (2,7) -> hop '
         'through (2,7) s (2,8) s (2,9) rock (2,10) s (2,11) s to (2,12); P4 jumps UP from '
         '(2,14) twice; P3 DOWN from (14,4) twice (vertical landing offsets).',
         pads=seq((34, (D, 0, 0, 0)), (1, (D | Y, 0, D | Y, U | Y)), (50, 0), (1, (0, 0, D | Y, U | Y)), (260, 0))),
    dict(name='jump_walking', desc='Y while walking: P1 walks RIGHT 5 frames then RIGHT+Y; P3 '
         'walks LEFT 6 frames then UP+Y (perpendicular, off-centre); P2 walks UP 7 frames then '
         'UP+Y; P4 walks RIGHT 3 frames then DOWN+Y.',
         pads=seq((3, (R, 0, L, R)), (1, (R, 0, L, D | Y)), (1, (R, 0, L, 0)), (1, (R | Y, 0, L, 0)),
                  (1, (R, 0, U | Y, 0)), (1, (R, U, 0, 0)), (1, (R, U | Y, 0, 0)), (120, 0))),
    dict(name='jump_inplace', desc='Y without a direction: P1 never presses one (jumps in '
         'place), P2 presses LEFT 10 frames after take-off, P3 DOWN 20 frames after, P4 holds '
         'Y+RIGHT 120 frames (one jump: Y is edge-triggered).',
         pads=seq((1, (Y, Y, Y, Y | R)), (9, (0, 0, 0, Y | R)), (1, (0, L, 0, Y | R)), (9, (0, 0, 0, Y | R)),
                  (1, (0, 0, D, Y | R)), (100, (0, 0, 0, Y | R)), (60, 0))),
    dict(name='jump_fire_a', desc='Each bomber bombs its spawn, walks one cell aside (in the '
         'blast), and jumps in place relative to the fire reaching its cell: P1 -40 ticks '
         '(fuse), P2 0, P3 +1, P4 +3 ticks after the fire (fire kills from its 2nd tick?).',
         pads=FireJump(walk=[R, L, L, R], off=[None, 0, 1, 3], dirs=[0, 0, 0, 0], fuse_at=[22, None, None, None])),
    dict(name='jump_fire_b', desc='As jump_fire_a: Y in place P1 2 ticks BEFORE the fire (fuse), '
         'P2 10 ticks before, P3 20 before, P4 30 before (lands while / after it burns).',
         pads=FireJump(walk=[R, L, L, R], off=[None] * 4, dirs=[0, 0, 0, 0], fuse_at=[1, 5, 10, 15])),
    dict(name='jump_fire_c', desc='Jump INTO a blast: each bomber bombs its spawn, walks one '
         'cell aside, then jumps back onto the bomb cell (towards it) at different moments '
         'of the fire: P1 just before it, P2 when it starts, P3 15 ticks into it, P4 25.',
         pads=FireJump(walk=[R, L, L, R], off=[None, 0, 15, 25], dirs=[L, R, R, L], fuse_at=[8, None, None, None])),
    dict(name='jump_bomb', desc='P1 bombs (3,4) (walks there), walks back to (2,4) and jumps '
         'RIGHT onto its bomb -> lands on it, hops on to (4,4); then walks to (2,6). '
         'P3 does the same mirrored (bomb at (13,4), jump LEFT from (14,4)).',
         pads=seq((13, (R, 0, L, 0)), (1, (A, 0, A, 0)), (13, (L, 0, R, 0)), (6, 0),
                  (1, (R | Y, 0, L | Y, 0)), (60, 0), (30, (L, 0, R, 0)), (40, (D, 0, D, 0)), (200, 0))),
    dict(name='jump_item_bomber', desc='Items poked at (3,4) (bomb up) and (13,4) (fire up): P1 '
         'jumps RIGHT onto the item, P3 LEFT onto it; P2 jumps LEFT onto P4 poked at (13,14); '
         'P4 stays.',
         setup=[V.item_at(3, 4, 0x1600), V.item_at(13, 4, 0x1602), pos(3, 13, 14)],
         pads=seq((1, (R | Y, L | Y, L | Y, 0)), (80, 0))),
    dict(name='jump_carry', desc='P1 has the glove: bomb, lift it (A held), then Y+RIGHT while '
         'carrying; P3 the same holding A through the jump.',
         setup=[V.stat(0, 'glove', 1), V.stat(2, 'glove', 1)],
         pads=seq((1, (A, 0, A, 0)), (6, 0), (20, (A, 0, A, 0)), (1, (A | Y | R, 0, A | Y | L, 0)),
                  (1, (0, 0, A, 0)), (40, (0, 0, A, 0)), (200, 0))),
    dict(name='jump_softland', desc='P1 at (2,6) jumps RIGHT onto the rock (3,6) -> hop through '
         'to (4,6)? (4..7,6 soft): measures hop speed through several cells; P2 at (8,6) '
         'jumps LEFT onto soft (7,6).',
         setup=[pos(0, 2, 6), pos(1, 8, 6)],
         pads=seq((1, (R | Y, L | Y)), (300, 0))),
]


def record_one(R, s):
    st = R.load(STATE)
    R.S.step(0)
    pokes = []
    for fn in s.get('setup', []):
        pokes += fn(R)
    for off, val, size in pokes:
        R.poke(off, val, size)
    init = R.initial()
    prev_grid = R.grid_window(V.GRID) & 0xff
    prev_dying = [p['f00'] & 0x800 for p in init['players']]
    frames = []
    pads = s['pads']
    n = len(pads) if isinstance(pads, list) else s.get('frames', 420)
    for i in range(n):
        entry = pads[i] if isinstance(pads, list) else pads(R, i)
        entry = list(entry) + [0] * (5 - len(entry))
        R.S.step(tuple(entry))
        g = R.grid_window(V.GRID) & 0xff
        ch = np.argwhere(g != prev_grid)
        prev_grid = g
        pl = R.players()
        deaths = [k for k in range(4) if (pl[k]['f00'] & 0x800) and not prev_dying[k]]
        prev_dying = [p['f00'] & 0x800 for p in pl]
        truth = dict(R.globals(), players=pl, bombs=R.bombs(), movers=R.movers(),
                     grid=[[int(c) + V.X0, int(r) + V.Y0, int(g[r, c])] for r, c in ch], deaths=deaths)
        frames.append(dict(pads=entry, truth=truth))
    v = dict(version=2, name=s['name'], description=s['desc'],
             start=dict(state=STATE, state_sha1=V.sha1(st), multitap=True, settle_frames=1,
                        pokes=[[int(a), int(b), int(c)] for a, b, c in pokes]),
             initial=init, frames=frames)
    with open(os.path.join(OUT, s['name'] + '.json'), 'w') as f:
        json.dump(v, f, separators=(',', ':'))
    # start WRAM (as vcover.py)
    R.load(STATE)
    R.S.step(0)
    for off, val, size in v['start']['pokes']:
        R.poke(off, val, size)
    t0 = init['globals']['tick']
    skip = 0
    while skip < len(frames) and frames[skip]['truth']['tick'] == t0:
        R.S.step(tuple(frames[skip]['pads']))
        skip += 1
    R.S.wram().tofile(os.path.join(START, s['name'] + '.wram'))
    json.dump({'skip': skip}, open(os.path.join(START, s['name'] + '.meta.json'), 'w'))
    print('%-18s %5d frames' % (s['name'], len(frames)))


if __name__ == '__main__':
    names = [a for a in sys.argv[1:] if not a.startswith('--')]
    todo = [s for s in SCEN if not names or s['name'] in names]
    if '--norecord' not in sys.argv:
        os.makedirs(START, exist_ok=True)
        R = V.Rec(True)
        ensure_state(R.S)
        for s in todo:
            record_one(R, s)
    if '--check' in sys.argv:
        env = dict(os.environ, SB2_VECTORS=OUT, SB2_START=START)
        subprocess.call(['node', os.path.join(HERE, 'run.mjs')] + [s['name'] for s in todo], env=env, cwd=ROOT)
