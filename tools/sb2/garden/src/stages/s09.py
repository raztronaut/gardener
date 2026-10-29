"""Stage 9 — the VEGETABLE TERRACES: straw-mulched beds and tilled soil with sprouting
seedlings; cabbages, lettuces, pumpkins and bean bushes (soft); field stones and old stumps
(hard); dry-stone terrace walls with herbs all round; the original's arrow panels are
garden markers — wooden boards with an arrow of marigolds whose colours run toward the
tip (the original's palette cycle: 5 colours turning)."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Vegetable Terraces'

CHASE = [C('#a83a10'), C('#e06a18'), C('#ff9a28'), C('#ffd040'), C('#fff8b0')]   # tail .. tip, phase 0
CYCLES = {6: {'colours': CHASE, 'rom': 0xDB7E, 'phases': 4}}

S = [C('#3a2616'), C('#56381e'), C('#704c2a'), C('#8c6236'), C('#a87c48')]
S_SH = C('#2a1a10')
STRAW = [C('#a8823a'), C('#d4b060')]
SPROUT = [C('#3a7a2a'), C('#78b840')]
B = [C('#173a1c'), C('#245a26'), C('#387c30'), C('#58a040'), C('#8cc860')]
CAB = [C('#1e4a3a'), C('#2e6a4e'), C('#4a8c62'), C('#78b07c'), C('#b0d8a4')]
LET = [C('#2a5a1a'), C('#468a24'), C('#6aae34'), C('#9ccc4c'), C('#d0ec80')]
PUMP = [C('#7a3010'), C('#b8501a'), C('#e47828'), C('#ffa848'), C('#ffd088')]
OUT = C('#140c06')
ST = [C('#463e36'), C('#665a4c'), C('#887a66'), C('#aa9c84'), C('#cec2a6')]
GAP = C('#241a10')
WOOD = [C('#4a2e16'), C('#8a6036'), C('#c09058'), C('#e0b878')]
BEAN = C('#f4f0e0')
HERB = [C('#5a7a3a'), C('#9ab860')]

SHADE = {S[4]: S[2], S[3]: S[1], S[2]: S[0], S[1]: S_SH, S[0]: S_SH, STRAW[1]: S[3], STRAW[0]: S[2]}


def ground_tex():
    img = TR.soil_tex(S[1:5], 909, furrows=False)
    r = Rng(4)
    for (x, y) in N.poisson(64, 64, 3.5, 91):
        x, y = int(x), int(y)
        if r.rand(3) == 0:
            continue
        dx, dy = [(1, 0), (1, 1), (0, 1), (1, -1)][r.rand(4)]
        img[y % 64, x % 64] = STRAW[1]
        img[(y + dy) % 64, (x + dx) % 64] = STRAW[0]
    return img


def decals():
    d = []
    for s in (1, 2, 3):
        im = blank(16, 16)
        r = Rng(s)
        for k in range(2 + s % 2):
            x, y = 3 + r.rand(10), 4 + r.rand(9)
            im[y, x] = SPROUT[0]
            im[y - 1, x - 1] = SPROUT[1]
            im[y - 1, x + 1] = SPROUT[1]
            im[y, x - 1] = S[0]
        d.append(im)
    d.append(TR.decal_pebbles(4, [S_SH, ST[1], ST[3], ST[4]], n=2))
    d.append(TR.decal_leaves(5, [(LET[3], LET[1])], n=2))
    return d


def marker(direction):
    """a wooden board with an arrow of marigolds (colours chase toward the tip)"""
    img = blank(16, 16)
    img[1:15, 1:15] = WOOD[1]
    img[1, 1:15] = WOOD[2]
    img[1:15, 1] = WOOD[2]
    img[14, 1:15] = WOOD[0]
    img[1:15, 14] = WOOD[0]
    for y in range(2, 14):
        if y % 4 == 1:
            img[y, 2:14] = WOOD[0]
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
    img = over(img, shape)
    img[0, 1:15] = OUT
    img[15, 1:15] = OUT
    img[1:15, 0] = OUT
    img[1:15, 15] = OUT
    return img


def gimmicks():
    g = {}
    for n, d in (('gimmick_3e_0', 'r'), ('gimmick_3f_0', 'l'), ('gimmick_3d_0', 'd'), ('gimmick_3c_0', 'u'),
                 ('gimmick_3f_1', 'l'), ('gimmick_3d_1', 'd')):
        g[n] = marker(d)
    return g


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    TR.tile_tex(cv.base, ground_tex(), allc)
    TR.scatter(cv.decal, field, decals(), 0.40, 92)
    reg = TR.rough_region(ring, 93, amp=1.0)
    TR.stone_wall(cv.obj, reg, ST, 94, GAP, size=5.0, moss=(HERB[0], HERB[1]), outline=OUT)
    # herbs and beans growing along the wall tops
    n = N.fbm(512, 512, 95, ((16, 1.0), (8, 0.5)), period=512)
    herbs = reg & (n > 0.6)
    TR.mass(cv.obj2, herbs, B, 96, outline=OUT, dome_r=4.0, glob=0.7, r=(1.1, 2.0))
    hard = [TR.boulder(ST, OUT, seed=1), TR.stump(WOOD[:1] + [S[1], S[2], S[3]], WOOD, OUT, seed=2),
            TR.boulder(ST, OUT, seed=3, lobes=5), TR.boulder(ST, OUT, seed=4, rx=7.2, ry=6.0)]
    for (cx, cy) in pillars:
        cv.put('obj', hard[TR.cell_hash(cx, cy, 5) % len(hard)], cx * 16, cy * 16)


def soft():
    return [
        TR.cabbage(CAB, OUT, seed=1, vein=CAB[4], shadow=S_SH),
        TR.cabbage(LET, OUT, seed=2, shadow=S_SH),
        TR.pumpkin(PUMP, [B[1], B[2], B[3]], OUT, seed=3, shadow=S_SH),
        TR.bush(B, OUT, seed=4, flowers=[(BEAN, STRAW[1], ST[3])], nflowers=6, shadow=S_SH),
        TR.cabbage(CAB, OUT, seed=5, vein=CAB[4], shadow=S_SH, r=6.2),
    ]


def pressure():
    return TR.boulder(ST, OUT, seed=9, rx=7.4, ry=7.2, lobes=4, amp=0.05, flat=0.6)
