"""Garden Edition — reusable pixel brushes for the gardens (procedural, deterministic).

Each brush paints a 16x16 (or any size) cell with a small colour ramp, the way SNES tile
artists build blocks: a lit top-left, a shaded bottom-right, a 1 px dark outline, and
small hand-like details (leaves, pebbles, mortar). Stages combine them with hand-drawn
grids for the iconic pieces.
"""
import math
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
