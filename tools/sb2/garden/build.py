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
sys.path.insert(0, HERE)
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


_MAPS = None


def stage_maps():
    global _MAPS
    if _MAPS is None:
        p = os.path.join(SCRATCH, 'maps.json')
        if not os.path.exists(p):
            import subprocess
            subprocess.check_call(['node', os.path.join(HERE, 'mapdump.mjs'), p])
        _MAPS = read_json(p)
    return _MAPS


# ---- the arena as cell art (arena.py; display.js stageArt) -----------------------------------
def stage_cells(st, ov, report, art):
    import objects
    import arena
    meta = read_json(os.path.join(ASSETS, 'stages', 'stage%02d' % st, 'stage.json'))
    mod = importlib.import_module('s%02d' % st)
    importlib.reload(mod)
    pack = read_json(os.path.join(ASSETS, 'pack', 'pack.json'))
    ppu = pack['stages'][st - 1]['ppu']
    res = arena.build_stage(st, mod, meta, stage_maps(), report, objects, ppu, id_base=len(art['pics']))
    blob = 'stage%02d' % st
    rows = res['rows']
    for r, words in rows.items():
        ov.put(blob, 0x10000 + r * 32, pal_bytes(words))
    # characters still drawn the SNES way: animated cells (their sources in WRAM) and BG1
    # overlays; {(bg, tile): (row, 16x16 image)} (transparent = colour 0: the ground shows)
    for (bg, t), (row, img) in res['chars'].items():
        base = (ppu['bg%d_char_base' % bg] * 2) & 0xFFFF
        P = rows[row]
        idx = np.vectorize(lambda v: 0 if v < 0 else P.index(int(v), 1))(img)
        for (dy, dx), c in zip(((0, 0), (0, 8), (8, 0), (8, 8)), (t, t + 1, t + 16, t + 17)):
            ov.put(blob, (base + c * 32) & 0xFFFF, encode4(idx[dy:dy + 8, dx:dx + 8]))
    for an in res['anims']:
        P = rows[an['pal']]
        for fr, im in an['frames']:
            for (dy, dx), k in zip(((0, 0), (0, 8), (8, 0), (8, 8)), (0, 1, 16, 17)):
                q = im[dy:dy + 8, dx:dx + 8]
                idx = np.vectorize(lambda v: 0 if v < 0 else P.index(int(v), 1))(q)
                ov.put(blob, 0x10200 + 0x828 + ((fr & 0x7F) + k) * 32, encode4(idx))   # C1340A: frame & $7F
    # palette cycles (stage 8 / 9: whole BG rows loaded from ROM C1 per phase)
    for row, cyc in res['cycles'].items():
        pal = rows[row]
        cols, base_addr, phases = cyc['colours'], cyc['rom'], cyc['phases']
        n = len(cols)
        for ph in range(phases):
            words = [cols[(cols.index(c) - ph) % n] if c in cols else c for c in pal]
            ov.put('rom.C1', base_addr + 32 * ph, pal_bytes(words))
    first = len(art['pics'])
    art['pics'] += res['pics']
    shade_ids = [first + i for i, p in enumerate(res['colour_pics']) if p[1]]
    cls = []
    for key, mode, row, layers in res['cls']:
        cls.append([key, mode, row, None if layers is None else
                    [[w, h, salt, [first + i for i in ids]] for (w, h, salt, ids) in layers]])
    art['stages'][str(st)] = {'shade': res['shade'], 'shadePics': shade_ids, 'cls': cls,
                              'masks': res['masks'], 'maskRefs': res['refs'], 'fireRefs': res['xrefs'], 'stat': res['stat']}
    return res


def pal_bytes(words):
    return b''.join(int(w).to_bytes(2, 'little') for w in words)


# ---- the HUD (BG3 2bpp, map $5C00 / chars $A000 in every stage) ----------------------------
HUD_MAP, HUD_CHR = 0xB800, 0xA000
HUD_DIGIT = [0x8F, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x8C, 0x8D, 0x8E]      # display.js DIGIT
HUD_DEAD = {'white': (0, 0x60), 'black': (0, 0x62), 'red': (1, 0x64), 'blue': (1, 0x66)}


def hud_chars(vram, report):
    """{char: 16 bytes} for every HUD char, cut from the garden bar along the original's map"""
    import hud
    out, who = {}, {}

    def put(t, pal, img8, hf=0, vf=0, name=''):
        if hf:
            img8 = img8[:, ::-1]
        if vf:
            img8 = img8[::-1, :]
        P = hud.PALS[pal]
        idx = np.zeros((8, 8), np.int32)
        for y in range(8):
            for x in range(8):
                v = int(img8[y, x])
                if v < 0:
                    continue
                if v not in P[1:]:
                    raise SystemExit('HUD %s: colour #%02x%02x%02x not in BG3 palette %d' % ((name,) + rgb(v) + (pal,)))
                idx[y, x] = P.index(v, 1)
        b = encode2(idx)
        if t in out and out[t] != b:
            report.append('HUD: char $%02X drawn twice differently (%s, %s)' % (t, who[t], name))
        out[t] = b
        who[t] = name

    pic = hud.picture()
    for r in range(3):
        for c in range(32):
            e = vram[HUD_MAP + (r * 32 + c) * 2] | (vram[HUD_MAP + (r * 32 + c) * 2 + 1] << 8)
            if e == 0:
                continue
            put(e & 0x3FF, (e >> 10) & 7, pic[r * 8:r * 8 + 8, c * 8:c * 8 + 8], (e >> 14) & 1, (e >> 15) & 1, 'map %d,%d' % (c, r))
    for d in range(10):
        put(HUD_DIGIT[d], 2, hud.digit(str(d)), name='digit %d' % d)
    dead = hud.picture(dead=('white', 'black', 'red', 'blue'))
    put(0xD0, 2, dead[0:8, 24:32], name='dead top')
    put(0xD1, 2, dead[0:8, 32:40], name='dead top')
    for k, (pal, base) in HUD_DEAD.items():
        cx = hud.FACE_COLS[['white', 'black', 'red', 'blue'].index(k)] * 8
        for dy, add in ((8, 0), (16, 0x10)):
            put(base + add, pal, dead[dy:dy + 8, cx:cx + 8], name='dead ' + k)
            put(base + add + 1, pal, dead[dy:dy + 8, cx + 8:cx + 16], name='dead ' + k)
    return out


def stage_hud(st, ov, report, cache={}):
    import hud
    pack = read_json(os.path.join(ASSETS, 'pack', 'pack.json'))
    blob = 'stage%02d' % st
    with open(os.path.join(ASSETS, 'pack', pack['bin']), 'rb') as f:
        f.seek(pack['blobs'][blob][0])
        vram = f.read(0x10000)
    key = bytes(vram[HUD_MAP:HUD_MAP + 192])
    if key not in cache:
        cache[key] = hud_chars(vram, report)
    for t, b in cache[key].items():
        ov.put(blob, HUD_CHR + t * 16, b)
    words = []
    for p in range(4):
        words += hud.PALS[p]
    ov.put(blob, 0x10000, pal_bytes(words))


# ---- sprite effects (fixed OBJ tiles in every stage's VRAM) ---------------------------------
def auto_palette(images, name, report):
    cols = set()
    for im in images:
        cols |= set(int(v) for v in np.unique(im) if v >= 0)
    if len(cols) > 15:
        raise SystemExit('OBJ palette %s: %d colours' % (name, len(cols)))
    pal = [0] + sorted(cols, key=lambda c: sum(rgb(c)))
    return pal + [0] * (16 - len(pal))


def obj_put(ov, blob, base, t, img, pal=None):
    """an OBJ tile (8x8 or 16x16) -> chars at the OBJ name base; pal = colour list (img in
    colours) or None (img already palette indices)"""
    size = img.shape[0]
    for ty in range(0, size, 8):
        for tx in range(0, size, 8):
            n = (t & 0x100) | ((t + (ty << 1)) & 0xF0) | ((t + (tx >> 3)) & 0x0F)
            q = img[ty:ty + 8, tx:tx + 8]
            if pal is not None:
                q = np.vectorize(lambda v: 0 if v < 0 else pal.index(int(v)))(q)
            else:
                q = np.where(q < 0, 0, q)
            ov.put(blob, (base + n * 32) & 0xFFFF, encode4(q))


POD_PAL = None


def mod_pressure(st):
    mod = importlib.import_module('s%02d' % st)
    return mod.pressure()


def stage_fx(st, ov, report):
    """the held / kicked / thrown pods (the garden's bombs): fixed OBJ tiles in the classic
    bomb palette (objPal8); every other sprite is the original's"""
    global POD_PAL
    import fx
    pack = read_json(os.path.join(ASSETS, 'pack', 'pack.json'))
    ppu = pack['stages'][st - 1]['ppu']
    base = (ppu['obj_name_base'] * 2) & 0xFFFF
    blob = 'stage%02d' % st
    pods = {**fx.pods(), **fx.small_pods(), **fx.sparkles()}
    if POD_PAL is None:
        POD_PAL = auto_palette(list(pods.values()), 'pod', report)
    for t, im in pods.items():
        obj_put(ov, blob, base, t, im, POD_PAL)
    # the sudden-death block while it falls (OBJ tile 142, palette 6; the original shows it as
    # a white square there, then its landed block): the garden's own landed block, in OBJ
    # palette 6's slots 10..15 (placeholders the original never shows, $7C1E)
    blk = mod_pressure(st)
    cols = {}
    for v in blk.ravel():
        if v >= 0:
            cols[int(v)] = cols.get(int(v), 0) + 1
    keep = sorted(cols, key=lambda c: -cols[c])[:6]
    keep = sorted(keep, key=lambda c: sum(rgb(c)))
    def q(v):
        if v < 0:
            return 0
        if v in keep:
            return 10 + keep.index(v)
        t = rgb(v)
        return 10 + min(range(len(keep)), key=lambda i: sum((a - b) ** 2 for a, b in zip(rgb(keep[i]), t)))
    idx = np.vectorize(q)(blk)
    obj_put(ov, blob, base, 142, idx)
    if len(cols) > 6:
        report.append('stage %d: falling block reduced from %d to 6 colours' % (st, len(cols)))
    ov.put(blob, 0x10000 + (128 + 6 * 16 + 10) * 2, pal_bytes(keep + [keep[-1]] * (6 - len(keep))))
    # stage 2: a pushed soft block slides as a sprite (OBJ tile 96, palette 4): the garden's
    # own soft block, so it does not turn into the original's while it moves
    mod = importlib.import_module('s%02d' % st)
    if hasattr(mod, 'pushed'):
        im = mod.pushed()
        p4 = auto_palette([im], 'pushed block', report)
        obj_put(ov, blob, base, 96, im, p4)
        ov.put(blob, 0x10000 + (128 + 4 * 16) * 2, pal_bytes(p4))


# ---- the menus (menu.js: menu.json / menu.bin, patched like the battle pack) ------------------
class MenuOverlay(Overlay):
    pass


def menu_skin(ov, report):
    import menus
    mj = read_json(os.path.join(ASSETS, 'pack', 'menu.json'))
    if 'GARDEN' not in mj.get('words', {}):
        report.append('menus: the menu pack has no GARDEN word (rebuild it: tools/sb2/extract/menupack.py)')
    def tile(t, img):
        img = np.where(img < 0, 0, img)
        for (dy, dx), c in zip(((0, 0), (0, 8), (8, 0), (8, 8)), (t, t + 1, t + 16, t + 17)):
            ov.put('vram.menu', c * 32, encode4(img[dy:dy + 8, dx:dx + 8]))
    import menufont
    # (the player table's bomber heads stay the original's: the players are its bombers)
    for t, img in {**menus.wall_tiles(), **menus.strip_tiles(), **menufont.cells(mj.get('words', {}))}.items():
        tile(t, img)
    for name in ['cgram.menu'] + ['cgram.%02d' % s for s in range(1, 11)]:
        for p, P in menus.BG_PALS.items():
            for i, c in P.items():
                ov.put(name, (p * 16 + i) * 2, int(c).to_bytes(2, 'little'))
    report.append('menus: %d tiles, palettes 1..4' % (len(menus.wall_tiles()) + len(menus.strip_tiles())))


# ---- the title screen (vram.title: pictures cut into 16x16 tiles) ----------------------------------
TITLE_RESERVED = {0x000, 0x200, 0x24A, 0x24C, 0x202, 0x204, 0x206, 0x208, 0x20A, 0x20C}


def map_addr(base, tx, ty):
    return base + ((ty & 31) * 32 + (tx & 31)) * 2 + (0x800 if tx & 32 else 0) + (0x1000 if ty & 32 else 0)


def pack_palettes(cells, slots, report, name):
    """greedy: put each cell's colour set in the first palette (of slots) it fits"""
    pals = {k: set() for k in slots}
    assign = []
    for cs in cells:
        for k in slots:
            if cs <= pals[k] or len(pals[k] | cs) <= 15:
                pals[k] |= cs
                assign.append(k)
                break
        else:
            raise SystemExit('%s: no palette for a cell (%d colours)' % (name, len(cs)))
    out = {}
    for k, cols in pals.items():
        lst = [0] + sorted(cols, key=lambda c: sum(rgb(c)))
        out[k] = lst + [0] * (16 - len(lst))
    return out, assign


def title_skin(ov, report):
    import title
    b1, b2 = title.bg1(), title.bg2()
    cl = title.clouds()
    free = [r * 32 + c * 2 for r in range(32) for c in range(8) if r * 32 + c * 2 not in TITLE_RESERVED]
    tiles = {}            # bytes -> tile number

    def put_tile(img16, pal, fixed=None):
        idx = np.zeros((16, 16), np.int32)
        for y in range(16):
            for x in range(16):
                v = int(img16[y, x])
                idx[y, x] = 0 if v < 0 else pal.index(v)
        key = idx.tobytes()
        if fixed is None and key in tiles:
            return tiles[key]
        t = fixed if fixed is not None else free.pop(0)
        for (dy, dx), c in zip(((0, 0), (0, 8), (8, 0), (8, 8)), (t, t + 1, t + 16, t + 17)):
            ov.put('vram.title', c * 32, encode4(idx[dy:dy + 8, dx:dx + 8]))
        if fixed is None:
            tiles[key] = t
        return t

    def cells_of(img, rows, cols):
        out = []
        for r in range(rows):
            for c in range(cols):
                cell = img[r * 16:r * 16 + 16, c * 16:c * 16 + 16]
                out.append(((r, c), cell, set(int(v) for v in np.unique(cell) if v >= 0)))
        return out
    c1 = cells_of(b1, 14, 16)
    p1, a1 = pack_palettes([cs for _, _, cs in c1], [0, 1, 2, 3], report, 'title BG1')
    c2 = cells_of(b2, 14, 16)
    cloud_cols = set()
    for im in cl.values():
        cloud_cols |= set(int(v) for v in np.unique(im) if v >= 0)
    p2, a2 = pack_palettes([cloud_cols] + [cs for _, _, cs in c2], [4, 5], report, 'title BG2')
    if a2[0] != 4:
        raise SystemExit('title: clouds must be in palette 4')
    a2 = a2[1:]
    for ((r, c), cell, cs), pal in zip(c1, a1):
        e = 0x2000 if not cs else (put_tile(cell, p1[pal]) | (pal << 10) | 0x2000)
        ov.put('vram.title', map_addr(0x8000, 16 + c, r), e.to_bytes(2, 'little'))
    for ((r, c), cell, cs), pal in zip(c2, a2):
        e = 0x1200 if not cs else (put_tile(cell, p2[pal]) | (pal << 10))
        ov.put('vram.title', map_addr(0xA000, c, r), e.to_bytes(2, 'little'))
    # tiles 0 (BG1's empty 0x2000) and 0x200 (BG2's sky 0x1200) are empty: the backdrop shows
    for t in (0x000, 0x200):
        for c in (t, t + 1, t + 16, t + 17):
            ov.put('vram.title', c * 32, bytes(32))
    sm, bg = cl['small'], cl['big']
    put_tile(sm[:, 0:16], p2[4], 0x24A)
    put_tile(sm[:, 16:32], p2[4], 0x24C)
    for k, t in enumerate((0x202, 0x204, 0x206)):
        put_tile(bg[0:16, k * 16:k * 16 + 16], p2[4], t)
    for k, t in enumerate((0x208, 0x20A, 0x20C)):
        put_tile(bg[16:32, k * 16:k * 16 + 16], p2[4], t)
    # palettes
    cg = [0] * 256
    for k, pl in {**p1, **p2}.items():
        for i in range(1, 16):
            cg[k * 16 + i] = pl[i]
    cg[0] = title.SKY
    # sprites: the cursor pod (OBJ tiles 0 / 2 / 4) and its bloom (32..46), OBJ palette 0;
    # the four gardeners (palettes 1..4)
    idle, burst = title.cursor_frames()
    p_obj = auto_palette(idle + burst, 'title cursor', report)
    base = 0xC000
    for t, im in zip((0, 2, 4), idle):
        obj_put(ov, 'vram.title', base, t, im, p_obj)
    for k, im in enumerate(burst):
        obj_put(ov, 'vram.title', base, 32 + 2 * k, im, p_obj)
    for i in range(16):
        cg[128 + i] = p_obj[i]
    sprites = []          # (no gardeners: the players are the original's bombers)
    for name in ['cgram.title']:
        ov.put(name, 0, pal_bytes(cg[:144]))
    tc = {'idle': [{'tile': 2, 'x': 56, 'y': 144, 'pal': 0, 'frames': 5}],
          'confirm': [{'tile': 32 + 2 * (k // 2), 'x': 56, 'y': 144, 'pal': 0} for k in range(16)]}
    report.append('title: %d tiles, BG palettes %s' % (len(tiles), sorted(set(a1)) + sorted(set(a2))))
    return {'title_sprites': sprites, 'title_cursor': tc}


def contact_sheet(st, res, path):
    """every picture of the stage on one sheet (16 per row), for review"""
    pics = [p for p in res['colour_pics'] if not p[1]]
    rows = (len(pics) + 15) // 16
    sheet = np.full((rows * 17, 16 * 17), -1, np.int32)
    for i, p in enumerate(pics):
        r, c = divmod(i, 16)
        sheet[r * 17:r * 17 + 16, c * 17:c * 17 + 16] = p[0]
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
    stages = list(range(1, 11))          # always all: the overlay is written whole
    if os.environ.get('GARDEN_ONLY'):    # dev: other stages keep the original pictures
        stages = [int(x) for x in os.environ['GARDEN_ONLY'].split(',')]
    results = {}
    art = {'pics': [], 'stages': {}}
    for st in stages:
        try:
            m = importlib.import_module('s%02d' % st)
        except ModuleNotFoundError:
            m = None
        if m is None or not hasattr(m, 'paint'):
            report.append('stage %d: no source yet (the original pictures)' % st)
            continue
        results[st] = stage_cells(st, ov, report, art)
        stage_hud(st, ov, report)
        stage_fx(st, ov, report)
        if a.sheets and (not a.stage or st in a.stage):
            contact_sheet(st, results[st], os.path.join(SCRATCH, 'sheet_s%02d.png' % st))
    mov = Overlay()
    menu_skin(mov, report)
    menu_manifest = title_skin(mov, report)
    strip_blob = b''        # the menus' strip and "go" run: the original's (its bombers)
    # the overlay files
    binbuf = bytearray()
    patches = []
    for blob, at, data in ov.runs():
        patches.append([blob, at, len(binbuf), len(data)])
        binbuf += data
        while len(binbuf) & 3:
            binbuf.append(0)
    mpatches = []
    mblobs = {}
    for blob, at, data in mov.runs():
        mpatches.append([blob, at, len(binbuf), len(data)])
        binbuf += data
        while len(binbuf) & 3:
            binbuf.append(0)
    # the cell art: pictures (256 bytes each: CGRAM index per pixel), per stage the shade
    # map and the static stacks of both layouts (per map cell: count, then u16 picture ids)
    # (129 bytes each: the palette row (255 = a shade mask), then 4bpp indices, 2 per byte)
    art_json = {'pics': [len(binbuf), len(art['pics'])], 'stages': {}}
    shade_ids = set()
    for S in art['stages'].values():
        shade_ids |= set(S['shadePics'])
    for i, p in enumerate(art['pics']):
        p = np.asarray(p, np.uint8)
        nz = p[p > 0]
        row = 255 if i in shade_ids else (int(nz[0]) >> 4 if len(nz) else 0)
        if row != 255 and len(nz) and (np.any((nz >> 4) != row)):
            raise SystemExit('picture %d mixes palette rows' % i)
        lo = (p & 15) if row != 255 else (p > 0).astype(np.uint8)
        binbuf.append(row)
        binbuf += bytes((lo[0::2] | (lo[1::2] << 4)).astype(np.uint8))
    for k, S in art['stages'].items():
        j = {'shadePics': S['shadePics'], 'cls': S['cls'], 'masks': S['masks'], 'maskRefs': S['maskRefs'], 'fireRefs': S['fireRefs']}
        j['shade'] = len(binbuf)
        binbuf += S['shade']
        j['stat'] = {}
        for lay, b in S['stat'].items():
            j['stat'][lay] = len(binbuf)
            binbuf += b
        while len(binbuf) & 3:
            binbuf.append(0)
        art_json['stages'][k] = j
    manifest = {
        'version': 1, 'name': 'garden', 'title': 'Bomber Garden',
        'menu': {'patches': mpatches, 'blobs': mblobs, 'mini': 'mini_tall.png', 'miniOrig': 'mini_orig.png', 'manifest': menu_manifest},
        'note': 'Garden Edition: original pixel art (tools/sb2/garden/), an overlay on the runtime pack',
        'bin': 'garden.bin',
        'pack': {'patches': patches, 'display': {'objPal8': POD_PAL, 'art': art_json}},
    }
    with open(os.path.join(OUT, 'garden.bin'), 'wb') as f:
        f.write(binbuf)
    with open(os.path.join(OUT, 'garden.json'), 'w') as f:
        json.dump(manifest, f, separators=(',', ':'))
    print('\n'.join(report))
    print('overlay: %d patches, %d bytes' % (len(patches), len(binbuf)))


if __name__ == '__main__':
    main()
