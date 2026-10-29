"""Garden Edition — the arena's shared objects, drawn on a transparent 16x16 cell and
composited by the build over each garden's floor (the original bakes bombs / flames /
burning blocks over its floor the same way: one opaque BG2 cell per state).

  pod(type, frame)       seed pods (normal, remote, rubber, pierce, power) with their pulse
  bloom(piece, frame)    the explosion: pollen gold -> petal pink, petal-shaped arm ends
  shed(soft, frame)      a burning soft block shedding leaves (from the garden's own block)
  wilt(frame)            a burning item: a wilting puff of pollen and petals

Every object uses only the OBJ_SET colours (BG palettes 1..4 hold them + the floor).
"""
import math
import os
import sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
from gfx import T, blank, grid, over, hflip, vflip, Rng, hash2, dither  # noqa: E402
from swatch import (POD_0, POD_1, POD_2, LEAF_2, LEAF_4, WHITE, GOLD_4, GOLD_2,  # noqa: E402
                    GOLD_1, PINK, ROSE_2, PINK_L)

OBJ_SET = [POD_0, POD_1, POD_2, LEAF_2, LEAF_4, WHITE, GOLD_4, GOLD_2, GOLD_1, PINK, ROSE_2, PINK_L]

# ---- seed pods ---------------------------------------------------------------------------
# legend: o outline, d body dark, m body, w shine, g leaf dark, l leaf light, y gold,
# Y pale gold, p pink, r rose
L = {'o': POD_0, 'd': POD_1, 'm': POD_2, 'w': WHITE, 'g': LEAF_2, 'l': LEAF_4,
     'y': GOLD_2, 'Y': GOLD_4, 'p': PINK, 'r': ROSE_2, 'k': GOLD_1}

# the pulse: three sizes of the same round pod (the original's 3 bomb frames: small,
# middle, large, then middle again)
POD = [
"""
................
................
..........gl....
.........gll....
........o.g.....
.....ooooo......
....odddddoo....
...odmmdddddo...
...odmwmddddo...
..oddmmddddddo..
..odddddddddmo..
..oddddddddmmo..
...odddddddmo...
...oodddddmoo...
.....ooooooo....
................
""",
"""
................
..........gl....
.........gll....
........o.g.....
.....oooooo.....
....oddddddoo...
...odmmdddddo...
..odmwmddddddo..
..odmmdddddddo..
..oddddddddddo..
..odddddddddmo..
..oddddddddmmo..
...odddddddmo...
...oodddddmmo...
.....ooooooo....
................
""",
"""
..........gl....
.........gll....
........o.g.....
.....ooooooo....
....oddddddddo..
...odmmddddddo..
..odmwwmddddddo.
..odmwmdddddddo.
.oddmmddddddddo.
.oddddddddddddo.
.odddddddddddmo.
.oddddddddddmmo.
..odddddddddmo..
..oodddddddmmo..
....ooooooooo...
................
""",
]


def _pod_base(size):
    return grid(POD[size], L)


def _leaf_bud(img, x, y, col_a, col_b):
    img[y, x] = col_a
    img[y, x + 1] = col_b


def pod(kind, frame):
    """frame: the original's frame index of that type (normal 0..2 / 1 again, remote 0..3,
    rubber / pierce / power 0..2)"""
    size = [0, 1, 2, 1][frame] if kind != 'remote' else [1, 1, 1, 1][frame]
    if kind == 'normal':
        img = _pod_base(size)
        # the leaf fuse flickers a gold spark at its tip on the largest frame
        if size == 2:
            img[0, 11] = GOLD_4
        return img
    if kind == 'remote':
        # a pod with a trowel-blade antenna and a blinking gold bud (4 frames)
        img = _pod_base(1)
        img[0:4, :] = T
        img[0:4, 9:13] = T
        blade = grid("""
.....oo
....oYwo
....oyYo
.....ok.
......o.
""".replace(' ', ''), L, w=8) if False else None
        for (x, y, c) in [(9, 0, POD_0), (10, 0, POD_0), (8, 1, POD_0), (9, 1, GOLD_4), (10, 1, WHITE), (11, 1, POD_0),
                          (8, 2, POD_0), (9, 2, GOLD_2), (10, 2, GOLD_4), (11, 2, POD_0), (9, 3, POD_0), (10, 3, GOLD_1),
                          (10, 4, POD_0)]:
            img[y, x] = c
        bud = [WHITE, GOLD_4, GOLD_2, GOLD_4][frame]
        img[9, 7] = bud
        img[9, 8] = bud
        img[10, 7] = bud if frame == 0 else POD_2
        img[10, 8] = POD_2
        return img
    if kind == 'rubber':
        # a bouncy gourd: light green with dark ribs, squashing on the pulse
        rows = [
"""
................
................
.........ol.....
........ogl.....
......oooooo....
....oolllllloo..
...ollglllglllo.
...olglllglllgo.
..olglwlglllglo.
..olgllglllglgo.
..olglllglllggo.
...oglllglllgo..
...ooggggggggo..
.....oooooooo...
................
................
""",
"""
................
.........ol.....
........ogl.....
.....oooooo.....
....ollllllo....
...olglllglloo..
...olgwlglllgo..
..olglllgllllgo.
..olglllglllglo.
..olglllglllglo.
..oglllglllgglo.
...ogllglllggo..
...oogggggggoo..
.....ooooooo....
................
................
""",
"""
................
.........ol.....
........ogl.....
......ooooo.....
.....ollllloo...
....olglllglo...
...olgwlglllgo..
...olglllglllo..
..olglllgllllgo.
..olglllglllglo.
..olglllglllglo.
..oglllglllgglo.
...ogllglllggo..
...oogggggggoo..
.....ooooooo....
................
""",
        ]
        return grid(rows[[0, 1, 2, 1][frame]], L)
    if kind == 'pierce':
        # a thorny pod: rose thorns all around the dark body
        img = _pod_base(size)
        thorns = {0: [(3, 7), (2, 10), (13, 9), (12, 6), (6, 14), (10, 14)],
                  1: [(2, 7), (1, 10), (14, 9), (13, 6), (5, 15), (11, 15), (8, 4)],
                  2: [(1, 7), (0, 10), (15, 9), (14, 6), (4, 15), (12, 15), (7, 3)]}[size]
        for (x, y) in thorns:
            if 0 <= x < 16 and 0 <= y < 16:
                img[y, x] = ROSE_2
        # a pink tip on each thorn's neighbour toward the body for weight
        return img
    if kind == 'power':
        # a big pod with a golden sun band
        img = _pod_base(size)
        y0 = {0: 10, 1: 10, 2: 10}[size]
        for x in range(16):
            for y in (y0, y0 + 1):
                if img[y, x] in (POD_1, POD_2):
                    img[y, x] = GOLD_2 if y == y0 else GOLD_1
        # the sun disc in the middle of the band
        cx = 7 if size < 2 else 7
        for (dx, dy, c) in [(0, -1, GOLD_4), (1, -1, GOLD_4), (-1, 0, GOLD_4), (0, 0, WHITE), (1, 0, WHITE), (2, 0, GOLD_4),
                            (-1, 1, GOLD_2), (0, 1, GOLD_4), (1, 1, GOLD_4), (2, 1, GOLD_2), (0, 2, GOLD_1), (1, 2, GOLD_1)]:
            img[y0 - 1 + dy, cx + dx] = c
        return img
    raise ValueError(kind)


# ---- blooms (the explosion) -------------------------------------------------------------------
# A bloom cell is drawn from a distance field: d = distance from the blast's centre line
# (arms) or centre (the burst), with a petal frill on the edge. The frill repeats every
# 8 px, so neighbouring cells always meet seamlessly.
WIDTH = [2.6, 4.2, 5.4, 6.4, 7.2]        # half-width of the band per frame (0 = thinnest)
FRILL = [0.0, 0.6, 0.9, 1.1, 1.3]


def _frill(t, f, phase=0):
    # petal bumps along the band: a rounded bump every 8 px
    u = ((t + phase) % 8) / 8.0
    return FRILL[f] * (0.5 + 0.5 * math.cos(2 * math.pi * u))


def _bloom_col(d, w, x, y, f):
    """colour for a pixel at distance d from the centre of a band of half-width w"""
    if d > w:
        return T
    r = d / w if w > 0 else 1
    if r < 0.30:
        return WHITE
    if r < 0.52:
        return GOLD_4 if not (f >= 3 and dither(3, x, y)) else WHITE
    if r < 0.72:
        return GOLD_2
    if r < 0.86:
        return GOLD_1 if f < 2 else (PINK if dither(6, x + 1, y) else GOLD_1)
    return PINK if f >= 1 else GOLD_1


def _edge(img, f):
    """a rose rim on the outermost petal pixels (frames 2..4)"""
    if f < 2:
        return img
    out = img.copy()
    H, W = img.shape
    for y in range(H):
        for x in range(W):
            if img[y, x] == PINK:
                n = 0
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < W and 0 <= yy < H and img[yy, xx] == T:
                        n += 1
                if n >= 1 and hash2(x, y, f) % 3 == 0:
                    out[y, x] = ROSE_2
    return out


def _sparkle(img, f, seed):
    """pollen flecks outside the band on the full frames (3/4 alternate = shimmer)"""
    if f < 3:
        return img
    out = img.copy()
    r = Rng(seed * 7 + f)
    for _ in range(3):
        x, y = r.rand(16), r.rand(16)
        if out[y, x] == T:
            out[y, x] = GOLD_4 if r.rand(2) else PINK
    return out


def _arm_h(f, frame_seed=0):
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            w = WIDTH[f] + _frill(x, f)
            d = abs(y - 7.5)
            img[y, x] = _bloom_col(d, w, x, y, f)
    return img


def _burst(f):
    """the centre: the arms crossed + a round flower burst with 8 petals"""
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            dx, dy = x - 7.5, y - 7.5
            wa = WIDTH[f] + _frill(x, f)
            wb = WIDTH[f] + _frill(y, f)
            da, db = abs(dy), abs(dx)
            rr = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            wr = (WIDTH[f] + 1.6) * (0.82 + 0.18 * math.cos(8 * ang + math.pi / 8)) + 0.4
            best = None
            for d, w in ((da, wa), (db, wb), (rr, wr)):
                if d <= w:
                    r = d / w
                    if best is None or r < best[0]:
                        best = (r, d, w)
            if best:
                img[y, x] = _bloom_col(best[1], best[2], x, y, f)
    return img


def _end_right(f):
    """the arm ending in a rounded petal tip pointing right"""
    img = blank(16, 16)
    L_ = [6.0, 8.5, 10.5, 12.0, 13.0][f]          # how far the petal reaches into the cell
    for y in range(16):
        for x in range(16):
            dy = abs(y - 7.5)
            w = WIDTH[f] + _frill(x, f)
            # taper: an ellipse cap from x = L_-w .. L_
            if x <= L_ - WIDTH[f] * 1.2:
                ww = w
            else:
                t = (x - (L_ - WIDTH[f] * 1.2)) / (WIDTH[f] * 1.2 + 0.01)
                ww = w * math.sqrt(max(0.0, 1 - t * t)) if t < 1 else -1
            if ww > 0:
                img[y, x] = _bloom_col(dy, ww, x, y, f)
    # the petal's tip: a notch of pink like a petal's split end
    if f >= 2:
        tip = int(L_)
        for y in (7, 8):
            if 0 <= tip < 16 and img[y, tip] != T:
                img[y, tip] = ROSE_2
    return img


# The petal blooms: the band of light (white core -> pale gold -> gold) is fringed with
# pink petals along both edges (every 8 px, top and bottom alternating, so neighbouring
# cells always meet), ends in a five-petal flower and bursts as an eight-petal flower in
# the middle. Frames 0..4 grow it; 3 and 4 alternate (shimmer: the petals shift by 4 px).
BAND = [2.2, 3.0, 3.6, 4.0, 4.0]           # half-width of the light band per frame
PET_R = [0.0, 2.0, 2.6, 3.0, 3.0]          # petal radius (long axis)
PET_OUT = [0.0, 1.2, 1.8, 2.2, 2.2]        # how far a petal centre sits past the band edge


def _band_col(d, w, x, y, f):
    r = d / w if w > 0 else 1
    if r < 0.38:
        return WHITE
    if r < 0.66:
        return GOLD_4 if not (f >= 3 and dither(4, x, y)) else WHITE
    if r < 0.88:
        return GOLD_2
    return GOLD_1


def _petal_field(img, owner, cx, cy, ax, ay, rl, rw, f):
    """paint one petal: an ellipse centred (cx, cy) with its long axis (ax, ay) (unit)"""
    if rl <= 0:
        return
    for y in range(16):
        for x in range(16):
            dx, dy = x + 0.5 - cx, y + 0.5 - cy
            u = dx * ax + dy * ay
            v = -dx * ay + dy * ax
            q = (u / rl) ** 2 + (v / rw) ** 2
            if q <= 1:
                # outer half of the petal (away from the band) is the deep rose rim
                c = ROSE_2 if (q > 0.62 and u > 0) else PINK if q > 0.25 or u > 0 else PINK_L
                if f <= 1:
                    c = PINK if q > 0.5 else GOLD_2
                img[y, x] = c
                owner[y, x] = 1


def _arm(f, phase):
    """a horizontal arm (centre line y = 7.5)"""
    img = blank(16, 16)
    own = np.zeros((16, 16), np.int32)
    w = BAND[f]
    if f >= 1:
        for k in range(-1, 4):
            for side in (-1, 1):
                px = k * 8 + (0 if side < 0 else 4) + phase
                cy = 7.5 + side * (w + PET_OUT[f] - 0.6)
                _petal_field(img, own, px + 0.5, cy, 0, side, PET_R[f], PET_R[f] * 0.78, f)
    for y in range(16):
        for x in range(16):
            d = abs(y + 0.5 - 8)
            if d <= w:
                img[y, x] = _band_col(d, w, x, y, f)
    return img


def _flower(img, cx, cy, n, r_core, r_pet, f, rot=0.0):
    """a flower: n petals around a gold core"""
    own = np.zeros((16, 16), np.int32)
    if f >= 1:
        for k in range(n):
            a = rot + k * 2 * math.pi / n
            ax, ay = math.cos(a), math.sin(a)
            _petal_field(img, own, cx + ax * (r_core + r_pet * 0.45), cy + ay * (r_core + r_pet * 0.45), ax, ay,
                         r_pet, r_pet * 0.75, f)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d <= r_core:
                img[y, x] = _band_col(d, r_core, x, y, f)
    return img


def _end_right(f, phase):
    """an arm from the left edge ending in a five-petal flower"""
    img = _arm(f, phase)
    reach = [5.5, 7.5, 8.0, 8.5, 8.5][f]
    # clear what lies past the flower, then draw the flower at the tip
    for y in range(16):
        for x in range(16):
            if x + 0.5 > reach:
                img[y, x] = T
    core = BAND[f] - 0.2
    return _flower(img, reach, 8.0, 5, core, PET_R[f], f, rot=0.0)


def _centre(f, phase):
    img = blank(16, 16)
    a = _arm(f, phase)
    over(img, a)
    over(img, a.T.copy())
    return _flower(img, 8.0, 8.0, 8, BAND[f] + 0.4, PET_R[f] - 0.2, f, rot=math.pi / 8 + (phase / 8.0) * math.pi / 4)


def bloom(piece, frame):
    f = frame
    phase = 4 if f == 4 else 0
    if piece == 'arm_h':
        img = _arm(f, phase)
    elif piece == 'arm_v':
        img = _arm(f, phase).T.copy()
    elif piece == 'center':
        img = _centre(f, phase)
    elif piece == 'end_right':
        img = _end_right(f, phase)
    elif piece == 'end_left':
        img = hflip(_end_right(f, phase))
    elif piece == 'end_down':
        img = _end_right(f, phase).T.copy()
    elif piece == 'end_up':
        img = vflip(_end_right(f, phase).T.copy())
    else:
        raise ValueError(piece)
    return _sparkle(img, f, hash2(len(piece), f))


# ---- a burning soft block: the garden's own block shedding leaves --------------------------
def nearest_obj(c):
    """nearest OBJ_SET colour (perceptual-ish distance in RGB)"""
    from gfx import rgb
    r, g, b = rgb(c)
    best, bd = OBJ_SET[0], 1e9
    for o in OBJ_SET:
        R, G, B = rgb(o)
        d = 2 * (R - r) ** 2 + 4 * (G - g) ** 2 + 3 * (B - b) ** 2
        if d < bd:
            best, bd = o, d
    return best


def shed(soft, frame):
    """frame 0..5: the block catches (gold fringe), bursts into leaves and petals, they fly
    out and fade. soft = the garden's soft block (16x16, opaque); returns a transparent
    overlay for the floor."""
    src = soft.copy()
    mask = src >= 0
    # the block in the object colours
    base = blank(16, 16)
    for y in range(16):
        for x in range(16):
            if mask[y, x]:
                base[y, x] = nearest_obj(int(src[y, x]))
    out = blank(16, 16)
    r = Rng(91 + frame)
    if frame == 0:
        out = base.copy()
        # gold fringe catching along the top and the sides
        for y in range(16):
            for x in range(16):
                if out[y, x] != T and (hash2(x, y, 3) % 5 == 0):
                    out[y, x] = GOLD_2 if hash2(x, y, 4) % 2 else GOLD_4
        return out
    # particles: every 2x2 cluster of the block becomes a leaf / petal flying outward
    cx = cy = 7.5
    spread = [0, 1.6, 3.4, 5.2, 6.8, 8.0][frame]
    keep = [1, 0.75, 0.5, 0.32, 0.18, 0.08][frame]
    for by in range(0, 16, 2):
        for bx in range(0, 16, 2):
            if not mask[by:by + 2, bx:bx + 2].any():
                continue
            h = hash2(bx, by, 17)
            if (h % 100) / 100.0 > keep + 0.15:
                continue
            dx, dy = bx + 1 - cx, by + 1 - cy
            n = math.hypot(dx, dy) or 1
            # leaves fly outward and fall a little (gravity)
            px = int(round(bx + dx / n * spread * (0.6 + (h % 7) / 10)))
            py = int(round(by + dy / n * spread * (0.6 + (h % 5) / 10) + spread * 0.35))
            kind = h % 4
            if frame <= 2:
                cols = [LEAF_4, LEAF_2, PINK, GOLD_2]
            elif frame <= 4:
                cols = [LEAF_2, PINK, GOLD_4, ROSE_2]
            else:
                cols = [PINK, GOLD_4, LEAF_4, WHITE]
            c = cols[kind]
            for (ox, oy) in ([(0, 0), (1, 0), (0, 1)] if kind < 2 else [(0, 0), (1, 1)] if frame < 4 else [(0, 0)]):
                xx, yy = px + ox, py + oy
                if 0 <= xx < 16 and 0 <= yy < 16:
                    out[yy, xx] = c
    # the burning core: a glow left where the block was (frames 1..3)
    if frame <= 3:
        rad = [0, 5.5, 4.5, 3.0][frame]
        for y in range(16):
            for x in range(16):
                d = math.hypot(x - 7.5, y - 8)
                if d < rad:
                    rr = d / rad
                    out[y, x] = WHITE if rr < 0.35 else GOLD_4 if rr < 0.6 else GOLD_2 if rr < 0.85 else (PINK if dither(8, x, y) else out[y, x] if out[y, x] != T else GOLD_1)
    return out


# ---- a burning item: a wilting puff -----------------------------------------------------------
def wilt(frame):
    """frame 0..6: a pollen puff swells, petals drift down and fade"""
    out = blank(16, 16)
    rad = [3.5, 5.5, 6.8, 7.4, 7.0, 6.0, 4.5][frame]
    holes = [0, 0, 2, 4, 7, 10, 13][frame]
    for y in range(16):
        for x in range(16):
            dx, dy = x - 7.5, y - 7.5 - frame * 0.25
            ang = math.atan2(dy, dx)
            rr = math.hypot(dx, dy) / (rad * (0.85 + 0.15 * math.cos(5 * ang + frame)))
            if rr > 1:
                continue
            if dither(holes, x + frame, y):
                continue
            if frame <= 2:
                c = WHITE if rr < 0.35 else GOLD_4 if rr < 0.65 else GOLD_2 if rr < 0.88 else PINK
            elif frame <= 4:
                c = GOLD_4 if rr < 0.4 else PINK if rr < 0.75 else ROSE_2
            else:
                c = PINK if rr < 0.6 else ROSE_2
            out[y, x] = c
    # falling petals on the late frames
    r = Rng(5 + frame)
    for k in range(frame):
        x, y = r.rand(14) + 1, min(15, 8 + r.rand(6) + frame // 2)
        out[y, x] = PINK if k % 2 else LEAF_4
    return out
