"""Stage 10 — the DEEP FOREST: a dim forest floor of moss and leaf litter with ferns and
little mushrooms; big toadstools that grow back (soft: red, brown and orange caps with
the original's 4 regrowth frames); ancient trunks with root flares and mossy boulders
(hard); a dense old-growth canopy all round."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Deep Forest'

F = [C('#1a2a14'), C('#24381a'), C('#304a20'), C('#40602a'), C('#587a36')]
F_SH = C('#121e0e')
LIT = [C('#5a3a1c'), C('#7a522a'), C('#a0703a')]
CAN = [C('#0c1e10'), C('#163018'), C('#204622'), C('#30602c'), C('#4c7e3a')]
OUT = C('#080e06')
RED = [C('#6a1010'), C('#a81c18'), C('#e03424'), C('#ff7058')]
BRN = [C('#4a2810'), C('#7a4420'), C('#a8683a'), C('#d09a60')]
ORA = [C('#7a3a08'), C('#c06010'), C('#f09020'), C('#ffc060')]
SPOT = [C('#fff8ec'), C('#d8d0c0')]
STEM = [C('#b8ac90'), C('#ece4cc')]
BARK = [C('#1e140c'), C('#34241a'), C('#4c3624'), C('#664a30'), C('#86643e')]
ST = [C('#30363a'), C('#4c5458'), C('#6c7678'), C('#929c9a'), C('#bac2bc')]
MOSS = [C('#304a20'), C('#40602a'), C('#587a36'), C('#78983e')]
FERN = [C('#142a12'), C('#1e401a'), C('#2e5a24'), C('#467a30'), C('#689a40')]

SHADE = {F[4]: F[2], F[3]: F[1], F[2]: F[0], F[1]: F_SH, F[0]: F_SH, LIT[2]: LIT[0], LIT[1]: F[0], LIT[0]: F_SH}


def ground_tex():
    img = TR.moss_tex(F, 1010)
    n = N.fbm(64, 64, 1011, ((16, 1.0), (8, 0.5)), period=64)
    r = Rng(12)
    for (x, y) in N.poisson(64, 64, 3.0, 1012):
        x, y = int(x), int(y)
        if n[y % 64, x % 64] < 0.5:
            continue
        c = LIT[r.rand(3)]
        img[y % 64, x % 64] = c
        img[y % 64, (x + 1) % 64] = LIT[0] if c != LIT[0] else LIT[1]
    return img


def decals():
    d = []
    d.append(TR.decal_mushrooms(1, (BRN[1], BRN[2], BRN[3]), (STEM[0], STEM[1]), n=2))
    d.append(TR.decal_mushrooms(2, (RED[1], RED[2], RED[3]), (STEM[0], STEM[1]), n=1, spots=SPOT[0]))
    d.append(TR.decal_leaves(3, [(LIT[2], LIT[0]), (ORA[2], ORA[0])], n=3))
    d.append(TR.decal_tuft(4, [FERN[1], FERN[2], FERN[3], FERN[4]], n=2))
    d.append(TR.decal_pebbles(5, [F_SH, ST[1], ST[2], ST[3]], n=2))
    d.append(TR.decal_leaves(6, [(LIT[1], LIT[0])], n=4))
    return d


CAPS = [(RED, SPOT), (BRN, (BRN[3], BRN[2])), (ORA, SPOT), (RED, SPOT)]


def stool(k, size):
    cap, sp = CAPS[k]
    return TR.toadstool(cap, STEM, OUT, size=size, spots=sp if k != 1 else None, seed=k + 1, shadow=F_SH)


def soft():
    return [stool(k, 1.0) for k in range(len(CAPS))]


def regrow():
    return {'soft_regrow_%d' % i: [stool(k, sz) for k in range(len(CAPS))]
            for i, sz in enumerate((0.35, 0.55, 0.75, 0.9))}


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    TR.tile_tex(cv.base, ground_tex(), allc)
    TR.scatter(cv.decal, field, decals(), 0.42, 101)
    reg = TR.rough_region(ring, 103, amp=2.0)
    TR.mass(cv.obj, reg, CAN, 104, outline=OUT, dome_r=10.0, glob=0.9, r=(1.8, 3.2))
    pts = TR.ring_points(ring, 26, 105)
    TR.crowns(cv.obj2, pts, CAN, 106, outline=OUT, r=(9.0, 12.0), clip=reg, leaf=(1.8, 3.0))
    hard = [TR.trunk(BARK, OUT, seed=1, moss=(MOSS[1], MOSS[3])), TR.boulder(ST, OUT, seed=2, moss=MOSS),
            TR.trunk(BARK, OUT, seed=3, moss=(MOSS[1], MOSS[3])), TR.boulder(ST, OUT, seed=4, moss=MOSS, lobes=5),
            TR.stump(BARK[:4], [BRN[1], BRN[2], BRN[3], STEM[1]], OUT, seed=5, moss=(MOSS[1], MOSS[3]))]
    for (cx, cy) in pillars:
        cv.put('obj', hard[TR.cell_hash(cx, cy, 5) % len(hard)], cx * 16, cy * 16)


def pressure():
    return TR.boulder(ST, OUT, seed=9, rx=7.4, ry=7.2, lobes=4, amp=0.05, flat=0.6)
