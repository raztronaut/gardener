"""Stage 5 — the ZEN GARDEN: raked gravel, round pruned azaleas (soft), granite blocks
(hard), golden sun stones (the original's power pads: a pod set on one blasts far), an
earthen wall with a grey tile roof; the original's raised plates (BG1, drawn above the
players) are slatted wooden pergolas hung with wisteria that sways (its 4 frames)."""
from common import *  # noqa: F401,F403
import math

NAME = 'Zen Garden'


def gravel():
    img = blank(16, 16, STONE_3)
    for y in range(16):
        for x in range(16):
            if y % 4 == 1:
                img[y, x] = STONE_4
            elif y % 4 == 3 and hash2(x, y, 4) % 3 == 0:
                img[y, x] = STONE_2
    return img


def sun_stone(base):
    img = base.copy()
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            ang = math.atan2(y - 7.5, x - 7.5)
            ray = 6.4 + 1.2 * max(0, math.cos(8 * ang))
            if d <= 4.2:
                img[y, x] = GOLD_3 if (x + y < 15 and d < 3.2) else GOLD_2
                if d > 3.5:
                    img[y, x] = GOLD_1
            elif d <= ray and math.cos(8 * ang) > 0.55:
                img[y, x] = GOLD_2 if d < ray - 1 else GOLD_1
    img[6, 6] = WHITE
    img[6, 7] = GOLD_3
    return img


def granite(base):
    blk = blank(16, 16)
    for y in range(16):
        for x in range(16):
            dx, dy = (x - 7.5) / 7.5, (y - 8) / 7.5
            if max(abs(dx), abs(dy)) > 1 or (abs(dx) > 0.75 and abs(dy) > 0.75 and dx * dx + dy * dy > 1.25):
                continue
            lum = -(dx * 0.7 + dy)
            blk[y, x] = STONE_3 if lum > 0.55 else STONE_2 if lum > -0.1 else STONE_1
    for (x, y) in ((4, 3), (5, 3), (6, 2), (3, 4), (10, 2), (11, 3)):
        blk[y, x] = MOSS
    for (x, y) in ((4, 2), (5, 2), (10, 1)):
        blk[y, x] = MOSS
    blk = outline(blk, INK)
    return over(base.copy(), blk)


def wall(role):
    """an earthen wall with a grey tile roof: the top wall shows the roof and the plaster
    face, the others the roof ridge from above"""
    img = blank(16, 16, STONE_5)
    if role in ('top', 'tl', 'tr'):
        for y in range(16):
            for x in range(16):
                if y < 7:                       # roof tiles: rows of round tile ends
                    c = STONE_3 if (x + (2 if (y // 3) % 2 else 0)) % 4 else INK
                    if y % 3 == 0:
                        c = STONE_4
                    img[y, x] = c
                elif y == 7:
                    img[y, x] = INK
                elif y < 15:
                    img[y, x] = STONE_5 if y != 8 else STONE_4
                else:
                    img[y, x] = INK
        return img
    horiz = role in ('bottom', 'bl', 'br')
    for y in range(16):
        for x in range(16):
            a = y if horiz else x
            b = x if horiz else y
            if 3 <= a <= 12:
                c = STONE_3 if (b + (2 if a % 2 else 0)) % 4 else INK
                if a in (3, 12):
                    c = INK
                if a == 7 or a == 8:
                    c = STONE_4
                img[y, x] = c
            else:
                img[y, x] = STONE_5 if (a < 3) == (role in ('bottom', 'bl', 'br', 'right', 'tr', 'br')) else STONE_4
    return img


def pergola(piece, frame=0):
    """one of the six BG1 pieces of a pergola (3 x 2 cells): l/m/r on top (0x60, 0x4c,
    0x64) and below (0x66, 0x4e, 0x6a); slats with gaps (transparent: the gardeners under
    it show through), beams, wisteria in the middle that sways"""
    img = blank(16, 16)
    col, row = piece
    for y in range(16):
        for x in range(16):
            X, Y = col * 16 + x, row * 16 + y          # in the 48 x 32 pergola
            beam = Y in (2, 3, 28, 29) or X in (2, 3, 44, 45)
            slat = (X % 6) in (0, 1, 2) and 4 <= Y <= 27
            if beam:
                img[y, x] = WOOD_2 if Y in (2, 28) or X in (2, 44) else WOOD_1
            elif slat and 4 <= X <= 43:
                img[y, x] = WOOD_2 if (X % 6) == 0 else WOOD_1 if (X % 6) == 2 else WOOD_2
    # corner posts
    for (cx, cy) in ((1, 1), (44, 1), (1, 27), (44, 27)):
        for yy in range(cy, cy + 4):
            for xx in range(cx, cx + 3):
                if col * 16 <= xx < col * 16 + 16 and row * 16 <= yy < row * 16 + 16:
                    img[yy - row * 16, xx - col * 16] = INK if xx == cx + 2 or yy == cy + 3 else WOOD_1
    # wisteria on the middle column, swaying with the frame
    if col == 1:
        sway = [0, 1, 0, -1][frame % 4]
        for k, x0 in enumerate((3, 8, 12)):
            length = 8 + (k % 2) * 3 if row == 0 else 6 + (k % 2) * 2
            for i in range(length):
                yy = (6 if row == 0 else 0) + i
                xx = x0 + (sway if i > 2 else 0) + (1 if (i % 3 == 2) else 0)
                if 0 <= xx < 16 and 0 <= yy < 16:
                    img[yy, xx] = LILAC_3 if i % 2 == 0 else LILAC_2
                    if 0 <= xx + 1 < 16 and i % 3 == 1:
                        img[yy, xx + 1] = LILAC_2
    return img


PERGOLA_TILES = {'bg1_overlay_2': (0, 0), 'bg1_overlay_0': (1, 0), 'bg1_overlay_3': (2, 0),
                 'bg1_overlay_4': (0, 1), 'bg1_overlay_1': (1, 1), 'bg1_overlay_5': (2, 1)}


def terrain(ctx):
    a = {}
    g = gravel()
    a['floor_0'] = g
    a['floor_1'] = shadow_top(g, [STONE_4, STONE_3, STONE_2], [STONE_3, STONE_2, STONE_2], rows=5)
    a['gimmick_14_0'] = sun_stone(g)
    a['hard_block_0'] = granite(g)
    a['pressure_block'] = granite(g)
    az = clump_bush([LEAF_1, LEAF_2, LEAF_3, LEAF_4], INK, flowers=[(PINK, ROSE_2), (ROSE_2, PINK)],
                    flower_spots=[(4, 4), (10, 3), (7, 7), (12, 8), (3, 10), (9, 11), (6, 13), (12, 13)])
    a['soft_block_0'] = over(g.copy(), az)
    for n, pc in PERGOLA_TILES.items():
        a[n] = pergola(pc, 0)
    # the wisteria sways: the middle pieces' 4 frames (C1340A: tile 0x4C frames 80..86,
    # 0x4E frames 88..8E)
    a['__anims__'] = [
        {'tile': 0x4C, 'pal': 6, 'frames': [(0x80 + 2 * k, pergola((1, 0), k)) for k in range(4)]},
        {'tile': 0x4E, 'pal': 6, 'frames': [(0x88 + 2 * k, pergola((1, 1), k)) for k in range(4)]},
    ]
    for n in ring_names(ctx):
        role, _ = role_of(ctx, n)
        if role in ('border_l', 'border_r'):
            a[n] = gravel()
        else:
            a[n] = wall(role)
    return a
