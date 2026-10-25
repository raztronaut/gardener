"""Test vectors for the SB2 battle rules: recorded input traces + per-frame WRAM truth.

    python3 vectors.py                 # (re)build every vector into data/sb2/vectors/
    python3 vectors.py walk_cleared    # only some
    python3 vectors.py --list
    python3 vectors.py --verify [names]  # replay the JSON pads, compare the truth

Output: data/sb2/vectors/<name>.json (gitignored, derived from the user's ROM).

Vector format (version 2):
  {
    "version": 2, "name", "description",
    "start": {"state": <name in data/sb2/states or data/sb2/re/states>,
              "multitap": bool, "settle_frames": 1,
              "pokes": [[wram_offset, value, size], ...]},   # applied after settling
    "initial": {...}        # snapshot right after the pokes (frame "-1"): full arena
                            # grid/underlay/tiles (cols 0..16, rows 2..16), item deck,
                            # all player stats, bombs, globals
    "frames": [ {"pads": [p0..p4], "truth": {...}} , ... ]
  }
Pads are libretro joypad masks (B=1 Y=2 SELECT=4 START=8 UP=16 DOWN=32 LEFT=64
RIGHT=128 A=256 X=512 L=1024 R=2048); with "multitap" pads[0]=P1(white),
pads[1]=P2(black), pads[2]=P3(red), pads[3]=P4(blue); without it pads[0]=P1, pads[1]=P2.
Truth per frame (after that frame's retro_run):
  tick ($32: logic ticks completed; a frame where it does not advance is a lag frame),
  rng ($D6), g30 ($30), timer (round clock words, see ROUND_ADDRS),
  players[4]: x, xf, y, yf (16.16 position; cell = ((x+8)>>4, (y+0x17)>>4)),
      f00 (b15 active, b11 dying), f52, f7e, inp (+6E SNES bits), cell (+A8 grid idx),
      speed (+F0 level), speed_max (+E0), bombs_cap (+E1), bombs_hand (+F1),
      bombs_out (+F8), fire (+F2; reach = fire+1), btype (+F3), disease (+F5),
      kick (+FF), glove (+FE), wallpass (+FB), bombpass (+FA), shield (+EF)
  bombs: active bomb slots [slot, flags, grid_idx, fuse(+04), range(+07), owner(+06), t08, t09]
  movers: moving objects from the bomber list (ptr >= $8400): [ptr, x, y, f52, f00]
  grid: changed cells since previous frame [cx, cy, new_value] (low byte of $7FC000)
  deaths: player indices whose f00 b11 (dying) rose this frame
"""
import hashlib
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), HERE]
import numpy as np  # noqa: E402
from snes import Snes, B, STATES_DIR, ROOT  # noqa: E402

OUT = os.path.join(ROOT, 'data', 'sb2', 'vectors')
MYSTATES = os.path.join(ROOT, 'data', 'sb2', 're', 'states')

GRID, GRID_BASE, TILES = 0x1C000, 0x1D000, 0x1A000
PB = 0x8000
DECK = 0x3C48
X0, Y0, X1, Y1 = 0, 2, 17, 17          # snapshot window (cols, rows)
# round clock / state words (filled in from the round-flow RE; extra words are harmless)
ROUND_ADDRS = [0x5E10, 0x5E12, 0x5E14, 0x5C56, 0x5E20, 0x00B9, 0x00BE, 0x5D0E, 0x5C3E,
               0x5E66, 0x5E68, 0x5E6A, 0x5E6C]
# = minutes, seconds, sub-tick counter, time-up flag (0 = up), timer-stopped (b15),
#   mode flags ($B9 b14 = round over), round-over countdown, sudden-death flag (b0),
#   winner slot ($FFFF = draw), win counters P1..P4  (see re/notes-round.md)

PFIELDS = [('x', 0x10, 2), ('xf', 0x12, 2), ('y', 0x18, 2), ('yf', 0x1A, 2), ('f00', 0x00, 2),
           ('f52', 0x52, 2), ('f7e', 0x7E, 2), ('inp', 0x6E, 2), ('cell', 0xA8, 2),
           ('speed', 0xF0, 1), ('speed_max', 0xE0, 1), ('bombs_cap', 0xE1, 1),
           ('bombs_hand', 0xF1, 1), ('bombs_out', 0xF8, 1), ('fire', 0xF2, 1),
           ('btype', 0xF3, 1), ('disease', 0xF5, 1), ('kick', 0xFF, 1), ('glove', 0xFE, 1),
           ('wallpass', 0xFB, 1), ('bombpass', 0xFA, 1), ('shield', 0xEF, 1)]

ITEM_TILES = {   # deck word -> name (see SPEC.md "Items")
    0x1600: 'bomb_up', 0x1602: 'fire_up', 0x1604: 'pierce', 0x1606: 'full_fire',
    0x1622: 'speed_up', 0x160E: 'remote', 0x160A: 'skull', 0x1626: 'glove',
    0x1624: 'kick', 0x162A: 'power_bomb', 0x1628: 'rubber_bomb', 0x1640: 'heart',
    0x1620: 'wall_pass', 0x1608: 'bomb_pass'}


def gi(cx, cy):
    return cy * 0x80 + cx * 2


def ti(cx, cy):
    return cy * 0x40 + cx * 2


class Rec:
    def __init__(self, multitap):
        self.S = Snes(render=False, multitap=multitap)
        self.multitap = multitap

    # -- memory ----------------------------------------------------------------
    def w(self):
        return self.S.wram(live=True)

    def r(self, off, size):
        w = self.w()
        v = int(w[off])
        if size == 2:
            v |= int(w[off + 1]) << 8
        return v

    def poke(self, off, val, size):
        w = self.w()
        w[off] = val & 0xff
        if size == 2:
            w[off + 1] = (val >> 8) & 0xff

    def load(self, state):
        for d in (STATES_DIR, MYSTATES):
            p = os.path.join(d, state + '.state')
            if os.path.exists(p):
                self.S.load_state_file(p)
                return p
        raise FileNotFoundError(state)

    # -- snapshots -------------------------------------------------------------
    def grid_window(self, base):
        w = self.w()
        g = w[base:base + 0x1000].view('<u2').reshape(32, 64)
        return g[Y0:Y1, X0:X1].copy()

    def tiles_window(self):
        w = self.w()
        g = w[TILES:TILES + 0x800].view('<u2').reshape(32, 32)
        return g[Y0:Y1, X0:X1].copy()

    def players(self):
        out = []
        for i in range(4):
            b = PB + 0x100 * i
            out.append({k: self.r(b + o, s) for k, o, s in PFIELDS})
        return out

    def bombs(self):
        out = []
        for k in range(40):
            b = 0x12000 + 0x100 * k
            f = self.r(b, 2)
            if f & 0x8000:
                out.append([k, f, self.r(b + 0xA, 2), self.r(b + 4, 1), self.r(b + 7, 1),
                            self.r(b + 6, 1), self.r(b + 8, 1), self.r(b + 9, 1)])
        return out

    def movers(self):
        out = []
        for k in range(64):
            p = self.r(0x2620 + 2 * k, 2)
            if p == 0xFFFF:
                break
            if p >= 0x8400:
                out.append([p, self.r(p + 0x10, 2), self.r(p + 0x18, 2), self.r(p + 0x52, 2),
                            self.r(p, 2)])
        return out

    def deck(self):
        out = []
        for k in range(80):
            v = self.r(DECK + 2 * k, 2)
            if v == 0xFFFF:
                break
            out.append(v)
        return out

    def globals(self):
        return dict(tick=self.r(0x32, 2), nmi=self.r(0x36, 2), rng=self.r(0xD6, 2),
                    g30=self.r(0x30, 2), stage=self.r(0x1A, 2),
                    timer=[self.r(a, 2) for a in ROUND_ADDRS])

    def initial(self):
        return dict(globals=self.globals(), players=self.players(), bombs=self.bombs(),
                    movers=self.movers(), deck=self.deck(),
                    grid_window=dict(cols=[X0, X1], rows=[Y0, Y1]),
                    grid=(self.grid_window(GRID) & 0xff).tolist(),
                    grid_hi=(self.grid_window(GRID) >> 8).tolist(),
                    underlay=(self.grid_window(GRID_BASE) & 0xff).tolist(),
                    tiles=self.tiles_window().tolist())

    # -- recording ---------------------------------------------------------------
    def record(self, spec):
        st = self.load(spec['state'])
        for _ in range(spec.get('settle', 1)):
            self.S.step(0)
        pokes = []
        for fn in spec.get('setup', []):
            pokes += fn(self)
        for off, val, size in pokes:
            self.poke(off, val, size)
        init = self.initial()
        prev_grid = self.grid_window(GRID) & 0xff
        prev_dying = [p['f00'] & 0x800 for p in init['players']]
        frames = []
        pads = spec['pads'](self) if callable(spec['pads']) else spec['pads']
        for i, pad in enumerate(pads):
            entry = pad if isinstance(pad, (list, tuple)) else [pad]
            entry = list(entry) + [0] * (5 - len(entry))
            self.S.step(tuple(entry))
            g = self.grid_window(GRID) & 0xff
            ch = np.argwhere(g != prev_grid)
            prev_grid = g
            pl = self.players()
            deaths = [k for k in range(4) if (pl[k]['f00'] & 0x800) and not prev_dying[k]]
            prev_dying = [p['f00'] & 0x800 for p in pl]
            truth = dict(self.globals(), players=pl, bombs=self.bombs(), movers=self.movers(),
                         grid=[[int(c) + X0, int(r) + Y0, int(g[r, c])] for r, c in ch],
                         deaths=deaths)
            frames.append(dict(pads=entry, truth=truth))
            stop = spec.get('stop')
            if stop and stop(self, i):
                break
        return dict(version=2, name=spec['name'], description=spec['desc'],
                    start=dict(state=spec['state'], state_sha1=sha1(st), multitap=self.multitap,
                               settle_frames=spec.get('settle', 1),
                               pokes=[[int(a), int(b), int(c)] for a, b, c in pokes]),
                    initial=init, frames=frames)


def sha1(path):
    with open(path, 'rb') as f:
        return hashlib.sha1(f.read()).hexdigest()


# ---- setup helpers (return poke lists) ------------------------------------------
def clear_soft(R):
    out = []
    g = R.grid_window(GRID)
    for r in range(g.shape[0]):
        for c in range(g.shape[1]):
            if g[r, c] & 0xff == 0xC2:
                cx, cy = c + X0, r + Y0
                out += [(GRID + gi(cx, cy), 0, 2), (GRID_BASE + gi(cx, cy), 0, 2)]
    return out


def stat(i, field, v):
    off = dict((k, o) for k, o, s in PFIELDS)[field]
    return lambda R: [(PB + 0x100 * i + off, v, 1)]


def item_at(cx, cy, word):
    return lambda R: [(GRID + gi(cx, cy), 0x44, 2), (GRID_BASE + gi(cx, cy), 0, 2),
                      (TILES + ti(cx, cy), word, 2)]


def soft_at(cx, cy):
    return lambda R: [(GRID + gi(cx, cy), 0xC2, 2), (GRID_BASE + gi(cx, cy), 0, 2)]


def mt(*p):
    """multitap pad entry: P1..P4."""
    return list(p) + [0] * (5 - len(p))


def hold(n, *p):
    return [mt(*p)] * n


def rnd_walk(n, seed, bomb_every=0, pl=0):
    rng = random.Random(seed)
    out = []
    cur = 0
    for i in range(n):
        if i % rng.choice([5, 7, 9, 11, 13]) == 0:
            cur = rng.choice([B.UP, B.DOWN, B.LEFT, B.RIGHT, B.UP | B.RIGHT, B.DOWN | B.LEFT, 0])
        p = cur | (B.A if bomb_every and i % bomb_every == 0 else 0)
        e = [0] * 5
        e[pl] = p
        out.append(e)
    return out


# ---- derived states ------------------------------------------------------------
def ensure_states():
    """com4_stageNN: all four bombers COM (level 5) on stage NN, first bright frame;
    mt4_stageNN: four humans (multitap) on stage NN."""
    os.makedirs(MYSTATES, exist_ok=True)
    need = [n for n in range(1, 11)
            if not os.path.exists(os.path.join(MYSTATES, 'com4_stage%02d.state' % n))]
    if need:
        S = Snes(render=False)
        S.load_state_file(os.path.join(STATES_DIR, 'battle_players.state'))
        for n, pad in [(1, B.RIGHT), (10, 0), (1, B.DOWN), (10, 0), (1, B.RIGHT), (10, 0),
                       (1, B.START), (160, 0), (1, B.START), (200, 0)]:
            S.run(n, pad)
        base = S.save_state()
        for st in need:
            S.load_state(base)
            for _ in range(st - 1):
                S.run(1, B.RIGHT)
                S.run(50, 0)
            S.run(1, B.START)
            wait_bright(S)
            p = os.path.join(MYSTATES, 'com4_stage%02d.state' % st)
            S.save_state_file(p)
            print('built', p)


def wait_bright(S):
    w = S.wram(live=True)
    dark = False
    for _ in range(1500):
        S.step(0)
        b = w[0x30] & 0x0F
        if b != 0x0F:
            dark = True
        elif dark:
            return          # first fully bright frame after the stage fade-in
    raise RuntimeError('stage never became bright')


# ---- scenarios -----------------------------------------------------------------
MT = 'battle_start_4p_mt'     # 4 humans (multitap), stage 1, nobody moves unless told


def death_or(n):
    return lambda R, i: i >= n


SCEN = []


def scen(name, desc, state, pads, setup=(), multitap=True, stop=None):
    SCEN.append(dict(name=name, desc=desc, state=state, pads=pads, setup=list(setup),
                     multitap=multitap, stop=stop))


scen('walk_natural', 'P1 walks the original stage-1 layout (pillars + soft blocks), '
     'turning every few frames; exercises blocking and corner slides. Others idle.',
     MT, rnd_walk(900, 1))
scen('walk_cleared', 'Soft blocks removed (logic grids only): P1 random walk with frequent '
     'turns over the pillar lattice -> many corner slides in all 4 directions; P4 does '
     'a second walk.', MT,
     [[a[0], 0, 0, b[0], 0] for a, b in zip(rnd_walk(1200, 2), rnd_walk(1200, 3))],
     setup=[clear_soft])
scen('corner_offsets', 'Cleared arena. P1 starts at (2,4), steps 3/5/7 px off-centre '
     'then pushes into pillars from each side.', MT,
     hold(3, B.RIGHT) + hold(30, B.DOWN) + hold(5, B.RIGHT) + hold(30, B.DOWN) +
     hold(7, B.LEFT) + hold(30, B.UP) + hold(3, B.DOWN) + hold(30, B.RIGHT) +
     hold(5, B.UP) + hold(30, B.LEFT) + hold(20, 0) + hold(40, B.RIGHT | B.DOWN) +
     hold(40, B.LEFT | B.UP), setup=[clear_soft])
scen('speed_levels', 'Cleared arena, P1 speed level poked to 5 (2.75 px/tick), P2 to 0 '
     '(0.5), P3 to 6 (3.0), P4 stays 1 (1.25); all walk.', MT,
     hold(60, B.RIGHT, B.LEFT, B.DOWN, B.UP) + hold(60, B.DOWN, B.UP, B.LEFT, B.RIGHT),
     setup=[clear_soft, stat(0, 'speed', 5), stat(0, 'speed_max', 5), stat(1, 'speed', 0),
            stat(2, 'speed', 6), stat(2, 'speed_max', 6)])
scen('bomb_single', 'P1 drops one bomb at (2,4) and walks to safety; full fuse, '
     'explosion and fire lifetime.', MT,
     hold(1, B.A) + hold(12, B.DOWN) + hold(16, B.DOWN) + hold(200, 0))
scen('bomb_chain', 'Cleared arena, P1 has 4 bombs and fire 2 (reach 3): drops bombs '
     'at (2,4),(4,4),(6,4),(8,4) and flees down; chain reaction along row 4.', MT,
     hold(1, B.A) + hold(26, B.RIGHT) + hold(1, B.A) + hold(26, B.RIGHT) + hold(1, B.A) +
     hold(26, B.RIGHT) + hold(1, B.A) + hold(13, B.RIGHT) + hold(30, B.DOWN) + hold(220, 0),
     setup=[clear_soft, stat(0, 'bombs_cap', 4), stat(0, 'bombs_hand', 4), stat(0, 'fire', 2)])
scen('bomb_softblocks', 'Original layout; P1 fire 3 (reach 4): bomb destroys soft blocks, '
     'items revealed from the deck, P1 later walks over them.', MT,
     hold(1, B.A) + hold(14, B.DOWN) + hold(14, B.RIGHT) + hold(230, 0) +
     hold(30, B.LEFT) + hold(30, B.UP) + hold(60, B.RIGHT) + hold(60, 0),
     setup=[stat(0, 'fire', 3)])
scen('death_own_bomb', 'P1 drops a bomb and stays on it -> dies; death animation and '
     'round end (others idle).', MT, hold(1, B.A) + hold(700, 0))
scen('death_two', 'P1 and P2 placed next to each other; P1 bombs, both stay -> double '
     'kill / draw handling.', MT, hold(1, B.A) + hold(700, 0),
     setup=[lambda R: [(PB + 0x100 + 0x10, 0x30, 2), (PB + 0x100 + 0x18, 0x30, 2)]])

# one vector per item kind: item cell at (3,4), P1 at (2,4) walks right over it, then
# places bombs / walks so the effect shows.
for word, name in sorted(ITEM_TILES.items()):
    scen('item_' + name, 'Item %04X (%s) poked at (3,4); P1 walks right onto it, then '
         'drops bombs and walks to show the effect.' % (word, name), MT,
         hold(20, B.RIGHT) + hold(1, B.A) + hold(20, B.RIGHT) + hold(1, B.A) +
         hold(40, B.DOWN) + hold(1, B.A) + hold(30, B.UP) + hold(200, 0),
         setup=[clear_soft, item_at(3, 4, word)])
scen('item_burn', 'Item (bomb_up) at (4,4), P1 bombs at (2,4) with reach 3 -> item burns.',
     MT, hold(1, B.A) + hold(30, B.DOWN) + hold(220, 0),
     setup=[clear_soft, item_at(4, 4, 0x1600), stat(0, 'fire', 2)])
scen('skull_swap', 'Skull at (3,4): P1 catches it, then walks into P2 (moved next to it) '
     '-> disease swap.', MT, hold(20, B.RIGHT) + hold(60, B.RIGHT) + hold(200, 0),
     setup=[clear_soft, item_at(3, 4, 0x160A),
            lambda R: [(PB + 0x100 + 0x10, 0x60, 2), (PB + 0x100 + 0x18, 0x30, 2)]])
scen('kick', 'P1 has kick: bomb at (2,5), P1 steps back up and walks into it -> bomb '
     'slides down until an obstacle; second bomb kicked right and stopped with X.', MT,
     hold(13, B.DOWN) + hold(1, B.A) + hold(14, B.UP) + hold(8, B.DOWN) + hold(60, 0) +
     hold(1, B.A) + hold(14, B.LEFT) + hold(10, B.RIGHT) + hold(20, 0) + hold(1, B.X) +
     hold(200, 0), setup=[clear_soft, stat(0, 'kick', 1), stat(0, 'bombs_cap', 2),
                          stat(0, 'bombs_hand', 2)])
scen('glove_throw', 'P1 has the glove: picks up its own bomb (A on the bomb), throws it '
     'left (wraps to the far side), then up (wraps, bounces off P4).', MT,
     hold(1, B.A) + hold(6, 0) + hold(20, B.A) + hold(1, B.A | B.LEFT) + hold(1, B.LEFT) +
     hold(40, 0) + hold(1, B.A) + hold(6, 0) + hold(20, B.A) + hold(1, B.A | B.UP) +
     hold(1, B.UP) + hold(200, 0),
     setup=[clear_soft, stat(0, 'glove', 1), stat(0, 'bombs_cap', 2), stat(0, 'bombs_hand', 2)])
scen('timeout_sudden_death', 'Clock poked to 0:35. Soft blocks cleared; the 4 humans walk '
     'out of the two outer rings, then idle -> Hurry at 0:38? (no: starts at 0:35), sudden '
     'death from 0:33 (one block per 15 ticks, 80 blocks), time up at 0:00+65 ticks kills '
     'everyone -> draw, 256-tick round-over phase.', MT,
     hold(26, B.DOWN, B.UP, B.DOWN, B.UP) + hold(26, B.RIGHT, B.LEFT, B.LEFT, B.RIGHT) +
     hold(2700, 0),
     setup=[clear_soft, lambda R: [(0x5E10, 0, 2), (0x5E12, 35, 2), (0x5E14, 0, 2)]])
scen('round_win', 'Cleared arena; P2, P3, P4 poked next to P1 at (3,4), (2,5), (4,4); P1 '
     'bombs and runs down to (2,7) -> 3 die, round over, P1 wins after 256 ticks.', MT,
     hold(1, B.A) + hold(40, B.DOWN) + hold(800, 0),
     setup=[clear_soft, lambda R: [(PB + 0x110, 0x30, 2), (PB + 0x118, 0x30, 2),
                                   (PB + 0x210, 0x20, 2), (PB + 0x218, 0x40, 2),
                                   (PB + 0x310, 0x40, 2), (PB + 0x318, 0x30, 2)]])
scen('glove_stun', 'P1 (glove) throws its bomb right at P2 standing on (5,4): P2 is stunned '
     '28 ticks (+52 = $81), the bomb bounces to (6,4); P2 then walks left.', MT,
     hold(1, B.A) + hold(6, 0) + hold(20, B.A) + hold(1, B.A | B.RIGHT) + hold(1, B.RIGHT) +
     hold(16, 0) + hold(104, 0, B.LEFT) + hold(150, 0),
     setup=[clear_soft, stat(0, 'glove', 1),
            lambda R: [(PB + 0x110, 0x50, 2), (PB + 0x118, 0x30, 2)]])
scen('cpu_round', 'All four bombers COM (level 5), stage 1, full round until the result.',
     'com4_stage01', [[0, 0, 0, 0, 0]] * 9000, multitap=False)
for _n in range(2, 11):
    scen('cpu_stage%02d' % _n, 'All four bombers COM (level 5) on stage %d for 4000 frames '
         '(gimmicks + AI on that stage).' % _n, 'com4_stage%02d' % _n,
         [[0, 0, 0, 0, 0]] * 4000, multitap=False)
scen('cpu_round_1p', 'battle_start: P1 human idle-walking, 3 COM (level 5).',
     'battle_start', [e[:2] for e in rnd_walk(5000, 7, bomb_every=97)], multitap=False)


def build(names=None, child=False):
    os.makedirs(OUT, exist_ok=True)
    todo = [s for s in SCEN if not names or s['name'] in names]
    by_mt = {}
    for s in todo:
        by_mt.setdefault(s['multitap'], []).append(s)
    # one Snes per process: derived states + each multitap group in child processes
    if not child:
        import subprocess
        subprocess.check_call([sys.executable, __file__, '--ensure'])
        for flag, group in by_mt.items():
            subprocess.check_call([sys.executable, __file__, '--group'] + [s['name'] for s in group])
        return
    for flag, group in by_mt.items():
        R = Rec(flag)
        for s in group:
            v = R.record(s)
            p = os.path.join(OUT, s['name'] + '.json')
            with open(p, 'w') as f:
                json.dump(v, f, separators=(',', ':'))
            print('%-24s %5d frames  %s' % (s['name'], len(v['frames']), p))


def verify(names=None, child=False):
    files = sorted(f for f in os.listdir(OUT) if f.endswith('.json'))
    bad = 0
    groups = {}
    for fn in files:
        v = json.load(open(os.path.join(OUT, fn)))
        if names and v['name'] not in names:
            continue
        groups.setdefault(v['start']['multitap'], []).append(v)
    if len(groups) > 1 or not child:
        import subprocess
        for flag, vs in groups.items():
            subprocess.check_call([sys.executable, __file__, '--verify-group'] + [v['name'] for v in vs])
        return
    for flag, vs in groups.items():
        R = Rec(flag)
        for v in vs:
            R.load(v['start']['state'])
            for _ in range(v['start']['settle_frames']):
                R.S.step(0)
            for a, b, c in v['start']['pokes']:
                R.poke(a, b, c)
            ok = True
            for i, fr in enumerate(v['frames']):
                R.S.step(tuple(fr['pads']))
                pl = R.players()
                if pl != fr['truth']['players'] or R.globals()['rng'] != fr['truth']['rng']:
                    print('%s: MISMATCH at frame %d' % (v['name'], i))
                    ok = False
                    bad += 1
                    break
            if ok:
                print('%s: OK (%d frames)' % (v['name'], len(v['frames'])))
    return bad


if __name__ == '__main__':
    a = sys.argv[1:]
    if '--list' in a:
        for s in SCEN:
            print('%-22s %s' % (s['name'], s['desc']))
    elif a and a[0] == '--group':
        build(a[1:], child=True)
    elif a and a[0] == '--ensure':
        ensure_states()
    elif a and a[0] == '--verify-group':
        verify(a[1:], child=True)
    elif '--verify' in a:
        verify([x for x in a if not x.startswith('--')])
    else:
        build(a or None)
