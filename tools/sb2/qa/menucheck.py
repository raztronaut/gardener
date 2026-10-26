"""Compare the re-laid out menus (menucheck.mjs) with the original's frames, region by region.

    node tools/sb2/qa/menucheck.mjs && python3 tools/sb2/qa/menucheck.py

Regions = the parts the tall layout keeps from the original (same pixels, moved by whole
16 px rows): mode / players / rules panels (original rows 1..9 -> tall rows 8..16), the
stage-select panel's right column and preview (CLASSIC), the title's logo, items and
sprites (original rows 0..9 -> tall rows 6..15). The animated cursor cells (cols 1..2)
are left out (their phase depends on the frame). Writes side-by-side PNGs.
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
D = os.path.join(ROOT, 'data', 'sb2', 'qa', 'menucheck')
REF = os.path.join(ROOT, 'data', 'sb2', 'assets', 'menus', 'ref')


def load(name):
    a = np.frombuffer(open(os.path.join(D, name + '.rgba'), 'rb').read(), np.uint8).reshape(455, 256, 4)[:, :, :3]
    return a


def to565(a):
    """the harness frames are RGB565-expanded (snes9x); compare 5/6/5 bits"""
    a = a.astype(np.int32)
    return (a[:, :, 0] >> 3, a[:, :, 1] >> 2, a[:, :, 2] >> 3)


# (screen, ref, [(orig x0, y0, w, h, tall dx, dy)])
CHECKS = [
    ('mode', 'mode', [(48, 16, 192, 144, 0, 112)]),
    ('players', 'players', [(48, 16, 192, 144, 0, 112)]),
    ('rules', 'rules', [(48, 16, 192, 144, 0, 112)]),
    ('stage', 'stage', [(16, 16, 224, 16, 0, 16), (144, 32, 96, 32, 0, 16), (32, 32, 112, 112, 0, 16)]),
    ('title', 'title', [(0, 0, 256, 160, 0, 96)]),
]
total_bad = total = 0
for screen, ref, regions in CHECKS:
    a = load(screen)
    r = np.array(Image.open(os.path.join(REF, ref + '.png')).convert('RGB'))
    side = np.zeros((455, 256 * 2 + 8, 3), np.uint8)
    side[:224, :256] = r
    side[:, 264:] = a
    for (x, y, w, h, dx, dy) in regions:
        o = r[y:y + h, x:x + w]
        t = a[y + dy:y + dy + h, x + dx:x + dx + w]
        eq = np.all(np.stack([p == q for p, q in zip(to565(o), to565(t))]), axis=0)
        bad = int((~eq).sum())
        total_bad += bad
        total += eq.size
        print('%-8s region (%3d,%3d %3dx%3d) -> (+%d,+%d): %6d / %6d px identical%s' % (
            screen, x, y, w, h, dx, dy, int(eq.sum()), eq.size, '' if not bad else '  (%d differ)' % bad))
    Image.fromarray(side).save(os.path.join(D, 'side_%s.png' % screen))
print('ALL %d / %d px identical (%.3f %%)' % (total - total_bad, total, 100.0 * (total - total_bad) / total))
