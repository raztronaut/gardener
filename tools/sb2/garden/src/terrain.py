"""Garden Edition — shared nature painters for the ten gardens (cell art, arena.py).

Grounds are tileable 64 x 64 textures laid in map space (so neighbouring cells join and the
4-cell period hides the 16 px grid), with decals (flowers, clover, pebbles, mushrooms,
leaves) scattered per cell by a stable hash. Bushes, rocks, stumps are 16 x 16 sprites over
the ground. Masses (hedges, treelines, canopy) are leaf textures lit as one mound over
their region, so their edges round off and throw a shadow into the field.
"""
import math
import numpy as np

from gfx import T, Rng, hash2, blank, grid, over
import nature as N

TEX = 64


# ---- layout helpers --------------------------------------------------------------------------
def classify(L, static=('hard_block', 'wall', 'border')):
    """ring = static cells connected to the screen's frame; pillars = the other static
    cells; field = everything else with a metatile"""
    st = set()
    for (cx, cy) in L.cells:
        k = L.kind(cx, cy)
        if k in static or k is None:
            st.add((cx, cy))
    ring = set()
    todo = [(cx, cy) for (cx, cy) in st if cx in (0, 16) or cy in (L.y0, L.y1)]
    while todo:
        c = todo.pop()
        if c in ring or c not in st:
            continue
        ring.add(c)
        x, y = c
        todo += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    pillars = st - ring
    field = set(L.cells) - st
    return ring, pillars, field


def cell_mask(cells, pad=0):
    m = np.zeros((512, 512), bool)
    for (cx, cy) in cells:
        m[cy * 16:cy * 16 + 16, cx * 16:cx * 16 + 16] = True
    return m


def tile_tex(cv_layer, tex, cells, ox=0, oy=0):
    """lay a tileable texture over the cells (map-space coordinates)"""
    th, tw = tex.shape
    for (cx, cy) in cells:
        for y in range(16):
            yy = cy * 16 + y
            row = tex[(yy + oy) % th]
            for x in range(16):
                v = row[(cx * 16 + x + ox) % tw]
                if v >= 0:
                    cv_layer[yy, cx * 16 + x] = v


def cell_hash(cx, cy, salt):
    return hash2(cx, cy, salt)


# ---- grounds -----------------------------------------------------------------------------------
def patches(n, levels, ramp, ox=0, oy=0, dither=0.12):
    """quantise a noise field into ramp colours at the given thresholds (ascending), with a
    narrow ordered-dither band at every threshold"""
    H, W = n.shape
    ys, xs = np.mgrid[0:H, 0:W]
    thr = N.BAYER4[(ys + oy) & 3, (xs + ox) & 3] - 0.5
    v = n + thr * dither
    idx = np.zeros((H, W), int)
    for t in levels:
        idx += (v > t)
    return np.array(ramp, np.int32)[idx]


def grass_tex(ramp, seed, tuft=0.6, lush=0.5, size=TEX, blades=True):
    """lush grass: ramp = [deep, dark, base, light, tip]. Low-frequency patches of darker /
    lighter turf, many small blade tufts (lit tip, dark root)."""
    deep, dark, base, light, tip = ramp
    n = N.fbm(size, size, seed, ((32, 1.0), (16, 0.6), (8, 0.3)), period=size)
    img = patches(n, [0.30, 0.66 - 0.12 * lush], [dark, base, light])
    if blades:
        pts = N.poisson(size, size, 3.2 / max(0.2, tuft) ** 0.5, seed * 3 + 1)
        r = Rng(seed * 11 + 5)
        for (x, y) in pts:
            x, y = int(x), int(y)
            here = img[y % size, x % size]
            lo = deep if here == dark else dark if here == base else base
            hi = light if here == base else tip if here == light else base
            k = r.rand(4)
            if k == 0:        # a 'v' of two blades
                pix = [(0, 0, hi), (2, 0, hi), (0, 1, lo), (1, 1, lo), (2, 1, lo)]
            elif k == 1:      # three blades, the middle one taller
                pix = [(1, -1, hi), (0, 0, hi), (1, 0, lo), (2, 0, hi), (0, 1, lo), (2, 1, lo)]
            elif k == 2:      # a single blade leaning
                pix = [(1, 0, hi), (0, 1, lo)]
            else:             # a dark notch (shadow between clumps)
                pix = [(0, 0, lo), (1, 0, lo)]
            for dx, dy, c in pix:
                img[(y + dy) % size, (x + dx) % size] = c
    return img


def moss_tex(ramp, seed, size=TEX):
    """soft moss: rounded cushions (lit upper left) on a darker bed"""
    deep, dark, base, light, tip = ramp
    lumv = np.full((size, size), -0.6)
    pts = N.poisson(size, size, 4.0, seed)
    r = Rng(seed + 9)
    for (cx, cy) in pts:
        rad = 2.0 + r.rand(15) / 10.0
        for y in range(int(cy - rad - 1), int(cy + rad + 2)):
            for x in range(int(cx - rad - 1), int(cx + rad + 2)):
                dx, dy = (x + 0.5 - cx) / rad, (y + 0.5 - cy) / rad
                d = dx * dx + dy * dy
                if d > 1:
                    continue
                l = (-dx * 0.55 - dy * 0.83 + math.sqrt(1 - d) * 0.75) / 1.25
                yy, xx = y % size, x % size
                lumv[yy, xx] = max(lumv[yy, xx], l)
    n = N.fbm(size, size, seed + 1, ((32, 1.0), (16, 0.5)), period=size)
    lumv += (n - 0.5) * 0.6
    return N.shade(lumv, [deep, dark, base, light, tip], -0.7, 1.0, dither=0.3)


def soil_tex(ramp, seed, size=TEX, pebble=None, furrows=False):
    """earth: ramp = [deep, dark, base, light]; crumbs, small cracks, optional pebbles"""
    deep, dark, base, light = ramp
    n = N.fbm(size, size, seed, ((16, 1.0), (8, 0.6), (4, 0.4)), period=size)
    img = patches(n, [0.28, 0.70], [dark, base, light], dither=0.25)
    if furrows:
        for y in range(size):
            for x in range(size):
                w = int(1.5 * math.sin((x + seed) * 0.21))
                if (y + w) % 8 == 6:
                    img[y, x] = deep
                elif (y + w) % 8 == 5:
                    img[y, x] = light if hash2(x, y, seed) % 3 else base
    r = Rng(seed + 3)
    for (x, y) in N.poisson(size, size, 5.0, seed + 7):
        x, y = int(x), int(y)
        if r.rand(3) == 0:
            img[y % size, x % size] = deep
            img[y % size, (x + 1) % size] = dark
        else:
            img[y % size, x % size] = light if r.rand(2) else dark
    if pebble:
        for (x, y) in N.poisson(size, size, 11.0, seed + 13):
            pebble_at(img, int(x), int(y), pebble, wrap=True, seed=int(x * 7 + y))
    return img


def gravel_tex(ramp, seed, size=TEX, rake=False):
    """fine gravel: ramp = [deep, dark, base, light, hi]; rake = parallel raked lines"""
    deep, dark, base, light, hi = ramp
    img = np.full((size, size), base, np.int32)
    for y in range(size):
        for x in range(size):
            h = hash2(x, y, seed) % 23
            if rake:
                ph = (y + int(1.2 * math.sin(x * 0.19 + seed))) % 4
                img[y, x] = [light, base, dark, base][ph]
                if h == 0:
                    img[y, x] = hi
                elif h == 1:
                    img[y, x] = deep
            else:
                if h < 3:
                    img[y, x] = light
                elif h < 5:
                    img[y, x] = dark
                elif h == 5:
                    img[y, x] = hi
    if not rake:
        for (x, y) in N.poisson(size, size, 3.6, seed + 1):
            x, y = int(x), int(y)
            img[y % size, x % size] = light
            img[y % size, (x + 1) % size] = hi
            img[(y + 1) % size, x % size] = dark
            img[(y + 1) % size, (x + 1) % size] = deep
    return img


def pebble_at(img, x, y, ramp, wrap=False, seed=0, big=False):
    """a small stone (ramp = [shadow, dark, mid, light])"""
    sh, dk, md, lt = ramp
    H, W = img.shape
    pat = ([(0, 0, lt), (1, 0, md), (0, 1, md), (1, 1, dk), (2, 1, sh), (1, 2, sh)] if not big else
           [(1, 0, lt), (2, 0, md), (0, 1, lt), (1, 1, md), (2, 1, md), (3, 1, dk), (0, 2, md), (1, 2, dk),
            (2, 2, dk), (3, 2, sh), (1, 3, sh), (2, 3, sh)])
    for dx, dy, c in pat:
        xx, yy = x + dx, y + dy
        if wrap:
            xx %= W
            yy %= H
        if 0 <= xx < W and 0 <= yy < H:
            img[yy, xx] = c


# ---- decals (16 x 16, transparent) --------------------------------------------------------------
def flower(img, x, y, petal, centre, shade=None, kind='plus'):
    """a tiny flower: 'plus' (4 petals, 3x3), 'dot' (1 px + centre), 'star' (5x5 sparse),
    'cup' (tulip-like 2 px)"""
    pts = {'plus': [(0, -1, petal), (-1, 0, petal), (1, 0, petal), (0, 1, shade or petal), (0, 0, centre)],
           'dot': [(0, 0, petal), (1, 0, shade or petal)],
           'big': [(0, -1, petal), (1, -1, petal), (-1, 0, petal), (0, 0, centre), (1, 0, centre), (2, 0, petal),
                   (-1, 1, shade or petal), (0, 1, centre), (1, 1, centre), (2, 1, shade or petal),
                   (0, 2, shade or petal), (1, 2, shade or petal)],
           'cup': [(0, 0, petal), (1, 0, petal), (0, 1, shade or petal), (1, 1, centre)]}[kind]
    for dx, dy, c in pts:
        if 0 <= x + dx < img.shape[1] and 0 <= y + dy < img.shape[0]:
            img[y + dy, x + dx] = c


def decal_flowers(seed, cols, n=3, kinds=('plus',), stem=None, spread=11):
    """a few small flowers (cols = list of (petal, centre, shade)); stem colour optional"""
    img = blank(16, 16)
    r = Rng(seed)
    cx, cy = 3 + r.rand(10), 3 + r.rand(10)
    placed = []
    for k in range(n * 4):
        if len(placed) >= n:
            break
        x = min(13, max(2, cx + r.rand(spread) - spread // 2))
        y = min(13, max(2, cy + r.rand(spread) - spread // 2))
        if any(abs(x - a) + abs(y - b) < 3 for a, b in placed):
            continue
        placed.append((x, y))
        p, c, s = cols[r.rand(len(cols))]
        if stem is not None:
            img[y + 1, x] = stem
            if y + 2 < 16:
                img[y + 2, x] = stem
        flower(img, x, y, p, c, s, kinds[r.rand(len(kinds))])
    return img


def decal_clover(seed, ramp, n=3, bloom=None):
    """clover leaves (ramp = [dark, mid, light]) and an optional white / pink bloom"""
    dark, mid, light = ramp
    img = blank(16, 16)
    r = Rng(seed)
    for k in range(n):
        x, y = 2 + r.rand(11), 2 + r.rand(11)
        for dx, dy, c in ((0, -1, light), (-1, 0, mid), (1, 0, light), (0, 0, dark), (0, 1, dark),
                          (-1, -1, light if r.rand(2) else mid), (1, 1, mid)):
            if 0 <= x + dx < 16 and 0 <= y + dy < 16:
                img[y + dy, x + dx] = c
    if bloom:
        x, y = 3 + r.rand(9), 3 + r.rand(9)
        p, c = bloom
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            img[y + dy, x + dx] = p
        img[y, x] = c
    return img


def decal_pebbles(seed, ramp, n=3, big=1):
    img = blank(16, 16)
    r = Rng(seed)
    for k in range(n):
        pebble_at(img, 1 + r.rand(11), 1 + r.rand(11), ramp, big=k < big)
    return img


def decal_mushrooms(seed, cap, stem, n=2, spots=None):
    """tiny toadstools: cap = (dark, mid, light), stem = (dark, light)"""
    img = blank(16, 16)
    r = Rng(seed)
    for k in range(n):
        x, y = 2 + r.rand(10), 3 + r.rand(9)
        cd, cm, cl = cap
        sd, sl = stem
        for dx, dy, c in ((0, 0, cl), (1, 0, cm), (2, 0, cm), (-1, 1, cm), (0, 1, cm), (1, 1, cm),
                          (2, 1, cm), (3, 1, cd), (0, 2, sl), (1, 2, sl), (2, 2, sd), (0, 3, sd), (1, 3, sd)):
            if 0 <= x + dx < 16 and 0 <= y + dy < 16:
                img[y + dy, x + dx] = c
        if spots:
            img[y + 1, x] = spots
    return img


def decal_leaves(seed, cols, n=3):
    """fallen leaves (cols = list of (light, dark))"""
    img = blank(16, 16)
    r = Rng(seed)
    for k in range(n):
        x, y = 2 + r.rand(11), 2 + r.rand(11)
        lt, dk = cols[r.rand(len(cols))]
        if r.rand(2):
            pix = [(0, 0, lt), (1, 0, lt), (1, 1, dk), (2, 1, dk)]
        else:
            pix = [(1, 0, lt), (0, 1, lt), (1, 1, dk), (0, 2, dk)]
        for dx, dy, c in pix:
            if 0 <= x + dx < 16 and 0 <= y + dy < 16:
                img[y + dy, x + dx] = c
    return img


def decal_tuft(seed, ramp, n=2):
    """tall grass tufts (ramp = [dark, mid, light, tip])"""
    dark, mid, light, tip = ramp
    img = blank(16, 16)
    r = Rng(seed)
    for k in range(n):
        x, y = 2 + r.rand(10), 4 + r.rand(9)
        for b, (dx, hgt, lean) in enumerate(((0, 3, -1), (2, 4, 0), (4, 3, 1), (1, 2, 0), (3, 2, 0))):
            for j in range(hgt):
                xx = x + dx + (lean if j >= hgt - 1 else 0)
                yy = y - j
                if 0 <= xx < 16 and 0 <= yy < 16:
                    img[yy, xx] = tip if j == hgt - 1 else light if j > 0 else dark
        for dx in range(5):
            if 0 <= x + dx < 16 and y + 1 < 16:
                img[y + 1, x + dx] = dark
    return img


def scatter(cv_layer, cells, decals, prob, salt):
    """one decal per chosen cell (hash < prob), decals picked by hash"""
    for (cx, cy) in cells:
        h = cell_hash(cx, cy, salt)
        if (h % 1000) / 1000.0 >= prob:
            continue
        d = decals[(h // 1000) % len(decals)]
        sub = cv_layer[cy * 16:cy * 16 + 16, cx * 16:cx * 16 + 16]
        m = d >= 0
        sub[m] = d[m]


# ---- soft blocks ------------------------------------------------------------------------------------
def bush(ramp, outline, seed=0, rx=6.9, ry=6.6, cx=8.0, cy=7.6, lobes=6, amp=0.10, flowers=None,
         nflowers=5, berries=None, shadow=None, r=(1.3, 2.3), density=1.0, tuft_top=False, glob=0.8):
    """a round leafy bush filling the cell: ramp = 5 greens dark..light; flowers = list of
    (petal, centre, shade); berries = (red, highlight); shadow = ground-shadow colour drawn
    as a thin crescent under the bush"""
    m = N.blob(16, 16, cx, cy, rx, ry, lobes=lobes, amp=amp, seed=seed)
    img = N.foliage(m, ramp, seed=seed + 1, r=r, density=density, dome_r=5.0, glob=glob)
    rr = Rng(seed + 5)
    if flowers:
        pts = []
        for k in range(nflowers * 6):
            if len(pts) >= nflowers:
                break
            x, y = 2 + rr.rand(12), 2 + rr.rand(11)
            if not m[y, x] or (x + y > 19 and rr.rand(3)):
                continue
            if any(abs(x - a) + abs(y - b) < 3 for a, b in pts):
                continue
            pts.append((x, y))
            p, c, s = flowers[rr.rand(len(flowers))]
            flower(img, x, y, p, c, s, 'plus')
            img = np.where(m, img, T)
    if berries:
        red, hi = berries
        pts = []
        for k in range(40):
            if len(pts) >= 6:
                break
            x, y = 2 + rr.rand(12), 2 + rr.rand(12)
            if not (m[y, x] and m[y + 1, x + 1] if y < 15 and x < 15 else False):
                continue
            if any(abs(x - a) + abs(y - b) < 3 for a, b in pts):
                continue
            pts.append((x, y))
            img[y, x] = hi
            img[y, x + 1] = red
            img[y + 1, x] = red
            img[y + 1, x + 1] = outline
    img = N.selout(img, outline, None)
    if shadow is not None:
        sh = N.shift(img >= 0, 1, 1) & (img < 0)
        ys, xs = np.mgrid[0:16, 0:16]
        sh &= (ys >= 9)
        img[sh] = shadow
    return img


def fern(ramp, outline, seed=0, fronds=7, shadow=None):
    """a fern clump from above: fronds radiating from the centre, leaflets either side"""
    dark, d2, mid, light, hi = ramp
    img = blank(16, 16)
    r = Rng(seed)
    cx, cy = 7.5, 8.0
    order = []
    for k in range(fronds):
        a = (k / fronds) * 2 * math.pi + (r.rand(40) - 20) / 100.0
        L = 6.0 + r.rand(15) / 10.0
        order.append((math.sin(a), a, L))
    order.sort()     # back (top) fronds first
    for s, a, L in order:
        ca, sa = math.cos(a), math.sin(a)
        steps = int(L * 2)
        for i in range(steps):
            t = i / 2.0
            bend = 0.06 * t * t
            x = cx + ca * t - sa * bend
            y = cy + sa * t + ca * bend
            w = max(0.0, 1.8 * (1 - t / L) + 0.4)
            for side in (-1, 1):
                for j in range(int(w) + 1):
                    lx = x - sa * side * j
                    ly = y + ca * side * j
                    xi, yi = int(round(lx)), int(round(ly))
                    if 0 <= xi < 16 and 0 <= yi < 16:
                        lit = -ca * 0.55 - sa * 0.83
                        c = hi if (j == 0 and lit > 0.3) else light if lit > 0 else mid if lit > -0.5 else d2
                        if j == int(w):
                            c = d2 if lit > -0.2 else dark
                        img[yi, xi] = c
    img = N.selout(img, outline, None)
    if shadow is not None:
        sh = N.shift(img >= 0, 1, 1) & (img < 0)
        img[sh] = shadow
    return img


def grass_clump(ramp, outline, seed=0, shadow=None, seeds=None):
    """a clump of tall grass: many blades from a base, arching outwards, seed heads"""
    dark, d2, mid, light, hi = ramp
    img = blank(16, 16)
    r = Rng(seed)
    bl = []
    for k in range(22):
        bx = 3.5 + r.rand(90) / 10.0
        lean = (bx - 8) * 0.22 + (r.rand(10) - 5) / 10.0
        hgt = 9 + r.rand(5)
        bl.append((r.rand(100), bx, lean, hgt))
    bl.sort()
    for _, bx, lean, hgt in bl:
        for j in range(hgt):
            t = j / hgt
            x = bx + lean * j * (0.3 + t)
            y = 14 - j
            xi, yi = int(round(x)), int(round(y))
            if 0 <= xi < 16 and 0 <= yi < 16:
                c = hi if t > 0.85 else light if t > 0.55 else mid if t > 0.25 else d2
                if lean > 0.5 and t > 0.3:
                    c = mid if c == light else c
                img[yi, xi] = c
        if seeds and hgt >= 12:
            xi, yi = int(round(bx + lean * hgt * 1.3)), 14 - hgt
            if 0 <= xi < 16 and 0 <= yi < 16:
                img[yi, xi] = seeds
    img = N.selout(img, outline, None)
    if shadow is not None:
        sh = N.shift(img >= 0, 1, 1) & (img < 0)
        ys, xs = np.mgrid[0:16, 0:16]
        img[sh & (ys >= 12)] = shadow
    return img


# ---- hard blocks -------------------------------------------------------------------------------------
def boulder(stone, outline, seed=0, moss=None, rx=7.0, ry=6.6, cx=8.0, cy=8.0, lobes=4, amp=0.08, cracks=1,
            snow=None, flat=0.3):
    """a rounded rock: stone = 5 greys dark..light; moss = 4 greens (on the lit top);
    snow = (white, blue-white) cap"""
    m = N.blob(16, 16, cx, cy, rx, ry, lobes=lobes, amp=amp, seed=seed)
    lumv = N.dome(m, 5.5, flat=flat)
    n = N.fbm(16, 16, seed + 3, ((8, 1.0), (4, 0.5)))
    img = N.shade(lumv + (n - 0.5) * 0.5, stone, -1.0, 1.0, dither=0.3, mask=m)
    ys, xs = np.mgrid[0:16, 0:16]
    if moss:
        mm = m & (lumv + (n - 0.5) * 1.6 > 0.35) & (ys < cy + 2)
        mimg = N.shade(lumv + (n - 0.5) * 0.8, moss, -0.4, 1.2, dither=0.3)
        img[mm] = mimg[mm]
    if snow:
        wh, bw = snow
        sm = m & ((ys + (n * 3).astype(int)) < cy - 1.5)
        img[sm] = np.where(lumv[sm] > 0.2, wh, bw)
    r = Rng(seed + 8)
    for k in range(cracks):
        x, y = 6 + r.rand(5), 7 + r.rand(4)
        for j in range(4):
            if m[y, x] and (img[y, x] in stone):
                img[y, x] = stone[0]
            x += 1 if r.rand(2) else 0
            y += 1
    img = N.selout(img, outline, None)
    return img


def stump(bark, wood, outline, seed=0, moss=None, r=6.6):
    """a cut tree stump from above: rings on the top, bark ring, roots at the bottom"""
    img = blank(16, 16)
    cx, cy = 8.0, 7.0
    ys, xs = np.mgrid[0:16, 0:16]
    # roots / the side (below the top)
    side = ((xs + 0.5 - cx) / (r + 0.6)) ** 2 + ((ys + 0.5 - cy - 2.2) / (r - 0.6)) ** 2 <= 1
    rr = Rng(seed)
    for (rx, ry) in ((2, 13), (13, 12), (4, 14), (11, 14)):
        if rr.rand(3):
            side[ry - 1:ry + 1, rx - 1:rx + 2] = True
    sl = N.dome(side, 3.0)
    img = np.where(side, N.shade(sl, bark, -1.0, 1.0, dither=0.2), T)
    for x in range(16):
        if (x + seed) % 3 == 0:
            for y in range(16):
                if side[y, x] and img[y, x] != bark[0] and (y > cy + 2):
                    img[y, x] = bark[1]
    top = ((xs + 0.5 - cx) / r) ** 2 + ((ys + 0.5 - cy) / (r - 0.9)) ** 2 <= 1
    d = np.hypot((xs + 0.5 - cx) / r, (ys + 0.5 - cy) / (r - 0.9))
    rings = np.where(d > 0.86, wood[0], np.where(((d * 9).astype(int) % 2) == 0, wood[2], wood[1]))
    rings = np.where((d < 0.86) & (xs + ys < 11) & (((d * 9).astype(int) % 2) == 0), wood[3], rings)
    img[top] = rings[top]
    img[int(cy), int(cx)] = wood[0]
    if moss:
        n = N.fbm(16, 16, seed + 2, ((4, 1.0),))
        mm = side & ~top & (n > 0.55)
        img[mm] = np.where(xs[mm] < 8, moss[1], moss[0])
    return N.selout(img, outline, None)


def log_h(bark, wood, outline, seed=0, moss=None):
    """a fallen log lying across the cell (end rings on the right)"""
    img = blank(16, 16)
    m = np.zeros((16, 16), bool)
    m[3:13, 0:16] = True
    m[3, 0] = m[12, 0] = False
    ys, xs = np.mgrid[0:16, 0:16]
    l = 1 - np.abs(ys - 6.0) / 6.0
    img = np.where(m, N.shade(l * 1.6 - 0.6, bark, -1.0, 1.0, dither=0.2), T)
    for y in range(4, 12):
        for x in range(0, 13):
            if (x * 3 + y * 7 + seed) % 11 == 0:
                img[y, x] = bark[1]
    # end grain
    for y in range(3, 13):
        for x in range(12, 16):
            dx, dy = (x - 13.5) / 2.5, (y - 7.5) / 4.8
            dd = dx * dx + dy * dy
            if dd <= 1:
                img[y, x] = wood[2] if int(math.sqrt(dd) * 3) % 2 == 0 else wood[1]
    if moss:
        n = N.fbm(16, 16, seed + 2, ((4, 1.0),))
        mm = m & (ys < 6) & (n > 0.5) & (xs < 12)
        img[mm] = np.where(ys[mm] < 4, moss[1], moss[0])
    return N.selout(img, outline, None)


def standing_stone(stone, outline, seed=0, moss=None, lichen=None):
    """an upright stone seen from above-front: lit top face, a front face with grooves"""
    img = blank(16, 16)
    ys, xs = np.mgrid[0:16, 0:16]
    m = N.blob(16, 16, 8.0, 7.6, 6.0, 7.2, lobes=3, amp=0.07, seed=seed)
    top = m & (ys < 6 + (N.fbm(16, 16, seed, ((8, 1.0),)) * 2).astype(int))
    lumv = N.dome(m, 4.0)
    img = N.shade(lumv, stone[:4], -1.0, 1.0, dither=0.3, mask=m)
    img[top] = np.where(xs[top] < 9, stone[4], stone[3])
    for x in range(4, 13, 3):
        for y in range(7, 14):
            if m[y, x] and not top[y, x]:
                img[y, x] = stone[1]
    if moss:
        n = N.fbm(16, 16, seed + 4, ((4, 1.0),))
        mm = m & ~top & (n > 0.62)
        img[mm] = moss[1]
    if lichen:
        r = Rng(seed)
        for k in range(3):
            x, y = 4 + r.rand(8), 2 + r.rand(4)
            if top[y, x]:
                img[y, x] = lichen
    return N.selout(img, outline, None)


# ---- masses (hedges, canopy) --------------------------------------------------------------------------
def leaf_texture(size, seed, r=(1.6, 2.8), density=1.1):
    """tileable leaf-cluster light field: lum (-1.5 between clusters) per pixel"""
    lumv = np.full((size, size), -1.5)
    rng = Rng(seed)
    n = int(size * size * density / (math.pi * ((r[0] + r[1]) / 2) ** 2)) + 1
    pts = []
    for k in range(n):
        pts.append((rng.rand(size * 10) / 10.0, rng.rand(size * 10) / 10.0, r[0] + (r[1] - r[0]) * rng.rand(100) / 100.0))
    pts.sort(key=lambda p: p[1])
    for (cx, cy, rad) in pts:
        for y in range(int(cy - rad - 1), int(cy + rad + 2)):
            for x in range(int(cx - rad - 1), int(cx + rad + 2)):
                dx, dy = (x + 0.5 - cx) / rad, (y + 0.5 - cy) / rad
                dd = dx * dx + dy * dy
                if dd > 1:
                    continue
                l = (-dx * 0.55 - dy * 0.83 + math.sqrt(1 - dd) * 0.75) / 1.25
                lumv[y % size, x % size] = l * 1.1 - 0.15
    return lumv


def mass(cv_layer, region, ramp, seed, outline=None, soft_outline=None, dome_r=9.0, glob=0.9, tex=None,
         r=(1.6, 2.8), density=1.1, bias=0.0, size=TEX):
    """paint a leafy mass over a region (bool mask, map space): a tileable cluster texture
    lit as one mound over the region; outline below / right in `outline`"""
    if tex is None:
        tex = leaf_texture(size, seed, r, density)
    ys, xs = np.nonzero(region)
    if len(ys) == 0:
        return
    y0, y1, x0, x1 = max(0, ys.min() - 2), min(512, ys.max() + 3), max(0, xs.min() - 2), min(512, xs.max() + 3)
    reg = region[y0:y1, x0:x1]
    g = N.dome(reg, dome_r)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    lt = tex[yy % size, xx % size]
    lumv = np.where(lt > -1.2, lt + glob * g + bias, -1.4 + 0.5 * g)
    img = N.shade(lumv, ramp, -1.0, 1.0, dither=0.25, ox=x0, oy=y0, mask=reg)
    if outline is not None:
        img = N.selout(img, outline, soft_outline)
    sub = cv_layer[y0:y1, x0:x1]
    m = img >= 0
    sub[m] = img[m]


def rough_region(cells, seed, amp=2.5, inward=None, outward=None):
    """the region of a set of cells with an organic edge: pixels near the region's border
    are pushed in / out by low-frequency noise (amp px). Returns a bool mask."""
    m = cell_mask(cells)
    n = N.fbm(512, 512, seed, ((16, 1.0), (8, 0.5)), period=512)
    d_in = N.dist_inside(m, cap=int(amp) + 3)
    d_out = N.dist_inside(~m, cap=int(amp) + 3)
    off = (n - 0.5) * 2 * amp
    keep = (m & (d_in > -off)) | (~m & (d_out <= off))
    if inward is not None:
        keep &= ~inward
    if outward is not None:
        keep |= outward
    return keep
