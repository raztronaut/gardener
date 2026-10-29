"""Stage 8 — the JAPANESE GARDEN: moss and stepping stones, blue-violet hydrangeas (soft),
stone lanterns (hard), a bamboo fence; the original's conveyor belts are a STREAM in a
stone channel whose water flows (the original's palette cycle drives it: 5 water colours
turn along the flow), its switches a water wheel (direction) and a koi pond (speed),
with lantern lights that blink (the second cycle)."""
from common import *  # noqa: F401,F403
import math

NAME = 'Japanese Garden'

FLOW = [WATER_1, WATER_2, WATER_3, WATER_4, WATER_5]       # phase-0 colours of the 5 bands
LIGHTS = [GOLD_3, RED, GOLD_1]                              # pal 7 cycle (2 phases)
BANDS = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4]


def moss(seed=0):
    img = speckle(16, 16, MOSS, [(MOSS_L, 3), (OLIVE, 2)], seed=seed, density=0.12)
    return img


def channel(kind):
    """kind: '+x' '-x' '+y' '-y' or a corner 'br_r' (from bottom to right) etc."""
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            if kind in ('+x', '-x'):
                along, cross = (x + 0.5), (y + 0.5 - 8)
                if kind == '-x':
                    along = 16 - along
            elif kind in ('+y', '-y'):
                along, cross = (y + 0.5), (x + 0.5 - 8)
                if kind == '-y':
                    along = 16 - along
            else:
                # corners: the centre of curvature at a corner of the cell
                cxy = {'b>r': (16, 16), 'l>b': (0, 16), 't>l': (0, 0), 'r>t': (16, 0)}[kind]
                dx, dy = x + 0.5 - cxy[0], y + 0.5 - cxy[1]
                r = math.hypot(dx, dy)
                cross = r - 8
                th = math.atan2(abs(dy), abs(dx))           # 0 along x, pi/2 along y
                if kind == 'b>r':      # from the bottom edge (th=0 at bottom? at x=8,y=16: dx=-8,dy=0 -> th 0)
                    along = th / (math.pi / 2) * 16
                elif kind == 'l>b':    # from the left edge (dx=0 -> th pi/2) to the bottom (th 0)
                    along = (1 - th / (math.pi / 2)) * 16
                elif kind == 't>l':    # from the top (dy=0 -> th 0) to the left (th pi/2)
                    along = th / (math.pi / 2) * 16
                else:                  # 'r>t': from the right (dx=0, th pi/2) to the top (th 0)
                    along = (1 - th / (math.pi / 2)) * 16
            a = abs(cross)
            if a <= 5.5:
                pos = (along + 0.7 * a) % 16
                img[y, x] = FLOW[BANDS[int(pos) % 16]]
            elif a <= 6.5:
                img[y, x] = INK
            elif a <= 8.1:
                img[y, x] = STONE_3 if cross < 0 else STONE_2
    return img


def stream_cell(kind):
    base = moss()
    return over(base, channel(kind))


def lantern(base):
    t = grid("""
.....oooooo.....
...oo334433oo...
.oo3444444443oo.
o34444444444433o
o33333333333332o
.oooooooooooooo.
..o32LMMMML23o..
..o32MNNNNM23o..
..o32LMMMML23o..
..oooooooooooo..
.o333333333332o.
..oooo3332oooo..
.....o3332o.....
....oo3332oo....
..o3333333332o..
..ooooooooooo...
""", {'o': INK, '4': STONE_4, '3': STONE_3, '2': STONE_2, 'L': LIGHTS[0], 'M': LIGHTS[2], 'N': LIGHTS[1]})
    return over(base.copy(), t)


def bamboo_fence(role):
    img = blank(16, 16, MOSS)
    vertical_poles = role in ('top', 'tl', 'tr', 'bottom', 'bl', 'br')
    for y in range(16):
        for x in range(16):
            a = x if vertical_poles else y
            b = y if vertical_poles else x
            p = a % 4
            c = LEAF_3 if p == 1 else LEAF_2 if p == 2 else LEAF_1 if p == 3 else INK
            if b % 8 == 3:                       # nodes
                c = LEAF_3 if p in (1, 2) else c
            img[y, x] = c
            if b in (4, 11) and p != 0:          # rope ties
                img[y, x] = OLIVE
    if role in ('top', 'tl', 'tr'):
        img[15, :] = INK
    return img


def wheel(frame):
    """a millstone (the direction switch): its grooves turn over 3 frames, a lantern light
    glows in its hub"""
    img = moss()
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            ang = math.atan2(y - 7.5, x - 7.5) + frame * math.pi / 9
            if d <= 7.4:
                lum = -((x - 7.5) * 0.7 + (y - 7.5) * 0.7) / 7.4
                c = STONE_4 if lum > 0.4 else STONE_3 if lum > -0.3 else STONE_2
                if 2.6 < d < 6.6 and abs(math.sin(3 * ang)) < 0.22:
                    c = STONE_2 if c != STONE_2 else INK
                if d > 6.8:
                    c = INK
                img[y, x] = c
                if d < 2:
                    img[y, x] = LIGHTS[0] if d < 1.2 else LIGHTS[2]
    return img


def lotus_basin(frame):
    """a stone basin where a lotus opens (the speed switch), 3 frames"""
    img = moss()
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d <= 7.4:
                img[y, x] = INK if d > 6.8 else STONE_3 if d > 5.6 else LEAF_1
    open_ = [1.6, 2.6, 3.6][frame]
    for k in range(6):
        ang = k * math.pi / 3 + frame * 0.3
        cx, cy = 7.5 + open_ * math.cos(ang), 7.5 + open_ * math.sin(ang)
        for y in range(16):
            for x in range(16):
                if math.hypot(x - cx, y - cy) <= 1.5:
                    img[y, x] = LILAC_3 if (x - cx) + (y - cy) < 0.5 else LILAC_2
    img[7, 7] = LIGHTS[0]
    img[8, 8] = LIGHTS[0]
    img[7, 8] = LIGHTS[2]
    img[8, 7] = LIGHTS[2]
    return img


def terrain(ctx):
    a = {}
    m = moss()
    a['floor_0'] = m
    a['floor_1'] = shadow_top(m, [MOSS_L, MOSS, OLIVE, STONE_3, STONE_2], [MOSS, OLIVE, OLIVE, STONE_2, STONE_2], rows=5)
    # the stream (clockwise by default: top flows right, right flows down ...)
    for n, k in (('gimmick_17_0', '+x'), ('gimmick_18_0', '-x'), ('gimmick_19_0', '-y'), ('gimmick_1a_0', '+y'),
                 ('gimmick_1d_0', 'b>r'), ('gimmick_1b_0', 'l>b'), ('gimmick_1c_0', 't>l'), ('gimmick_1e_0', 'r>t')):
        a[n] = stream_cell(k)
    hyd = clump_bush([LEAF_1, LEAF_2, LEAF_3, LEAF_3], INK, flowers=[(LILAC_3, LILAC_2), (LILAC_2, LILAC_3)],
                     flower_spots=[(4, 4), (10, 3), (7, 7), (12, 8), (3, 10), (9, 11), (6, 13), (12, 13)])
    a['soft_block_0'] = over(m.copy(), hyd)
    a['hard_block_0'] = lantern(m)
    blk = blank(14, 14, STONE_3)
    blk[0:4, :] = STONE_4
    blk[:, 11:] = STONE_2
    blk[10:, :] = STONE_2
    pb = m.copy()
    over(pb, outline(blk, INK), 0, 0)
    a['pressure_block'] = pb
    for k in range(3):
        a['gimmick_12_%d' % k] = wheel(k)
        a['gimmick_13_%d' % k] = lotus_basin(k)
    for n in ring_names(ctx):
        role, _ = role_of(ctx, n)
        a[n] = bamboo_fence(role) if role not in ('border_l', 'border_r') else moss(9)
    a['__cycles__'] = {6: {'colours': FLOW, 'rom': 0xDBFE, 'phases': 4},
                       7: {'colours': LIGHTS, 'rom': 0xDC7E, 'phases': 2}}
    return a
