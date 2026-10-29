#!/usr/bin/env python3
"""Garden Edition review sheet: every bomber pose the census saw (data/sb2/garden/census.json),
composed from its pieces like the game draws it, original next to the gardener.

    python3 tools/sb2/garden/posesheet.py [--colour white] [--traced] [--from N --to M] [--scale 4]
-> data/sb2/garden/poses_<colour>.png  (needs data/sb2: ROM-derived pose layouts)
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, 'lib'))
sys.path.insert(0, os.path.join(HERE, 'src'))
import trace_bombers as tb  # noqa: E402
import bombers  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--colour', default='white')
    ap.add_argument('--traced', action='store_true', help='trace now instead of reading src/bombers/pieces.txt')
    ap.add_argument('--from', dest='fr', type=int, default=0)
    ap.add_argument('--to', type=int, default=999)
    ap.add_argument('--scale', type=int, default=4)
    ap.add_argument('--cols', type=int, default=10)
    a = ap.parse_args()
    m = json.load(open(os.path.join(ROOT, 'data/sb2/assets/pack/pack.json')))
    b = open(os.path.join(ROOT, 'data/sb2/assets/pack/sb2.bin'), 'rb').read()
    o, l = m['blobs']['rom.C2']
    C2 = b[o:o + l]
    orig = tb.load_pieces()
    garden = tb.trace_all(orig) if a.traced else bombers.read_pieces()
    opal = tb.original_palette()
    gpal = bombers.palette_rgb(a.colour)
    cen = json.load(open(os.path.join(ROOT, 'data/sb2/garden/census.json')))
    poses = sorted(cen['poses'], key=lambda p: (sorted(p['anims'])[0], p['pose']))[a.fr:a.to]
    S, cell = a.scale, 40
    cols = a.cols
    cw = cell * S * 2 + 8
    img = Image.new('RGB', (cols * cw, ((len(poses) + cols - 1) // cols) * (cell * S + 14)), (24, 8, 24))
    d = ImageDraw.Draw(img)
    for k, ps in enumerate(poses):
        ad = ps['pose'] & 0xFFFF
        n = C2[ad]
        ad += 1
        pcs = []
        for i in range(n):
            dx = (C2[ad] ^ 0x80) - 0x80
            dy = (C2[ad + 1] ^ 0x80) - 0x80
            b2, b3, b4 = C2[ad + 2], C2[ad + 3], C2[ad + 4]
            ad += 5
            pcs.append((dx, dy, b2, ((b3 & 0x0F) << 8) | b4))
        ox, oy = (k % cols) * cw, (k // cols) * (cell * S + 14)
        for side, (src, pal) in enumerate(((orig, opal), (garden, gpal))):
            can = np.zeros((cell, cell, 3), np.uint8)
            can[:] = (64, 104, 64)
            for dx, dy, b2, tid in reversed(pcs):
                if tid >= 0x3C0 or tid not in src:
                    continue
                t = src[tid]
                if b2 & 0x40:
                    t = t[:, ::-1]
                if b2 & 0x80:
                    t = t[::-1, :]
                for y in range(16):
                    for x in range(16):
                        v = t[y, x]
                        X, Y = dx + 12 + x, dy + 32 + y
                        if v and 0 <= X < cell and 0 <= Y < cell:
                            can[Y, X] = pal[v]
            img.paste(Image.fromarray(can).resize((cell * S, cell * S), Image.NEAREST), (ox + side * cell * S, oy + 12))
        d.text((ox + 2, oy), '%d %s %s' % (a.fr + k, ','.join(sorted(ps['anims'])[:2]), ' '.join(str(p[3]) for p in pcs if p[3] < 0x3C0)), fill=(255, 255, 0))
    out = os.path.join(ROOT, 'data/sb2/garden/poses_%s.png' % a.colour)
    img.save(out)
    print(out, img.size)


if __name__ == '__main__':
    main()
