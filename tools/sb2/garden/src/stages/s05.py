"""Stage 5 — the ZEN MOSS GARDEN: a deep moss carpet with fallen maple leaves, tiny ferns
and flat stepping stones; sun stones (the original's power pads: a pod set on one blasts
far) are round granite plates inlaid with a gold ring; pruned azaleas, moss cushions and
ferns (soft); rounded granite boulders (hard); clipped hedges under red Japanese maples all
round; the original's raised plates (BG1, drawn above the players) are slatted wooden
pergolas hung with wisteria that sways (its 4 frames)."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Zen Moss Garden'

M = [C('#18301a'), C('#22441f'), C('#305a26'), C('#447230'), C('#5e8a3c')]
M_SH = C('#142a14')
MAPLE = [C('#5a1418'), C('#8e2020'), C('#c23a26'), C('#e8683a'), C('#ffa060')]
FERN = [C('#173a1a'), C('#245a24'), C('#3a7c30'), C('#5aa040'), C('#8cc860')]
OUT = C('#0c1c10')
AZA = C('#f05a8a')
AZA_D = C('#b02a5a')
AZA_L = C('#ffb0c8')
ST = [C('#3a3c3e'), C('#5a5e5e'), C('#7e8280'), C('#a4a8a2'), C('#cccec6')]
GOLD = [C('#8a5a10'), C('#d09a28'), C('#ffd860')]
WOOD = [C('#5a3a20'), C('#8a5e34'), C('#b88850')]
LILAC = [C('#8a6ac8'), C('#c4a8f0')]
LEAF = [C('#3a7c30'), C('#5aa040')]
INK = C('#24160c')

SHADE = {M[4]: M[2], M[3]: M[1], M[2]: M[0], M[1]: M_SH, M[0]: M_SH}


def ground_tex():
    return TR.moss_tex(M, 505)


def decals():
    d = []
    d.append(TR.decal_leaves(1, [(MAPLE[3], MAPLE[1]), (MAPLE[4], MAPLE[2])], n=3))
    d.append(TR.decal_leaves(2, [(MAPLE[2], MAPLE[0])], n=2))
    # a flat stepping stone
    for s in (3, 4):
        im = blank(16, 16)
        m = N.blob(16, 16, 8.0, 8.5, 5.0, 3.4, lobes=4, amp=0.1, seed=s)
        lv = N.dome(m, 2.0, flat=0.3)
        im = N.shade(lv, [M[1], ST[0], ST[1], ST[2]], -1.0, 1.0, dither=0.2, mask=m)
        sh = N.shift(m, 1, 1) & ~m
        im[sh] = M_SH
        d.append(im)
    d.append(TR.decal_tuft(5, [FERN[1], FERN[2], FERN[3], FERN[4]], n=1))
    d.append(TR.decal_flowers(6, [(AZA_L, GOLD[2], AZA)], n=2, kinds=('dot',)))
    return d


def sun_stone():
    img = blank(16, 16)
    m = N.blob(16, 16, 8.0, 8.0, 7.0, 6.6, lobes=5, amp=0.04, seed=7)
    lv = N.dome(m, 3.0, flat=0.6)
    img = N.shade(lv, ST[1:5], -1.0, 1.0, dither=0.2, mask=m)
    ys, xs = np.mgrid[0:16, 0:16]
    d = np.hypot(xs + 0.5 - 8, ys + 0.5 - 8)
    ring = m & (d > 3.2) & (d < 5.0)
    img[ring] = np.where((xs[ring] + ys[ring]) < 16, GOLD[2], GOLD[1])
    img[m & (d < 1.6)] = GOLD[2]
    img[m & (d >= 1.6) & (d < 2.4)] = GOLD[0]
    img = N.selout(img, OUT, None)
    return img


def gimmicks():
    return {'gimmick_14_0': sun_stone()}


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    TR.tile_tex(cv.base, ground_tex(), allc)
    TR.scatter(cv.decal, field, decals(), 0.36, 51)
    reg = TR.rough_region(ring, 55, amp=1.4)
    TR.mass(cv.obj, reg, FERN, 56, outline=OUT, dome_r=8.0, glob=0.9, r=(1.3, 2.3))
    # red maples standing in the hedge: round crowns on the ring
    pts = TR.ring_points(ring, 30, 57, depth=9)
    TR.crowns(cv.obj2, pts, MAPLE, 58, outline=OUT, r=(8.0, 11.0))
    hard = hard_blocks()
    for (cx, cy) in pillars:
        cv.put('obj', hard[TR.cell_hash(cx, cy, 5) % len(hard)], cx * 16, cy * 16)


def hard_blocks():
    return [TR.boulder(ST, OUT, seed=1, flat=0.4), TR.boulder(ST, OUT, seed=2, lobes=5),
            TR.boulder(ST, OUT, seed=3, rx=7.2, ry=6.0), TR.boulder(ST, OUT, seed=4, lobes=3)]


def soft():
    return [
        TR.bush(FERN, OUT, seed=1, flowers=[(AZA, AZA_L, AZA_D)], nflowers=9, shadow=M_SH),
        TR.bush(FERN, OUT, seed=2, flowers=[(AZA_L, AZA, AZA)], nflowers=8, shadow=M_SH, lobes=7),
        TR.bush(FERN, OUT, seed=3, flowers=[(AZA_L, GOLD[2], AZA)], nflowers=8, shadow=M_SH, lobes=4, amp=0.05),
        TR.fern(FERN, OUT, seed=4, shadow=M_SH),
        TR.bush(FERN, OUT, seed=5, flowers=[(AZA, AZA_L, AZA_D)], nflowers=8, shadow=M_SH),
    ]


def pressure():
    return TR.boulder(ST, OUT, seed=9, rx=7.4, ry=7.2, lobes=4, amp=0.05, flat=0.6)


# ---- the pergolas (BG1, above the players) ------------------------------------------------------
PERGOLA = {0x60: (0, 0), 0x4C: (1, 0), 0x64: (2, 0), 0x66: (0, 1), 0x4E: (1, 1), 0x6A: (2, 1)}


def pergola(piece, frame=0):
    """one of the six BG1 pieces of a pergola (3 x 2 cells): slats with gaps (transparent:
    the players under it show through), beams, posts, wisteria in the middle that sways"""
    img = blank(16, 16)
    col, row = piece
    for y in range(16):
        for x in range(16):
            X, Y = col * 16 + x, row * 16 + y
            beam = Y in (2, 3, 28, 29) or X in (2, 3, 44, 45)
            slat = (X % 6) in (0, 1, 2) and 4 <= Y <= 27
            if beam:
                img[y, x] = WOOD[2] if Y in (2, 28) or X in (2, 44) else WOOD[1]
            elif slat and 4 <= X <= 43:
                img[y, x] = WOOD[2] if (X % 6) == 0 else WOOD[0] if (X % 6) == 2 else WOOD[1]
    for (cx, cy) in ((1, 1), (44, 1), (1, 27), (44, 27)):
        for yy in range(cy, cy + 4):
            for xx in range(cx, cx + 3):
                if col * 16 <= xx < col * 16 + 16 and row * 16 <= yy < row * 16 + 16:
                    img[yy - row * 16, xx - col * 16] = INK if xx == cx + 2 or yy == cy + 3 else WOOD[1]
    # wisteria vines twining over the beams and slats: leaf clusters, hanging racemes
    for y in range(16):
        for x in range(16):
            X, Y = col * 16 + x, row * 16 + y
            h = hash2(X // 2, Y // 2, 55)
            if img[y, x] >= 0 and img[y, x] != INK and h % 5 < 2:
                img[y, x] = LEAF[1] if (X + Y) % 3 else LEAF[0]
            elif img[y, x] < 0 and (h % 9 == 0) and 3 <= X <= 44 and 3 <= Y <= 28:
                img[y, x] = LEAF[0]
    sway = [0, 1, 0, -1][frame % 4] if col == 1 else 0
    for k, x0 in enumerate((2, 6, 10, 14)):
        length = (7 + (k % 2) * 3 if row == 0 else 5 + (k % 2) * 2)
        y0 = (5 + (k % 3)) if row == 0 else 0
        for i in range(length):
            yy = y0 + i
            xx = x0 + (sway if i > 2 else 0) + (1 if (i % 3 == 2) else 0)
            if 0 <= xx < 16 and 0 <= yy < 16:
                img[yy, xx] = LILAC[1] if i % 2 == 0 else LILAC[0]
                if 0 <= xx + 1 < 16 and i % 3 == 1 and i < length - 2:
                    img[yy, xx + 1] = LILAC[0]
    return img


def chars():
    return {(1, t): (6, pergola(pc, 0)) for t, pc in PERGOLA.items()}


def anims():
    return [
        {'tile': 0x4C, 'pal': 6, 'frames': [(0x80 + 2 * k, pergola((1, 0), k)) for k in range(4)]},
        {'tile': 0x4E, 'pal': 6, 'frames': [(0x88 + 2 * k, pergola((1, 1), k)) for k in range(4)]},
    ]
