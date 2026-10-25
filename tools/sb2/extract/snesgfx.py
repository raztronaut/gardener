"""SNES graphics decoding helpers (pure numpy, no emulator needed).

All functions take raw byte arrays as returned by the harness (`S.vram()`, `S.cgram()`,
`S.oam()`), so they can also run on dumps saved to disk.

Conventions
- VRAM addresses given as *word* addresses unless the name ends in `_byte`.
- An "index image" is a uint8 (h, w) array of colour indices 0..15 (4bpp) / 0..3 (2bpp)
  *within* a palette; a "cgram index image" holds full CGRAM indices 0..255 and uses
  -1 (int16) for transparent pixels.
- RGBA is uint8 (h, w, 4); alpha 0 where the hardware is transparent (colour 0 of a
  BG/OBJ palette), 255 elsewhere.  BGR555 -> RGB uses (c << 3) | (c >> 2).
"""
import numpy as np


# ---- colours -----------------------------------------------------------------
def cgram_words(cgram):
    return np.asarray(cgram, np.uint8)[:512].view('<u2').astype(np.int32)


def bgr555_to_rgb(words):
    w = np.asarray(words, np.int32)
    c = np.stack([(w & 31), (w >> 5) & 31, (w >> 10) & 31], -1).astype(np.uint8)
    return (c << 3) | (c >> 2)


def cgram_rgb(cgram):
    """(256, 3) uint8 RGB."""
    return bgr555_to_rgb(cgram_words(cgram))


def cgram_hex(cgram):
    """256 '#rrggbb' strings."""
    return ['#%02x%02x%02x' % tuple(int(v) for v in c) for c in cgram_rgb(cgram)]


def palette_lut(cgram):
    """(257, 4) RGBA lookup: [i] = CGRAM colour i opaque, [256] = transparent.
    Index a cgram-index image with `lut[np.where(img < 0, 256, img)]`."""
    rgb = cgram_rgb(cgram)
    lut = np.zeros((257, 4), np.uint8)
    lut[:256, :3] = rgb
    lut[:256, 3] = 255
    return lut


def to_rgba(cimg, cgram):
    """cgram-index image (int16, -1 = transparent) -> RGBA."""
    lut = palette_lut(cgram)
    return lut[np.where(cimg < 0, 256, cimg)]


# ---- tiles -------------------------------------------------------------------
def decode_tile(vram, byte_addr, bpp):
    """One 8x8 tile -> uint8 (8, 8) colour indices. 2bpp: 16 B, 4bpp: 32 B, 8bpp: 64 B.
    Planar: rows of (p0,p1) words, then (p2,p3) 16 B later, ..."""
    v = np.asarray(vram, np.uint8)
    n = bpp * 8
    a = byte_addr & 0xffff
    raw = v[a:a + n] if a + n <= len(v) else np.concatenate([v[a:], v[:a + n - len(v)]])
    out = np.zeros((8, 8), np.uint8)
    bits = np.unpackbits(raw.reshape(-1, 1), axis=1)    # (n, 8) MSB first = leftmost pixel
    for p in range(bpp):
        base = (p // 2) * 16 + (p & 1)
        rows = bits[base:base + 16:2]                     # (8, 8)
        out |= (rows << p).astype(np.uint8)
    return out


def decode_tiles_block(vram, byte_addr, count, bpp):
    """`count` consecutive 8x8 tiles -> (count, 8, 8)."""
    return np.stack([decode_tile(vram, byte_addr + i * bpp * 8, bpp) for i in range(count)])


def tile_sheet(vram, byte_addr, count, bpp, cols=16):
    """Index image grid of `count` tiles, `cols` per row."""
    t = decode_tiles_block(vram, byte_addr, count, bpp)
    rows = (count + cols - 1) // cols
    out = np.zeros((rows * 8, cols * 8), np.uint8)
    for i in range(count):
        out[(i // cols) * 8:(i // cols) * 8 + 8, (i % cols) * 8:(i % cols) * 8 + 8] = t[i]
    return out


# ---- backgrounds -------------------------------------------------------------
BPP_BY_MODE = {0: (2, 2, 2, 2), 1: (4, 4, 2, 0), 2: (4, 4, 0, 0), 3: (8, 4, 0, 0),
               4: (8, 2, 0, 0), 5: (4, 2, 0, 0), 6: (4, 0, 0, 0)}


def tilemap_entries(vram, sc_base, sc_size):
    """Read a BG tilemap (word address `sc_base`, size code 0..3) as an (H, W) uint16
    array of raw entries in screen order (32x32 screens stitched per hardware layout)."""
    v = np.asarray(vram, np.uint8).view('<u2')
    wide = sc_size in (1, 3)
    tall = sc_size in (2, 3)
    W, H = (64 if wide else 32), (64 if tall else 32)
    out = np.zeros((H, W), np.uint16)
    scr = 0
    for sy in range(2 if tall else 1):
        for sx in range(2 if wide else 1):
            base = (sc_base + scr * 0x400) & 0x7fff
            block = np.array([v[(base + i) & 0x7fff] for i in range(1024)], np.uint16).reshape(32, 32)
            out[sy * 32:sy * 32 + 32, sx * 32:sx * 32 + 32] = block
            scr += 1
    return out


def decode_entry(e):
    e = int(e)
    return dict(tile=e & 0x3ff, pal=(e >> 10) & 7, prio=(e >> 13) & 1,
                hflip=bool(e & 0x4000), vflip=bool(e & 0x8000))


def render_bg_cell(vram, char_base, e, bpp, big, pal_base=0):
    """One tilemap entry -> cgram-index image (int16, -1 transparent) of 8x8 or 16x16
    (big=True: tile, tile+1, tile+16, tile+17), flips applied, plus its priority bit."""
    d = decode_entry(e)
    n = 16 if big else 8
    img = np.full((n, n), -1, np.int16)
    tsize = bpp * 8
    for ty in range(2 if big else 1):
        for tx in range(2 if big else 1):
            t = (d['tile'] + ty * 16 + tx) & 0x3ff
            pix = decode_tile(vram, char_base * 2 + t * tsize, bpp).astype(np.int16)
            img[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = pix
    if d['hflip']:
        img = img[:, ::-1]
    if d['vflip']:
        img = img[::-1, :]
    pal = pal_base + d['pal'] * (1 << bpp)
    img = np.where(img == 0, -1, img + pal).astype(np.int16)
    return img, d['prio']


def render_bg(vram, ppu, layer, mode=None):
    """Whole BG `layer` (1..4) tilemap -> (cimg int16 (-1 transparent), prio uint8 mask,
    entries uint16).  Size is the full tilemap (not the 256x224 window)."""
    mode = ppu['bgmode'] if mode is None else mode
    bpp = BPP_BY_MODE[mode][layer - 1]
    big = bool(ppu['bgmode_raw'] & (0x10 << (layer - 1)))
    ent = tilemap_entries(vram, ppu['bg%d_sc_base' % layer], ppu['bg%d_sc_size' % layer])
    n = 16 if big else 8
    H, W = ent.shape
    cimg = np.full((H * n, W * n), -1, np.int16)
    prio = np.zeros((H * n, W * n), np.uint8)
    cache = {}
    cb = ppu['bg%d_char_base' % layer]
    for y in range(H):
        for x in range(W):
            e = int(ent[y, x])
            if e not in cache:
                cache[e] = render_bg_cell(vram, cb, e, bpp, big)
            img, p = cache[e]
            cimg[y * n:y * n + n, x * n:x * n + n] = img
            prio[y * n:y * n + n, x * n:x * n + n] = p
    return cimg, prio, ent


def bg_window(cimg, hofs, vofs, w=256, h=224):
    """Crop a wrapped view of a full BG image at the given scroll."""
    H, W = cimg.shape[:2]
    ys = (np.arange(h) + vofs) % H
    xs = (np.arange(w) + hofs) % W
    return cimg[ys][:, xs]


# ---- sprites -----------------------------------------------------------------
OBJ_SIZES = [((8, 8), (16, 16)), ((8, 8), (32, 32)), ((8, 8), (64, 64)), ((16, 16), (32, 32)),
             ((16, 16), (64, 64)), ((32, 32), (64, 64)), ((16, 32), (32, 64)), ((16, 32), (32, 32))]


def decode_oam(oam):
    o = np.asarray(oam, np.uint8)
    out = []
    for i in range(128):
        x, y, t, a = (int(v) for v in o[i * 4:i * 4 + 4])
        hi = (int(o[512 + i // 4]) >> ((i % 4) * 2)) & 3
        xx = x | ((hi & 1) << 8)
        if xx >= 256:
            xx -= 512
        out.append(dict(i=i, x=xx, y=y, tile=t | ((a & 1) << 8), pal=(a >> 1) & 7,
                        prio=(a >> 4) & 3, hflip=bool(a & 0x40), vflip=bool(a & 0x80),
                        large=bool(hi & 2)))
    return out


def obj_size(ppu, large):
    return OBJ_SIZES[ppu['obj_size_select']][1 if large else 0]


def obj_tile_addr(ppu, tile):
    """Byte address in VRAM of OBJ 8x8 tile number 0..511."""
    if tile < 256:
        base = ppu['obj_name_base']
    else:
        base = ppu['obj_name_base2'] - 0x1000   # name_base2 already includes the +$1000 words
    return ((base + tile * 16) & 0x7fff) * 2


def render_sprite(vram, ppu, s):
    """One OAM entry -> cgram-index image (int16, -1 transparent), w x h per OBSEL.
    Tile numbering follows hardware: column wraps within the 16-tile row."""
    w, h = obj_size(ppu, s['large'])
    img = np.full((h, w), -1, np.int16)
    t0 = s['tile']
    for ty in range(h // 8):
        for tx in range(w // 8):
            row = ((t0 >> 4) + ty) & 0xf
            col = ((t0 & 0xf) + tx) & 0xf
            t = (t0 & 0x100) | (row << 4) | col
            pix = decode_tile(vram, obj_tile_addr(ppu, t), 4).astype(np.int16)
            img[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = pix
    if s['hflip']:
        img = img[:, ::-1]
    if s['vflip']:
        img = img[::-1, :]
    pal = 128 + s['pal'] * 16
    return np.where(img == 0, -1, img + pal).astype(np.int16)


def compose_sprites(vram, ppu, sprites, origin=None, size=None):
    """Draw a list of OAM entries (dicts from decode_oam) into one cgram-index image.
    Hardware order: lower OAM index is drawn on top. Returns (cimg, (x0, y0)) where
    (x0, y0) is the screen coordinate of the image's top-left.  Y wraps at 256."""
    boxes = []
    for s in sprites:
        w, h = obj_size(ppu, s['large'])
        y = s['y'] if s['y'] < 240 else s['y'] - 256
        boxes.append((s['x'], y, w, h))
    if origin is None:
        x0 = min(b[0] for b in boxes)
        y0 = min(b[1] for b in boxes)
    else:
        x0, y0 = origin
    if size is None:
        W = max(b[0] + b[2] for b in boxes) - x0
        H = max(b[1] + b[3] for b in boxes) - y0
    else:
        W, H = size
    out = np.full((H, W), -1, np.int16)
    for s, (x, y, w, h) in sorted(zip(sprites, boxes), key=lambda p: -p[0]['i']):
        img = render_sprite(vram, ppu, s)
        for yy in range(h):
            py = y - y0 + yy
            if not 0 <= py < H:
                continue
            for_x = img[yy]
            px0 = x - x0
            lo, hi = max(0, -px0), min(w, W - px0)
            if lo >= hi:
                continue
            seg = for_x[lo:hi]
            dst = out[py, px0 + lo:px0 + hi]
            m = seg >= 0
            dst[m] = seg[m]
    return out, (x0, y0)


def visible(s):
    """OAM entry on screen (y in 0..223 or wrapping in from the top, x > -64)."""
    y = s['y']
    return (y < 224 or y >= 192 + 64) and s['x'] > -64 and s['x'] < 256 and y != 0xe0 and y != 0xf0


def crop_alpha(cimg):
    """Bounding box (x0, y0, x1, y1) of opaque pixels, or None."""
    ys, xs = np.nonzero(cimg >= 0)
    if len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
