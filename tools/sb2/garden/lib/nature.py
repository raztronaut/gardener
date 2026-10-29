"""Garden Edition — a small toolkit for organic SNES-style pixel art (pure numpy, no ROM data).

Images are int32 arrays of BGR555 colours (-1 = transparent), like gfx.py. Everything is
deterministic (seeded hashes, never numpy's RNG), so a build never changes by itself.

    vnoise / fbm         tileable value noise (period = the canvas size)
    dome(mask)           a height field over a mask (rounded edges), its light term
    shade(lum, ramp)     light -> ramp colours, ordered dithering only near band edges
    blob(...)            a lumpy round silhouette
    foliage(mask, ...)   leaf clusters filling a mask, lit per cluster and as a whole
    selout(img, ...)     selective outline (dark below / right, softer above / left)
    stamp(...)           place a small sprite (wrapping on a tileable canvas)
Light comes from the upper left; shadows fall down and to the right.
"""
import math
import numpy as np
from gfx import T, Rng, hash2

LIGHT = (-0.55, -0.83)      # direction TO the light in (x, y) screen space (upper left)
BAYER2 = np.array([[0.125, 0.625], [0.875, 0.375]])
BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16.0


def hashf(x, y, seed):
    return hash2(int(x), int(y), seed) / 65535.0


def vnoise(w, h, cell, seed, period=None):
    """smooth value noise, cell = lattice spacing in px; tileable when period (px) is a
    multiple of cell (default: the canvas size)"""
    pw = period or w
    ph = period or h
    gx, gy = max(1, pw // cell), max(1, ph // cell)
    lat = np.array([[hashf(i, j, seed) for i in range(gx)] for j in range(gy)])
    ys, xs = np.mgrid[0:h, 0:w].astype(float)
    fx, fy = (xs + 0.5) / cell, (ys + 0.5) / cell
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    a = lat[y0 % gy, x0 % gx]
    b = lat[y0 % gy, (x0 + 1) % gx]
    c = lat[(y0 + 1) % gy, x0 % gx]
    d = lat[(y0 + 1) % gy, (x0 + 1) % gx]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm(w, h, seed, octaves=((16, 1.0), (8, 0.5), (4, 0.25)), period=None):
    acc = np.zeros((h, w))
    tot = 0
    for k, (cell, amp) in enumerate(octaves):
        acc += amp * vnoise(w, h, cell, seed * 7 + k, period)
        tot += amp
    return acc / tot


def dist_inside(mask, cap=12):
    """chamfer distance (px) from each mask pixel to the nearest outside pixel (cap)"""
    H, W = mask.shape
    d = np.where(mask, float(cap), 0.0)
    pad = np.zeros((H + 2, W + 2))
    for _ in range(cap):
        pad[1:-1, 1:-1] = d
        nb = np.minimum.reduce([pad[0:-2, 1:-1], pad[2:, 1:-1], pad[1:-1, 0:-2], pad[1:-1, 2:]]) + 1
        dg = np.minimum.reduce([pad[0:-2, 0:-2], pad[0:-2, 2:], pad[2:, 0:-2], pad[2:, 2:]]) + 1.414
        nd = np.where(mask, np.minimum(d, np.minimum(nb, dg)), 0.0)
        if np.array_equal(nd, d):
            break
        d = nd
    return d


def dome(mask, radius=6.0, light=LIGHT, flat=0.0, wrap_edges=False):
    """light term (-1..1) of a rounded mound over the mask: height grows with the
    distance to the edge (circular profile up to radius px). flat > 0 lifts the top's light"""
    d = dist_inside(mask, cap=int(radius) + 2)
    t = np.clip(d / radius, 0, 1)
    hgt = np.sqrt(1 - (1 - t) ** 2) * radius
    gy, gx = np.gradient(hgt)
    nz = np.ones_like(hgt)
    n = np.sqrt(gx * gx + gy * gy + nz * nz)
    lx, ly = light
    lz = 0.75
    ln = math.sqrt(lx * lx + ly * ly + lz * lz)
    lum = (-gx * lx - gy * ly + nz * lz) / (n * ln)
    lum = (lum - 0.55) * 2.2 + flat * t
    return np.where(mask, lum, 0.0)


def shade(lum, ramp, lo=-1.0, hi=1.0, dither=0.35, ox=0, oy=0, mask=None):
    """map a light field to ramp colours (dark..light); pixels close to a band edge are
    ordered-dithered (2x2), the rest are flat"""
    H, W = lum.shape
    n = len(ramp)
    v = (np.clip(lum, lo, hi) - lo) / (hi - lo) * (n - 1)
    ys, xs = np.mgrid[0:H, 0:W]
    thr = BAYER2[(ys + oy) & 1, (xs + ox) & 1]
    base = np.floor(v)
    frac = v - base
    up = frac > 0.5 + (thr - 0.5) * dither * 2
    idx = np.clip(base + up, 0, n - 1).astype(int)
    out = np.array(ramp, np.int32)[idx]
    if mask is not None:
        out = np.where(mask, out, T)
    return out


def blob(w, h, cx, cy, rx, ry=None, lobes=5, amp=0.12, seed=0, phase=None):
    """a lumpy round silhouette (bool mask)"""
    ry = ry or rx
    ys, xs = np.mgrid[0:h, 0:w].astype(float)
    dx, dy = (xs + 0.5 - cx) / rx, (ys + 0.5 - cy) / ry
    ang = np.arctan2(dy, dx)
    ph = phase if phase is not None else hashf(seed, 1, 77) * 6.283
    ph2 = hashf(seed, 2, 77) * 6.283
    rr = 1 + amp * np.sin(lobes * ang + ph) + amp * 0.5 * np.sin((lobes * 2 + 1) * ang + ph2)
    return np.hypot(dx, dy) <= rr


def foliage(mask, ramp, seed=0, r=(1.6, 2.6), density=0.55, light=LIGHT, dome_r=6.0, glob=0.6,
            ox=0, oy=0, wrap=False, tips=None, holes=None):
    """fill a mask with overlapping leaf clusters: each cluster is a tiny lit dome; the
    whole mass is lit as a mound too (glob = its weight). ramp = dark..light (4-6 colours).
    The darkest colour fills the gaps between clusters. ox / oy = canvas offset (for
    hashes / dithering), wrap = clusters wrap around the canvas (tileable)."""
    H, W = mask.shape
    g = dome(mask, dome_r, light) if glob else np.zeros((H, W))
    area = int(mask.sum())
    n = int(area * density / (math.pi * ((r[0] + r[1]) / 2) ** 2)) + 1
    rng = Rng(seed)
    lum = np.full((H, W), -1.2)
    own = np.zeros((H, W), bool)
    pts = []
    ys_m, xs_m = np.nonzero(mask)
    if len(xs_m) == 0:
        return np.full((H, W), T, np.int32)
    for k in range(n * 3):
        if len(pts) >= n:
            break
        i = rng.rand(len(xs_m))
        cx, cy = xs_m[i] + rng.rand(100) / 100.0, ys_m[i] + rng.rand(100) / 100.0
        rad = r[0] + (r[1] - r[0]) * rng.rand(100) / 100.0
        pts.append((cy, cx, rad))
    pts.sort()
    lx, ly = light
    for (cy, cx, rad) in pts:
        x0, x1 = int(math.floor(cx - rad - 1)), int(math.ceil(cx + rad + 1))
        y0, y1 = int(math.floor(cy - rad - 1)), int(math.ceil(cy + rad + 1))
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                xx, yy = (x % W, y % H) if wrap else (x, y)
                if not (0 <= xx < W and 0 <= yy < H) or not mask[yy, xx]:
                    continue
                dx, dy = (x + 0.5 - cx) / rad, (y + 0.5 - cy) / rad
                dd = dx * dx + dy * dy
                if dd > 1:
                    continue
                dz = math.sqrt(1 - dd)
                l = (-dx * lx - dy * ly + dz * 0.75) / 1.25
                lum[yy, xx] = l * 1.1 - 0.15 + glob * g[yy, xx]
                own[yy, xx] = True
    lum = np.where(own, lum, -1.5)
    out = shade(lum, ramp, -1.0, 1.0, dither=0.25, ox=ox, oy=oy)
    out = np.where(mask, out, T)
    return out


def selout(img, dark, soft=None, light=LIGHT, inside=False):
    """outline the opaque pixels: outside pixels below / right of the shape get `dark`,
    above / left get `soft` (None = dark as well). inside=True draws on the shape's own
    edge pixels instead of around it."""
    m = img >= 0
    H, W = m.shape
    out = img.copy()
    pad = np.zeros((H + 2, W + 2), bool)
    pad[1:-1, 1:-1] = m
    up, down = pad[0:-2, 1:-1], pad[2:, 1:-1]
    left, right = pad[1:-1, 0:-2], pad[1:-1, 2:]
    if not inside:
        ring = ~m & (up | down | left | right)
        # an outline pixel lying below / right of the shape faces away from the light
        away = ring & (up | left)
        out[ring] = soft if soft is not None else dark
        out[away] = dark
    else:
        edge = m & ~(up & down & left & right)
        away = edge & (~down | ~right)
        out[edge] = soft if soft is not None else dark
        out[away] = dark
    return out


def stamp(dst, spr, x, y, wrap=False):
    """composite a sprite (transparent = -1) at (x, y); wrap = modulo the canvas"""
    H, W = dst.shape
    h, w = spr.shape
    for j in range(h):
        for i in range(w):
            v = spr[j, i]
            if v < 0:
                continue
            xx, yy = x + i, y + j
            if wrap:
                xx %= W
                yy %= H
            elif not (0 <= xx < W and 0 <= yy < H):
                continue
            dst[yy, xx] = v
    return dst


def poisson(w, h, mind, seed, tries=30, margin=0, wrap=True):
    """deterministic dart throwing: points at least mind px apart (wrapping distance)"""
    rng = Rng(seed)
    pts = []
    n = int(w * h / (mind * mind) * 1.2) + 1
    for _ in range(n * tries):
        if len(pts) >= n:
            break
        x = margin + rng.rand(max(1, w - 2 * margin))
        y = margin + rng.rand(max(1, h - 2 * margin))
        ok = True
        for (px, py) in pts:
            dx, dy = abs(px - x), abs(py - y)
            if wrap:
                dx, dy = min(dx, w - dx), min(dy, h - dy)
            if dx * dx + dy * dy < mind * mind:
                ok = False
                break
        if ok:
            pts.append((x, y))
    return pts


def shift(mask, dx, dy):
    """mask moved by (dx, dy) (no wrap)"""
    H, W = mask.shape
    out = np.zeros_like(mask)
    ys = slice(max(0, dy), H + min(0, dy))
    yd = slice(max(0, -dy), H - max(0, dy))
    xs = slice(max(0, dx), W + min(0, dx))
    xd = slice(max(0, -dx), W - max(0, dx))
    out[ys, xs] = mask[yd, xd]
    return out


def cast_shadow(alpha, dx=2, dy=3, soft=True):
    """the shadow a raised shape throws onto the ground: the shape moved down-right (plus a
    1 px dithered fringe when soft), minus the shape itself"""
    s = np.zeros_like(alpha)
    for k in range(1, max(dx, dy) + 1):
        s |= shift(alpha, min(k, dx), min(k, dy))
    if soft:
        H, W = alpha.shape
        ys, xs = np.mgrid[0:H, 0:W]
        fringe = shift(s, 1, 1) & ~s & (((xs + ys) & 1) == 0)
        s |= fringe
    return s & ~alpha


def ring_dist(mask):
    """distance from each pixel (inside the mask) to the outside, uncapped-ish (for wide
    masses like hedges): chamfer up to 24 px"""
    return dist_inside(mask, cap=24)
