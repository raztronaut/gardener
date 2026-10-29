"""Garden Edition — the HUD bar (BG3, 2bpp: 3 colours + transparent per palette).

A dark forest-green bar like the wall's cards: a night outline, a mint rim, a vine at
each end, the four players' helmets (a gold antenna knob on top) next to their win counters
in night boxes, the clock in the middle, mint-and-gold flowers as end caps.

Drawn as a 256x24 picture (screen lines 1..24) + the glyphs the game writes at run time
(digits, the colon, the crossed-out helmets of the fallen). The build cuts it along the original's
BG3 map (which char goes where, with which palette); colours must belong to that palette:
  pal 0: night, white, mint          (the white / black helmets)
  pal 1: red, blue, night            (the red / blue helmets)
  pal 2: night, white, mint          (digit boxes, digits, the outer vines)
  pal 3: night, mint, gold           (the bar's frame, end caps, the sprouts)
Transparent = the backdrop (CGRAM 0) = the bar's green.
"""
from common import *  # noqa: F401,F403

BAR = C('#0f3a24')            # CGRAM 0: the backdrop = the bar
HAT_RED, HAT_BLUE = C('#e83a30'), C('#3a7af0')
PALS = {
    0: [BAR, NIGHT, WHITE, MINT],
    1: [BAR, HAT_RED, HAT_BLUE, NIGHT],
    2: [BAR, NIGHT, WHITE, MINT],
    3: [BAR, NIGHT, MINT, GOLD_3],
}
FACE_COLS = (3, 8, 19, 24)
BOXES = ((5, 7), (10, 12), (13, 18), (21, 23), (26, 28))
BOX_Y0, BOX_Y1 = 4, 20

SPROUT = """
................
.......33.......
.......33.......
.......2........
"""

DIGITS = {
    '0': ["..222...", ".22.22..", ".22.22..", ".22.22..", ".22.22..", ".22.22..", "..222..."],
    '1': ["...22...", "..222...", "...22...", "...22...", "...22...", "...22...", "..2222.."],
    '2': ["..222...", ".22.22..", "....22..", "...22...", "..22....", ".22.....", ".22222.."],
    '3': [".2222...", "....22..", "....22..", "..222...", "....22..", "....22..", ".2222..."],
    '4': ["...222..", "..2.22..", ".2..22..", ".22222..", "....22..", "....22..", "....22.."],
    '5': [".22222..", ".22.....", ".2222...", "....22..", "....22..", ".22.22..", "..222..."],
    '6': ["..222...", ".22.....", ".22.....", ".2222...", ".22.22..", ".22.22..", "..222..."],
    '7': [".22222..", "....22..", "...22...", "...22...", "..22....", "..22....", "..22...."],
    '8': ["..222...", ".22.22..", ".22.22..", "..222...", ".22.22..", ".22.22..", "..222..."],
    '9': ["..222...", ".22.22..", ".22.22..", "..2222..", "....22..", "...22...", "..22...."],
}


def digit(ch):
    """8x8 (screen y 8..15 of a box): the digit white on the night box, one blank row on top"""
    img = blank(8, 8, NIGHT)
    for y, row in enumerate(DIGITS[ch]):
        for x, c in enumerate(row):
            if c == '2':
                img[y + 1, x] = WHITE
    return img


def colon():
    """8x16 (rows 1-2 of the clock box): two dots, with the box bottom edge"""
    img = blank(8, 16, NIGHT)
    for (x, y) in ((3, 3), (4, 3), (3, 4), (4, 4), (3, 8), (4, 8), (3, 9), (4, 9)):
        img[y, x] = WHITE
    for y in range(16):
        if 8 + y > BOX_Y1:
            img[y, :] = T
        elif 8 + y == BOX_Y1:
            img[y, :] = MINT
    return img


HEAD = [
    ".......o........",
    "....oooooooo....",
    "...oFFFFFFFFo...",
    "..oFhhFFFFFFFo..",
    "..oFvvvvvvvvFo..",
    ".oFvv11vv22vvFo.",
    ".oFvv11vv22vvFo.",
    "..oFvvvvvvvvFo..",
    "..oFFFFFFFFFFo..",
    "...oFFFFFFFFo...",
    "....oooooooo....",
]


def hat(colour, dead=False):
    """the player's icon: a bomber's round helmet with its visor (the players are the
    original's bombers), drawn in the bar's palettes; dead = crossed-out eyes"""
    fill, outline, visor, eye = {
        'white': (WHITE, NIGHT, NIGHT, WHITE),
        'black': (NIGHT, MINT, NIGHT, MINT),
        'red': (HAT_RED, NIGHT, NIGHT, HAT_RED),
        'blue': (HAT_BLUE, NIGHT, NIGHT, HAT_BLUE),
    }[colour]
    hi = MINT if colour == 'black' else fill
    rows = list(HEAD)
    if dead:
        rows[5] = ".oFvv1vvvv2vvFo."
        rows[6] = ".oFvvv1vvvv2vFo."
        rows[0] = "................"
    L = {'o': outline, 'F': fill, 'h': hi, 'v': visor, '1': eye, '2': eye}
    img = blank(16, 16)
    over(img, grid('\n'.join(rows), L), 0, 0)
    return img


def bar():
    """the static bar, 256 x 24 (screen lines 1..24), faces / digits not included"""
    W, H = 256, 24
    img = blank(W, H)              # transparent = the backdrop green
    # outer vines (x 0..7 and 248..255): a mint stem with leaves and white buds
    for x0 in (0, 248):
        for y in range(H):
            sx = x0 + 3 + [0, 1, 1, 0, 0, -1, -1, 0][y % 8]
            img[y, sx] = MINT
            if y % 8 == 1:
                img[y, sx + 1] = MINT
                img[y, sx + 2] = MINT
                img[y - 1, sx + 2] = WHITE
            if y % 8 == 5:
                img[y, sx - 1] = MINT
                img[y, sx - 2] = MINT
                img[y + 1, sx - 2] = WHITE
    # the bar: x 8..247, night outline, mint rim
    x0, x1 = 8, 247
    for x in range(x0 + 1, x1):
        img[0, x] = NIGHT
        img[1, x] = MINT
        img[23, x] = NIGHT
    for y in range(1, 23):
        img[y, x0] = NIGHT
        img[y, x1] = NIGHT
        img[y, x0 + 1] = MINT
        img[y, x1 - 1] = MINT
    for (x, y) in ((x0 + 1, 1), (x1 - 1, 1)):
        img[y, x] = NIGHT
    # boxes
    for c0, c1 in BOXES:
        bx0, bx1 = c0 * 8 + 1, c1 * 8 + 6
        for y in range(BOX_Y0, BOX_Y1 + 1):
            for x in range(bx0, bx1 + 1):
                edge = y in (BOX_Y0, BOX_Y1) or x in (bx0, bx1)
                img[y, x] = MINT if edge else NIGHT
        for (x, y) in ((bx0, BOX_Y0), (bx1, BOX_Y0), (bx0, BOX_Y1), (bx1, BOX_Y1)):
            img[y, x] = T
    # end caps: a flower at col 2 / col 29, row 1
    flower = grid("""
..2..2..
.22..22.
..2332..
...33...
..2332..
.22..22.
..2..2..
........
""", {'2': MINT, '3': GOLD_3})
    over(img, flower, 16, 8)
    over(img, flower, 232, 8)
    return img


def picture(dead=()):
    """the bar as the game shows it at match start: hats, '0' wins, clock 2:00"""
    img = bar()
    sp = grid(SPROUT, {'2': MINT, '3': GOLD_3})
    for col, k in zip(FACE_COLS, ('white', 'black', 'red', 'blue')):
        if k not in dead:
            over(img, sp, col * 8, 4)
        over(img, hat(k, dead=k in dead), col * 8, 8)
    for c in (6, 11, 22, 27):
        over(img, digit('0'), c * 8, 8)
    for c, ch in ((14, '2'), (16, '0'), (17, '0')):
        over(img, digit(ch), c * 8, 8)
    over(img, colon(), 15 * 8, 8)
    return img
