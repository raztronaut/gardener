"""Stage 6 — the ROSE GARDEN: warm herringbone brick paving, rose bushes (soft), white stone
urns (hard), a white trellis with climbing roses; the original's teleport pads are a blue
birdbath (its water ripples) and a ring of rose petals (it turns)."""
from common import *  # noqa: F401,F403
import math

NAME = 'Rose Garden'


def paving():
    img = blank(16, 16, TERRA_4)
    for y in range(16):
        for x in range(16):
            # herringbone: 2x4 bricks alternating direction
            bx, by = x // 4, y // 4
            u, v = x % 4, y % 4
            if (bx + by) % 2 == 0:
                edge = v == 3 or (u == 3 and v < 2)
            else:
                edge = u == 3 or (v == 3 and u < 2)
            if edge:
                img[y, x] = TERRA_3
            elif (u == 0 and (bx + by) % 2) or (v == 0 and (bx + by) % 2 == 0):
                img[y, x] = PINK_L
    return img


def birdbath(frame):
    img = paving()
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d <= 7.4:
                img[y, x] = STONE_4 if d > 6.2 else (STONE_3 if d > 5.6 else WATER_2)
                if d > 6.9:
                    img[y, x] = STONE_2
            if d <= 5.6:
                # ripples: rings moving outward with the frame
                r = (d - frame * 1.4) % 4.2
                img[y, x] = WATER_4 if r < 0.9 else WATER_3 if r < 2.2 else WATER_2
    img[5, 5] = WHITE
    return img


def petal_ring(frame):
    img = paving()
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d <= 7.4:
                img[y, x] = STONE_4 if d > 6.2 else STONE_3 if d > 5.6 else STONE_2
                if d > 6.9:
                    img[y, x] = STONE_2
    # 6 petals turning around the centre
    for k in range(6):
        ang = (k / 6.0) * 2 * math.pi + frame * (math.pi / 12)
        cx, cy = 7.5 + 3.3 * math.cos(ang), 7.5 + 3.3 * math.sin(ang)
        for y in range(16):
            for x in range(16):
                if math.hypot(x - cx, y - cy) <= 1.6:
                    img[y, x] = RED if (x - cx) + (y - cy) > 0 else PINK
    for (x, y) in ((7, 7), (8, 7), (7, 8), (8, 8)):
        img[y, x] = GOLD_3
    return img


def urn(base):
    """a white stone pedestal with a ball finial (the rose garden's hard block)"""
    u = grid("""
......oooo......
.....o4443o.....
....o444433o....
....o443333o....
.....o3332o.....
...oooooooooo...
..o4444444443o..
.oooooooooooooo.
.o443333333322o.
.o433333333322o.
.o433333333322o.
.o433333333322o.
.o432222222222o.
oo444444444443oo
o33333333333332o
oooooooooooooooo
""", {'o': INK, '4': WHITE, '3': STONE_4, '2': STONE_3})
    # a climbing rose on the pedestal
    for (x, y, c) in ((3, 9, LEAF_2), (3, 10, LEAF_3), (4, 11, LEAF_2), (3, 12, LEAF_3), (4, 9, RED), (4, 8, RED_D)):
        u[y, x] = c
    return over(base.copy(), u)


def trellis(role):
    """a white trellis with a climbing rose: lattice over foliage"""
    fol = foliage_tile([LEAF_0, LEAF_1, LEAF_2, LEAF_3], seed=hash2(len(role), 1))
    img = fol.copy()
    for y in range(16):
        for x in range(16):
            if (x + y) % 8 == 0 or (x - y) % 8 == 0:
                img[y, x] = WHITE
    # roses on the trellis
    for (x, y) in ((4, 3), (11, 9)):
        for (dx, dy, c) in ((0, 0, RED), (1, 0, RED_D), (0, 1, RED_D), (1, 1, RED), (-1, 0, PINK), (0, -1, PINK)):
            img[y + dy, x + dx] = c
    if role in ('top', 'tl', 'tr'):
        img[14, :] = INK
        img[15, :] = STONE_3
    if role in ('bottom', 'bl', 'br'):
        img[0, :] = INK
    if role in ('left', 'tl', 'bl'):
        img[:, 15] = INK
    if role in ('right', 'tr', 'br'):
        img[:, 0] = INK
    return img


def terrain(ctx):
    a = {}
    p = paving()
    a['floor_0'] = p
    a['floor_1'] = shadow_top(p, [PINK_L, TERRA_4, TERRA_3], [TERRA_4, TERRA_3, TERRA_3], rows=5)
    a['gimmick_50_0'] = petal_ring(0)
    a['gimmick_50_1'] = birdbath(0)
    a['__anims__'] = [
        {'tile': 0x46, 'pal': 6, 'frames': [(k * 2, birdbath(k)) for k in range(4)]},
        {'tile': 0x2A, 'pal': 6, 'frames': [(8 + k * 2, petal_ring(k)) for k in range(4)]},
    ]
    rose = clump_bush([LEAF_1, LEAF_2, LEAF_3, LEAF_4], INK)
    for (fx, fy) in ((4, 4), (11, 3), (8, 8), (3, 11), (12, 10), (7, 13)):
        for (dx, dy, c) in ((0, 0, RED), (1, 0, RED_D), (0, 1, RED_D), (1, 1, RED), (-1, 0, PINK), (0, -1, PINK), (1, -1, RED), (-1, 1, RED_D)):
            if 0 <= fx + dx < 16 and 0 <= fy + dy < 16 and rose[fy + dy, fx + dx] not in (INK, -1):
                rose[fy + dy, fx + dx] = c
    a['soft_block_0'] = over(p.copy(), rose)
    a['hard_block_0'] = urn(p)
    blk = blank(14, 14, STONE_4)
    blk[0:4, :] = WHITE
    blk[:, 11:] = STONE_3
    blk[10:, :] = STONE_3
    pb = p.copy()
    over(pb, outline(blk, INK), 0, 0)
    a['pressure_block'] = pb
    for n in ring_names(ctx):
        role, _ = role_of(ctx, n)
        a[n] = trellis(role) if role not in ('border_l', 'border_r') else foliage_tile([LEAF_0, LEAF_1, LEAF_2, LEAF_3], seed=7)
    return a
