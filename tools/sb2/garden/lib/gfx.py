"""Garden Edition pixel-art toolkit (pure numpy, no ROM data).

Images are numpy int32 arrays (H, W): -1 = transparent, else a SNES BGR555 colour
(0..32767). Art is authored in exact BGR555 colours, so what a source draws is what the
SNES palette shows; the build allocates palette indices per palette slot afterwards.

    C('#74f7b0')                -> BGR555 int (each channel rounded to 5 bits)
    grid(text, legend)          -> image from a text grid ('.' = transparent)
    over(dst, src, x, y)        -> composite src (its transparent pixels skipped)
    encode4(idx8x8) / encode2() -> SNES planar character bytes
"""
import numpy as np

T = -1   # transparent


def C(h):
    h = h.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    q = lambda v: min(31, (v + 4) >> 3)
    return q(r) | (q(g) << 5) | (q(b) << 10)


def rgb(c):
    """BGR555 -> (r, g, b) 8-bit, the way the PPU renders it ((c << 3) | (c >> 2))"""
    r, g, b = c & 31, (c >> 5) & 31, (c >> 10) & 31
    e = lambda v: (v << 3) | (v >> 2)
    return (e(r), e(g), e(b))


def blank(w, h, fill=T):
    return np.full((h, w), fill, np.int32)


def grid(text, legend, w=None):
    """Text grid -> image. legend maps a char to a BGR555 colour (or T). Leading /
    trailing blank lines are dropped; every row must have the same width."""
    rows = [r.strip() for r in text.strip('\n').split('\n')]
    rows = [r for r in rows if r]
    W = w or max(len(r) for r in rows)
    out = blank(W, len(rows))
    for y, r in enumerate(rows):
        if len(r) != W:
            raise ValueError('grid row %d has %d chars, want %d: %r' % (y, len(r), W, r))
        for x, ch in enumerate(r):
            if ch in ('.', ' '):
                continue
            if ch not in legend:
                raise KeyError('grid char %r not in legend' % ch)
            out[y, x] = legend[ch]
    return out


def over(dst, src, x=0, y=0):
    """composite src onto dst at (x, y) in place (clipped); returns dst"""
    H, W = dst.shape
    h, w = src.shape
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x0 >= x1 or y0 >= y1:
        return dst
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]
    d = dst[y0:y1, x0:x1]
    m = s >= 0
    d[m] = s[m]
    return dst


def recolour(img, mapping):
    out = img.copy()
    for a, b in mapping.items():
        out[img == a] = b
    return out


def hflip(img):
    return img[:, ::-1].copy()


def vflip(img):
    return img[::-1, :].copy()


def outline(img, col, diag=False):
    """add a 1 px outline of colour col around the opaque pixels (outside them)"""
    m = img >= 0
    H, W = m.shape
    grow = np.zeros_like(m)
    for dy, dx in ([(-1, 0), (1, 0), (0, -1), (0, 1)] + ([(-1, -1), (-1, 1), (1, -1), (1, 1)] if diag else [])):
        sh = np.zeros_like(m)
        ys, yd = (slice(max(0, -dy), H - max(0, dy)), slice(max(0, dy), H - max(0, -dy)))
        xs, xd = (slice(max(0, -dx), W - max(0, dx)), slice(max(0, dx), W - max(0, -dx)))
        sh[yd, xd] = m[ys, xs]
        grow |= sh
    out = img.copy()
    out[grow & ~m] = col
    return out


def colours(img):
    return sorted(set(int(v) for v in np.unique(img) if v >= 0))


def to_rgba(img):
    H, W = img.shape
    out = np.zeros((H, W, 4), np.uint8)
    for c in colours(img):
        m = img == c
        out[m, 0:3] = rgb(c)
        out[m, 3] = 255
    return out


def save_png(img, path, scale=1, bg=None):
    from PIL import Image
    a = to_rgba(img)
    if bg is not None:
        b = np.zeros_like(a)
        b[..., 0:3] = bg
        b[..., 3] = 255
        m = a[..., 3] > 0
        b[m] = a[m]
        a = b
    im = Image.fromarray(a, 'RGBA')
    if scale != 1:
        im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
    im.save(path)


# ---- SNES character encoding -------------------------------------------------------------
def encode4(idx):
    """(8, 8) colour indices 0..15 -> 32 bytes (planes 0/1 interleaved, then 2/3)"""
    out = bytearray(32)
    for r in range(8):
        p = [0, 0, 0, 0]
        for x in range(8):
            v = int(idx[r, x])
            for b in range(4):
                if v & (1 << b):
                    p[b] |= 0x80 >> x
        out[2 * r], out[2 * r + 1], out[16 + 2 * r], out[17 + 2 * r] = p
    return bytes(out)


def encode2(idx):
    out = bytearray(16)
    for r in range(8):
        p0 = p1 = 0
        for x in range(8):
            v = int(idx[r, x])
            if v & 1:
                p0 |= 0x80 >> x
            if v & 2:
                p1 |= 0x80 >> x
        out[2 * r], out[2 * r + 1] = p0, p1
    return bytes(out)


def decode4(b, off=0):
    out = np.zeros((8, 8), np.int32)
    for r in range(8):
        p0, p1, p2, p3 = b[off + 2 * r], b[off + 2 * r + 1], b[off + 16 + 2 * r], b[off + 17 + 2 * r]
        for x in range(8):
            s = 7 - x
            out[r, x] = ((p0 >> s) & 1) | (((p1 >> s) & 1) << 1) | (((p2 >> s) & 1) << 2) | (((p3 >> s) & 1) << 3)
    return out


# ---- deterministic noise for textures ------------------------------------------------------
class Rng:
    """small LCG so textures never change between builds / numpy versions"""
    def __init__(self, seed):
        self.s = (seed * 2654435761 + 12345) & 0xFFFFFFFF

    def next(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return self.s >> 8

    def rand(self, n):
        return self.next() % n

    def chance(self, p):
        return (self.next() % 10000) < p * 10000


def hash2(x, y, seed=0):
    h = (x * 374761393 + y * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return (h ^ (h >> 16)) & 0xFFFF


BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])


def dither(level, x, y):
    """ordered dither: True where a pixel of coverage level (0..16) is lit"""
    return BAYER4[y & 3, x & 3] < level
