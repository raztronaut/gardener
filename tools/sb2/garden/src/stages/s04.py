"""Stage 4 — the ORCHARD: warm orchard grass with fallen apples, dandelions and clover;
the original's fuse ring is a GRAPEVINE trained along a low wire (its fire runs along the
vine); currant bushes, apple saplings and tall grass (soft); old fruit-tree stumps and
boulders (hard); a dry-stone wall overgrown with ivy all round."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Orchard'
FLOOR_KINDS = ('floor', 'gimmick_0e')        # the vine is painted in the ground
MASK_REFS = tuple('gimmick_0e_%d' % k for k in range(32))

G = [C('#2a4a1e'), C('#3c6424'), C('#527e2e'), C('#6e9a3a'), C('#9cbc52')]
G_SH = C('#1e3618')
DAND = C('#ffd040')
DAND_D = C('#d09a20')
APPLE = C('#d83a2a')
APPLE_H = C('#ff9a70')
APPLE_D = C('#8a1c18')
LEAF_Y = C('#d09a20')
# bushes
B = [C('#173a1c'), C('#245a26'), C('#387c30'), C('#58a040'), C('#8cc860')]
OUT = C('#10200c')
CURRANT = C('#c01838')
CURRANT_H = C('#ff7088')
BLOSSOM = C('#fff0f4')
BLOSSOM_D = C('#f0b0c4')
# wood / stone
BARK = [C('#2a1a10'), C('#462c18'), C('#664224'), C('#865c34'), C('#a87a48')]  # 5 for trunks
WOOD = [C('#7a5430'), C('#a87c48'), C('#c89e62'), C('#e2c084')]
ST = [C('#463e36'), C('#665a4c'), C('#887a66'), C('#aa9c84'), C('#cec2a6')]
GAP = C('#241c14')
IVY = [C('#0e2a16'), C('#173a1c'), C('#245a26'), C('#387c30'), C('#58a040')]
# the vine
STEM = [C('#2a1a10'), C('#664224')]
VLEAF = [C('#173a1c'), C('#245a26'), C('#387c30'), C('#58a040')]
GRAPE = [C('#2c1440'), C('#5a2c78'), C('#9a6ac0')]
WIRE = C('#887a66')

SHADE = {G[4]: G[2], G[3]: G[1], G[2]: G[0], G[1]: G_SH, G[0]: G_SH}


def ground_tex():
    return TR.grass_tex(G, 404, tuft=0.5, lush=0.3)


def decals():
    d = []
    # fallen apples
    for s in (1, 2):
        im = blank(16, 16)
        r = Rng(s)
        for k in range(1 + s % 2):
            x, y = 3 + r.rand(9), 3 + r.rand(9)
            for dx, dy, c in ((0, 0, APPLE_H), (1, 0, APPLE), (0, 1, APPLE), (1, 1, APPLE_D), (2, 1, G_SH), (1, 2, G_SH)):
                im[y + dy, x + dx] = c
            im[y - 1, x + 1] = STEM[0]
        d.append(im)
    d.append(TR.decal_flowers(3, [(DAND, DAND_D, DAND_D)], n=3, kinds=('plus', 'cup')))
    d.append(TR.decal_clover(4, [G[2], G[3], G[4]], n=4))
    d.append(TR.decal_leaves(5, [(LEAF_Y, DAND_D), (APPLE_H, APPLE_D)], n=3))
    d.append(TR.decal_tuft(6, [G[1], G[3], G[4], C('#c0d070')], n=2))
    d.append(TR.decal_flowers(7, [(BLOSSOM, DAND, BLOSSOM_D)], n=4, kinds=('dot',)))
    return d


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    TR.tile_tex(cv.base, ground_tex(), allc)
    vine = {c for c in field if L.kind(*c) == 'gimmick_0e'}
    TR.scatter(cv.decal, field - vine, decals(), 0.40, 41)

    def conn(cx, cy):
        return {d for d, (dx, dy) in (('l', (-1, 0)), ('r', (1, 0)), ('t', (0, -1)), ('b', (0, 1))) if (cx + dx, cy + dy) in vine}
    TR.vine_path(cv.obj, vine, conn, STEM, VLEAF, grape=GRAPE, seed=3, wire=WIRE)
    # the dry-stone wall, ivy over parts of it
    reg = TR.rough_region(ring, 44, amp=1.2)
    TR.stone_wall(cv.obj, reg, ST, 45, GAP, size=5.5, moss=(IVY[2], IVY[3]), outline=OUT)
    n = N.fbm(512, 512, 46, ((32, 1.0), (16, 0.5)), period=512)
    ivy = reg & (n > 0.52)
    TR.mass(cv.obj2, ivy, IVY, 47, outline=OUT, dome_r=5.0, glob=0.7, r=(1.3, 2.2))
    hard = hard_blocks()
    for (cx, cy) in pillars:
        cv.put('obj', hard[TR.cell_hash(cx, cy, 5) % len(hard)], cx * 16, cy * 16)


def hard_blocks():
    return [
        TR.stump(BARK[:4], WOOD, OUT, seed=1, moss=(IVY[2], IVY[3])),
        TR.stump(BARK[:4], WOOD, OUT, seed=2, moss=(IVY[2], IVY[3])),
        TR.boulder(ST, OUT, seed=3, lobes=5),
        TR.boulder(ST, OUT, seed=4, moss=[IVY[1], IVY[2], IVY[3], IVY[4]]),
    ]


def soft():
    return [
        TR.bush(B, OUT, seed=1, berries=(CURRANT, CURRANT_H), shadow=G_SH),
        TR.bush(B, OUT, seed=2, berries=(APPLE, APPLE_H), shadow=G_SH, lobes=7),
        TR.bush(B, OUT, seed=3, flowers=[(BLOSSOM, DAND, BLOSSOM_D)], nflowers=6, shadow=G_SH),
        TR.grass_clump(B, OUT, seed=4, shadow=G_SH, seeds=DAND),
        TR.bush(B, OUT, seed=5, shadow=G_SH),
    ]


def pressure():
    return TR.boulder(ST, OUT, seed=9, rx=7.4, ry=7.2, lobes=4, amp=0.05, flat=0.6)
