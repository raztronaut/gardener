"""Stage 3 — the POND GARDEN: shallow clear water over pebbles, lily pads with pink lotus
flowers (soft), mossy sandstone pillars (hard), a sandstone rim with two culverts at the
top and the bottom where the water runs under (the original's tunnels)."""
from common import *  # noqa: F401,F403
import math

NAME = 'Pond Garden'


def water(seed=0):
    img = blank(16, 16, WATER_3)
    # ripples: short light arcs, a few pebble shadows
    for (x, y) in ((2, 3), (3, 3), (4, 2), (10, 6), (11, 6), (12, 5), (5, 11), (6, 11), (7, 10), (13, 13), (14, 13)):
        img[y, x] = WATER_4
    for (x, y) in ((8, 2), (1, 8), (12, 10), (4, 14)):
        img[y, x] = WATER_2
        img[y, x + 1] = WATER_2
    return img


def lily(base):
    """a round lily pad with its notch and a pink lotus on it"""
    img = base.copy()
    for y in range(16):
        for x in range(16):
            dx, dy = x - 7.5, y - 8.0
            d = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            if d > 7.6:
                continue
            if -0.35 < ang < 0.05 and d > 1.5:       # the notch
                continue
            lum = -(dx * 0.6 + dy * 0.8) / 7.6
            c = LEAF_4 if lum > 0.35 else LEAF_3 if lum > -0.1 else LEAF_2
            if d > 6.7:
                c = INK
            # veins
            if d > 2 and d < 6.7 and abs(math.sin(ang * 4)) < 0.12:
                c = LEAF_2 if c != LEAF_2 else LEAF_1
            img[y, x] = c
    lotus = grid("""
.....p..p.....
....pPp.pPp...
...pPPpppPPp..
..pPPLPPPLPPp.
..pPLyyyyLPPp.
...pPLyyLPPp..
....ppPPPpp...
""".replace('.', '.'), {'p': ROSE_2, 'P': PINK, 'L': PINK, 'y': GOLD_3})
    over(img, lotus, 1, 3)
    return img


def sandstone(role, opening=None):
    """the pond's sandstone rim: lit blocks with mortar, a wet dark edge toward the water"""
    img = blank(16, 16, SAND_1)
    for y in range(16):
        for x in range(16):
            yy = y % 8
            sh = 4 if (y // 8) % 2 else 0
            xx = (x + sh) % 8
            if yy == 7 or xx == 7:
                img[y, x] = SAND_0
            elif yy == 0 or xx == 0:
                img[y, x] = SAND_2
            if hash2(x, y, 5) % 13 == 0 and img[y, x] == SAND_1:
                img[y, x] = SAND_2
    # moss tufts
    for (x, y) in ((3, 6), (4, 6), (11, 14), (12, 14)):
        img[y, x] = MOSS
    wet = WATER_2
    if role in ('top', 'tl', 'tr'):
        for x in range(16):
            img[14, x] = SAND_0
            img[15, x] = wet
    if role in ('bottom', 'bl', 'br'):
        for x in range(16):
            img[0, x] = wet
            img[1, x] = SAND_0
    if role in ('left', 'tl', 'bl'):
        for y in range(16):
            img[y, 14] = SAND_0
            img[y, 15] = wet
    if role in ('right', 'tr', 'br'):
        for y in range(16):
            img[y, 1] = SAND_0
            img[y, 0] = wet
    if opening:
        # the culvert's arch beside an opening: the water side darkens under the arch
        side = opening
        for y in range(16):
            for x in range(16):
                t = (x if side == 'r' else 15 - x)
                if t >= 12:
                    img[y, x] = INK_BROWN if t >= 14 else SAND_0
    return img


def terrain(ctx):
    a = {}
    w = water()
    a['floor_0'] = w
    a['floor_1'] = shadow_top(w, [WATER_4, WATER_3, WATER_2], [WATER_3, WATER_2, WATER_2], rows=5)
    a['soft_block_0'] = lily(w)
    pillar = grid("""
.oooooooooooooo.
o33333333333332o
o3mm333333mm332o
o33mm3333mmm322o
o32222222222221o
o2ooooooooooo21o
o22222222222221o
o23332223332221o
o22222222222221o
o2oooooooooooo1o
o22222222222221o
o22333222333221o
o22222222222221o
o21111111111111o
o11111111111111o
.oooooooooooooo.
""", {'o': INK_BROWN, '3': SAND_3, '2': SAND_1, '1': SAND_0, 'm': MOSS})
    a['hard_block_0'] = over(w.copy(), pillar)
    slab = remap(pillar, [MOSS, SAND_3, SAND_1, SAND_0], [SAND_3, SAND_2, SAND_1, SAND_0])
    a['pressure_block'] = over(w.copy(), slab)
    # openings: the floor cells in the top / bottom rows; walls beside them get the arch
    pos = ctx['pos']
    op = [p for p in pos.get('floor_0', []) if p[1] in (3, 29)]
    for n in ring_names(ctx):
        role, p = role_of(ctx, n)
        if role in ('border_l', 'border_r'):
            a[n] = sandstone('inner')
            continue
        opening = None
        if p and role in ('top', 'bottom'):
            if (p[0] + 1, p[1]) in op:
                opening = 'r'
            elif (p[0] - 1, p[1]) in op:
                opening = 'l'
        a[n] = sandstone(role, opening)
    return a
