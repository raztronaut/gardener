"""Stage 1 — the MEADOW: lush summer grass with daisies, buttercups, clover and pebbles;
round flowering shrubs, berry bushes and tall grass clumps (soft); mossy boulders and old
tree stumps (hard); a dark hawthorn hedgerow all round, sprinkled with wild roses."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Meadow'

# ground
G = [C('#1d4426'), C('#2a6030'), C('#3a7c38'), C('#529a44'), C('#7cb853')]
G_SH = C('#16331d')
WHITE_D = C('#d8e0d0')
BUTTER = C('#f6d44a')
BUTTER_D = C('#c89a28')
VIOLET = C('#9a70d8')
VIOLET_D = C('#6a48a8')
# bushes
B = [C('#173d1e'), C('#25602a'), C('#3c8636'), C('#62ac46'), C('#9cd468')]
B_OUT = C('#0c2312')
ROSE = C('#f08aa8')
ROSE_D = C('#c05478')
BERRY = C('#d02838')
# stone / wood
ST = [C('#3a4244'), C('#566264'), C('#7a8684'), C('#a0aaa2'), C('#c8d0c2')]
MOSS = [C('#3c6a26'), C('#5c8c30'), C('#84b040'), C('#a8cc58')]
BARK = [C('#2e1c10'), C('#4c3018'), C('#6c4826'), C('#8c6234')]
WOOD = [C('#7a5430'), C('#a87c48'), C('#c89e62'), C('#e2c084')]
INKB = C('#1a120a')
# hedge
H = [C('#0f2a16'), C('#1a4222'), C('#28602c'), C('#3c7e34'), C('#5a9c40')]

SHADE = {G[4]: G[2], G[3]: G[1], G[2]: G[0], G[1]: G_SH, G[0]: G_SH}


def ground_tex():
    return TR.grass_tex(G, 101, tuft=0.7)


def decals():
    d = []
    d.append(TR.decal_flowers(1, [(WHITE, BUTTER, WHITE_D)], n=3))
    d.append(TR.decal_flowers(2, [(BUTTER, BUTTER_D, BUTTER_D)], n=3, kinds=('plus', 'dot')))
    d.append(TR.decal_flowers(3, [(VIOLET, BUTTER, VIOLET_D)], n=2))
    d.append(TR.decal_clover(4, [G[2], G[3], G[4]], n=4, bloom=(WHITE, WHITE_D)))
    d.append(TR.decal_clover(5, [G[2], G[3], G[4]], n=3))
    d.append(TR.decal_pebbles(6, [G_SH, ST[1], ST[2], ST[3]], n=3))
    d.append(TR.decal_tuft(7, [G[1], G[3], G[4], C('#a8d470')], n=2))
    d.append(TR.decal_flowers(8, [(WHITE, BUTTER, WHITE_D), (BUTTER, BUTTER_D, BUTTER_D)], n=4, kinds=('dot', 'plus')))
    d.append(TR.decal_tuft(9, [G[1], G[3], G[4], C('#a8d470')], n=1))
    return d


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    TR.tile_tex(cv.base, ground_tex(), allc)
    TR.scatter(cv.decal, field, decals(), 0.42, 11)
    # the hedgerow: a leafy mass over the ring with a ragged inner edge
    reg = TR.rough_region(ring, 31, amp=1.6)
    TR.mass(cv.obj, reg, H, 41, outline=B_OUT, dome_r=10.0, glob=0.9)
    # rounded hawthorn shrubs standing out of the hedgerow
    pts = TR.ring_points(ring, 20, 8, depth=5)
    TR.crowns(cv.obj2, pts, B, 9, outline=B_OUT, r=(7.0, 9.5), clip=reg, leaf=(1.3, 2.3))
    # wild roses and hawthorn blossom on their sunny faces
    r = Rng(7)
    ys, xs = np.nonzero(reg)
    for k in range(0, len(xs), 29):
        x, y = xs[k], ys[k]
        if y + 2 >= 512 or x + 2 >= 512:
            continue
        L_ = cv.obj2 if cv.obj2[y, x] >= 0 else cv.obj
        if L_[y, x] in (B[3], B[4], H[3], H[4]) and L_[y + 1, x + 1] not in (B_OUT, T):
            if r.rand(2):
                TR.flower(L_, x, y, ROSE, BUTTER, ROSE_D, 'plus')
            else:
                L_[y, x] = WHITE
                L_[y, x + 1] = WHITE_D
    # hard: boulders and stumps by hash
    hard = hard_blocks()
    for (cx, cy) in pillars:
        h = TR.cell_hash(cx, cy, 5)
        cv.put('obj', hard[h % len(hard)], cx * 16, cy * 16)


def hard_blocks():
    return [
        TR.boulder(ST, INKB, seed=1, moss=MOSS),
        TR.boulder(ST, INKB, seed=2, moss=MOSS, lobes=5),
        TR.boulder(ST, INKB, seed=3, moss=MOSS, rx=7.2, ry=6.2),
        TR.stump(BARK, WOOD, INKB, seed=4, moss=MOSS),
        TR.boulder(ST, INKB, seed=5, moss=MOSS, lobes=3),
    ]


def soft():
    out = []
    out.append(TR.bush(B, B_OUT, seed=1, flowers=[(ROSE, BUTTER, ROSE_D)], shadow=G_SH))
    out.append(TR.bush(B, B_OUT, seed=2, flowers=[(WHITE, BUTTER, WHITE_D)], shadow=G_SH))
    out.append(TR.bush(B, B_OUT, seed=3, berries=(BERRY, ROSE), shadow=G_SH))
    out.append(TR.bush(B, B_OUT, seed=4, shadow=G_SH, lobes=7))
    out.append(TR.grass_clump([B[0], B[1], B[2], B[3], B[4]], B_OUT, seed=5, shadow=G_SH, seeds=BUTTER))
    out.append(TR.bush(B, B_OUT, seed=6, flowers=[(ROSE, BUTTER, ROSE_D), (WHITE, BUTTER, WHITE_D)], nflowers=4, shadow=G_SH))
    return out


def pressure():
    # the sudden-death block: a heavy grey field stone (like the falling block)
    return TR.boulder(ST, INKB, seed=9, rx=7.4, ry=7.2, lobes=4, amp=0.05, flat=0.6)
