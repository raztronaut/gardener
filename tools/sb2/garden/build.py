#!/usr/bin/env python3
"""Garden Edition build: original pixel art (tools/sb2/garden/src/) -> the skin overlay
public/arcade/sb2/garden/garden.json + garden.bin (+ pictures), committed.

    nice -n 10 python3 tools/sb2/garden/build.py [--only arena|bombers|hud|menus] [--stage N]

The overlay patches the runtime pack (data/sb2/assets/pack/, built from the user's ROM by
tools/sb2/extract/pack.py) in place of the graphics only, in the same formats the
renderer reads (render/skin.js):
  stageNN  VRAM characters of every BG2 / BG1 cell (metatile), the HUD (BG3) and the OBJ
           tiles, CGRAM (all BG palettes + OBJ palettes 4..7), WRAM animated-char sources
  rom.C5   the bombers' pose graphics (C5:tile*32) ; rom.C1 their palettes, stage cycles
  menus    characters + palettes of the title / menu screens, sprite pieces
Only bytes this build DRAWS go into the overlay; the original's layout (which tile goes
where, poses, scripts) is read from data/sb2/ at build time and never copied.
Inputs read from data/sb2/assets (ROM-derived, local): stage.json (metatile ids and kinds),
the pack manifest (blob layout, PPU registers).
"""
import argparse
import importlib
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, 'lib'))
sys.path.insert(0, os.path.join(HERE, 'src'))
sys.path.insert(0, os.path.join(HERE, 'src', 'stages'))
from gfx import T, encode4, encode2, rgb, over  # noqa: E402

ASSETS = os.path.join(ROOT, 'data', 'sb2', 'assets')
OUT = os.path.join(ROOT, 'public', 'arcade', 'sb2', 'garden')
SCRATCH = os.path.join(ROOT, 'data', 'sb2', 'garden')


def read_json(p):
    with open(p) as f:
        return json.load(f)


class Overlay:
    """byte patches per blob; contiguous writes are merged at the end"""
    def __init__(self):
        self.writes = {}      # blob -> {offset: byte}

    def put(self, blob, at, data):
        d = self.writes.setdefault(blob, {})
        for i, b in enumerate(data):
            d[at + i] = b

    def runs(self):
        for blob, d in self.writes.items():
            keys = sorted(d)
            i = 0
            while i < len(keys):
                j = i
                while j + 1 < len(keys) and keys[j + 1] == keys[j] + 1:
                    j += 1
                yield blob, keys[i], bytes(d[k] for k in keys[i:j + 1])
                i = j + 1


class Palettes:
    """palette allocation: each slot collects the colours its characters use (<= 15 +
    transparent); fixed slots pin a colour to an index (e.g. the item border = 15)"""
    def __init__(self):
        self.cols = {}
        self.fixed = {}
        self.users = {}

    def need(self, slot, cols, who):
        s = self.cols.setdefault(slot, set())
        for c in cols:
            if c not in s:
                s.add(c)
                self.users.setdefault(slot, {})[c] = who

    def pin(self, slot, index, col):
        self.fixed.setdefault(slot, {})[index] = col
        self.cols.setdefault(slot, set()).add(col)

    def solve(self):
        out = {}
        for slot, cols in self.cols.items():
            fixed = self.fixed.get(slot, {})
            free = sorted((c for c in cols if c not in fixed.values()), key=lambda c: sum(rgb(c)))
            if len(cols) > 15:
                users = self.users.get(slot, {})
                raise SystemExit('palette %s has %d colours (max 15):\n  %s' % (
                    slot, len(cols), '\n  '.join('%s %s' % ('#%02x%02x%02x' % rgb(c), users.get(c, '?')) for c in sorted(cols, key=lambda c: sum(rgb(c))))))
            pal = [None] * 16
            pal[0] = 0
            for i, c in fixed.items():
                pal[i] = c
            k = 1
            for c in free:
                while pal[k] is not None:
                    k += 1
                pal[k] = c
            out[slot] = [c if c is not None else 0 for c in pal]
        return out


def quads(img16):
    return [img16[0:8, 0:8], img16[0:8, 8:16], img16[8:16, 0:8], img16[8:16, 8:16]]


# ---- the arena (BG2 / BG1 cells) -------------------------------------------------------------
OWNER = (1, 2, 3, 4)


def slot_of(pal):
    return 'obj' if pal in OWNER else 'bg%d' % pal


def stage_arena(st, ov, report):
    import objects
    import items
    meta = read_json(os.path.join(ASSETS, 'stages', 'stage%02d' % st, 'stage.json'))
    mod = importlib.import_module('s%02d' % st)
    importlib.reload(mod)
    ctx = {'stage': st, 'meta': meta}
    terr = mod.terrain(ctx)
    base_name = getattr(mod, 'FLOOR', 'floor_0')
    base = terr[base_name]
    item_art = items.all_items()
    cells = []          # (metatile, img16)
    missing = []
    soft = terr.get('soft_block_0')
    for x in meta['metatiles']:
        k, n = x['kind'], x['name']
        img = None
        if k == 'bomb':
            img = over(base.copy(), objects.pod(x['bomb_type'], x['frame']))
        elif k == 'flame':
            if x.get('piece'):
                img = over(base.copy(), objects.bloom(x['piece'], x['frame']))
            else:
                img = mod.track_flame(ctx, x, terr) if hasattr(mod, 'track_flame') else None
        elif k == 'soft_destroy':
            img = over(base.copy(), objects.shed(soft, x['frame']))
        elif k == 'item_burn':
            img = over(base.copy(), objects.wilt(x['frame']))
        elif k == 'item':
            img = item_art.get(x['item'])
        else:
            img = terr.get(n)
            if img is None and hasattr(mod, 'cell'):
                img = mod.cell(ctx, x, terr)
        if img is None:
            missing.append(n)
            continue
        if (img < 0).any() and k != 'bg1_overlay':
            # BG2 cells are opaque (the backdrop would show): fill holes with the floor
            img = over(base.copy(), img)
        cells.append((x, img))
    if missing:
        report.append('stage %d: NOT DRAWN %d: %s' % (st, len(missing), ', '.join(missing)))
    # characters
    chars = {}          # char number -> (slot, 8x8 image, who)
    pals = Palettes()
    pals.pin('bg5', 15, items.BORDER[0])
    for x, img in cells:
        for e in x['entries']:
            t, pal, hf, vf = e & 0x3FF, (e >> 10) & 7, (e >> 14) & 1, (e >> 15) & 1
            canon = img
            if hf:
                canon = canon[:, ::-1]
            if vf:
                canon = canon[::-1, :]
            slot = slot_of(pal)
            for q, c in zip(quads(canon), (t, t + 1, t + 16, t + 17)):
                q = np.ascontiguousarray(q)
                prev = chars.get(c)
                if prev is not None:
                    if prev[0] == slot and np.array_equal(prev[1], q):
                        continue
                    if prev[0] != slot and np.array_equal(prev[1], q):
                        pals.need(slot, set(int(v) for v in np.unique(q) if v >= 0), x['name'])
                        continue
                    report.append('stage %d: char $%03X drawn twice differently: %s vs %s' % (st, c, prev[2], x['name']))
                    continue
                chars[c] = (slot, q, x['name'])
                pals.need(slot, set(int(v) for v in np.unique(q) if v >= 0), x['name'])
    sol = pals.solve()
    # the owner palettes 1..4 are one garden palette (the bloom / pod colours + the floor)
    pack = read_json(os.path.join(ASSETS, 'pack', 'pack.json'))
    ppu = pack['stages'][st - 1]['ppu']
    chr_base = (ppu['bg2_char_base'] * 2) & 0xFFFF
    blob = 'stage%02d' % st
    for c, (slot, q, who) in chars.items():
        pal = sol[slot]
        idx = np.zeros((8, 8), np.int32)
        for yy in range(8):
            for xx in range(8):
                v = int(q[yy, xx])
                idx[yy, xx] = 0 if v < 0 else pal.index(v)
        ov.put(blob, (chr_base + c * 32) & 0xFFFF, encode4(idx))
    cg = 0x10000      # CGRAM offset in the stage blob
    for p in range(1, 8):
        slot = slot_of(p)
        if slot not in sol:
            continue
        words = sol[slot]
        ov.put(blob, cg + p * 32, b''.join(int(w).to_bytes(2, 'little') for w in words))
    report.append('stage %d: %d cells, %d chars, palettes %s' % (st, len(cells), len(chars),
                  ' '.join('%s:%d' % (s, len(set(v)) - 1) for s, v in sorted(sol.items()))))
    return {'cells': cells, 'sol': sol, 'terr': terr, 'meta': meta}


def contact_sheet(st, res, path):
    """every drawn cell of the stage on one sheet (16 per row), for review"""
    from PIL import Image
    cells = res['cells']
    n = len(cells)
    rows = (n + 15) // 16
    sheet = np.full((rows * 17, 16 * 17), -1, np.int32)
    for i, (x, img) in enumerate(cells):
        r, c = divmod(i, 16)
        sheet[r * 17:r * 17 + 16, c * 17:c * 17 + 16] = img
    from gfx import save_png
    save_png(sheet, path, scale=3, bg=(20, 10, 30))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', type=int, nargs='*')
    ap.add_argument('--sheets', action='store_true')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SCRATCH, exist_ok=True)
    ov = Overlay()
    report = []
    stages = a.stage or list(range(1, 11))
    results = {}
    for st in stages:
        try:
            importlib.import_module('s%02d' % st)
        except ModuleNotFoundError:
            report.append('stage %d: no source yet' % st)
            continue
        results[st] = stage_arena(st, ov, report)
        if a.sheets:
            contact_sheet(st, results[st], os.path.join(SCRATCH, 'sheet_s%02d.png' % st))
    import items
    # the overlay files
    binbuf = bytearray()
    patches = []
    for blob, at, data in ov.runs():
        patches.append([blob, at, len(binbuf), len(data)])
        binbuf += data
        while len(binbuf) & 3:
            binbuf.append(0)
    manifest = {
        'version': 1, 'name': 'garden', 'title': 'Bomber Garden',
        'note': 'Garden Edition: original pixel art (tools/sb2/garden/), an overlay on the runtime pack',
        'bin': 'garden.bin',
        'pack': {'patches': patches, 'display': {'border95': list(items.BORDER)}},
    }
    with open(os.path.join(OUT, 'garden.bin'), 'wb') as f:
        f.write(binbuf)
    with open(os.path.join(OUT, 'garden.json'), 'w') as f:
        json.dump(manifest, f, separators=(',', ':'))
    print('\n'.join(report))
    print('overlay: %d patches, %d bytes' % (len(patches), len(binbuf)))


if __name__ == '__main__':
    main()
