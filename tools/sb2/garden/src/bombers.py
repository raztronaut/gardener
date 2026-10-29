"""Garden Edition — the gardeners' palettes (OBJ palettes 0..3 + the gold G-BOMBER, healthy
and the skull-disease flash) and the pieces file reader.

Identity is kept by the outfit: the sun hat and the overalls wear the player's colour
(white, black, red, blue, gold), the rest is shared — skin, brown hair and wellies,
green gloves and the leaf sprout on the hat, a straw-gold hat band.
"""
import os
from common import *  # noqa: F401,F403

HERE = os.path.dirname(os.path.abspath(__file__))
LEG = '.#szhHKuUDwgGbBa'

SHARED = {
    1: C('#140c10'),       # outline
    2: C('#ffcfa4'),       # skin
    3: C('#e08a64'),       # skin shade
    10: C('#fff0c4'),      # the shirt (sleeves) and small highlights: warm cream
    11: C('#8ee05a'),      # leaf / glove light
    12: C('#2e9a3c'),      # leaf / glove dark
    13: C('#9a5a2c'),      # brown (hair, wellies)
    14: C('#5a2e16'),      # brown dark
    15: C('#ffd84a'),      # accent: the straw-gold band
}

# hat light / hat / hat dark, outfit light / outfit / outfit dark
IDENTITY = {
    'white': ['#ffffff', '#dfe8e0', '#98a8a0', '#d8e4ec', '#a4b4c0', '#64748a'],
    'black': ['#6a6a7a', '#3a3a48', '#1e1e28', '#5a5a6a', '#34343e', '#1a1a22'],
    'red':   ['#ff8a6a', '#e83a30', '#8a1418', '#ff6a50', '#d02828', '#7a1014'],
    'blue':  ['#8ac8ff', '#3a7af0', '#1a3a9a', '#6aaaff', '#2a5ae0', '#142a80'],
    'gold':  ['#fff4a0', '#ffc828', '#b86e10', '#ffe060', '#f0a818', '#9a5a08'],
}


def palette(colour, sick=False):
    """16 BGR555 words for OBJ palette (index 0 = transparent)"""
    ids = IDENTITY[colour]
    pal = [0] * 16
    for k, v in SHARED.items():
        pal[k] = v
    for i, h in enumerate(ids):
        pal[4 + i] = C(h)
    if colour == 'gold':
        pal[15] = C('#2e9a3c')          # the champion's band is green
    if sick:
        # the skull flash: everything tinted a poisonous violet-green
        from gfx import rgb
        out = [0]
        for c in pal[1:]:
            r, g, b = rgb(c)
            r, g, b = (r + 150) // 2, (g + 60) // 2, (b + 200) // 2
            out.append(C('#%02x%02x%02x' % (min(255, r), min(255, g), min(255, b))))
        pal = out
    return pal


def palette_rgb(colour):
    from gfx import rgb
    return [rgb(c) for c in palette(colour)]


def read_pieces(path=None):
    """pieces.txt -> {tile: (16, 16) int array of OBJ palette indices}"""
    import numpy as np
    path = path or os.path.join(HERE, 'bombers', 'pieces.txt')
    out = {}
    cur, rows = None, []
    with open(path) as f:
        for line in f:
            line = line.rstrip('\n')
            if line.startswith('@'):
                cur, rows = int(line[1:].split()[0]), []
                continue
            if cur is None:
                continue
            if line.strip() == '':
                if rows:
                    out[cur] = np.array([[LEG.index(ch) for ch in r] for r in rows], np.int32)
                    cur, rows = None, []
                continue
            if len(line) != 16:
                raise ValueError('piece %d: row of %d chars' % (cur, len(line)))
            rows.append(line)
    if cur is not None and rows:
        out[cur] = np.array([[LEG.index(ch) for ch in r] for r in rows], np.int32)
    return out
