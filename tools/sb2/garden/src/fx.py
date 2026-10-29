"""Garden Edition — the sprite effects (fixed OBJ tiles in every stage's VRAM).

  pods       a kicked / thrown / carried pod (tiles 32..40, the held pod's palette) and the
             small pods (98..110), the pollen sparkles (42..47)
  shadow     under a jumping / falling gardener (64, any gardener palette: the outline)
  cards      an item flying off a gardener flips like a seed packet (66..78, the white
             gardener's palette: card white, outline, a green leaf on its back)
  puffs      the burst of a gardener's dropped items: a dandelion puff (136..140, a quarter
             of a 32x32 cloud mirrored 4 ways), the seeds rising after it (192, 194)
  hurry      the "Hurry!" banner (160..174), cut along the original's banner layout
  block      the sudden-death block falling (142) = the garden's own pressure block
Pictures are in colours; the build allocates each palette.
"""
from common import *  # noqa: F401,F403
import math
import objects

# ---- the held / moving pods -------------------------------------------------------------------
POD_TILES = {32: 'normal', 34: 'remote', 36: 'power', 38: 'pierce', 40: 'rubber'}


def pods():
    out = {t: objects.pod(k, 1 if k != 'remote' else 0) for t, k in POD_TILES.items()}
    return out


def small_pods():
    """98..110: smaller pods (scaled-down views), drawn by hand"""
    L = {'o': POD_0, 'd': POD_1, 'm': POD_2, 'w': WHITE, 'g': LEAF_2, 'l': LEAF_4}
    p12 = grid("""
................
................
................
................
.........gl.....
........og......
.....ooooo......
....oddddoo.....
...odwmddddo....
...odmdddddo....
...oddddddmo....
...odddddmmo....
....oddddmo.....
.....ooooo......
................
................
""", L)
    p10 = grid("""
................
................
................
................
................
.........l......
........og......
......oooo......
.....odwddo.....
.....oddddo.....
.....odddmo.....
......oooo......
................
................
................
................
""", L)
    return {98: p12, 100: p10, 104: p12, 106: p10, 108: p12, 110: p10}


def sparkles():
    """8x8 pollen sparkles (42..47)"""
    s1 = grid("""
........
...y....
..yWy...
...y....
........
........
........
........
""", {'y': GOLD_3, 'W': WHITE})
    s2 = grid("""
........
........
...W....
..WyW...
...W....
........
........
........
""", {'y': GOLD_3, 'W': WHITE})
    return {42: s1, 43: s2, 44: s1, 45: s2, 46: s1, 47: s2}


# ---- the gardener-palette tiles --------------------------------------------------------------
def shadow():
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            if ((x - 7.5) / 3.6) ** 2 + ((y - 7.5) / 2.6) ** 2 <= 1:
                img[y, x] = 1          # palette index (outline) — every gardener palette
    return img


def cards():
    """the flipping seed packet: index images in the white gardener's palette
    (1 outline, 10 white, 11/12 leaf, 13 brown). 66: face on, 68/70/72 turning,
    74/76/78 tilting flat"""
    def card(x0, x1, y0, y1, leaf=True, round_side=None):
        img = blank(16, 16)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                edge = x in (x0, x1) or y in (y0, y1)
                img[y, x] = 1 if edge else 10
        if leaf and x1 - x0 >= 6:
            cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
            for (dx, dy, c) in ((0, -2, 11), (1, -2, 11), (-1, -1, 11), (0, -1, 12), (1, -1, 11),
                                (0, 0, 12), (0, 1, 13), (0, 2, 13)):
                img[cy + dy, cx + dx] = c
        return img
    out = {66: card(1, 14, 1, 15), 68: card(4, 11, 1, 15), 70: card(6, 10, 0, 15, leaf=False),
           72: card(7, 8, 0, 15, leaf=False)}
    # tilting back: trapezoids of shrinking height
    for t, (y0, y1, inset) in ((74, (4, 12, 3)), (76, (5, 10, 2)), (78, (7, 8, 0))):
        img = blank(16, 16)
        h = y1 - y0
        for y in range(y0, y1 + 1):
            k = int(round(inset * (y1 - y) / max(1, h)))
            for x in range(k, 16 - k):
                edge = y in (y0, y1) or x in (k, 15 - k)
                img[y, x] = 1 if edge else 10
        if t == 74:
            for (x, y, c) in ((7, 7, 11), (8, 7, 11), (7, 8, 12), (8, 9, 13)):
                img[y, x] = c
        out[t] = img
    return out


# ---- pal 6: puffs, hurry, the falling block ----------------------------------------------------
def puff(r):
    """a quarter (top-left) of a 32x32 dandelion puff centred on the tile's bottom-right"""
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            dx, dy = x - 15.5, y - 15.5
            d = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            rr = r * (0.88 + 0.12 * math.cos(7 * ang))
            if d > rr:
                continue
            t = d / rr
            if t > 0.86:
                img[y, x] = MINT if (x + y) % 3 else WHITE
            elif t > 0.6:
                img[y, x] = CREAM if (x * 3 + y) % 4 else WHITE
            elif t > 0.3:
                img[y, x] = WHITE
            else:
                img[y, x] = GOLD_4
    # seeds flying at the rim of the large puff
    if r >= 14:
        for (x, y) in ((2, 6), (5, 2), (1, 11), (9, 1)):
            img[y, x] = WHITE
            if x + 1 < 16:
                img[y, x + 1] = MINT
    return img


def puffs():
    return {136: puff(9.5), 138: puff(13.0), 140: puff(15.6)}


def seeds():
    s = grid("""
................
................
................
......W.W.......
.......W........
......WmW.......
.......m........
.......m........
.......l........
................
................
................
................
................
................
................
""", {'W': WHITE, 'm': MINT, 'l': LEAF_3})
    s2 = grid("""
................
................
......W.W.......
.......W........
......WmW.......
.......m........
.......m........
........l.......
................
................
................
................
................
................
................
................
""", {'W': WHITE, 'm': MINT, 'l': LEAF_3})
    return {192: s, 194: s2}


# The "Hurry!" banner: drawn whole, then cut along the original's layout (pieces at offsets
# from the banner's origin: H = 160 + 162 below it, u r r y, "!" and its dot, y's tail).
HURRY_PIECES = [(173, 32, -1, 8), (172, 18, 8, 8), (174, 32, -17, 16), (170, 24, -8, 16), (168, 8, -8, 16),
                (166, -8, -8, 16), (164, -24, -8, 16), (162, -40, 2, 16), (160, -40, -14, 16)]
X0, Y0 = -40, -17        # banner picture origin

GLYPHS = {
    'H': ["###.......###"] * 7 + ["#############"] * 3 + ["###.......###"] * 8,
    'u': ["###.....###"] * 9 + ["####...####", ".##########", "..#####.###"],
    'r': ["###.####.", "#########", "#####..##", "####.....", "###......", "###......",
          "###......", "###......", "###......", "###......", "###......", "###......"],
    'y': ["###.....###"] * 8 + ["####...####", ".##########", "..#######.#", "........###",
                                ".......###.", "..######..."],
    '!': ["####", "####", "####", "####", "####", "####", ".###", ".###", ".##.", ".##.", "....", "....",
          ".##.", "####", ".##."],
}
# picture coordinates (banner + (40, 17)): the bottom of the letters on row 22
PLACE = {'H': (1, 4), 'u': (16, 10), 'r1': (29, 10), 'r2': (40, 10), 'y': (51, 10), '!': (65, 9)}


def hurry_banner():
    W, H = 88, 34
    img = blank(W, H)
    for key, (x0, y0) in PLACE.items():
        g = GLYPHS[key[0]]
        for gy, row in enumerate(g):
            for gx, c in enumerate(row):
                if c == '#':
                    img[y0 + gy, x0 + gx] = GOLD_3
    # shading: a light top edge, a deep gold bottom edge, a white glint on the H
    out = img.copy()
    for y in range(H):
        for x in range(W):
            if img[y, x] < 0:
                continue
            if y == 0 or img[y - 1, x] < 0:
                out[y, x] = GOLD_4
            elif y + 1 >= H or img[y + 1, x] < 0:
                out[y, x] = GOLD_1
            elif x > 0 and img[y, x - 1] < 0:
                out[y, x] = GOLD_4 if (y % 2) else GOLD_3
    out[6, 2] = WHITE
    out[6, 3] = WHITE
    # rose drop shadow (down-right), then the night outline
    sh = out.copy()
    for y in range(H - 1):
        for x in range(W - 1):
            if out[y, x] >= 0 and out[y + 1, x + 1] < 0:
                sh[y + 1, x + 1] = ROSE_2
    return outline(sh, NIGHT)


def hurry():
    ban = hurry_banner()
    out = {}
    for (t, dx, dy, size) in HURRY_PIECES:
        x, y = dx - X0, dy - Y0
        piece = blank(size, size)
        sub = ban[max(0, y):y + size, max(0, x):x + size]
        piece[max(0, -y):max(0, -y) + sub.shape[0], max(0, -x):max(0, -x) + sub.shape[1]] = sub
        out[t] = piece
    return out


# ---- stage 2: the rolling snowball (tile 96, OBJ palette 4) -------------------------------------
def snowball():
    img = blank(16, 16)
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d > 7.6:
                continue
            if d > 6.8:
                img[y, x] = ICE_0
            else:
                l = (x - 5) ** 2 + (y - 5) ** 2
                img[y, x] = WHITE if l < 10 else ICE_3 if l < 40 else ICE_2 if l < 80 else ICE_1
    for (x, y) in ((9, 10), (5, 11), (11, 6)):
        img[y, x] = ICE_1
    return img
