"""Stage 2 — the FROSTY WOODLAND: a frozen forest pond (the original's slippery ice) dusted
with snow, frozen leaves under the ice; dark frozen streams run beneath it (the
underground track) to black water holes; snow-capped holly, frosted firs and frozen
grass (soft); snowy boulders and stumps (hard); a fir treeline under snow all round."""
from common import *  # noqa: F401,F403
import terrain as TR
import nature as N

NAME = 'Frosty Woodland'
FLOOR_KINDS = ('floor', 'gimmick_07')

ICE = [C('#4f739c'), C('#6a92bc'), C('#88b0d4'), C('#a8cce6'), C('#d4ecf8')]
SNOW = C('#f4faff')
FROST = C('#c4dcee')
LEAF_FZ = C('#b07850')
LEAF_FZ2 = C('#7e8ea8')
# streams / holes
DEEP = [C('#0e1e38'), C('#1c3660'), C('#2e5486')]
# greens (holly, firs)
GR = [C('#0f2a24'), C('#1a4234'), C('#2a5e44'), C('#3e7a52'), C('#5c9a62')]
OUT = C('#0a1820')
BERRY = C('#d82838')
BERRY_H = C('#ff8a90')
ST = [C('#3a4250'), C('#58627a'), C('#7a86a0'), C('#a2acc2'), C('#ccd4e4')]
BARK = [C('#2a1c18'), C('#46302a'), C('#644638'), C('#86604a')]
WOOD = [C('#6a5040'), C('#9a7a5e'), C('#bc9c7c'), C('#dcc4a8')]

SHADE = {ICE[4]: ICE[2], ICE[3]: ICE[1], ICE[2]: ICE[0], ICE[1]: DEEP[2], ICE[0]: DEEP[1], SNOW: FROST, FROST: ICE[2]}


def ground_tex():
    n = N.fbm(64, 64, 202, ((32, 1.0), (16, 0.5), (8, 0.3)), period=64)
    img = TR.patches(n, [0.38, 0.70, 0.86], [ICE[1], ICE[2], ICE[3], FROST], dither=0.15)
    # frost streaks (diagonal glints on the ice)
    r = Rng(9)
    for (x, y) in N.poisson(64, 64, 9.0, 33):
        x, y = int(x), int(y)
        for k in range(3 + r.rand(3)):
            img[(y + k) % 64, (x + k) % 64] = ICE[4] if k % 2 == 0 else ICE[3]
    # snow drifts: soft white patches
    sn = N.fbm(64, 64, 207, ((16, 1.0), (8, 0.5)), period=64)
    img[sn > 0.76] = SNOW
    img[(sn > 0.71) & (sn <= 0.76)] = FROST
    return img


def decals():
    d = []
    d.append(TR.decal_leaves(1, [(LEAF_FZ, LEAF_FZ2)], n=2))
    d.append(TR.decal_leaves(2, [(LEAF_FZ2, ICE[1])], n=3))
    d.append(TR.decal_pebbles(3, [ICE[0], ST[1], ST[2], SNOW], n=2))
    # a frosty grass tuft poking out of the snow
    d.append(TR.decal_tuft(4, [GR[2], GR[3], FROST, SNOW], n=1))
    # little ice cracks
    for s in (5, 6):
        im = blank(16, 16)
        r = Rng(s)
        x, y = 3 + r.rand(6), 3 + r.rand(6)
        for k in range(9):
            if 0 <= x < 16 and 0 <= y < 16:
                im[y, x] = ICE[4] if k % 3 else SNOW
                if y + 1 < 16:
                    im[y + 1, x] = ICE[1]
            x += 1
            y += r.rand(3) - 1
        d.append(im)
    return d


def stream(conn):
    """a dark frozen stream under the ice, joining the cell edges in conn ('t','b','l','r')"""
    img = blank(16, 16)
    ys, xs = np.mgrid[0:16, 0:16]
    m = np.zeros((16, 16), bool)
    w = 3.2
    for c in conn:
        if c == 't':
            m |= (np.abs(xs + 0.5 - 8) < w) & (ys < 9)
        if c == 'b':
            m |= (np.abs(xs + 0.5 - 8) < w) & (ys >= 7)
        if c == 'l':
            m |= (np.abs(ys + 0.5 - 8) < w) & (xs < 9)
        if c == 'r':
            m |= (np.abs(ys + 0.5 - 8) < w) & (xs >= 7)
    m |= np.hypot(xs + 0.5 - 8, ys + 0.5 - 8) < w + 0.3
    d = N.dist_inside(m, 4)
    img[m] = np.where(d[m] > 2, DEEP[1], DEEP[2])
    # bubbles trapped in the ice and a pale rim
    for (x, y) in ((7, 7), (9, 9), (8, 5), (6, 10)):
        if m[y, x] and d[y, x] > 1:
            img[y, x] = ICE[2]
    rim = N.shift(m, 0, 1) | N.shift(m, 1, 0) | N.shift(m, 0, -1) | N.shift(m, -1, 0)
    rim &= ~m
    img[rim] = ICE[1]
    return img


def hole():
    """a black water hole in the ice with a broken white rim"""
    img = blank(16, 16)
    ys, xs = np.mgrid[0:16, 0:16]
    m = N.blob(16, 16, 8.0, 8.2, 5.8, 5.4, lobes=5, amp=0.1, seed=4)
    d = N.dist_inside(m, 5)
    img[m] = np.where(d[m] > 3, DEEP[0], np.where(d[m] > 1.5, DEEP[1], DEEP[2]))
    # the lit far side of the water (lower right) and a glint
    img[10, 10] = ICE[1]
    img[10, 9] = DEEP[2]
    rim = (N.shift(m, 1, 1) | N.shift(m, -1, -1) | N.shift(m, 1, -1) | N.shift(m, -1, 1)) & ~m
    img[rim] = np.where(ys[rim] < 8, SNOW, ICE[3])
    out = N.selout(img, ICE[1], None)
    return out


def gimmicks():
    g = {}
    for n, d in (('gimmick_08_0', 'rb'), ('gimmick_08_1', 'lb'), ('gimmick_08_2', 'tr'), ('gimmick_08_3', 'tl'),
                 ('gimmick_08_4', 'tb'), ('gimmick_08_5', 'lr'), ('gimmick_0a_0', 'tblr')):
        g[n] = stream(d)
    g['gimmick_49_0'] = hole()
    return g


def paint(cv, L):
    ring, pillars, field = TR.classify(L)
    allc = set(L.cells)
    TR.tile_tex(cv.base, ground_tex(), allc)
    TR.scatter(cv.decal, field, decals(), 0.35, 21)
    # the fir treeline: a dark mass, snow on its lit crowns
    reg = TR.rough_region(ring, 52, amp=1.8)
    TR.mass(cv.obj, reg, GR, 61, outline=OUT, dome_r=10.0, glob=0.9, r=(1.8, 3.2))
    tex = TR.leaf_texture(64, 61, (1.8, 3.2), 1.1)
    yy, xx = np.mgrid[0:512, 0:512]
    lt = tex[yy % 64, xx % 64]
    n = N.fbm(512, 512, 63, ((16, 1.0), (8, 0.5)), period=512)
    snowy = reg & (cv.obj >= 0) & (cv.obj != OUT) & (lt > 0.25 - (n - 0.5) * 0.8)
    cv.obj[snowy] = np.where(lt[snowy] > 0.55, SNOW, FROST)
    hard = hard_blocks()
    for (cx, cy) in pillars:
        cv.put('obj', hard[TR.cell_hash(cx, cy, 5) % len(hard)], cx * 16, cy * 16)


def hard_blocks():
    return [
        TR.boulder(ST, OUT, seed=1, snow=(SNOW, FROST)),
        TR.boulder(ST, OUT, seed=2, snow=(SNOW, FROST), lobes=5),
        TR.boulder(ST, OUT, seed=3, snow=(SNOW, FROST), rx=7.2, ry=6.2),
        snowy_stump(),
    ]


def snowy_stump():
    s = TR.stump(BARK, WOOD, OUT, seed=6)
    ys, xs = np.mgrid[0:16, 0:16]
    top = (s >= 0) & (s != OUT) & (ys < 9) & (((xs - 8) ** 2 / 36.0 + (ys - 6.5) ** 2 / 20.0) < 1)
    s[top] = np.where(xs[top] + ys[top] < 13, SNOW, FROST)
    return s


def soft():
    out = []
    holly = TR.bush(GR, OUT, seed=1, berries=(BERRY, BERRY_H), shadow=ICE[0])
    out.append(snowcap(holly, 1))
    out.append(snowcap(TR.bush(GR, OUT, seed=2, lobes=7, shadow=ICE[0]), 2))
    out.append(TR.conifer(GR, OUT, seed=3, snow=(SNOW, FROST), shadow=ICE[0]))
    out.append(TR.conifer(GR, OUT, seed=4, snow=(SNOW, FROST), shadow=ICE[0], r=7.0))
    out.append(snowcap(TR.bush(GR, OUT, seed=5, berries=(BERRY, BERRY_H), shadow=ICE[0]), 5))
    return out


def snowcap(img, seed):
    n = N.fbm(16, 16, seed + 40, ((4, 1.0),))
    ys, xs = np.mgrid[0:16, 0:16]
    m = (img >= 0) & (img != OUT) & ((ys + n * 4) < 7.5) & (img != BERRY) & (img != BERRY_H)
    img = img.copy()
    img[m] = np.where(xs[m] + ys[m] < 12, SNOW, FROST)
    return img


def pressure():
    # a block of pond ice
    return TR.boulder([ICE[0], ICE[1], ICE[2], ICE[3], SNOW], OUT, seed=9, rx=7.4, ry=7.2, lobes=4, amp=0.04, flat=0.6, cracks=2)
