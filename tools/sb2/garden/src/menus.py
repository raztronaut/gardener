"""Garden Edition — the battle menus (menu.js re-runs the original's menu screens on its
small PPU; the skin recolours them and redraws their scenery).

  palettes   BG palettes 1..4 of the menu screens, index by index: the panels become the
             wall's dark forest-green cards with mint rims, the orange label font sunflower
             gold, the blue values mint, the red values rose
  wall       the stone wall behind the panels -> a hedge of leaves with a few flowers
  strip      the bottom strip: the wall top -> a flowering hedge edge, the kerb -> a stone
             edging with flowers, the road -> a gravel garden path
  icons      the player table's bomber heads -> the gardeners' sun hats
Pictures are palette-index grids in the original's palette rows (the build writes them
as characters into the menu VRAM at the original tile numbers).
"""
from common import *  # noqa: F401,F403
import math
import bombers

# ---- palettes (BG rows 1..4: colour index -> garden colour) ---------------------------------
PANEL = C('#0f3a24')      # the panels' fill (the wall's cards)
P4 = {1: NIGHT, 2: INK, 3: LEAF_1, 4: LEAF_2, 5: MINT_D, 6: LEAF_3, 7: LEAF_4,
      8: TEAL_D, 9: TEAL, 10: MINT, 11: GOLD_1, 12: GOLD_2, 13: GOLD_4, 14: PANEL, 15: WHITE}
P3 = {1: NIGHT, 2: SOIL_1, 3: SOIL_2, 4: SAND_0, 5: SAND_1, 6: SAND_2, 7: SAND_3, 8: CREAM,
      9: LEAF_1, 10: LEAF_2, 11: LEAF_3, 12: WHITE, 13: PANEL, 14: PINK, 15: STONE_3}
# palette 2: the blue ramp (the mode screen's bands under the cut-out letters, MAN / ON) ->
# mint; the red ramp (COM, OFF) -> rose; the greens (OFF) -> leaves; 11 = the panel
P2 = {1: NIGHT, 2: TEAL_D, 3: TEAL, 4: MINT, 5: WHITE, 6: ROSE_0, 7: ROSE_1, 8: ROSE_2, 9: PINK,
      10: LEAF_1, 11: PANEL, 12: LEAF_3, 13: LEAF_4, 14: STONE_3, 15: WHITE}
W, B, R, U = bombers.IDENTITY['white'], bombers.IDENTITY['black'], bombers.IDENTITY['red'], bombers.IDENTITY['blue']
P1 = {1: NIGHT, 2: C(U[0]), 3: C(W[0]), 4: C(W[1]), 5: MINT, 6: C(W[2]), 7: C(B[0]), 8: C(B[1]), 9: GOLD_3,
      10: C(R[1]), 11: C(R[2]), 12: C(R[0]), 13: C(U[1]), 14: C(U[2]), 15: PANEL}
BG_PALS = {1: P1, 2: P2, 3: P3, 4: P4}

# ---- the hedge wall behind the panels (palette 4: 1 night, 2 ink, 3..7 leaves, 13 gold) ----------
LEAFRAMP = [3, 4, 6, 7]     # dark .. light (palette 4 indices)


def hedge_tile(seed, flowers=0):
    """a seamless foliage tile in palette-4 indices"""
    from brushes import foliage_tile
    img = foliage_tile(LEAFRAMP, seed=seed, n=8, rmin=2.4, rmax=3.8)
    r = Rng(seed + 9)
    for _ in range(flowers):
        x, y = 2 + r.rand(12), 2 + r.rand(12)
        for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
            img[y + dy, x + dx] = 15
        img[y, x] = 13
    return img


WALL_TILES = {0x2CE: (11, 0), 0x2AC: (12, 1), 0x2E2: (13, 0), 0x2E6: (14, 2), 0x24E: (15, 1)}


def wall_tiles():
    return {t: hedge_tile(s, f) for t, (s, f) in WALL_TILES.items()}


# ---- the bottom strip --------------------------------------------------------------------------
def hedge_edge(seed):
    """row 10 (palette 4): the hedge's lower edge, a dark shadow line at the bottom"""
    img = hedge_tile(seed, 1)
    for x in range(16):
        img[14, x] = 2
        img[15, x] = 1
    return img


def flower_bed(seed):
    """row 11 (palette 3): a bed of flowers along a stone edging"""
    img = blank(16, 16, 3)
    r = Rng(seed)
    for y in range(11):
        for x in range(16):
            img[y, x] = 10 if (x + y * 3 + seed) % 5 else (9 if (x + y) % 3 else 11)
    for _ in range(5):
        x, y = 1 + r.rand(14), 1 + r.rand(8)
        c = [14, 12, 14][r.rand(3)]
        for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
            img[y + dy, x + dx] = c
        img[y, x] = 8
    for x in range(16):
        img[11, x] = 1
        img[12, x] = 7 if x % 8 else 1
        img[13, x] = 6 if x % 8 else 1
        img[14, x] = 5 if x % 8 else 1
        img[15, x] = 4
    return img


def path(seed, stone=False):
    """rows 12 / 13 (palette 3): gravel path"""
    img = speckle(16, 16, 5, [(6, 3), (4, 2), (7, 1)], seed=seed, density=0.3)
    if stone:
        for y in range(3, 13):
            for x in range(3, 13):
                d = math.hypot(x - 7.5, y - 7.5)
                if d < 5.2:
                    img[y, x] = 15 if d < 4.4 else 4
        img[5, 5] = 8
    return img


STRIP_TILES = {
    # row 10 (palette 4)
    0x24C: ('edge', 21), 0x24A: ('edge', 22), 0x2AA: ('edge', 23), 0x2E4: ('edge', 24),
    # row 11 (palette 3)
    0x2CC: ('bed', 1), 0x2AE: ('bed', 2), 0x262: ('bed', 3), 0x260: ('bed', 4), 0x2CA: ('bed', 5),
    # rows 12 / 13 (palette 3)
    0x2C8: ('path', 6), 0x188: ('stone', 7), 0x2EE: ('path', 8),
}


def strip_tiles():
    out = {}
    for t, (k, s) in STRIP_TILES.items():
        out[t] = hedge_edge(s) if k == 'edge' else flower_bed(s) if k == 'bed' else path(s, stone=(k == 'stone'))
    return out


# ---- the player table's icons: sun hats (palette 1) ----------------------------------------------
HAT_ICON = """
................
................
................
......oooo......
.....oFFFFo.....
....oFHFFFFo....
....oFFFFFFo....
....oBBBBBBo....
..ooFFFFFFFFoo..
.oFHFFFFFFFFFFo.
..oooooooooooo..
................
................
................
................
................
"""


def icons():
    sets = {0x2C0: (3, 4, 5, 3), 0x2C2: (7, 8, 3, 7), 0x2C4: (10, 11, 9, 12), 0x2C6: (13, 14, 9, 2)}
    out = {}
    for t, (F, D, Bd, H) in sets.items():
        L = {'o': 1, 'F': F, 'B': Bd, 'H': H}
        img = grid(HAT_ICON, L)
        img[img < 0] = 15                     # the panel behind the icon
        # the hat's right side in shade
        for y in range(16):
            for x in range(10, 15):
                if img[y, x] == F:
                    img[y, x] = D
        out[t] = img
    return out
