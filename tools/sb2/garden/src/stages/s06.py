"""Stage 6 — the ROSE GARDEN: a soft lawn strewn with fallen rose petals, daisies and
clover; red, pink and white rose bushes (soft); weathered stone pedestals with ball
finials and mossy rocks (hard); a dark rose hedge in full bloom all round; the original's
teleport pads are a stone birdbath (its water ripples) and a ring of turning petals."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Rose Garden'
CHAR_CELLS = {'gimmick_50_0': 255, 'gimmick_50_1': 255}

PET = [C('#e04a6a'), C('#ff90aa')]
DAISY = C('#fff8f0')
DAISY_C = C('#ffd040')
B = [C('#173a1c'), C('#245a28'), C('#367a34'), C('#509844'), C('#7cbc5c')]
G = [B[1], B[2], C('#3c7838'), B[3], C('#7cb058')]
G_SH = B[0]
OUT = C('#0c1a0e')
RED = [C('#7a1020'), C('#c01c34'), C('#f04058')]
PINK = [C('#c8507a'), C('#f88cb0'), C('#ffd0e0')]
WROSE = [C('#d8d0c8'), C('#fffaf4')]
ST = [C('#4a463e'), C('#6e685c'), C('#948c7c'), C('#bab2a0'), C('#e0d8c4')]
WATER = [C('#2a5a8a'), C('#4a8cc0'), C('#8ac4e8')]
MOSS = [C('#2c5a26'), C('#447a30'), C('#62983c'), C('#84b450')]
TERRA = [C('#5a2414'), C('#8e3e22'), C('#c0603a'), C('#e48c5c'), C('#f8b888')]
SOIL = C('#2e1a10')
LAV = [C('#6a4aa8'), C('#a088e0')]

SHADE = {G[4]: G[2], G[3]: G[1], G[2]: G[0], G[1]: G_SH, G[0]: G_SH}


def ground_tex():
    return TR.grass_tex(G, 606, tuft=0.45, lush=0.6)


def decals():
    d = []
    d.append(TR.decal_leaves(1, [(PET[1], PET[0])], n=3))
    d.append(TR.decal_leaves(2, [(PET[1], PET[0]), (WROSE[1], WROSE[0])], n=4))
    d.append(TR.decal_flowers(3, [(DAISY, DAISY_C, WROSE[0])], n=3))
    d.append(TR.decal_clover(4, [G[2], G[3], G[4]], n=3))
    d.append(TR.decal_leaves(5, [(RED[2], RED[1])], n=2))
    d.append(TR.decal_tuft(6, [G[1], G[3], G[4], C('#a0c870')], n=1))
    return d


def rose_bush(seed, cols, n=6):
    img = TR.bush(B, OUT, seed=seed, shadow=G_SH, lobes=6)
    r = Rng(seed + 50)
    pts = []
    for k in range(60):
        if len(pts) >= n:
            break
        x, y = 2 + r.rand(11), 2 + r.rand(11)
        if not all(img[y + dy, x + dx] in B for dx in (0, 1) for dy in (0, 1)):
            continue
        if any(abs(x - a) + abs(y - b) < 4 for a, b in pts):
            continue
        pts.append((x, y))
        dk, md, lt = cols if len(cols) == 3 else (cols[0], cols[0], cols[1])
        for dx, dy, c in ((0, 0, lt), (1, 0, md), (0, 1, md), (1, 1, dk)):
            img[y + dy, x + dx] = c
        if y > 0 and img[y - 1, x] in B:
            img[y - 1, x] = md
    return img


def pedestal(seed):
    """a weathered stone pedestal with a ball finial (from above-front)"""
    img = blank(16, 16)
    ys, xs = np.mgrid[0:16, 0:16]
    base = (np.abs(xs + 0.5 - 8) < 6.5) & (ys >= 9) & (ys <= 14)
    l = N.dome(base, 2.0, flat=0.4)
    img = np.where(base, N.shade(l, ST, -1.0, 1.0, dither=0.2), T)
    img[9, 2:14] = ST[4]
    ball = np.hypot(xs + 0.5 - 8, ys + 0.5 - 6.5) < 5.2
    bl = N.dome(ball, 3.0)
    bi = N.shade(bl, ST, -1.0, 1.0, dither=0.25)
    img[ball] = bi[ball]
    n = N.fbm(16, 16, seed, ((4, 1.0),))
    mm = (img >= 0) & (n > 0.6) & (ys > 5)
    img[mm] = np.where(ys[mm] < 10, MOSS[2], MOSS[1])
    return N.selout(img, OUT, None)


def urn(seed, plant='lav'):
    """a big terracotta urn from above: a thick lit rim, dark soil, a plant spilling over"""
    img = blank(16, 16)
    ys, xs = np.mgrid[0:16, 0:16]
    d = np.hypot(xs + 0.5 - 8, ys + 0.5 - 8)
    body = d < 7.2
    rim = body & (d > 4.6)
    lit = ((xs + 0.5 - 8) * -0.55 + (ys + 0.5 - 8) * -0.83) / (d + 0.01)
    inner = (xs + 0.5 - 8) * 0.55 + (ys + 0.5 - 8) * 0.83     # the rim's inside faces the other way
    v = np.where(d > 5.9, lit, -lit * 0.8)
    img[rim] = np.where(v[rim] > 0.55, TERRA[4], np.where(v[rim] > 0.1, TERRA[3], np.where(v[rim] > -0.4, TERRA[2], TERRA[1])))
    soil = d <= 4.6
    img[soil] = SOIL
    pot = N.selout(img, OUT, None)
    # the planting (a second layer): a domed mound of foliage spilling over the rim
    img = blank(16, 16)
    m = N.blob(16, 16, 7.8, 6.6, 5.6, 5.0, lobes=6, amp=0.12, seed=seed)
    fol = N.foliage(m, B, seed=seed + 3, r=(1.1, 1.9), density=1.0, dome_r=4.0, glob=0.8)
    img[m] = fol[m]
    r = Rng(seed)
    if plant == 'lav':
        for k in range(10):
            x, y = 3 + r.rand(10), 3 + r.rand(7)
            if m[y, x]:
                img[y, x] = LAV[1]
                if y + 1 < 16 and m[y + 1, x]:
                    img[y + 1, x] = LAV[0]
    else:
        for k in range(6):
            x, y = 4 + r.rand(8), 3 + r.rand(7)
            if m[y, x]:
                TR.flower(img, x, y, DAISY, DAISY_C, WROSE[0], 'plus')
    return pot, N.selout(img, OUT, None)


def birdbath(frame):
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d <= 7.4:
                img[y, x] = ST[3] if d > 6.2 else (ST[2] if d > 5.6 else WATER[0])
                if d > 6.9:
                    img[y, x] = ST[1] if x + y > 15 else ST[4]
            if d <= 5.6:
                r = (d - frame * 1.4) % 4.2
                img[y, x] = WATER[2] if r < 0.9 else WATER[1] if r < 2.2 else WATER[0]
    img[5, 5] = DAISY
    return img


def petal_ring(frame):
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d <= 7.4:
                img[y, x] = ST[3] if d > 6.2 else ST[2] if d > 5.6 else ST[1]
                if d > 6.9:
                    img[y, x] = ST[1] if x + y > 15 else ST[4]
    for k in range(6):
        ang = (k / 6.0) * 2 * math.pi + frame * (math.pi / 12)
        cx, cy = 7.5 + 3.3 * math.cos(ang), 7.5 + 3.3 * math.sin(ang)
        for y in range(16):
            for x in range(16):
                if math.hypot(x - cx, y - cy) <= 1.6:
                    img[y, x] = RED[1] if (x - cx) + (y - cy) > 0 else PINK[1]
    for (x, y) in ((7, 7), (8, 7), (7, 8), (8, 8)):
        img[y, x] = DAISY_C
    return img


def chars():
    return {(2, 0x2A): (6, petal_ring(0)), (2, 0x46): (6, birdbath(0))}


def anims():
    return [
        {'tile': 0x46, 'pal': 6, 'frames': [(k * 2, birdbath(k)) for k in range(4)]},
        {'tile': 0x2A, 'pal': 6, 'frames': [(8 + k * 2, petal_ring(k)) for k in range(4)]},
    ]


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    TR.tile_tex(cv.base, ground_tex(), allc)
    TR.scatter(cv.decal, field, decals(), 0.42, 61)
    reg = TR.rough_region(ring, 63, amp=1.6)
    TR.mass(cv.obj, reg, B, 64, outline=OUT, dome_r=9.0, glob=0.9, r=(1.4, 2.4))
    # roses in bloom all over the hedge
    r = Rng(65)
    ys, xs = np.nonzero(reg)
    for k in range(0, len(xs), 23):
        x, y = xs[k], ys[k]
        if r.rand(3) or y + 1 >= 512 or x + 1 >= 512:
            continue
        if not (cv.obj[y, x] in B[2:] and cv.obj[y + 1, x + 1] in B):
            continue
        cols = [RED, PINK, (WROSE[0], WROSE[0], WROSE[1])][r.rand(3)]
        dk, md, lt = cols
        cv.obj[y, x] = lt
        cv.obj[y, x + 1] = md
        cv.obj[y + 1, x] = md
        cv.obj[y + 1, x + 1] = dk
    hard = [urn(1), urn(2, 'daisy'), urn(3), urn(4, 'daisy')]
    for (cx, cy) in pillars:
        pot, plant = hard[TR.cell_hash(cx, cy, 5) % len(hard)]
        cv.put('obj', pot, cx * 16, cy * 16)
        cv.put('obj2', plant, cx * 16, cy * 16)


def soft():
    return [rose_bush(1, RED), rose_bush(2, PINK), rose_bush(3, (WROSE[0], WROSE[0], WROSE[1])),
            rose_bush(4, RED, 8), rose_bush(5, PINK, 4)]


def pressure():
    return TR.boulder(ST, OUT, seed=9, rx=7.4, ry=7.2, lobes=4, amp=0.05, flat=0.6)
