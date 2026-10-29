"""Stage 3 — the LILY POND: clear shallow water over a pebbly bed (duckweed, floating
petals, little fish shadows); lily pads with lotus flowers, cattails and water hyacinth
(soft); mossy stones standing in the water (hard); a marsh bank of reeds and sedges all
round, cut by two stone culverts at the top and bottom (the original's tunnels)."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Lily Pond'
GROUND_KEYS = (6,)          # the culverts' hidden ends above / below the screen

W = [C('#174a5c'), C('#1f6070'), C('#2a7682'), C('#3c8c92'), C('#7cc4c0')]
W_DEEP = C('#103848')
DUCK = [C('#3e7a3a'), C('#68a446')]
PAD = [C('#1c4a26'), C('#2e6a32'), C('#4a9040'), C('#78b858')]
OUT = C('#0c2420')
LOTUS = C('#ffc0d4')
LOTUS_D = C('#e07aa0')
GOLD = C('#ffd860')
REED = [C('#1c3418'), C('#2c4c20'), C('#44682a'), C('#648a36'), C('#94b04c')]
HEAD = [C('#6a3a1c'), C('#8e5428'), C('#3a200e')]
HYA = C('#9a88e8')
HYA_D = C('#6a58b8')
ST = [C('#34403c'), C('#50605a'), C('#72827a'), C('#98a49a'), C('#c0c8b8')]
MOSS = [C('#3a6a2a'), C('#548a32'), C('#78ac40'), C('#a0c858')]
FISH = C('#e8783a')

SHADE = {W[4]: W[2], W[3]: W[1], W[2]: W[0], W[1]: W_DEEP, W[0]: W_DEEP}


def ground_tex():
    img = TR.water_tex(W, 303)
    # pebbles on the bed, seen through the water
    for (x, y) in N.poisson(64, 64, 13.0, 41):
        TR.pebble_at(img, int(x), int(y), [W[0], W[1], W[2], W[3]], wrap=True)
    return img


def decals():
    d = []
    # duckweed
    for s in (1, 2):
        im = blank(16, 16)
        r = Rng(s)
        for (x, y) in N.poisson(12, 12, 2.2, s, wrap=False):
            if r.rand(3):
                im[int(y) + 2, int(x) + 2] = DUCK[r.rand(2)]
        d.append(im)
    # floating petals
    d.append(TR.decal_leaves(3, [(LOTUS, LOTUS_D)], n=3))
    # a small pad
    # (no fish)
    for s in ():
        im = blank(16, 16)
        r = Rng(s)
        x, y = 4 + r.rand(6), 5 + r.rand(6)
        for k, c in enumerate((FISH, FISH, FISH, W[4], FISH)):
            im[y, x + k] = c
        im[y - 1, x + 4] = FISH
        im[y + 1, x + 4] = FISH
        im[y + 1, x + 1] = W_DEEP
        im[y + 1, x + 2] = W_DEEP
        d.append(im)
    d.append(TR.decal_pebbles(7, [W[0], ST[1], ST[2], ST[3]], n=2))
    return d


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    TR.tile_tex(cv.base, ground_tex(), allc)
    TR.scatter(cv.decal, field, decals(), 0.38, 31)
    # culverts: the openings in the ring rows (floor cells next to the ring)
    open_cells = [(cx, cy) for (cx, cy) in field if (cx, cy - 1) not in field and (cx, cy + 1) not in field
                  and (cx - 1, cy) in ring and (cx + 1, cy) in ring]
    reg = TR.rough_region(ring, 33, amp=1.8)
    for (cx, cy) in open_cells:
        # keep the culvert's water clear of the bank's ragged edge
        reg[cy * 16:cy * 16 + 16, cx * 16 - 1:cx * 16 + 17] = False
    TR.mass(cv.obj, reg, REED, 71, outline=OUT, dome_r=9.0, glob=0.9, r=(1.4, 2.6))
    # cattail heads on the bank
    r = Rng(8)
    for (cx, cy) in sorted(ring):
        for k in range(2):
            if r.rand(3) == 0:
                x, y = cx * 16 + 2 + r.rand(12), cy * 16 + 2 + r.rand(11)
                if reg[y, x] and reg[y + 3, x + 1] and cv.obj[y, x] != OUT:
                    cv.obj[y, x] = HEAD[1]
                    cv.obj[y + 1, x] = HEAD[0]
                    cv.obj[y + 2, x] = HEAD[0]
                    cv.obj[y + 1, x + 1] = HEAD[2]
                    cv.obj[y + 2, x + 1] = HEAD[2]
    # the culverts: stone lintels on the bank either side, dark water under the bank
    for (cx, cy) in open_cells:
        top = (cy - 1, cy) if (cx, cy - 1) not in allc or L.at(cx, cy - 1) is None or cy < 10 else (cy, cy + 1)
        x0, y0 = cx * 16, cy * 16
        up = cy < 10
        for x in range(x0 - 3, x0 + 19):
            for k in range(4):
                y = (y0 + k) if up else (y0 + 15 - k)
                c = ST[3] if k == 0 else ST[2] if k < 3 else ST[0]
                if (x - x0) % 6 == 5:
                    c = ST[0]
                cv.obj[y, x] = c
        cv.noshadow[y0:y0 + 16, x0 - 3:x0 + 19] = True
        for y in range(16):
            for x in range(16):
                t = (y if up else 15 - y)
                if t < 9:
                    cv.shade[y0 + y, x0 + x] = True
    for (cx, cy) in [(c[0], c[1] - 1) for c in open_cells] + [(c[0], c[1] + 1) for c in open_cells]:
        if (cx, cy) in allc:
            cv.base[cy * 16:cy * 16 + 16, cx * 16:cx * 16 + 16] = W_DEEP
    hard = hard_blocks()
    for (cx, cy) in pillars:
        cv.put('obj', hard[TR.cell_hash(cx, cy, 5) % len(hard)], cx * 16, cy * 16)


def stone_in_water(seed, **kw):
    s = TR.boulder(ST, OUT, seed=seed, moss=MOSS, moss_amt=0.3, **kw)
    # a pale ripple ring where the stone meets the water
    ys, xs = np.mgrid[0:16, 0:16]
    ring = N.shift(s >= 0, 0, 1) & (s < 0) & (ys >= 9)
    s[ring] = W[4]
    return s


def hard_blocks():
    return [stone_in_water(1), stone_in_water(2, lobes=5), stone_in_water(3, rx=7.2, ry=6.0), stone_in_water(4, lobes=3)]


def soft():
    return [
        TR.lily_pads(PAD, OUT, flower=(LOTUS, LOTUS_D, GOLD), seed=1, n=3, water_shadow=W[0]),
        TR.lily_pads(PAD, OUT, flower=(LOTUS, LOTUS_D, GOLD), seed=2, n=4, water_shadow=W[0]),
        TR.lily_pads(PAD, OUT, seed=3, n=3, water_shadow=W[0]),
        TR.reeds(REED, OUT, head=HEAD, seed=4, shadow=W[0]),
        TR.bush(PAD + [C('#a0d070')], OUT, seed=5, flowers=[(HYA, GOLD, HYA_D)], nflowers=5, shadow=W[0]),
    ]


def pressure():
    return TR.boulder(ST, OUT, seed=9, rx=7.4, ry=7.2, lobes=4, amp=0.05, flat=0.6)
