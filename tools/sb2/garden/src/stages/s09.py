"""Stage 9 — the VERTICAL FARM: a greenhouse floor of pale tiles, hydroponic lettuce trays
(soft), steel planter racks under grow lights (hard), the greenhouse's steel-and-glass
frame; the original's arrow panels are LED arrows whose lights chase toward the tip (the
original's palette cycle: 5 colours turning)."""
from common import *  # noqa: F401,F403
import math

NAME = 'Vertical Farm'

CHASE = [TEAL_D, TEAL, MINT, LEAF_5, WHITE]      # phase-0 colours, band 0 (tail) .. 4 (tip)


def tiles():
    img = blank(16, 16, STONE_4)
    for y in range(16):
        for x in range(16):
            if x % 8 == 7 or y % 8 == 7:
                img[y, x] = STONE_3
            elif x % 8 == 0 or y % 8 == 0:
                img[y, x] = STONE_5
    return img


def arrow(direction, base):
    """an LED arrow panel; direction 'r' 'l' 'u' 'd'"""
    img = base.copy()
    for y in range(1, 15):
        for x in range(1, 15):
            img[y, x] = SLATE_0
    for i in range(1, 15):
        img[1, i] = SLATE_1
        img[i, 1] = SLATE_1
        img[14, i] = INK
        img[i, 14] = INK
    shape = blank(16, 16)
    for y in range(16):
        for x in range(16):
            inside = (3 <= x <= 8 and 6 <= y <= 9) or (8 <= x <= 13 and abs(y - 7.5) <= (13 - x) * 0.85 + 0.6)
            if inside:
                pos = (x - 3) / 10.0 * 5
                shape[y, x] = CHASE[max(0, min(4, int(pos)))]
    if direction == 'l':
        shape = shape[:, ::-1]
    elif direction == 'd':
        shape = shape.T.copy()
    elif direction == 'u':
        shape = shape.T.copy()[::-1, :]
    return over(img, shape)


def rack(base):
    r = grid("""
.oooooooooooooo.
o23333333333332o
o2pppppppppppp2o
o21111111111112o
o2gGgGgGgGgGg12o
o2GgGgGgGgGgG12o
o2oooooooooooo2o
o23333333333332o
o2pppppppppppp2o
o21111111111112o
o2gGgGgGgGgGg12o
o2GgGgGgGgGgG12o
o2oooooooooooo2o
o23333333333332o
o22222222222222o
.oooooooooooooo.
""", {'o': INK, '3': SLATE_2, '2': SLATE_1, '1': SLATE_0, 'p': CHASE[1], 'g': LEAF_4, 'G': SLATE_2})
    return over(base.copy(), r)


def tray(base):
    t = grid("""
................
.oooooooooooooo.
o55555555555554o
o5o4o44o4o44o44o
o5gGlgGlgGlgGl4o
ogGlgGlgGlgGlgGo
oGlgGlgGlgGlgGlo
ogGlgGlgGlgGlgGo
oGlgGlgGlgGlgGlo
ogGlgGlgGlgGlgGo
o4lgGlgGlgGlgG3o
o44444444444433o
o33333333333332o
.oooooooooooooo.
..oo........oo..
................
""", {'o': INK, '5': STONE_5, '4': STONE_4, '3': STONE_3, '2': SLATE_1, 'g': LEAF_4, 'G': LEAF_2, 'l': LEAF_3})
    return over(base.copy(), t)


def frame(role):
    """the greenhouse frame: steel beams, glass panes, a grow-light strip"""
    img = blank(16, 16, ICE_2)
    for y in range(16):
        for x in range(16):
            if (x + y) % 9 == 0:
                img[y, x] = ICE_1
            if x % 8 == 3 or y % 8 == 3:
                img[y, x] = SLATE_1
            if x % 8 == 4 or y % 8 == 4:
                img[y, x] = SLATE_2
    if role in ('top', 'tl', 'tr'):
        img[12, :] = SLATE_0
        img[13, :] = CHASE[2]
        img[14, :] = SLATE_0
        img[15, :] = INK
    if role in ('bottom', 'bl', 'br'):
        img[0, :] = INK
        img[1, :] = SLATE_0
    if role in ('left', 'tl', 'bl'):
        img[:, 15] = INK
        img[:, 14] = SLATE_0
    if role in ('right', 'tr', 'br'):
        img[:, 0] = INK
        img[:, 1] = SLATE_0
    return img


def terrain(ctx):
    a = {}
    t = tiles()
    a['floor_0'] = t
    a['floor_1'] = shadow_top(t, [STONE_5, STONE_4, STONE_3], [STONE_4, STONE_3, STONE_3], rows=5)
    for n, d in (('gimmick_3e_0', 'r'), ('gimmick_3f_0', 'l'), ('gimmick_3d_0', 'd'), ('gimmick_3c_0', 'u'),
                 ('gimmick_3f_1', 'l'), ('gimmick_3d_1', 'd')):
        a[n] = arrow(d, t)
    a['hard_block_0'] = rack(t)
    a['soft_block_0'] = tray(t)
    blk = blank(14, 14, SLATE_1)
    blk[0:4, :] = SLATE_2
    blk[:, 11:] = SLATE_0
    blk[10:, :] = SLATE_0
    pb = t.copy()
    over(pb, outline(blk, INK), 0, 0)
    a['pressure_block'] = pb
    for n in ring_names(ctx):
        role, _ = role_of(ctx, n)
        a[n] = frame(role) if role not in ('border_l', 'border_r') else frame('inner')
    a['__cycles__'] = {6: {'colours': CHASE, 'rom': 0xDB7E, 'phases': 4}}
    return a
