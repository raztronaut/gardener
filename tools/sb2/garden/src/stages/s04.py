"""Stage 4 — the IRRIGATION GARDEN: tilled soil, lavender bushes (soft), big terracotta pots
(hard), a wooden fence; the original's fuse ring is a green garden HOSE: when a blast reaches
it, a wave of blooms runs along the hose (the original's burning frames, same timing)."""
from common import *  # noqa: F401,F403
import math
import objects

NAME = 'Irrigation Garden'

# the hose and its blooms live in BG palettes 1..4 (with the pods and blooms): its colours
# are the pod outline + the two leaf greens + white
HO, HL, HD, HW = POD_0, LEAF_4, LEAF_2, WHITE


def soil(seed=0):
    img = blank(16, 16, SOIL_3)
    for y in range(16):
        for x in range(16):
            # furrows: a darker line every 4 rows, slightly wavy
            if (y + (1 if (x // 5) % 2 else 0)) % 4 == 3:
                img[y, x] = SOIL_2
            elif (y + (1 if (x // 5) % 2 else 0)) % 4 == 0 and hash2(x, y, seed) % 3 == 0:
                img[y, x] = SOIL_4
    return img


def hose_h(img, y0=5, glints=(3, 11)):
    for x in range(16):
        img[y0, x] = HO
        img[y0 + 1, x] = HL
        img[y0 + 2, x] = HL
        img[y0 + 3, x] = HD
        img[y0 + 4, x] = HD
        img[y0 + 5, x] = HO
        if x % 8 == 6:                      # ribs
            img[y0 + 1, x] = HD
            img[y0 + 2, x] = HD
    for g in glints:
        img[y0 + 1, g] = HW
    return img


def hose_corner(img):
    """from the right edge to the bottom edge (the original's corner tile)"""
    for y in range(16):
        for x in range(16):
            r = math.hypot(x + 0.5 - 16, y + 0.5 - 16)
            if 4.6 <= r < 11.4:
                t = r - 4.6
                c = HO if t < 1.0 or t >= 5.8 else HD if t < 2.9 else HL
                img[y, x] = c
    img[9, 9] = HW
    img[8, 10] = HW
    return img


def arc_bloom(f):
    """the petal bloom following the corner's arc (radius 8 around the cell's corner)"""
    img = blank(16, 16)
    w = objects.BAND[f]
    own = np.zeros((16, 16), np.int32)
    if f >= 1:
        for k in range(-1, 6):
            ang = k * (math.pi / 2) / 4 + (math.pi / 16 if f == 4 else 0)
            for side in (-1, 1):
                rr = 8.0 + side * (w + objects.PET_OUT[f] - 0.6)
                a2 = ang + (math.pi / 16 if side > 0 else 0)
                cx, cy = 16 - rr * math.cos(a2), 16 - rr * math.sin(a2)
                ax, ay = -math.cos(a2) * side, -math.sin(a2) * side
                objects._petal_field(img, own, cx, cy, ax, ay, objects.PET_R[f], objects.PET_R[f] * 0.78, f)
    for y in range(16):
        for x in range(16):
            r = math.hypot(x + 0.5 - 16, y + 0.5 - 16)
            d = abs(r - 8.0)
            if d <= w:
                img[y, x] = objects._band_col(d, w, x, y, f)
    return objects._sparkle(img, f, 77)


BURN = [0, 1, 2, 4, 3, 2, 1, 0]           # the bloom's size over the 8 burning frames


def track_flame(ctx, x, terr):
    t = x['entries'][0] & 0xFF
    base = soil()
    if 0x60 <= t <= 0x6E or 0x80 <= t <= 0x8E:
        k = (t & 0x0F) // 2
        vert = t >= 0x80
        img = base.copy()
        if k <= 4:
            hose_h(img)
        if k < 7:
            over(img, objects.bloom('arm_h', BURN[k]))
        else:
            for (px, py) in ((3, 7), (9, 8), (13, 6)):
                img[py, px] = PINK
        return img.T.copy() if vert else img
    if t in (0xA0, 0xA2, 0xA4, 0xA6):
        img = hose_h(base.copy(), glints=())
        sx = 4 if t in (0xA0, 0xA4) else 10
        for (dx, dy, c) in ((0, 0, GOLD_4), (1, 0, WHITE), (0, 1, GOLD_2), (1, 1, GOLD_4), (-1, 0, GOLD_2), (2, 1, GOLD_2)):
            img[6 + dy, sx + dx] = c
        return img.T.copy() if t >= 0xA4 else img
    if 0xA8 <= t <= 0xC6:
        k = [0xA8, 0xAA, 0xAC, 0xAE, 0xC0, 0xC2, 0xC4, 0xC6].index(t)
        img = base.copy()
        if k <= 4:
            hose_corner(img)
        if k < 7:
            over(img, arc_bloom(BURN[k]))
        return img
    if t in (0xC8, 0xCA):
        img = hose_corner(base.copy())
        cx, cy = (6, 12) if t == 0xC8 else (12, 6)
        for (dx, dy, c) in ((0, 0, WHITE), (1, 0, GOLD_4), (0, 1, GOLD_4), (1, 1, GOLD_2)):
            img[cy + dy, cx + dx] = c
        return img
    return None


def fence(role):
    """a wooden picket fence: the top fence shows its face, the others their top rail"""
    img = blank(16, 16)
    if role in ('top', 'tl', 'tr'):
        for y in range(16):
            for x in range(16):
                px = x % 8
                if px in (1, 2, 3, 4, 5):
                    c = SOIL_4 if px == 1 else SOIL_3 if px < 5 else SOIL_2
                    if y < 2 and px in (1, 5):
                        c = T
                    img[y, x] = c
                if y in (4, 5, 11, 12):
                    img[y, x] = SOIL_3 if y in (4, 11) else SOIL_2
        img[15, :] = INK_BROWN
        img = outline(img, INK_BROWN)
        base = blank(16, 16, SOIL_2)
        return over(base, img)
    img = blank(16, 16, SOIL_2)
    horiz = role in ('bottom', 'bl', 'br')
    for y in range(16):
        for x in range(16):
            a, b = (y, x) if horiz else (x, y)
            if 5 <= a <= 10:
                c = SOIL_4 if a == 5 else SOIL_3 if a < 9 else SOIL_2
                if a in (5, 10):
                    c = INK_BROWN if a == 10 else SOIL_4
                img[y, x] = c
            if b % 16 in (6, 7, 8, 9) and 4 <= a <= 11:    # a post top
                img[y, x] = SOIL_4 if (b % 16 == 6 or a == 4) else SOIL_3 if a < 11 else INK
    if role in ('tl', 'tr', 'bl', 'br'):
        pass
    return img


def terrain(ctx):
    a = {}
    fl = soil()
    a['floor_0'] = fl
    a['floor_1'] = shadow_top(fl, [SOIL_4, SOIL_3, SOIL_2], [SOIL_3, SOIL_2, SOIL_2], rows=5)
    lav = clump_bush([LILAC_0, LILAC_1, LILAC_2, LILAC_3], INK_BROWN)
    # lavender spikes: little vertical flower stems above the bush clumps
    for (x, y) in ((4, 2), (8, 1), (12, 2), (6, 5), (10, 5)):
        lav[y, x] = LILAC_3
        lav[y + 1, x] = LILAC_2
    a['soft_block_0'] = over(fl.copy(), lav)
    pot = grid("""
.....g.gg.g.....
.oooooooooooooo.
o4ssssssssssss3o
o44444444444443o
o33333333333332o
.oooooooooooooo.
.o433333333322o.
.o433333333322o.
.o433333333322o.
..o4333333322o..
..o4333333322o..
..o3333333322o..
..o3333333322o..
...o33333322o...
...oooooooooo...
................
""", {'o': INK_BROWN, '4': TERRA_4, '3': TERRA_2, '2': TERRA_1, 's': SOIL_2, 'g': LEAF_2})
    a['hard_block_0'] = over(fl.copy(), pot)
    slab = remap(pot, [LEAF_3, LEAF_2], [SOIL_2, SOIL_2])
    blk = blank(16, 16, TERRA_2)
    blk[0:4, :] = TERRA_4
    blk[:, 13:] = TERRA_1
    blk[12:, :] = TERRA_1
    blk = outline(blk[1:15, 1:15], INK_BROWN)
    pb = fl.copy()
    over(pb, blk, 0, 0)
    a['pressure_block'] = pb
    # the hose ring pieces (palettes 1..4)
    a['gimmick_0e_0'] = a['gimmick_0e_3'] = a['gimmick_0e_6'] = a['gimmick_0e_9'] = hose_corner(fl.copy())
    v = hose_h(fl.copy()).T.copy()
    h = hose_h(fl.copy())
    for n, x in (('gimmick_0e_1', v), ('gimmick_0e_4', v), ('gimmick_0e_7', v), ('gimmick_0e_10', v),
                 ('gimmick_0e_2', h), ('gimmick_0e_5', h), ('gimmick_0e_8', h), ('gimmick_0e_11', h)):
        a[n] = x
    for n in ring_names(ctx):
        role, _ = role_of(ctx, n)
        if role in ('border_l', 'border_r'):
            g = speckle(16, 16, SOIL_2, [(SOIL_3, 1), (LEAF_2, 1)], seed=hash2(len(n), 9), density=0.2)
            a[n] = g
        else:
            a[n] = fence(role)
    return a
