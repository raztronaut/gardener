"""Stage 2 — the FROST GARDEN: a frozen pond (slippery ice, dark holes in the ice), holly
bushes capped with snow and red berries (soft), snowy boulders (hard), a ring of snowbanks
with wooden fence posts."""
from common import *  # noqa: F401,F403
import math

NAME = 'Frost Garden'
FLOOR = 'gimmick_07_0'


def ice(seed=0, dark=None):
    """an ice tile: pale ice, two frost streaks, a soft bevel; dark = connections of a
    darker 'shadowed ice' puddle: set of 'l', 'r', 't', 'b' (or None)"""
    img = blank(16, 16, ICE_2)
    for y in range(16):
        for x in range(16):
            if x == 15 or y == 15:
                img[y, x] = ICE_1
            elif x == 0 or y == 0:
                img[y, x] = ICE_3
    # frost streaks (diagonal, lit)
    for k in range(5):
        img[3 + k, 3 + k] = ICE_3
        img[3 + k, 4 + k] = WHITE if k < 2 else ICE_3
    for k in range(3):
        img[9 + k, 4 + k] = ICE_3
    img[11, 12] = ICE_3
    img[12, 12] = ICE_3
    if dark is not None:
        m = np.zeros((16, 16), bool)
        for y in range(4, 12):
            for x in range(4, 12):
                m[y, x] = True
        for (x, y) in ((4, 4), (11, 4), (4, 11), (11, 11)):
            m[y, x] = False
        if 'l' in dark:
            m[5:11, 0:4] = True
        if 'r' in dark:
            m[5:11, 12:16] = True
        if 't' in dark:
            m[0:4, 5:11] = True
        if 'b' in dark:
            m[12:16, 5:11] = True
        for y in range(16):
            for x in range(16):
                if m[y, x]:
                    edge = any(not (0 <= y + dy < 16 and 0 <= x + dx < 16) or not m[y + dy, x + dx]
                               for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                    inner_edge = edge and 0 < x < 15 and 0 < y < 15
                    img[y, x] = ICE_1 if not inner_edge else ICE_0
        # a lit lower-right rim on the puddle
        for y in range(1, 15):
            for x in range(1, 15):
                if m[y, x] and not m[y + 1, x] and img[y + 1, x] != ICE_0:
                    img[y + 1, x] = ICE_3
    return img


def hole():
    """a dark hole in the ice: open water inside a rim of ice and snow"""
    img = ice()
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d < 5.2:
                img[y, x] = WATER_0
            elif d < 6.2:
                img[y, x] = WATER_1 if y > 7 else ICE_0
            elif d < 7.4:
                img[y, x] = WHITE if y < 8 else ICE_3
    for (x, y) in ((6, 6), (7, 6), (9, 9)):
        img[y, x] = WATER_1
    return img


def snow_top(seed=0):
    """snow seen from above: white drifts with pale-ice hollows and a few holly sprigs"""
    img = blank(16, 16, WHITE)
    for y in range(16):
        for x in range(16):
            v = math.sin((x + seed) * 0.7) + math.cos(y * 0.9 + seed)
            if v > 1.2:
                img[y, x] = ICE_3
            elif v < -1.5:
                img[y, x] = ICE_2
    r = Rng(seed)
    for _ in range(2):
        x, y = 2 + r.rand(11), 2 + r.rand(11)
        img[y, x] = LEAF_1
        img[y, x + 1] = LEAF_0
        img[y - 1, x + 1] = RED
    return img


def snow_ring(role, post=False, tuft=False):
    """a hedge under snow: the top wall shows its snowy cap over the dark hedge face; the
    others its snowed-in top with the green showing at the arena-side edge"""
    img = snow_top(hash2(len(role), 5) % 7)
    face = foliage_tile([LEAF_0, LEAF_0, LEAF_1, LEAF_2], seed=41, n=8)
    if role in ('top', 'tl', 'tr'):
        for y in range(16):
            for x in range(16):
                lip = 6 + (1 if (x // 3) % 2 else 0)
                if y >= lip:
                    img[y, x] = face[y, x]
                if y == lip and x % 5 == 2:
                    img[y + 1, x] = WHITE           # snow drips
        img[14, :] = INK
        img[15, :] = ICE_1
    if role in ('bottom', 'bl', 'br'):
        img[0, :] = INK
        for x in range(16):
            img[1, x] = LEAF_0 if x % 3 else LEAF_1
            img[2, x] = ICE_2
    if role in ('left', 'tl', 'bl'):
        for y in range(16 if role == 'left' else (6 if role == 'tl' else 16)):
            if role == 'bl' and y < 2:
                continue
            img[y, 15] = INK
            img[y, 14] = LEAF_0 if y % 3 else LEAF_1
            img[y, 13] = ICE_2
    if role in ('right', 'tr', 'br'):
        for y in range(16 if role == 'right' else (6 if role == 'tr' else 16)):
            if role == 'br' and y < 2:
                continue
            img[y, 0] = INK
            img[y, 1] = LEAF_0 if y % 3 else LEAF_1
            img[y, 2] = ICE_2
    # a low wooden fence along the arena side of the snowbank
    def rail_v(x):
        for y in range(16):
            img[y, x] = WOOD_1
            if y % 8 in (1, 2):
                img[y, x - 1] = WOOD_2
                img[y, x] = WOOD_2
                if y % 8 == 1:
                    img[y - 1 if y else y, x - 1] = WHITE
    def rail_h(y):
        for x in range(16):
            img[y, x] = WOOD_1
            if x % 8 in (3, 4):
                img[y - 1, x] = WOOD_2
                img[y, x] = WOOD_2
                img[y - 2, x] = WHITE
    if role == 'left':
        rail_v(11)
    if role == 'right':
        rail_v(5)
    if role == 'bottom':
        rail_h(5)
    if post:
        px = 6
        for y in range(2, 14):
            for x in range(px, px + 4):
                img[y, x] = WOOD_2 if x < px + 2 else WOOD_1
            img[y, px - 1] = INK
            img[y, px + 4] = INK
        for x in range(px - 1, px + 5):
            img[1, x] = WHITE
            img[2, x] = WHITE if x in (px, px + 1, px + 2) else ICE_3
        img[0, px:px + 3] = WHITE
        img[14, px - 1:px + 5] = INK
        img[6, px + 1] = WOOD_3
        img[10, px + 2] = WOOD_3
    if tuft:
        for (x, y, c) in ((5, 6, LEAF_1), (6, 5, LEAF_2), (7, 5, LEAF_2), (8, 6, LEAF_1), (6, 6, LEAF_2), (7, 6, LEAF_1),
                          (5, 7, LEAF_0), (6, 7, LEAF_1), (7, 7, LEAF_1), (8, 7, LEAF_0), (6, 4, WHITE), (7, 4, WHITE), (9, 6, RED), (9, 5, RED_D)):
            img[y, x] = c
    return img


def terrain(ctx):
    a = {}
    a['gimmick_07_0'] = ice()
    for n, d in (('gimmick_08_0', 'rb'), ('gimmick_08_1', 'lb'), ('gimmick_08_2', 'tr'), ('gimmick_08_3', 'tl'),
                 ('gimmick_08_4', 'tb'), ('gimmick_08_5', 'lr'), ('gimmick_0a_0', 'tblr')):
        a[n] = ice(dark=set(d))
    a['gimmick_49_0'] = hole()
    base = ice()
    # holly under snow: dark leaves, white caps on the upper clumps, red berries
    bush = clump_bush([LEAF_0, LEAF_1, LEAF_2, LEAF_3], INK, flowers=[(RED, RED_D)],
                      flower_spots=[(5, 7), (11, 8), (8, 12), (3, 12), (13, 12)])
    for y in range(16):
        for x in range(16):
            if bush[y, x] in (LEAF_2, LEAF_3) and y < 6:
                bush[y, x] = WHITE if (y < 4 or (x + y) % 2) else ICE_3
    a['soft_block_0'] = over(base.copy(), bush)
    # a snowy boulder
    boulder = blank(16, 16)
    for y in range(16):
        for x in range(16):
            dx, dy = (x - 7.5) / 7.6, (y - 8.5) / 7.2
            if dx * dx + dy * dy > 1:
                continue
            lum = -(dx * 0.7 + dy * 0.8)
            boulder[y, x] = STONE_3 if lum > 0.3 else STONE_2 if lum > -0.3 else STONE_1
            if dy < -0.35 + 0.15 * math.sin(x * 1.3):
                boulder[y, x] = WHITE if dy < -0.6 else ICE_3
    boulder = outline(boulder, INK)
    a['hard_block_0'] = over(base.copy(), boulder)
    # sudden death: a block of pond ice
    blk = blank(16, 16, ICE_1)
    for y in range(16):
        for x in range(16):
            if y < 5:
                blk[y, x] = ICE_3 if y > 0 else WHITE
            elif x > 12:
                blk[y, x] = ICE_0
            elif (x - y) % 7 == 0 and y > 6:
                blk[y, x] = ICE_2
    blk[0, :] = INK
    blk[15, :] = INK
    blk[:, 0] = INK
    blk[:, 15] = INK
    a['pressure_block'] = over(base.copy(), blk)
    # the ring
    posts = {'wall_8', 'wall_16', 'wall_6'}
    tufts = {'wall_9', 'wall_12'}
    for n in ring_names(ctx):
        role, _ = role_of(ctx, n)
        if role in ('border_l', 'border_r'):
            g = speckle(16, 16, ICE_3, [(WHITE, 3), (ICE_2, 1)], seed=hash2(len(n), 3), density=0.25)
            a[n] = g
        else:
            a[n] = snow_ring(role, post=n in posts, tuft=n in tufts)
    return a
