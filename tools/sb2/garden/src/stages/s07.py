"""Stage 7 — the HEDGE MAZE: gravel paths and lawn lanes between clipped topiary cubes
(hard), white hydrangea shrubs (soft), tall hedge walls edged with a flower border; the
original's numbered pads are wooden garden signs 1..5 and a sunflower sign for "!"."""
from common import *  # noqa: F401,F403
import math

NAME = 'Hedge Maze'


def gravel(seed=0, tone=0):
    base = [STONE_3, SAND_1][tone]
    hi = [STONE_4, SAND_2][tone]
    lo = [STONE_2, SAND_0][tone]
    img = speckle(16, 16, base, [(hi, 3), (lo, 2)], seed=seed, density=0.22)
    return img


def lawn():
    img = blank(16, 16, LEAF_3)
    for y in range(16):
        for x in range(16):
            if (x // 4) % 2 == 0:
                img[y, x] = LEAF_4 if (y + x) % 5 else LEAF_3
            elif hash2(x, y, 2) % 7 == 0:
                img[y, x] = LEAF_4
    return img


def topiary(base):
    """a crisply clipped hedge cube: lit top face, darker sides"""
    img = base.copy()
    fol_top = foliage_tile([LEAF_1, LEAF_2, LEAF_3, LEAF_4], seed=21, n=9, rmin=1.8, rmax=2.8)
    fol_side = foliage_tile([LEAF_0, LEAF_0, LEAF_1, LEAF_2], seed=22, n=9, rmin=1.8, rmax=2.8)
    for y in range(1, 15):
        for x in range(1, 15):
            img[y, x] = fol_top[y, x] if y < 9 else fol_side[y, x]
    for x in range(1, 15):
        img[9, x] = LEAF_0
    img[1:15, 0] = INK
    img[1:15, 15] = INK
    img[0, 1:15] = INK
    img[15, 1:15] = INK
    return img


def sign(n, base):
    """a wooden garden sign with a number (or a sunflower)"""
    img = base.copy()
    for y in range(1, 15):
        for x in range(1, 15):
            d = math.hypot(x - 7.5, y - 7.5)
            if d <= 6.9:
                img[y, x] = WOOD_2 if d < 5.9 else WOOD_1
                if d >= 6.3:
                    img[y, x] = INK
    digits = {
        1: ["..#..", ".##..", "..#..", "..#..", "..#..", ".###."],
        2: [".##..", "#..#.", "...#.", "..#..", ".#...", "####."],
        3: ["###..", "...#.", ".##..", "...#.", "...#.", "###.."],
        4: ["..##.", ".#.#.", "#..#.", "####.", "...#.", "...#."],
        5: ["####.", "#....", "###..", "...#.", "#..#.", ".##.."],
    }
    if n in digits:
        for gy, row in enumerate(digits[n]):
            for gx, c in enumerate(row):
                if c == '#':
                    img[5 + gy, 5 + gx] = WHITE
                    img[5 + gy + 1, 5 + gx + 1] = img[5 + gy + 1, 5 + gx + 1] if img[5 + gy + 1, 5 + gx + 1] == WHITE else WOOD_1
    else:
        # a sunflower: the "!" pad
        for y in range(16):
            for x in range(16):
                d = math.hypot(x - 7.5, y - 7.5)
                ang = math.atan2(y - 7.5, x - 7.5)
                if d < 2.2:
                    img[y, x] = WOOD_1
                elif d < 5.4 * (0.75 + 0.25 * abs(math.cos(4 * ang))):
                    img[y, x] = GOLD_3 if d < 4 else GOLD_2
    return img


def hedge_wall(role, edge=True):
    """tall clipped hedge walls with a white-and-pink flower edging toward the paths"""
    top = foliage_tile([LEAF_1, LEAF_2, LEAF_3, LEAF_4], seed=31, n=9, rmin=2, rmax=3.2)
    side = foliage_tile([LEAF_0, LEAF_0, LEAF_1, LEAF_2], seed=32, n=9, rmin=2, rmax=3.2)
    img = top.copy()
    if role in ('top', 'tl', 'tr'):
        for y in range(8, 16):
            img[y, :] = side[y, :]
        img[8, :] = LEAF_0
        if edge:
            for x in range(16):
                img[14, x] = WHITE if x % 4 in (0, 1) else PINK
                img[15, x] = LEAF_1
    flowers = [(x, WHITE if (x // 2) % 2 else PINK) for x in range(16)]
    if role in ('bottom', 'bl', 'br') and edge:
        for x, c in flowers:
            img[1, x] = c
        img[0, :] = LEAF_0
    if role in ('left', 'tl', 'bl') and edge:
        for y in range(16):
            img[y, 14] = WHITE if (y // 2) % 2 else PINK
            img[y, 15] = LEAF_0
    if role in ('right', 'tr', 'br') and edge:
        for y in range(16):
            img[y, 1] = WHITE if (y // 2) % 2 else PINK
            img[y, 0] = LEAF_0
    return img


def terrain(ctx):
    a = {}
    g = gravel(5)
    a['floor_0'] = g
    a['floor_1'] = shadow_top(g, [STONE_4, STONE_3, STONE_2], [STONE_3, STONE_2, STONE_2], rows=5)
    a['floor_2'] = gravel(9)
    a['floor_3'] = lawn()
    a['hard_block_0'] = topiary(g)
    hyd = clump_bush([LEAF_1, LEAF_2, LEAF_3, LEAF_4], INK, flowers=[(WHITE, STONE_4)],
                     flower_spots=[(4, 4), (10, 3), (7, 7), (12, 8), (3, 10), (9, 11), (6, 13), (12, 13), (6, 2)])
    a['soft_block_0'] = over(g.copy(), hyd)
    blk = blank(14, 14, STONE_3)
    blk[0:4, :] = STONE_4
    blk[:, 11:] = STONE_2
    blk[10:, :] = STONE_2
    pb = g.copy()
    over(pb, outline(blk, INK), 0, 0)
    a['pressure_block'] = pb
    for k, n in enumerate(['gimmick_0f_0', 'gimmick_0f_1', 'gimmick_0f_2', 'gimmick_0f_3', 'gimmick_0f_4']):
        a[n] = sign(k + 1, g)
    a['gimmick_0f_5'] = sign('!', g)
    for n in ring_names(ctx):
        role, _ = role_of(ctx, n)
        a[n] = hedge_wall(role) if role not in ('border_l', 'border_r') else foliage_tile([LEAF_0, LEAF_0, LEAF_1, LEAF_2], seed=33)
    return a
