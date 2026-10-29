"""Stage 7 — the HEDGE MAZE: pale gravel walks and lawn lanes between clipped yew hedges
(the original's maze walls, painted as continuous hedges with rounded tops); blue and
white hydrangeas (soft); the original's numbered speed pads are round stepping stones
carved with the number in gold (and "!"); a tall outer hedge with a flower border."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Hedge Maze'

GRAV = [C('#5e5446'), C('#7e7260'), C('#9c8f78'), C('#b8ab90'), C('#d6cab0')]
G = [C('#1e4024'), C('#2c5a2e'), C('#3c7438'), C('#548e44'), C('#78ac58')]
G_SH = C('#16301c')
GR_SH = C('#463e34')
YEW = [C('#0c2414'), C('#143a1e'), C('#1f5228'), C('#2e6c32'), C('#468a40')]
OUT = C('#081408')
HYD_B = [C('#3a5ab8'), C('#6a8ae0'), C('#a8c0f8')]
HYD_W = [C('#c8ccd8'), C('#f4f6ff')]
B = [C('#14321a'), C('#1f4c24'), C('#2e6a2e'), C('#46883a'), C('#6ca850')]
ST = [C('#4a463e'), C('#6e685c'), C('#948c7c'), C('#bab2a0'), C('#e0d8c4')]
GOLD = [C('#8a5a10'), C('#d8a030'), C('#ffe070')]
POPPY = C('#f04030')
DAISY = C('#fff8f0')
DAISY_C = C('#ffd040')

SHADE = {G[4]: G[2], G[3]: G[1], G[2]: G[0], G[1]: G_SH, G[0]: G_SH,
         GRAV[4]: GRAV[2], GRAV[3]: GRAV[1], GRAV[2]: GRAV[0], GRAV[1]: GR_SH, GRAV[0]: GR_SH}


def gravel():
    return TR.gravel_tex(GRAV, 707)


def lawn():
    return TR.grass_tex(G, 708, tuft=0.4, lush=0.4)


def decals_lawn():
    return [TR.decal_flowers(1, [(DAISY, DAISY_C, HYD_W[0])], n=3), TR.decal_clover(2, [G[2], G[3], G[4]], n=3),
            TR.decal_tuft(3, [G[1], G[3], G[4], C('#a0c870')], n=1)]


def decals_gravel():
    return [TR.decal_pebbles(4, [GR_SH, ST[1], ST[3], ST[4]], n=3), TR.decal_pebbles(5, [GR_SH, ST[2], ST[3], ST[4]], n=2),
            TR.decal_leaves(6, [(B[3], B[1])], n=2)]


DIGITS = {
    '1': ['.#.', '##.', '.#.', '.#.', '###'], '2': ['##.', '..#', '.#.', '#..', '###'],
    '3': ['##.', '..#', '.#.', '..#', '##.'], '4': ['#.#', '#.#', '###', '..#', '..#'],
    '5': ['###', '#..', '##.', '..#', '##.'], '!': ['.#.', '.#.', '.#.', '...', '.#.'],
}


def pad(ch):
    img = blank(16, 16)
    m = N.blob(16, 16, 8.0, 8.0, 6.8, 6.2, lobes=5, amp=0.04, seed=3)
    lv = N.dome(m, 3.0, flat=0.5)
    img = N.shade(lv, ST[1:5], -1.0, 1.0, dither=0.2, mask=m)
    g = DIGITS[ch]
    for j, row in enumerate(g):
        for i, c in enumerate(row):
            if c == '#':
                for dx in (0, 1):
                    x, y = 5 + i * 2 + dx, 5 + j
                    if dx == 0:
                        img[y, x] = GOLD[2]
                    else:
                        img[y, x] = GOLD[1]
                img[6 + j, 6 + i * 2] = GOLD[0] if img[6 + j, 6 + i * 2] not in (GOLD[1], GOLD[2]) else img[6 + j, 6 + i * 2]
    return N.selout(img, OUT, None)


def gimmicks():
    g = {}
    for k, ch in enumerate('12345'):
        g['gimmick_0f_%d' % k] = pad(ch)
    g['gimmick_0f_5'] = pad('!')
    return g


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    lawn_cells = {c for c in allc if L.at(*c) in ('floor_3', 'floor_2')}
    grav_cells = allc - lawn_cells
    TR.tile_tex(cv.base, gravel(), grav_cells)
    TR.tile_tex(cv.base, lawn(), lawn_cells)
    TR.scatter(cv.decal, field & lawn_cells, decals_lawn(), 0.35, 71)
    TR.scatter(cv.decal, field & grav_cells, decals_gravel(), 0.30, 72)
    # the maze hedges: one clipped mass per connected wall, rounded tops
    walls = TR.rough_region(pillars, 73, amp=0.8)
    TR.mass(cv.obj, walls, YEW, 74, outline=OUT, dome_r=6.0, glob=1.0, r=(1.1, 1.9), density=1.3)
    reg = TR.rough_region(ring, 75, amp=1.0)
    TR.mass(cv.obj, reg, YEW, 76, outline=OUT, dome_r=9.0, glob=1.0, r=(1.1, 1.9), density=1.3)
    # a flower border along the foot of the outer hedge
    r = Rng(77)
    for (cx, cy) in field:
        if any((cx + dx, cy + dy) in ring for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1))) and r.rand(2):
            for k in range(2):
                x, y = cx * 16 + 2 + r.rand(12), cy * 16 + 2 + r.rand(12)
                TR.flower(cv.decal, x, y, [POPPY, DAISY][r.rand(2)], DAISY_C, None, 'plus')


def soft():
    return [
        TR.bush(B, OUT, seed=1, flowers=[(HYD_B[2], HYD_B[1], HYD_B[0])], nflowers=6, shadow=G_SH),
        TR.bush(B, OUT, seed=2, flowers=[(HYD_W[1], HYD_W[0], HYD_W[0])], nflowers=6, shadow=G_SH),
        TR.bush(B, OUT, seed=3, flowers=[(HYD_B[1], HYD_B[2], HYD_B[0]), (HYD_W[1], HYD_W[0], HYD_W[0])], nflowers=7, shadow=G_SH),
        TR.grass_clump(B, OUT, seed=4, shadow=G_SH, seeds=DAISY_C),
    ]


def pressure():
    # a clipped yew cube (the hedges' own block)
    m = np.zeros((16, 16), bool)
    m[1:15, 1:15] = True
    m[1, 1] = m[1, 14] = m[14, 1] = m[14, 14] = False
    img = N.foliage(m, YEW, seed=9, r=(1.1, 1.9), density=1.3, dome_r=4.0, glob=1.0)
    return N.selout(img, OUT, None)
