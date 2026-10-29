"""Garden Edition — the menus' lettering, redrawn: a chunky 2-px-stroke garden font (7 x 10
letters, outlined, shaded top-light to bottom-dark) written over the original's text cells
(the same tile numbers, so the menus' logic is unchanged).

Styles (palette rows of the menu screens, see menus.py): gold labels (row 4: 13 / 12 / 11),
mint values (row 2: 5 / 4 / 3 / 2), rose values (row 2: 9 / 8 / 7 / 6), leaf values (row 2:
13 / 12 / 10), white digits (row 4: 15 / 10 / 9), and the mode screen's cut-out letters
(row 3: cream letters; the original's cut-outs showed BG2's bands, solid reads better).
"""
import numpy as np
from common import *  # noqa: F401,F403

G = {
    'A': [".#####.", "##...##", "##...##", "##...##", "#######", "#######", "##...##", "##...##", "##...##", "##...##"],
    'B': ["######.", "##...##", "##...##", "##..##.", "######.", "##...##", "##...##", "##...##", "##...##", "######."],
    'C': [".#####.", "##...##", "##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "##...##", ".#####."],
    'D': ["#####..", "##..##.", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", "##..##.", "#####.."],
    'E': ["#######", "##.....", "##.....", "##.....", "######.", "##.....", "##.....", "##.....", "##.....", "#######"],
    'G': [".#####.", "##...##", "##.....", "##.....", "##.####", "##...##", "##...##", "##...##", "##...##", ".######"],
    'I': ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
    'L': ["##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "##.....", "#######"],
    'M': ["##...##", "###.###", "#######", "##.#.##", "##.#.##", "##...##", "##...##", "##...##", "##...##", "##...##"],
    'N': ["##...##", "###..##", "####.##", "##.####", "##..###", "##...##", "##...##", "##...##", "##...##", "##...##"],
    'O': [".#####.", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", ".#####."],
    'P': ["######.", "##...##", "##...##", "##...##", "######.", "##.....", "##.....", "##.....", "##.....", "##....."],
    'R': ["######.", "##...##", "##...##", "##...##", "######.", "##.##..", "##..##.", "##...##", "##...##", "##...##"],
    'S': [".#####.", "##...##", "##.....", "###....", ".#####.", "....###", ".....##", ".....##", "##...##", ".#####."],
    'T': ["######", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##.."],
    'V': ["##...##", "##...##", "##...##", "##...##", "##...##", "##...##", ".##.##.", ".##.##.", "..###..", "...#..."],
    'Y': ["##..##", "##..##", "##..##", ".####.", "..##..", "..##..", "..##..", "..##..", "..##..", "..##.."],
    'F': ["#######", "##.....", "##.....", "##.....", "######.", "##.....", "##.....", "##.....", "##.....", "##....."],
    'K': ["##...##", "##..##.", "##.##..", "####...", "###....", "####...", "##.##..", "##..##.", "##...##", "##...##"],
    'H': ["##...##", "##...##", "##...##", "##...##", "#######", "#######", "##...##", "##...##", "##...##", "##...##"],
    'W': ["##...##", "##...##", "##...##", "##...##", "##.#.##", "##.#.##", "#######", "###.###", "##...##", "#.....#"],
    'U': ["##...##", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", "##...##", ".#####."],
    '-': ["....", "....", "....", "....", "####", "####", "....", "....", "....", "...."],
    ' ': ["...", "...", "...", "...", "...", "...", "...", "...", "...", "..."],
    '0': [".####.", "##..##", "##..##", "##.###", "##.###", "###.##", "###.##", "##..##", "##..##", ".####."],
    '1': ["..##..", ".###..", "####..", "..##..", "..##..", "..##..", "..##..", "..##..", "..##..", "######"],
    '2': [".####.", "##..##", "....##", "....##", "...##.", "..##..", ".##...", "##....", "##....", "######"],
    '3': [".####.", "##..##", "....##", "....##", "..###.", "....##", "....##", "....##", "##..##", ".####."],
    '4': ["...##.", "..###.", ".####.", "##.##.", "##.##.", "######", "...##.", "...##.", "...##.", "...##."],
    '5': ["######", "##....", "##....", "#####.", "....##", "....##", "....##", "....##", "##..##", ".####."],
    '6': [".####.", "##..##", "##....", "##....", "#####.", "##..##", "##..##", "##..##", "##..##", ".####."],
    '7': ["######", "....##", "....##", "...##.", "...##.", "..##..", "..##..", "..##..", "..##..", "..##.."],
    '8': [".####.", "##..##", "##..##", "##..##", ".####.", "##..##", "##..##", "##..##", "##..##", ".####."],
    '9': [".####.", "##..##", "##..##", "##..##", "##..##", ".#####", "....##", "....##", "##..##", ".####."],
    ':': ["..", "..", "##", "##", "..", "..", "##", "##", "..", ".."],
}

def _tall(g):
    """10-row glyph -> 12 rows (rows 2 and 7 doubled): letters as tall as the cells allow"""
    return g[:3] + [g[2]] + g[3:8] + [g[7]] + g[8:]


G = {k: _tall(v) for k, v in G.items()}

STYLES = {   # body ramp: top rows .. bottom rows (palette indices), outline, background
    'gold': {'ramp': [13, 13, 13, 13, 12, 12, 12, 12, 11, 11, 11, 11], 'out': 1, 'bg': 14},
    'digit': {'ramp': [15, 15, 15, 15, 10, 10, 10, 10, 9, 9, 9, 9], 'out': 1, 'bg': 14},
    'mint': {'ramp': [5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2], 'out': 1, 'bg': 11},
    'rose': {'ramp': [9, 9, 9, 8, 8, 8, 8, 7, 7, 7, 6, 6], 'out': 1, 'bg': 11},
    'leaf': {'ramp': [13, 13, 13, 13, 12, 12, 12, 12, 10, 10, 10, 10], 'out': 1, 'bg': 11},
    'cream': {'ramp': [12, 12, 12, 12, 8, 8, 8, 8, 7, 7, 7, 7], 'out': 1, 'bg': 13},
}


def text_strip(text, ncells, style, align='center', gap=1, y0=2):
    """the text rendered into ncells 16x16 tiles (palette indices), centred"""
    st = STYLES[style]
    W = ncells * 16
    body = np.zeros((16, W), bool)
    glyphs = [G[ch] for ch in text]
    tw = sum(len(g[0]) for g in glyphs) + gap * (len(glyphs) - 1)
    x = (W - tw) // 2 if align == 'center' else (2 if align == 'left' else W - tw - 2)
    ramp_row = np.full((16, W), -1, np.int32)
    for g in glyphs:
        for gy, row in enumerate(g):
            for gx, c in enumerate(row):
                if c == '#' and 0 <= x + gx < W:
                    body[y0 + gy, x + gx] = True
                    ramp_row[y0 + gy, x + gx] = gy
        x += len(g[0]) + gap
    img = np.full((16, W), st['bg'], np.int32)
    for y in range(16):
        for x in range(W):
            if body[y, x]:
                img[y, x] = st['ramp'][ramp_row[y, x]]
            elif any(0 <= y + dy < 16 and 0 <= x + dx < W and body[y + dy, x + dx]
                     for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                img[y, x] = st['out']
    # a drop shadow (down-right) in the outline colour for the solid styles
    if True:
        sh = img.copy()
        for y in range(15):
            for x in range(W - 1):
                if img[y, x] == st['out'] and img[y + 1, x + 1] == st['bg']:
                    sh[y + 1, x + 1] = st['out']
        img = sh
    return [img[:, k * 16:(k + 1) * 16] for k in range(ncells)]


def infinity(style='digit'):
    """the TIME value 'unlimited' across 3 cells: an infinity loop"""
    st = STYLES[style]
    W = 48
    body = np.zeros((16, W), bool)
    import math
    for y in range(16):
        for x in range(W):
            for cx in (18.5, 29.5):
                d = math.hypot((x + 0.5 - cx) / 1.15, y + 0.5 - 8)
                if 2.6 <= d <= 4.9:
                    body[y, x] = True
    img = np.full((16, W), st['bg'], np.int32)
    for y in range(16):
        for x in range(W):
            if body[y, x]:
                img[y, x] = st['ramp'][min(11, max(0, (y - 2)))]
            elif any(0 <= y + dy < 16 and 0 <= x + dx < W and body[y + dy, x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                img[y, x] = st['out']
    return [img[:, k * 16:(k + 1) * 16] for k in range(3)]


def star(style='digit'):
    import math
    st = STYLES[style]
    pts = [(7.5 + (6.6 if k % 2 == 0 else 2.7) * math.cos(-math.pi / 2 + k * math.pi / 5),
            8.4 + (6.6 if k % 2 == 0 else 2.7) * math.sin(-math.pi / 2 + k * math.pi / 5)) for k in range(10)]

    def inside(x, y):
        c = False
        for i in range(10):
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % 10]
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                c = not c
        return c
    img = np.full((16, 16), st['bg'], np.int32)
    body = np.array([[inside(x + 0.5, y + 0.5) for x in range(16)] for y in range(16)])
    for y in range(16):
        for x in range(16):
            if body[y, x]:
                img[y, x] = st['ramp'][min(11, max(0, y - 2))]
            elif any(0 <= y + dy < 16 and 0 <= x + dx < 16 and body[y + dy, x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                img[y, x] = st['out']
    return img


# (tile numbers, text, style) — the original's text cells (tile = map entry & 0x3FF)
LABELS = [
    ([0x128, 0x12A, 0x12C, 0x12E, 0x140], 'PLAYER', 'gold', 'left'),
    ([0x142, 0x144, 0x146, 0x148, 0x14A, 0x14C, 0x14E], 'COM LEVEL', 'gold', 'center'),
    ([0x1E6, 0x1E8, 0x1EA, 0x1EC, 0x1EE], 'BATTLE', 'gold', 'center'),
    ([0x1A6, 0x1A8, 0x1AA, 0x1AC], 'TIME', 'gold', 'center'),
    ([0x1AE, 0x1C0, 0x1C2, 0x1C4, 0x1C6, 0x1C8, 0x1CA], 'G-BOMBER', 'gold', 'center'),
    ([0x1CC, 0x1CE, 0x1E0, 0x1E2, 0x1E4], 'STAGE', 'gold', 'center'),
    ([0x100, 0x102, 0x104], 'MAN', 'mint', 'center'),
    ([0x106, 0x108, 0x10A], 'COM', 'rose', 'center'),
    ([0x18A, 0x18C, 0x18E], 'ON', 'mint', 'center'),
    ([0x1A0, 0x1A2, 0x1A4], 'OFF', 'rose', 'center'),
]
SINGLES = [(0x120, '1', 'gold'), (0x122, '2', 'gold'), (0x124, '3', 'gold'), (0x126, '4', 'gold'),
           (0x160, '1', 'digit'), (0x162, '2', 'digit'), (0x164, '3', 'digit'), (0x166, '4', 'digit'),
           (0x168, '5', 'digit'), (0x16A, '6', 'digit'), (0x16C, '7', 'digit'), (0x16E, '8', 'digit'),
           (0x180, '9', 'digit'), (0x182, '10', 'digit'), (0x248, '00', 'digit'), (0x246, ':', 'digit')]


def cells(words):
    """{tile: 16x16 palette-index image} for every text cell; words = menu.json words
    (the composed TALL / CLASSIC / GARDEN / DIGIT0 / STAR)"""
    out = {}
    for tiles, text, style, align in LABELS:
        for t, img in zip(tiles, text_strip(text, len(tiles), style, align)):
            out[t] = img
    # players' OFF: three cells, the last two the same tile (0x10E twice): O, F, F
    out[0x10C] = text_strip('O', 1, 'leaf', 'center')[0]
    out[0x10E] = text_strip('F', 1, 'leaf', 'center')[0]
    for t, text, style in SINGLES:
        gap = 0 if len(text) > 1 else 1
        out[t] = text_strip(text, 1, style, 'center', gap=gap)[0]
    for t, img in zip([0x300, 0x302, 0x304], infinity()):
        out[t] = img
    for name, text in (('TALL', 'TALL'), ('CLASSIC', 'CLASSIC'), ('GARDEN', 'GARDEN')):
        ents = words.get(name)
        if ents:
            for e, img in zip(ents, text_strip(text, len(ents), 'gold', 'center')):
                out[e & 0x3FF] = img
    if words.get('DIGIT0'):
        out[words['DIGIT0'][0] & 0x3FF] = text_strip('0', 1, 'digit')[0]
    if words.get('STAR'):
        out[words['STAR'][0] & 0x3FF] = star()
    # the mode screen: cut-out letters (row 3): SINGLE MATCH / TAG MATCH
    single = [0x284, 0x286, 0x288, 0x28A, 0x28C, 0x28E, 0x2A0, 0x2A2, 0x2A4]
    tag = [0x2A6, 0x2A8, 0x2E0]
    s = text_strip('SINGLE', 5, 'cream', 'center')
    for t, img in zip(single[:5], s):
        out[t] = img
    for t, img in zip(single[5:], text_strip('MATCH', 4, 'cream', 'center')):
        out[t] = img
    for t, img in zip(tag, text_strip('TAG', 3, 'cream', 'center')):
        out[t] = img
    return out
