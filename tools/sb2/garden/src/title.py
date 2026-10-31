"""Garden Edition — the title screen: SUPER BOMBERMAN: THE GARDEN EDITION, by Gui Dávid.

Two pictures in the original title's frame (256 x 224; menu.js re-lays them out for the
wall's 256 x 455):
  bg1   the logotype SUPER / BOMBERMAN / THE GARDEN EDITION (chunky beveled letters, a seed
        pod for the first O, leaves sprouting from GARDEN), the menu lines NORMAL GAME /
        BATTLE GAME / PASSWORD and the credit BY GUI DÁVID (an acute accent on the A)
  bg2   a dusk garden sky (transparent: the backdrop colour) with the skyline at its foot
        (rows 10..13: hedges, a glasshouse, sunflowers, trees), + the two cloud shapes the
        menu places (glowing dusk clouds)
plus the sprites (a gardener with a watering can, sunflowers), the seed-pod cursor and its
bloom when BATTLE GAME is chosen. The build cuts the pictures into 16x16 tiles.
"""
from common import *  # noqa: F401,F403
import math
import objects

SKY = C('#0b3346')          # the backdrop (CGRAM 0): dusk teal-blue
SKY_HI = C('#1b5a68')
GLOW = C('#2f8a7c')

# ---- a chunky pixel font (6 x 7 cells, each cell 4 x 4 px with rounded outer corners) -------------
FONT = {
    'B': ["#####.", "##..##", "##..##", "#####.", "##..##", "##..##", "#####."],
    'O': [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
    'M': ["##..##", "######", "######", "##..##", "##..##", "##..##", "##..##"],
    'E': ["######", "##....", "##....", "#####.", "##....", "##....", "######"],
    'R': ["#####.", "##..##", "##..##", "#####.", "####..", "##.##.", "##..##"],
    'G': [".####.", "##..##", "##....", "##.###", "##..##", "##..##", ".#####"],
    'A': [".####.", "##..##", "##..##", "######", "##..##", "##..##", "##..##"],
    'D': ["####..", "##.##.", "##..##", "##..##", "##..##", "##.##.", "####.."],
    'N': ["##..##", "###.##", "###.##", "######", "##.###", "##.###", "##..##"],
    'S': [".#####", "##....", "##....", ".####.", "....##", "....##", "#####."],
    'U': ["##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
    'P': ["#####.", "##..##", "##..##", "#####.", "##....", "##....", "##...."],
    'T': ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##.."],
    'H': ["##..##", "##..##", "##..##", "######", "##..##", "##..##", "##..##"],
    'I': ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
}


def big_letter(ch, face, hi, lo, cell=4, cellh=None):
    g = FONT[ch]
    ch_ = cellh or cell
    H, W = len(g) * ch_, len(g[0]) * cell
    m = np.zeros((H, W), bool)
    for gy, row in enumerate(g):
        for gx, c in enumerate(row):
            if c == '#':
                m[gy * ch_:(gy + 1) * ch_, gx * cell:(gx + 1) * cell] = True
    # round the outer corners of each filled cell (cut a pixel where both neighbours are empty)
    for gy, row in enumerate(g):
        for gx, c in enumerate(row):
            if c != '#':
                continue
            def e(dx, dy):
                yy, xx = gy + dy, gx + dx
                return not (0 <= yy < len(g) and 0 <= xx < len(row)) or g[yy][xx] != '#'
            x0, y0 = gx * cell, gy * ch_
            if e(-1, 0) and e(0, -1):
                m[y0, x0] = False
            if e(1, 0) and e(0, -1):
                m[y0, x0 + cell - 1] = False
            if e(-1, 0) and e(0, 1):
                m[y0 + ch_ - 1, x0] = False
            if e(1, 0) and e(0, 1):
                m[y0 + ch_ - 1, x0 + cell - 1] = False
    img = blank(W, H)
    for y in range(H):
        for x in range(W):
            if not m[y, x]:
                continue
            top = y == 0 or not m[y - 1, x]
            left = x == 0 or not m[y, x - 1]
            bot = y == H - 1 or not m[y + 1, x]
            img[y, x] = hi if (top or left) else lo if (bot or y > H * 0.62) else face
    return img


def word(text, face, hi, lo, gap=3, cell=4, cellh=None):
    letters = [big_letter(c, face, hi, lo, cell, cellh) for c in text]
    W = sum(l.shape[1] for l in letters) + gap * (len(letters) - 1)
    H = letters[0].shape[0]
    img = blank(W, H)
    x = 0
    for l in letters:
        over(img, l, x, 0)
        x += l.shape[1] + gap
    return img


def extrude(img, col, depth=3, outline_col=None):
    """a 3D side down-right, then a dark outline"""
    H, W = img.shape
    out = blank(W + depth + 2, H + depth + 2)
    for d in range(depth, 0, -1):
        for y in range(H):
            for x in range(W):
                if img[y, x] >= 0:
                    out[y + 1 + d, x + 1 + d] = col
    over(out, img, 1, 1)
    return outline(out, outline_col if outline_col is not None else NIGHT, diag=True)


def pod_letter(h):
    """the O of BOMBER: a seed pod with a leaf fuse, as tall as the letters"""
    w = int(h * 0.92)
    img = blank(w + 6, h + 6)
    cx, cy, r = (w + 6) / 2 - 0.5, h / 2 + 3.5, h / 2 - 0.5
    for y in range(img.shape[0]):
        for x in range(img.shape[1]):
            d = math.hypot(x - cx, (y - cy) * 1.02)
            if d <= r:
                l = ((x - cx + r * 0.38) ** 2 + (y - cy + r * 0.42) ** 2) ** 0.5
                img[y, x] = WHITE if l < r * 0.16 else POD_3 if l < r * 0.34 else POD_2 if l < r * 0.72 else POD_1
    # the leaf fuse on top-right
    for (dx, dy, c) in ((2, -1, LEAF_2), (3, -2, LEAF_2), (3, -3, LEAF_4), (4, -3, LEAF_4), (5, -4, LEAF_4), (4, -4, LEAF_5),
                        (2, -2, LEAF_2), (6, -5, LEAF_5), (1, 0, LEAF_2)):
        x, y = int(cx + r * 0.5) + dx, int(cy - r * 0.86) + dy
        if 0 <= x < img.shape[1] and 0 <= y < img.shape[0]:
            img[y, x] = c
    img[int(cy - r * 0.86) - 6, int(cx + r * 0.5) + 6] = GOLD_4
    return img


SMALL = {   # a 5 x 7 font for the menu lines (caps)
    'A': [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    'B': ["####.", "#...#", "####.", "#...#", "#...#", "#...#", "####."],
    'D': ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    'E': ["#####", "#....", "####.", "#....", "#....", "#....", "#####"],
    'G': [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
    'I': ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
    'L': ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    'M': ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    'N': ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
    'O': [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    'P': ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    'R': ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    'S': [".####", "#....", ".###.", "....#", "....#", "#...#", ".###."],
    'T': ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    'W': ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
    'H': ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    'U': ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    'V': ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
    'Y': ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    ' ': [".....", ".....", ".....", ".....", ".....", ".....", "....."],
}
ACCENT = {'Á': ('A', ["...#.", "..#.."])}     # an acute accent: two rows above the letter


def small_text(s, col, shade, gap=1, accent=None):
    """5 x 7 caps with a drop shadow; letters with an accent (Á) carry it two rows above
    (the picture is then 2 rows taller and the letters start at row 2)"""
    top = 2 if any(ch in ACCENT for ch in s) else 0
    W = len(s) * (5 + gap)
    img = blank(W + 1, 9 + top)
    x = 0
    for ch in s:
        acc = None
        if ch in ACCENT:
            ch, acc = ACCENT[ch]
        g = SMALL[ch]
        for gy, row in enumerate(g):
            for gx, c in enumerate(row):
                if c == '#':
                    img[top + gy, x + gx] = col if gy < 4 else shade
        if acc:
            for gy, row in enumerate(acc):
                for gx, c in enumerate(row):
                    if c == '#':
                        img[gy, x + gx] = accent if accent is not None else col
        x += 5 + gap
    # a drop shadow
    sh = img.copy()
    for y in range(img.shape[0] - 1):
        for x in range(img.shape[1] - 1):
            if img[y, x] >= 0 and img[y + 1, x + 1] < 0:
                sh[y + 1, x + 1] = NIGHT
    return sh


MENU_Y = 147                 # the cursor's rows: y = 144 + 16 * k (menu.js)


def sprout(img, lx, ly, flip=False):
    for (dx, dy, c) in ((0, 0, LEAF_2), (1, -1, LEAF_3), (2, -2, LEAF_4), (3, -2, LEAF_4), (4, -3, LEAF_5),
                        (2, -1, LEAF_3), (3, -1, LEAF_2), (-1, -1, LEAF_3), (-2, -2, LEAF_4), (-3, -2, LEAF_4)):
        x = lx - dx if flip else lx + dx
        if 0 <= ly + dy < img.shape[0] and 0 <= x < img.shape[1] and img[ly + dy, x] < 0:
            img[ly + dy, x] = c


def bg1():
    img = blank(256, 224)
    # SUPER: smaller gold letters over the main word
    sup = extrude(word('SUPER', GOLD_3, GOLD_4, GOLD_2, gap=2, cell=3), GOLD_0, 2)
    over(img, sup, (256 - sup.shape[1]) // 2, 6)
    # BOMBERMAN: the big gold word, its first O a seed pod
    lw, gap = 4 * 6, 2
    top = word('BOMBERMAN', GOLD_3, GOLD_4, GOLD_2, gap=gap, cell=4, cellh=4)
    podx = lw + gap
    pod = pod_letter(top.shape[0] + 2)
    t2 = top.copy()
    t2[:, podx:podx + lw] = T
    top3 = extrude(t2, GOLD_0, 3)
    x1 = (256 - top3.shape[1]) // 2
    over(img, top3, x1, 32)
    over(img, outline(pod, NIGHT), x1 + podx - 2, 32 - 3)
    # THE GARDEN EDITION: "THE" and "EDITION" in rose / mint small caps beside a big mint GARDEN
    garden = extrude(word('GARDEN', MINT, WHITE, MINT_D, gap=3, cell=4, cellh=4), LEAF_0, 3)
    x2 = (256 - garden.shape[1]) // 2
    the = small_text('THE', PINK_L, PINK)
    over(img, the, x2, 72)
    over(img, garden, x2, 82)
    sprout(img, x2 + garden.shape[1] - 9, 80, flip=True)
    ed = extrude(word('EDITION', MINT, WHITE, MINT_D, gap=2, cell=3, cellh=3), LEAF_0, 2)
    over(img, ed, (256 - ed.shape[1]) // 2, 117)
    for k, s in enumerate(('NORMAL GAME', 'BATTLE GAME', 'PASSWORD')):
        t = small_text(s, WHITE if k == 1 else MINT, MINT_D)
        over(img, t, 76, MENU_Y + 16 * k)
    # the credit, below the menu
    cr = small_text('BY GUI DÁVID', GOLD_4, GOLD_2, accent=GOLD_4)
    over(img, cr, (256 - cr.shape[1]) // 2, MENU_Y + 16 * 3 + 2)
    return img


# ---- the sky and the skyline ------------------------------------------------------------------
def bg2():
    img = blank(256, 224)
    # stars / fireflies in the sky rows (0..9: they show behind the logo)
    r = Rng(4)
    for _ in range(26):
        x, y = r.rand(256), 4 + r.rand(150)
        img[y, x] = GOLD_4 if r.rand(3) == 0 else SKY_HI
    # the skyline: rows 10..13 (y 160..223)
    y0 = 160
    for x in range(256):
        # far trees: a bumpy silhouette
        h = 22 + int(6 * math.sin(x * 0.09) + 4 * math.sin(x * 0.23 + 1))
        for y in range(y0 + 64 - h - 18, 224):
            img[y, x] = LEAF_0
        # a lit rim on the far trees
        img[y0 + 64 - h - 18, x] = GLOW
    # the glasshouse (left of centre)
    gx, gy = 30, y0 + 16
    for y in range(gy, 224):
        for x in range(gx, gx + 56):
            roof = (y - gy) < 14 and abs(x - (gx + 28)) > (y - gy) * 2
            if roof:
                continue
            frame = (x - gx) % 8 == 0 or (y - gy) % 10 == 0 or abs(x - (gx + 28)) == (y - gy) * 2
            img[y, x] = STONE_4 if frame else (SKY_HI if (x + y) % 5 else WATER_4)
    # sunflowers along the front
    for k, fx in enumerate(range(108, 250, 22)):
        top = y0 + 26 + (k % 3) * 4
        for y in range(top + 5, 224):
            img[y, fx] = LEAF_2
            if (y - top) % 9 == 4:
                img[y, fx + 1] = LEAF_3
                img[y, fx + 2] = LEAF_3
        for y in range(top, top + 9):
            for x in range(fx - 4, fx + 5):
                d = math.hypot(x - fx, y - (top + 4))
                if d <= 4.4:
                    img[y, x] = SOIL_1 if d < 2 else GOLD_3 if (x + y) % 2 else GOLD_2
    # the hedge in front and the ground
    for x in range(256):
        hh = 12 + int(2 * math.sin(x * 0.4))
        for y in range(224 - hh - 8, 224 - 8):
            img[y, x] = LEAF_1 if (x * 3 + y) % 7 else LEAF_2
        img[224 - hh - 9, x] = LEAF_3
        for y in range(224 - 8, 224):
            img[y, x] = SOIL_2 if y > 219 else SOIL_1
    return img


def cloud(w, h, seed):
    img = blank(w, h)
    r = Rng(seed)
    blobs = [(w * 0.3, h * 0.6, h * 0.42), (w * 0.55, h * 0.45, h * 0.5), (w * 0.78, h * 0.62, h * 0.36)]
    for y in range(h):
        for x in range(w):
            for (cx, cy, rr) in blobs:
                if math.hypot(x - cx, (y - cy) * 1.4) <= rr:
                    img[y, x] = GLOW if y > cy else SKY_HI if y > cy - rr * 0.4 else PINK
                    break
    return img


def clouds():
    """small = 32 x 16 (tiles 0x24A, 0x24C), big = 48 x 32 (0x202..0x206 over 0x208..0x20C)"""
    return {'small': cloud(32, 16, 1), 'big': cloud(48, 32, 2)}


# ---- sprites ---------------------------------------------------------------------------------------
def cursor_frames():
    """the seed-pod cursor (idle pulse: tiles 0, 2, 4) and the bloom when chosen"""
    idle = [objects.pod('normal', 0), objects.pod('normal', 1), objects.pod('normal', 2)]
    burst = [objects.bloom('center', f) for f in (0, 1, 2, 3, 4, 3, 2, 1)]
    return idle, burst
