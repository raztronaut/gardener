"""Stage 10 — the FOREST GARDEN: soft grass and clover, red toadstools that grow back
(soft, with the original's 4 regrowth frames), mossy boulders (hard), a forest edge of
ferns, tree trunks and rocks."""
from common import *  # noqa: F401,F403
import math

NAME = 'Forest Garden'


def grass(seed=0, clover=False):
    img = blank(16, 16, LEAF_3)
    for y in range(16):
        for x in range(16):
            h = hash2(x, y, seed)
            if h % 9 == 0:
                img[y, x] = LEAF_4
                if y > 0:
                    img[y - 1, x] = LEAF_4 if h % 2 else img[y - 1, x]
            elif h % 13 == 1:
                img[y, x] = LEAF_2
    if clover:
        for (cx, cy, c) in ((4, 4, WHITE), (11, 10, PINK), (12, 3, WHITE)):
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                img[cy + dy, cx + dx] = c
            img[cy, cx] = GOLD_3 if False else LEAF_4
    return img


def toadstool(base, size=1.0, spots=True):
    """a red toadstool with white spots on a cream stem; size 0..1 grows it"""
    img = base.copy()
    capw, caph = 7.4 * size, 5.2 * size
    cy = 13 - 8 * size
    stem_top = cy + caph * 0.5
    for y in range(16):
        for x in range(16):
            dx, dy = (x + 0.5 - 8) / max(0.5, capw), (y + 0.5 - cy) / max(0.5, caph)
            if dy <= 0.35 and dx * dx + dy * dy <= 1:
                lum = -(dx * 0.6 + dy * 0.9)
                img[y, x] = RED if lum > -0.2 else RED_D
                if dy > 0.15:
                    img[y, x] = CREAM if abs(dx) < 0.85 else RED_D
            elif stem_top <= y + 0.5 <= 14.5 and abs(x + 0.5 - 8) <= 2.4 * size + 0.5:
                img[y, x] = CREAM if x < 8 else SAND_2
    if spots and size > 0.6:
        for (sx, sy) in ((-3, -2), (1, -3), (3, -1), (-1, -1)):
            x, y = int(8 + sx * size), int(cy + sy * size)
            if 0 <= x < 15 and 0 <= y < 15 and img[y, x] in (RED, RED_D):
                img[y, x] = WHITE
                if img[y, x + 1] in (RED, RED_D):
                    img[y, x + 1] = WHITE
    # outline the toadstool
    m = np.zeros((16, 16), bool)
    for y in range(16):
        for x in range(16):
            m[y, x] = img[y, x] != base[y, x]
    for y in range(16):
        for x in range(16):
            if not m[y, x]:
                for ddx, ddy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    xx, yy = x + ddx, y + ddy
                    if 0 <= xx < 16 and 0 <= yy < 16 and m[yy, xx]:
                        img[y, x] = INK
                        break
    return img


def boulder(base):
    b = blank(16, 16)
    for y in range(16):
        for x in range(16):
            dx, dy = (x - 7.5) / 7.6, (y - 8.4) / 7.0
            if dx * dx + dy * dy > 1:
                continue
            lum = -(dx * 0.7 + dy * 0.8)
            b[y, x] = STONE_3 if lum > 0.35 else STONE_2 if lum > -0.3 else STONE_1
            if dy < -0.45 + 0.18 * math.sin(x * 1.1):
                b[y, x] = MOSS if dy > -0.75 else LEAF_4
    for (x, y) in ((6, 9), (7, 10), (10, 7)):
        b[y, x] = STONE_1
    return over(base.copy(), outline(b, INK))


def forest_edge(n, role):
    """dense ferns; a tree trunk on some cells, a rock on others"""
    img = foliage_tile([LEAF_0, LEAF_1, LEAF_2, LEAF_3], seed=hash2(len(n), ord(n[-1])), n=8)
    k = hash2(len(n), ord(n[-1]), 3) % 4
    if k == 0:
        # a tree trunk
        for y in range(16):
            for x in range(5, 11):
                img[y, x] = WOOD_2 if x < 8 else WOOD_1
            img[y, 4] = INK
            img[y, 11] = INK
        for y in (3, 9, 13):
            img[y, 6] = WOOD_1
    elif k == 1:
        for y in range(6, 15):
            for x in range(3, 13):
                d = ((x - 7.5) / 5) ** 2 + ((y - 10) / 4.5) ** 2
                if d <= 1:
                    img[y, x] = STONE_2 if d > 0.5 or x > 8 else STONE_3
        img = img
    return img


def terrain(ctx):
    a = {}
    g = grass(3)
    a['floor_0'] = g
    a['floor_1'] = shadow_top(g, [LEAF_4, LEAF_3, LEAF_2], [LEAF_3, LEAF_2, LEAF_2], rows=5)
    a['floor_2'] = grass(5, clover=True)
    a['hard_block_0'] = boulder(g)
    a['soft_block_0'] = toadstool(g, 1.0)
    for k, sz in enumerate((0.35, 0.55, 0.75, 0.9)):
        a['soft_regrow_%d' % k] = toadstool(g, sz, spots=k >= 2)
    blk = blank(14, 14, STONE_2)
    blk[0:4, :] = STONE_3
    blk[:, 11:] = STONE_1
    blk[10:, :] = STONE_1
    pb = g.copy()
    over(pb, outline(blk, INK), 0, 0)
    a['pressure_block'] = pb
    for n in ring_names(ctx):
        role, _ = role_of(ctx, n)
        a[n] = forest_edge(n, role)
    return a
