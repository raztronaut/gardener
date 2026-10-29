"""Stage 8 — the JAPANESE GARDEN: deep moss and raked gravel; the original's conveyor belts
are a STREAM in a bed of river pebbles whose water flows (the original's palette cycle
drives it: 5 water colours turn along the flow); its switches are a millstone
(direction) and a lotus basin (speed); stone lanterns whose lights flicker (the second
cycle) and mossy rocks (hard); blue hydrangeas, ferns and azaleas (soft); a bamboo grove
all round."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Japanese Garden'

FLOW = [C('#16508a'), C('#2a70b0'), C('#4a94cc'), C('#7cbce0'), C('#c4e8f8')]   # phase 0, band 0..4
LIGHTS = [C('#ffe070'), C('#ff8030'), C('#d06018')]                              # row 7 cycle (2 phases)
CYCLES = {6: {'colours': FLOW, 'rom': 0xDBFE, 'phases': 4},
          7: {'colours': LIGHTS, 'rom': 0xDC7E, 'phases': 2}}
BANDS = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4]

M = [C('#18301a'), C('#22441f'), C('#305a26'), C('#447230'), C('#5e8a3c')]
M_SH = C('#122614')
ST = [C('#34383a'), C('#565a5a'), C('#7a7e7c'), C('#a2a6a0'), C('#cacec4')]
PEB = ST[:4]
OUT = C('#0a140c')
HYD = [C('#3a4aa8'), C('#6a7ae0'), C('#a8b8f8')]
AZA = [C('#c02a5a'), C('#f06a9a')]
B = [C('#14321a'), C('#1f4c24'), C('#2e6a2e'), C('#46883a'), C('#6ca850')]
BAM = B
CANE = [C('#46883a'), C('#a8c860')]
MAPLE = [C('#c02a5a'), C('#f06a9a')]
BASIN = C('#1c3a4a')

SHADE = {M[4]: M[2], M[3]: M[1], M[2]: M[0], M[1]: M_SH, M[0]: M_SH}


def ground_tex():
    return TR.moss_tex(M, 808)


def decals():
    d = []
    for s in (1, 2):
        im = blank(16, 16)
        m = N.blob(16, 16, 8.0, 8.5, 5.2, 3.6, lobes=4, amp=0.1, seed=s)
        lv = N.dome(m, 2.0, flat=0.3)
        im = N.shade(lv, [M[1], ST[0], ST[1], ST[2]], -1.0, 1.0, dither=0.2, mask=m)
        d.append(im)
    d.append(TR.decal_leaves(3, [(MAPLE[1], MAPLE[0])], n=3))
    d.append(TR.decal_tuft(4, [B[1], B[2], B[3], B[4]], n=1))
    d.append(TR.decal_pebbles(5, [M_SH, PEB[1], PEB[2], PEB[3]], n=3))
    return d


def channel(kind):
    """kind: '+x' '-x' '+y' '-y' or a corner 'b>r' 'l>b' 't>l' 'r>t' (geometry and flow
    direction of the original's belts, checked against conveyed bombs)"""
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            if kind in ('+x', '-x'):
                along, cross = (x + 0.5), (y + 0.5 - 8)
                if kind == '-x':
                    along = 16 - along
            elif kind in ('+y', '-y'):
                along, cross = (y + 0.5), (x + 0.5 - 8)
                if kind == '-y':
                    along = 16 - along
            else:
                cxy = {'b>r': (16, 16), 'l>b': (0, 16), 't>l': (0, 0), 'r>t': (16, 0)}[kind]
                dx, dy = x + 0.5 - cxy[0], y + 0.5 - cxy[1]
                r = math.hypot(dx, dy)
                cross = r - 8
                th = math.atan2(abs(dy), abs(dx))
                if kind in ('b>r', 't>l'):
                    along = th / (math.pi / 2) * 16
                else:
                    along = (1 - th / (math.pi / 2)) * 16
            a = abs(cross)
            if a <= 5.0:
                pos = (along + 0.7 * a) % 16
                img[y, x] = FLOW[BANDS[int(pos) % 16]]
            elif a <= 7.8:
                # river pebbles along both banks (a pattern periodic along the flow)
                u = int(along) % 16
                k = (u // 4) + (0 if cross < 0 else 7)
                v = (a - 5.0) / 2.8
                cu = (u % 4) / 3.0
                bump = 1 - ((cu - 0.5) * 2) ** 2 - ((v - 0.45) * 2) ** 2
                if bump < 0.05:
                    img[y, x] = PEB[0]
                else:
                    lit = (0.5 - cu) * 0.5 + (0.45 - v) * 0.6 + (hash2(k, 3, 8) % 3 - 1) * 0.15
                    img[y, x] = PEB[3] if lit > 0.25 else PEB[2] if lit > -0.1 else PEB[1]
                    if a <= 5.5:
                        img[y, x] = PEB[1] if bump < 0.4 else img[y, x]
    return img


def lantern():
    """a stone lantern from above-front: a roof cap, the light box glowing (cycle)"""
    t = grid("""
.....oooooo.....
...oo334433oo...
.oo3444444443oo.
o34444444444433o
o33333333333332o
.oooooooooooooo.
..o32LMMMML23o..
..o32MNNNNM23o..
..o32LMMMML23o..
..oooooooooooo..
.o333333333332o.
..oooo3332oooo..
.....o3332o.....
....oo3332oo....
..o3333333332o..
..ooooooooooo...
""", {'o': OUT, '4': ST[4], '3': ST[3], '2': ST[2], 'L': LIGHTS[0], 'M': LIGHTS[2], 'N': LIGHTS[1]})
    return t


def wheel(frame):
    """a millstone (the direction switch): its grooves turn over 3 frames, a light in its hub"""
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            ang = math.atan2(y - 7.5, x - 7.5) + frame * math.pi / 9
            if d <= 7.4:
                lum = -((x - 7.5) * 0.7 + (y - 7.5) * 0.7) / 7.4
                c = ST[4] if lum > 0.4 else ST[3] if lum > -0.3 else ST[2]
                if 2.6 < d < 6.6 and abs(math.sin(3 * ang)) < 0.22:
                    c = ST[1]
                if d > 6.8:
                    c = OUT
                img[y, x] = c
                if d < 2:
                    img[y, x] = LIGHTS[0] if d < 1.2 else LIGHTS[2]
    return img


def lotus_basin(frame):
    """a stone basin where a lotus opens (the speed switch), 3 frames"""
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d <= 7.4:
                img[y, x] = OUT if d > 6.8 else ST[3] if d > 5.6 else BASIN
    open_ = [1.6, 2.6, 3.6][frame]
    for k in range(6):
        ang = k * math.pi / 3 + frame * 0.3
        cx, cy = 7.5 + open_ * math.cos(ang), 7.5 + open_ * math.sin(ang)
        for y in range(16):
            for x in range(16):
                if math.hypot(x - cx, y - cy) <= 1.5:
                    img[y, x] = AZA[1] if (x - cx) + (y - cy) < 0.5 else AZA[0]
    img[7, 7] = LIGHTS[0]
    img[8, 8] = LIGHTS[0]
    img[7, 8] = LIGHTS[2]
    img[8, 7] = LIGHTS[2]
    return img


def gimmicks():
    g = {}
    for n, k in (('gimmick_17_0', '+x'), ('gimmick_18_0', '-x'), ('gimmick_19_0', '-y'), ('gimmick_1a_0', '+y'),
                 ('gimmick_1d_0', 'b>r'), ('gimmick_1b_0', 'l>b'), ('gimmick_1c_0', 't>l'), ('gimmick_1e_0', 'r>t')):
        g[n] = channel(k)
    for k in range(3):
        g['gimmick_12_%d' % k] = wheel(k)
        g['gimmick_13_%d' % k] = lotus_basin(k)
    return g


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    TR.tile_tex(cv.base, ground_tex(), allc)
    stream = {c for c in field if (L.at(*c) or '').startswith('gimmick_1')}
    TR.scatter(cv.decal, field - stream, decals(), 0.36, 81)
    # the bamboo grove: a leafy mass with pale canes showing through
    reg = TR.rough_region(ring, 83, amp=1.4)
    TR.mass(cv.obj, reg, BAM, 84, outline=OUT, dome_r=8.0, glob=0.8, r=(1.0, 2.0), density=1.2)
    r = Rng(85)
    for k in range(400):
        x, y = r.rand(512), r.rand(512)
        if not reg[y, x]:
            continue
        ln = 4 + r.rand(6)
        for j in range(ln):
            if y + j < 512 and reg[y + j, x] and cv.obj[y + j, x] != OUT:
                cv.obj[y + j, x] = CANE[1] if j % 4 else CANE[0]
                if x + 1 < 512 and reg[y + j, x + 1]:
                    cv.obj[y + j, x + 1] = CANE[0]
    hard = [lantern(), TR.boulder(ST, OUT, seed=2, moss=[M[1], M[2], M[3], M[4]]), lantern(),
            TR.boulder(ST, OUT, seed=4, lobes=5, moss=[M[1], M[2], M[3], M[4]])]
    for (cx, cy) in pillars:
        cv.put('obj', hard[TR.cell_hash(cx, cy, 5) % len(hard)], cx * 16, cy * 16)


def soft():
    return [
        TR.bush(B, OUT, seed=1, flowers=[(HYD[2], HYD[1], HYD[0])], nflowers=7, shadow=M_SH),
        TR.bush(B, OUT, seed=2, flowers=[(HYD[1], HYD[2], HYD[0])], nflowers=6, shadow=M_SH, lobes=7),
        TR.fern(B, OUT, seed=3, shadow=M_SH),
        TR.bush(B, OUT, seed=4, flowers=[(AZA[1], HYD[2], AZA[0])], nflowers=7, shadow=M_SH),
    ]


def pressure():
    return TR.boulder(ST, OUT, seed=9, rx=7.4, ry=7.2, lobes=4, amp=0.05, flat=0.6)
