"""Garden Edition — reusable pixel brushes for the gardens (procedural, deterministic).

Each brush paints a 16x16 (or any size) cell with a small colour ramp, the way SNES tile
artists build blocks: a lit top-left, a shaded bottom-right, a 1 px dark outline, and
small hand-like details (leaves, pebbles, mortar). Stages combine them with hand-drawn
grids for the iconic pieces.
"""
import math
import numpy as np
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lib'))
from gfx import T, blank, grid, over, hflip, vflip, Rng, hash2, dither  # noqa: E402

# ---- silhouettes ------------------------------------------------------------------------------
def rounded_mask(w=16, h=16, r=3, inset=0):
    m = [[False] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            xx = min(x - inset, w - 1 - inset - x)
            yy = min(y - inset, h - 1 - inset - y)
            if xx < 0 or yy < 0:
                continue
            if xx < r and yy < r:
                if (r - xx - 0.5) ** 2 + (r - yy - 0.5) ** 2 > r * r:
                    continue
            m[y][x] = True
    return m


def outline_mask(img, mask, col):
    """paint col on the mask's edge pixels (inside the mask)"""
    h, w = len(mask), len(mask[0])
    for y in range(h):
        for x in range(w):
            if not mask[y][x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if not (0 <= xx < w and 0 <= yy < h) or not mask[yy][xx]:
                    img[y, x] = col
                    break
    return img


# ---- foliage ---------------------------------------------------------------------------------
LEAF = [
    "..aa..",
    ".abba.",
    "abccba",
    "abcdcb",
    ".bccb.",
    "..bb..",
]


def leaf_scales(w, h, ramp, seed=0, step=(5, 4), stagger=True, jitter=1):
    """overlapping rounded leaves (painter's order, top rows first): ramp = [dark, mid,
    light, highlight]; returns an opaque image filled with foliage"""
    dark, mid, light, hi = ramp
    img = blank(w, h, dark)
    cmap = {'a': dark, 'b': mid, 'c': light, 'd': hi}
    sx, sy = step
    r = Rng(seed)
    for gy in range(-2, h + 2, sy):
        off = (sx // 2) if (stagger and ((gy // sy) & 1)) else 0
        for gx in range(-sx, w + sx, sx):
            jx = r.rand(2 * jitter + 1) - jitter if jitter else 0
            jy = r.rand(2) if jitter else 0
            x0, y0 = gx + off + jx - 1, gy + jy - 1
            for ly, row in enumerate(LEAF):
                for lx, ch in enumerate(row):
                    if ch == '.':
                        continue
                    xx, yy = x0 + lx, y0 + ly
                    if 0 <= xx < w and 0 <= yy < h:
                        img[yy, xx] = cmap[ch]
    return img


def bush(ramp, outline, flowers=None, seed=1, r=4, inset=0, shade=True, w=16, h=16):
    """a rounded bush filling a cell: foliage scales, a dark outline, a shaded bottom edge,
    optional flowers [(petal, centre)]"""
    img = blank(w, h)
    m = rounded_mask(w, h, r, inset)
    fol = leaf_scales(w, h, ramp, seed)
    for y in range(h):
        for x in range(w):
            if m[y][x]:
                img[y, x] = fol[y, x]
    if shade:
        # bottom-right shading: the lowest two inside rows lean dark
        for y in range(h):
            for x in range(w):
                if m[y][x] and (y >= h - 3 - inset or x >= w - 2 - inset) and img[y, x] in (ramp[2], ramp[3]):
                    img[y, x] = ramp[1]
        for y in range(h):
            for x in range(w):
                if m[y][x] and y <= 3 + inset and x <= 9 and img[y, x] == ramp[2] and dither(6, x, y):
                    img[y, x] = ramp[3]
    if flowers:
        rr = Rng(seed + 50)
        spots = [(4, 4), (10, 3), (7, 8), (12, 9), (3, 10), (9, 12)]
        for k, (fx, fy) in enumerate(spots[:len(flowers) if isinstance(flowers, list) and len(flowers) > 2 else 4]):
            petal, centre = flowers[k % len(flowers)] if isinstance(flowers, list) else flowers
            fx += rr.rand(2)
            fy += rr.rand(2)
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                if 0 <= fx + dx < w and 0 <= fy + dy < h and m[fy + dy][fx + dx]:
                    img[fy + dy, fx + dx] = petal
            if m[fy][fx]:
                img[fy, fx] = centre
    outline_mask(img, m, outline)
    return img


# ---- ground ----------------------------------------------------------------------------------
def speckle(w, h, base, specks, seed=0, density=0.08, cluster=False):
    """a flat ground with scattered specks: specks = [(colour, weight)]"""
    img = blank(w, h, base)
    tot = sum(wt for _, wt in specks)
    for y in range(h):
        for x in range(w):
            v = hash2(x, y, seed) / 65536.0
            if v < density:
                pick = (hash2(x, y, seed + 1) / 65536.0) * tot
                for c, wt in specks:
                    pick -= wt
                    if pick <= 0:
                        img[y, x] = c
                        break
    return img


def pebbles(img, cols, n, seed=0, size=(2, 1)):
    """small pebbles: a light top pixel + a dark bottom pixel (cols = (light, mid, dark))"""
    light, mid, dark = cols
    h, w = img.shape
    r = Rng(seed)
    for _ in range(n):
        x, y = r.rand(w - 2), r.rand(h - 2)
        img[y, x] = light
        img[y, x + 1] = mid
        img[y + 1, x] = mid
        img[y + 1, x + 1] = dark
    return img


def shadow_top(img, src_cols, dst_cols, rows=4, slant=True):
    """the shadow a block casts on the floor cell below it: the top rows darkened (with a
    dithered edge), like the original's shadowed floor"""
    out = img.copy()
    h, w = img.shape
    lut = dict(zip(src_cols, dst_cols))
    for y in range(h):
        for x in range(w):
            edge = rows + (1 if (slant and x > w - 4) else 0)
            if y < edge - 1 or (y == edge - 1 and dither(8, x, y)):
                c = int(img[y, x])
                out[y, x] = lut.get(c, c)
    return out


# ---- stone / brick ------------------------------------------------------------------------------
def stone_block(cols, outline, w=16, h=16, bevel=2, top=5, seed=0, cracks=True):
    """a squared stone block seen from above-front: a lit top face, a front face, bevels.
    cols = [darkest, dark, mid, light, highlight]"""
    d0, d1, m, l, hi = cols
    img = blank(w, h, m)
    for y in range(h):
        for x in range(w):
            if y < top:                       # top face
                img[y, x] = l
                if y == 0 or x == 0:
                    img[y, x] = hi
            else:                              # front face
                img[y, x] = m
                if y == top:
                    img[y, x] = hi if x < w - 1 else l
                if x >= w - 2:
                    img[y, x] = d1
                if y >= h - 2:
                    img[y, x] = d1
    # texture: a few lighter / darker pits on the front face
    r = Rng(seed)
    for _ in range(4):
        x, y = 2 + r.rand(w - 5), top + 2 + r.rand(max(1, h - top - 5))
        img[y, x] = d1
        img[y, x + 1] = l
    if cracks:
        x = 4 + r.rand(6)
        for y in range(top + 1, top + 4):
            img[y, x + (y & 1)] = d1
    # outline
    for y in range(h):
        for x in range(w):
            if x == 0 or y == 0 or x == w - 1 or y == h - 1:
                img[y, x] = outline
    img[0, 0] = img[0, w - 1] = img[h - 1, 0] = img[h - 1, w - 1] = T
    return img


def bricks(w, h, brick, mortar, light, dark, bw=8, bh=4, seed=0, offset=0):
    """running-bond brickwork: brick colour + lit top edge + dark bottom edge, mortar lines"""
    img = blank(w, h, brick)
    for y in range(h):
        row = (y + offset) // bh
        yy = (y + offset) % bh
        sh = (bw // 2) if row & 1 else 0
        for x in range(w):
            xx = (x + sh) % bw
            if yy == bh - 1 or xx == bw - 1:
                img[y, x] = mortar
            elif yy == 0:
                img[y, x] = light
            elif yy == bh - 2 or xx == bw - 2:
                img[y, x] = dark if hash2(x, y, seed) % 4 else brick
    return img


def fill_mask(img, mask, col):
    h, w = img.shape
    for y in range(h):
        for x in range(w):
            if mask[y][x]:
                img[y, x] = col
    return img


def ramp_shade(img, ramp, light_dir=(-1, -1)):
    """re-shade a flat-coloured mask: pixels by their position inside the shape get a
    darker / lighter step of ramp (ramp[0] darkest)"""
    return img


# ---- clump bushes (clean cartoon foliage: overlapping round leaf clumps) ------------------------
BUSH_CLUMPS = [  # (cx, cy, r): back row first, the front row overlaps it
    (4.5, 4.5, 4.3), (11.0, 4.0, 4.3), (7.8, 3.0, 3.6),
    (2.8, 9.3, 3.6), (8.0, 8.4, 4.4), (13.2, 9.0, 3.6),
    (4.6, 12.4, 3.8), (11.4, 12.4, 3.8), (8.0, 13.0, 3.2),
]


def clump_bush(ramp, outline, flowers=None, clumps=None, w=16, h=16, flower_spots=None, base=None):
    """a bush of overlapping round clumps: each clump lit from the upper left (ramp =
    [dark, mid, light, highlight]); a dark seam where a front clump overlaps a back one;
    the outer silhouette outlined. flowers = (petal, centre) or a list; base = an image to
    draw on (transparent where the bush is not)"""
    dark, mid, light, hi = ramp
    img = base.copy() if base is not None else blank(w, h)
    owner = np.full((h, w), -1, np.int32)
    clumps = clumps or BUSH_CLUMPS
    for k, (cx, cy, r) in enumerate(clumps):
        for y in range(h):
            for x in range(w):
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                d = math.hypot(dx, dy)
                if d > r:
                    continue
                owner[y, x] = k
                # light from the upper left
                lum = -(dx * 0.7 + dy * 0.75) / r + (0.25 - d / r * 0.35)
                if lum > 0.45:
                    c = hi
                elif lum > 0.05:
                    c = light
                elif lum > -0.45:
                    c = mid
                else:
                    c = dark
                img[y, x] = c
    # seams: a pixel of this clump bordering a clump drawn later (in front of it) above / left
    out = img.copy()
    for y in range(h):
        for x in range(w):
            k = owner[y, x]
            if k < 0:
                continue
            for dx, dy in ((0, -1), (-1, 0), (1, 0)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h and owner[yy, xx] >= 0 and owner[yy, xx] < k:
                    # x belongs to a front clump, the neighbour to a back one: shade the back pixel
                    out[yy, xx] = dark
    img = out
    m = owner >= 0
    for y in range(h):
        for x in range(w):
            if not m[y, x]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                xx, yy = x + dx, y + dy
                if not (0 <= xx < w and 0 <= yy < h) or not m[yy, xx]:
                    img[y, x] = outline
                    break
    if flowers:
        fl = flowers if isinstance(flowers, list) else [flowers]
        spots = flower_spots or [(4, 4), (11, 3), (8, 8), (3, 10), (12, 10), (7, 13)]
        for k, (fx, fy) in enumerate(spots):
            petal, centre = fl[k % len(fl)]
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                xx, yy = fx + dx, fy + dy
                if 0 <= xx < w and 0 <= yy < h and m[yy, xx] and img[yy, xx] != outline:
                    img[yy, xx] = petal
            if img[fy, fx] != outline:
                img[fy, fx] = centre
    return img


# ---- where a ring cell sits ------------------------------------------------------------------------
def role_of(ctx, name):
    """the role of a wall / border metatile from its first position on the tall map:
    border_l / border_r (columns 0 / 16, half visible), tl tr bl br corners, top bottom left
    right edges, or 'inner' (anything else)"""
    pos = ctx['pos'].get(name)
    if not pos:
        return 'inner', None
    cx, cy = pos[0]
    if cx == 0:
        return 'border_l', (cx, cy)
    if cx == 16:
        return 'border_r', (cx, cy)
    top, bot = cy == 3, cy == 29
    if top and cx == 1:
        return 'tl', (cx, cy)
    if top and cx == 15:
        return 'tr', (cx, cy)
    if bot and cx == 1:
        return 'bl', (cx, cy)
    if bot and cx == 15:
        return 'br', (cx, cy)
    if top:
        return 'top', (cx, cy)
    if bot:
        return 'bottom', (cx, cy)
    if cx == 1:
        return 'left', (cx, cy)
    if cx == 15:
        return 'right', (cx, cy)
    return 'inner', (cx, cy)


def ring_names(ctx):
    """every wall / border metatile of the stage"""
    return [x['name'] for x in ctx['meta']['metatiles'] if x['kind'] in ('wall', 'border')]


def foliage_tile(ramp, seed=0, w=16, h=16, n=7, rmin=2.6, rmax=4.2, wrap=True):
    """seamless foliage: round leaf clumps (lit upper left) wrapped around the tile edges,
    so neighbouring cells join; ramp = [dark, mid, light, highlight]"""
    dark, mid, light, hi = ramp
    img = blank(w, h, dark)
    owner = np.full((h, w), -1, np.int32)
    r_ = Rng(seed)
    clumps = []
    for k in range(n):
        clumps.append((r_.rand(w * 10) / 10.0, r_.rand(h * 10) / 10.0, rmin + r_.rand(int((rmax - rmin) * 10) + 1) / 10.0))
    clumps.sort(key=lambda c: c[1])
    for k, (cx, cy, r) in enumerate(clumps):
        for y in range(h):
            for x in range(w):
                best = None
                for ox in ((-w, 0, w) if wrap else (0,)):
                    for oy in ((-h, 0, h) if wrap else (0,)):
                        dx, dy = x + 0.5 - (cx + ox), y + 0.5 - (cy + oy)
                        d = math.hypot(dx, dy)
                        if d <= r and (best is None or d < best[0]):
                            best = (d, dx, dy)
                if best is None:
                    continue
                d, dx, dy = best
                owner[y, x] = k
                lum = -(dx * 0.7 + dy * 0.75) / r + (0.25 - d / r * 0.35)
                img[y, x] = hi if lum > 0.5 else light if lum > 0.05 else mid if lum > -0.5 else dark
    out = img.copy()
    for y in range(h):
        for x in range(w):
            k = owner[y, x]
            if k < 0:
                continue
            for dx, dy in ((0, -1), (-1, 0), (1, 0)):
                xx, yy = (x + dx) % w, (y + dy) % h
                if owner[yy, xx] >= 0 and owner[yy, xx] < k:
                    out[yy, xx] = dark
    return out


def remap(img, src, dst):
    """colour substitution (e.g. a ramp one step darker for shade)"""
    out = img.copy()
    for a, b in zip(src, dst):
        out[img == a] = b
    return out


def hline(img, y, col, x0=0, x1=None):
    x1 = img.shape[1] - 1 if x1 is None else x1
    img[y, x0:x1 + 1] = col
    return img


def vline(img, x, col, y0=0, y1=None):
    y1 = img.shape[0] - 1 if y1 is None else y1
    img[y0:y1 + 1, x] = col
    return img
