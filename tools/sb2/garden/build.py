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


def stage_arena(st, ov, report):
    import objects
    import items
    meta = read_json(os.path.join(ASSETS, 'stages', 'stage%02d' % st, 'stage.json'))
    mod = importlib.import_module('s%02d' % st)
    importlib.reload(mod)
    maps = stage_maps()
    byent = {}
    for x in meta['metatiles']:
        for e in x['entries']:
            byent.setdefault(e, x['name'])
    grid_, pos = {}, {}
    rows = maps['tall%d' % st]
    for cy in range(2, 31):
        for cx in range(0, 17):
            n = byent.get(rows[cy][cx])
            grid_[(cx, cy)] = n
            if n:
                pos.setdefault(n, []).append((cx, cy))
    ctx = {'stage': st, 'meta': meta, 'grid': grid_, 'pos': pos, 'at': lambda cx, cy: grid_.get((cx, cy))}
    terr = mod.terrain(ctx)
    base_name = getattr(mod, 'FLOOR', 'floor_0')
    base = terr[base_name]
    item_art = items.all_items()
    cells = []          # (metatile, img16)
    missing = []
    soft = terr.get('soft_block_0')
    plain = set()
    for x in meta['metatiles']:
        for e in x['entries']:
            if not (e & 0xC000):
                plain.add(e & 0x3FF)
    for x in meta['metatiles']:
        k, n = x['kind'], x['name']
        img = None
        if (k not in ('bomb', 'flame', 'soft_destroy', 'item_burn', 'item') or (k == 'flame' and not x.get('piece'))) and all((e & 0xC000) and (e & 0x3FF) in plain for e in x['entries']):
            missing.append(x)          # a mirror of a drawn cell: its characters come from that one
            continue
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
            missing.append(x)
            continue
        if (img < 0).any() and k != 'bg1_overlay':
            # BG2 cells are opaque (the backdrop would show): fill holes with the floor
            img = over(base.copy(), img)
        cells.append((x, img))
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
    anims = terr.get('__anims__', [])
    for an in anims:
        for fr, im in an['frames']:
            pals.need(slot_of(an['pal']), set(int(v) for v in np.unique(im) if v >= 0), 'anim $%02X' % an['tile'])
    notdrawn = []
    for x in missing:
        ok = True
        for e in x['entries']:
            t = e & 0x3FF
            if any(c not in chars for c in (t, t + 1, t + 16, t + 17)):
                ok = False
        if not ok:
            notdrawn.append(x['name'])
    if notdrawn:
        report.append('stage %d: NOT DRAWN %d: %s' % (st, len(notdrawn), ', '.join(notdrawn)))
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
    # animated characters (C1340A sources at WRAM $7E4828 + frame*32, 16 chars per row)
    for an in anims:
        pal = sol[slot_of(an['pal'])]
        for fr, im in an['frames']:
            for (dy, dx), k in zip(((0, 0), (0, 8), (8, 0), (8, 8)), (0, 1, 16, 17)):
                q = im[dy:dy + 8, dx:dx + 8]
                idx = np.vectorize(lambda v: 0 if v < 0 else pal.index(int(v)))(q)
                ov.put(blob, 0x10200 + 0x828 + ((fr & 0x7F) + k) * 32, encode4(idx))   # C1340A: frame & $7F
    # palette cycles (stage 8 / 9: the display loads whole BG palettes from ROM C1 per
    # phase): phase p = the solved palette with each cycling colour C[k] -> C[(k - p) % n]
    for slot_pal, cyc in terr.get('__cycles__', {}).items():
        pal = sol[slot_of(slot_pal)]
        cols, base_addr, phases = cyc['colours'], cyc['rom'], cyc['phases']
        n = len(cols)
        for c in cols:
            if c not in pal:
                raise SystemExit('stage %d: cycling colour not in palette %d' % (st, slot_pal))
        for ph in range(phases):
            words = [cols[(cols.index(c) - ph) % n] if c in cols else c for c in pal]
            ov.put('rom.C1', base_addr + 32 * ph, pal_bytes(words))
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


# ---- the gardeners (ROM C5 pose graphics + C1 palettes) ------------------------------------
PAL_HEALTHY = [0xE2BC, 0xE2DC, 0xE2FC, 0xE31C]     # C1D7B0[colour] for colours 0..3 (white black red blue)
PAL_SICK = [0xE55C, 0xE57C, 0xE59C, 0xE5BC]        # C1D7DA[colour]
PAL_GOLD, PAL_GOLD_SICK = 0xDCFC, 0xDD1C
COLOURS = ['white', 'black', 'red', 'blue']


def pal_bytes(words):
    return b''.join(int(w).to_bytes(2, 'little') for w in words)


def gardeners(ov, report):
    import bombers
    pieces = bombers.read_pieces()
    for t, g in pieces.items():
        for (dy, dx), c in zip(((0, 0), (0, 8), (8, 0), (8, 8)), (t, t + 1, t + 16, t + 17)):
            ov.put('rom.C5', (c & 0x7FF) << 5, encode4(g[dy:dy + 8, dx:dx + 8]))
    # the pointer tables are checked against the pack (the palettes are rewritten in place)
    pack = read_json(os.path.join(ASSETS, 'pack', 'pack.json'))
    with open(os.path.join(ASSETS, 'pack', pack['bin']), 'rb') as f:
        f.seek(pack['blobs']['rom.C1'][0])
        c1 = f.read(0x10000)
    w16 = lambda a: c1[a] | (c1[a + 1] << 8)
    for i in range(4):
        assert w16(0xD7B0 + 2 * i) == PAL_HEALTHY[i] and w16(0xD7DA + 2 * i) == PAL_SICK[i], 'C1 palette table moved'
        ov.put('rom.C1', PAL_HEALTHY[i], pal_bytes(bombers.palette(COLOURS[i])))
        ov.put('rom.C1', PAL_SICK[i], pal_bytes(bombers.palette(COLOURS[i], sick=True)))
    ov.put('rom.C1', PAL_GOLD, pal_bytes(bombers.palette('gold')))
    ov.put('rom.C1', PAL_GOLD_SICK, pal_bytes(bombers.palette('gold', sick=True)))
    report.append('gardeners: %d pieces, 10 palettes' % len(pieces))


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


def stage_fx(st, ov, report, terr):
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
    obj_put(ov, blob, base, 64, fx.shadow())
    for t, im in fx.cards().items():
        obj_put(ov, blob, base, t, im)
    six = {**fx.puffs(), **fx.seeds(), **fx.hurry()}
    six[142] = terr['pressure_block']
    six[188] = np.full((8, 8), -1, np.int32)
    p6 = auto_palette(list(six.values()), 'fx6 stage %d' % st, report)
    for t, im in six.items():
        obj_put(ov, blob, base, t, im, p6)
    ov.put(blob, 0x10000 + (128 + 6 * 16) * 2, pal_bytes(p6))
    if st == 2:
        sb = fx.snowball()
        p4 = auto_palette([sb], 'fx4', report)
        obj_put(ov, blob, base, 96, sb, p4)
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
    for t, img in {**menus.wall_tiles(), **menus.strip_tiles(), **menus.icons(), **menufont.cells(mj.get('words', {}))}.items():
        tile(t, img)
    for name in ['cgram.menu'] + ['cgram.%02d' % s for s in range(1, 11)]:
        for p, P in menus.BG_PALS.items():
            for i, c in P.items():
                ov.put(name, (p * 16 + i) * 2, int(c).to_bytes(2, 'little'))
    report.append('menus: %d tiles, palettes 1..4' % (len(menus.wall_tiles()) + len(menus.strip_tiles()) + len(menus.icons())))


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
    import bombers
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
    pieces = bombers.read_pieces()
    sprites = []
    for k, col in enumerate(('white', 'black', 'red', 'blue')):
        pl = bombers.palette(col)
        for i in range(16):
            cg[128 + (k + 1) * 16 + i] = pl[i]
    head, body = pieces[40], pieces[42]
    obj_put(ov, 'vram.title', base, 64, head)
    obj_put(ov, 'vram.title', base, 66, body)
    for k in range(4):
        x = 128 - 2 * 24 + k * 24 + 4
        sprites.append({'x': x, 'y': 104, 'tile': 64, 'pal': k + 1, 'prio': 3, 'hflip': False, 'vflip': False, 'w': 16, 'h': 16})
        sprites.append({'x': x, 'y': 120, 'tile': 66, 'pal': k + 1, 'prio': 3, 'hflip': False, 'vflip': False, 'w': 16, 'h': 16})
    for name in ['cgram.title']:
        ov.put(name, 0, pal_bytes(cg))
    tc = {'idle': [{'tile': 2, 'x': 56, 'y': 144, 'pal': 0, 'frames': 5}],
          'confirm': [{'tile': 32 + 2 * (k // 2), 'x': 56, 'y': 144, 'pal': 0} for k in range(16)]}
    report.append('title: %d tiles, BG palettes %s' % (len(tiles), sorted(set(a1)) + sorted(set(a2))))
    return {'title_sprites': sprites, 'title_cursor': tc}


def strip_skin(ov, report):
    """the menus' bottom strip and the stage select's "go" run, with the gardeners: OBJ
    palettes 1 (white), 2 (black), 3 (the pod) in every menu CGRAM; the pieces blob is
    replaced whole (256 bytes per piece, colour indices)"""
    import bombers
    import fx
    P = bombers.read_pieces()
    pod_imgs = [fx.pods()[32], fx.small_pods()[98]]
    pp = auto_palette(pod_imgs, 'strip pod', report)
    pieces, meta = [], []

    def add(img, pal, colours=None):
        if colours is not None:
            img = np.vectorize(lambda v: 0 if v < 0 else colours.index(int(v)))(img)
        buf = np.zeros(256, np.uint8)
        buf[:] = np.where(img < 0, 0, img).ravel()
        pieces.append(bytes(buf))
        meta.append({'i': len(meta), 'w': 16, 'h': 16, 'pal': pal})
        return len(meta) - 1
    ids = {}
    for name, (h, b) in {'r0': (12, 14), 'r1': (32, 34), 'r2': (36, 38), 'l0': (68, 70)}.items():
        for k, pal in ((1, 1), (2, 2)):
            ids[(name, k)] = (add(P[h], pal), add(P[b], pal))
    pod = add(pod_imgs[0], 3, pp)
    WX, BX, Y = 52, 188, 180

    def gardener(k, pose, x):
        hid, bid = ids[(pose, k)]
        return [[hid, x, Y, 3], [bid, x, Y + 16, 3]]
    frames = []
    for f in range(52):
        pcs = gardener(1, 'r0', WX) + gardener(2, 'l0', BX)
        if f < 26:
            pcs = [[pod, WX + 12 + 5 * f, 197, 3]] + pcs
        frames.append({'pieces': pcs, 'duration': 1})
    strip = {'period': 52, 'frames': frames, 'pieces': meta}
    # "go": both turn right and walk off, the pod rolling ahead
    walk = ['r1', 'r0', 'r2', 'r0']
    go = []
    for f in range(97):
        p = walk[(f // 6) % 4]
        pcs = gardener(1, p, WX + 2 * f) + gardener(2, p, BX + 2 * f - 6)
        pcs = [[pod, min(250, BX + 24 + 3 * f), 197, 3]] + pcs
        go.append(pcs)
    blob = b''.join(pieces)
    words = [0] * 48
    for k, col in ((1, 'white'), (2, 'black')):
        pl = bombers.palette(col)
        for i in range(16):
            words[(k - 1) * 16 + i] = pl[i]
    for i in range(16):
        words[32 + i] = pp[i]
    for name in ['cgram.menu'] + ['cgram.%02d' % s for s in range(1, 11)]:
        ov.put(name, (128 + 16) * 2, pal_bytes(words))
    report.append('strip: %d pieces' % len(meta))
    return blob, {'strip': strip, 'go': {'runs': [{'frames': go, 'fade_starts_frames_after_press': 98}], 'pieces': meta, 'fade_after': 98}}


def figures_skin(report):
    """the winner figures atlas (public/arcade/sb2/garden/figures.png) + their anims"""
    import figures
    from gfx import save_png
    cols = ['white', 'black', 'red', 'blue']
    fr = {c: figures.frames(c) for c in cols}
    w, h = fr['white'][0][0].shape[1] + 2, fr['white'][0][0].shape[0] + 2
    atlas = np.full((h * 4, w * 2), -1, np.int32)
    anims = {}
    for r, c in enumerate(cols):
        anims[c] = {'winner': [], 'loser': []}
        for k, (img, dur) in enumerate(fr[c]):
            atlas[r * h:r * h + img.shape[0], k * w:k * w + img.shape[1]] = img
            anims[c]['winner'].append([k * w, r * h, img.shape[1], img.shape[0], dur])
        anims[c]['loser'] = [anims[c]['winner'][1][:4] + [60]]
    save_png(atlas, os.path.join(OUT, 'figures.png'))
    report.append('figures: 4 colours x 2 frames')
    return {'atlas': 'figures.png', 'anims': anims}


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
    stages = list(range(1, 11))          # always all: the overlay is written whole
    results = {}
    for st in stages:
        try:
            importlib.import_module('s%02d' % st)
        except ModuleNotFoundError:
            report.append('stage %d: no source yet' % st)
            continue
        results[st] = stage_arena(st, ov, report)
        stage_hud(st, ov, report)
        stage_fx(st, ov, report, results[st]['terr'])
        if a.sheets and (not a.stage or st in a.stage):
            contact_sheet(st, results[st], os.path.join(SCRATCH, 'sheet_s%02d.png' % st))
    gardeners(ov, report)
    mov = Overlay()
    menu_skin(mov, report)
    menu_manifest = title_skin(mov, report)
    strip_blob, strip_manifest = strip_skin(mov, report)
    menu_manifest.update(strip_manifest)
    import items
    # the overlay files
    binbuf = bytearray()
    patches = []
    for blob, at, data in ov.runs():
        patches.append([blob, at, len(binbuf), len(data)])
        binbuf += data
        while len(binbuf) & 3:
            binbuf.append(0)
    mpatches = []
    mblobs = {'pieces': [len(binbuf), len(strip_blob)]}
    binbuf += strip_blob
    while len(binbuf) & 3:
        binbuf.append(0)
    for blob, at, data in mov.runs():
        mpatches.append([blob, at, len(binbuf), len(data)])
        binbuf += data
        while len(binbuf) & 3:
            binbuf.append(0)
    manifest = {
        'version': 1, 'name': 'garden', 'title': 'Bomber Garden',
        'menu': {'patches': mpatches, 'blobs': mblobs, 'mini': 'mini_tall.png', 'miniOrig': 'mini_orig.png', 'manifest': menu_manifest},
        'note': 'Garden Edition: original pixel art (tools/sb2/garden/), an overlay on the runtime pack',
        'bin': 'garden.bin',
        'pack': {'patches': patches, 'figures': figures_skin(report), 'display': {'border95': list(items.BORDER), 'objPal8': POD_PAL}},
    }
    with open(os.path.join(OUT, 'garden.bin'), 'wb') as f:
        f.write(binbuf)
    with open(os.path.join(OUT, 'garden.json'), 'w') as f:
        json.dump(manifest, f, separators=(',', ':'))
    print('\n'.join(report))
    print('overlay: %d patches, %d bytes' % (len(patches), len(binbuf)))


if __name__ == '__main__':
    main()
