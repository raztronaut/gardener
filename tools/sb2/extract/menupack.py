"""Runtime pack for the original battle menus (public/arcade/sb2/menu.js) -> data/sb2/assets/pack/
menu.json + menu.bin + mini_tall.png (gitignored, derived from the ROM).

    python3 tools/sb2/extract/menupack.py        (pack.py runs it at the end)

Inputs: data/sb2/assets/menus/ (tools/sb2/extract/menus.py: the menus driven in the harness,
NOTES-menus.md). The menu front end re-runs the original's picture on a small PPU
(render/ppu.js), so the pack holds the PPU state:
  vram.title / cgram.title        title screen (BG1 logo + items, BG2 sky, 65 sprites)
  vram.menu  / cgram.menu         the four battle-menu screens (BG1 map: side by side at
                                  x 0/256/512/768; BG2: the 10 stage previews)
  chars.NN / cgram.NN             stage select, stage NN: BG chars 0..255 (the preview art,
                                  reloaded per stage) and CGRAM
  strip                           the bottom strip / "go" sprite pieces as colour indices
                                  (the game streams them into VRAM per frame; menus.py kept
                                  them by pixels), 256 bytes each
New characters (written into unused VRAM tiles of vram.menu, recorded in menu.json
`words`): the words of the wall's extra row (layout TALL / CLASSIC), composed letter by
letter from the original's own orange label font (glyphs cut out of STAGE, BATTLE, TIME,
COM LEVEL, G-BOMBER, PLAYER); STAR = the COM LEVEL value after 9 (the wall's ★ COM, not in
the original), a five-pointed star drawn like the silver digits 1..9 (same 4 colours:
outline 1, left edge 3, body 5, right edge f per horizontal run; same palette row). mini_tall.png: the TALL arena of each stage at match start,
rendered by the port (tools/sb2/render/minimaps.mjs), 1 px per 2 px (112 x 208 each).
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import ASSETS, read_json  # noqa: E402

MENUS = os.path.join(ASSETS, 'menus')
OUT = os.path.join(ASSETS, 'pack')
BG1_MAP = 0x8000            # byte address of the BG1 map (sc_base word $4000), 64x64
BG2_MAP = 0xA000


def rd(path):
    with open(path, 'rb') as f:
        return f.read()


def map_entry(vram, base, tx, ty):
    a = base + ((ty & 31) * 32 + (tx & 31)) * 2
    if tx & 32:
        a += 0x800
    if ty & 32:
        a += 0x1000
    return vram[a] | (vram[a + 1] << 8)


def char_rows(vram, ch):
    """8x8 4bpp char -> (8, 8) colour indices"""
    out = np.zeros((8, 8), np.uint8)
    a = ch * 32
    for r in range(8):
        p0, p1, p2, p3 = vram[a + 2 * r], vram[a + 2 * r + 1], vram[a + 16 + 2 * r], vram[a + 17 + 2 * r]
        for x in range(8):
            s = 7 - x
            out[r, x] = ((p0 >> s) & 1) | (((p1 >> s) & 1) << 1) | (((p2 >> s) & 1) << 2) | (((p3 >> s) & 1) << 3)
    return out


def tile16(vram, e):
    """BG 16x16 tile (entry e) -> (16, 16) colour indices within its palette, flips applied"""
    t = e & 0x3FF
    px = np.zeros((16, 16), np.uint8)
    px[0:8, 0:8] = char_rows(vram, t)
    px[0:8, 8:16] = char_rows(vram, t + 1)
    px[8:16, 0:8] = char_rows(vram, t + 16)
    px[8:16, 8:16] = char_rows(vram, t + 17)
    if e & 0x4000:
        px = px[:, ::-1]
    if e & 0x8000:
        px = px[::-1, :]
    return px


def put_char(vram, ch, rows):
    a = ch * 32
    for r in range(8):
        p = [0, 0, 0, 0]
        for x in range(8):
            v = int(rows[r, x])
            for b in range(4):
                p[b] |= ((v >> b) & 1) << (7 - x)
        vram[a + 2 * r], vram[a + 2 * r + 1], vram[a + 16 + 2 * r], vram[a + 17 + 2 * r] = p


# ---- the orange label font ------------------------------------------------------------------
# (screen, row, first col, text) of label words in the BG1 map (cols relative to the screen)
LABELS = [('stage', 2, 9, 'STAGE'), ('rules', 4, 4, 'BATTLE'), ('rules', 6, 5, 'TIME'),
          ('rules', 2, 3, 'COM LEVEL'), ('rules', 8, 3, 'G-BOMBER'), ('players', 2, 4, '1PLAYER')]
SCREEN_X = {'mode': 0, 'players': 16, 'rules': 32, 'stage': 48}
GREEN = 0x12EC              # the panel's plain green cell


def strip_of(vram, screen, row, col, ncells):
    cells = [map_entry(vram, BG1_MAP, SCREEN_X[screen] + col + k, row) for k in range(ncells)]
    return np.concatenate([tile16(vram, e) for e in cells], axis=1), cells


def glyphs(vram):
    """letter -> (16, w) colour indices (background = the green's index, from GREEN).
    The letters share their outline (colour 1) with their neighbours, so a glyph = one
    8-connected component of the letter body (colours > 1) + the outline pixels within
    2 px of it."""
    bg = int(np.bincount(tile16(vram, GREEN).ravel()).argmax())
    OUTLINE = 1
    out = {}
    for screen, row, col, text in LABELS:
        n = 0
        while map_entry(vram, BG1_MAP, SCREEN_X[screen] + col + n, row) not in (GREEN, 0x1202, 0x1224) and n < 10:
            n += 1
        strip, cells = strip_of(vram, screen, row, col, n)
        body = (strip != bg) & (strip != OUTLINE)
        lab = np.zeros(strip.shape, np.int32)
        comps = []
        for y0 in range(16):
            for x0 in range(strip.shape[1]):
                if body[y0, x0] and not lab[y0, x0]:
                    k = len(comps) + 1
                    stack, pts = [(y0, x0)], []
                    lab[y0, x0] = k
                    while stack:
                        y, x = stack.pop()
                        pts.append((y, x))
                        for dy in (-1, 0, 1):
                            for dx in (-1, 0, 1):
                                yy, xx = y + dy, x + dx
                                if 0 <= yy < 16 and 0 <= xx < strip.shape[1] and body[yy, xx] and not lab[yy, xx]:
                                    lab[yy, xx] = k
                                    stack.append((yy, xx))
                    comps.append(pts)
        comps = [c for c in comps if len(c) > 4]
        comps.sort(key=lambda c: min(x for _, x in c))
        letters = [c for c in text if c != ' ']
        if len(comps) != len(letters):
            print('  font: %r gives %d letter bodies for %d letters, skipped' % (text, len(comps), len(letters)))
            continue
        for ch, pts in zip(letters, comps):
            m = np.zeros(strip.shape, bool)
            for y, x in pts:
                m[y, x] = True
            grow = m.copy()
            for _ in range(2):
                g2 = grow.copy()
                g2[1:, :] |= grow[:-1, :]; g2[:-1, :] |= grow[1:, :]
                g2[:, 1:] |= grow[:, :-1]; g2[:, :-1] |= grow[:, 1:]
                g2[1:, 1:] |= grow[:-1, :-1]; g2[:-1, :-1] |= grow[1:, 1:]
                g2[1:, :-1] |= grow[:-1, 1:]; g2[:-1, 1:] |= grow[1:, :-1]
                grow = g2
            keep = m | (grow & (strip == OUTLINE))
            xs = np.nonzero(keep.any(axis=0))[0]
            g = np.where(keep, strip, bg)[:, xs[0]:xs[-1] + 1]
            out.setdefault(ch, g.astype(np.uint8))
    return out, bg, (cells[0] >> 10) & 7


def compose_word(font, bg, word, gap=1):
    parts = []
    for i, ch in enumerate(word):
        g = font[ch]
        parts.append(g)
        if i < len(word) - 1:
            parts.append(np.full((16, gap), bg, np.uint8))
    img = np.concatenate(parts, axis=1)
    ncells = (img.shape[1] + 15) // 16
    canvas = np.full((16, ncells * 16), bg, np.uint8)
    x0 = (ncells * 16 - img.shape[1]) // 2
    canvas[:, x0:x0 + img.shape[1]] = img
    return canvas


def star_glyph(bg):
    """16x16 colour indices: a 5-point star (point up) in the silver digits' style"""
    import math
    cx, cy, R, r = 7.5, 8.6, 6.9, 2.8
    pts = [(cx + (R if k % 2 == 0 else r) * math.cos(-math.pi / 2 + k * math.pi / 5),
            cy + (R if k % 2 == 0 else r) * math.sin(-math.pi / 2 + k * math.pi / 5)) for k in range(10)]

    def inside(x, y):
        c = False
        for i in range(10):
            (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % 10]
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                c = not c
        return c
    body = np.zeros((16, 16), bool)
    for y in range(16):
        for x in range(16):        # 4x4 supersampling, >= 7/16 covered
            body[y, x] = sum(inside(x + (i + .5) / 4, y + (j + .5) / 4) for i in range(4) for j in range(4)) >= 7
    out = np.full((16, 16), bg, np.uint8)
    for y in range(16):
        for x in range(16):
            if not body[y, x] and any(0 <= y + dy < 16 and 0 <= x + dx < 16 and body[y + dy, x + dx]
                                      for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                out[y, x] = 1
    for y in range(16):
        x = 0
        while x < 16:
            if body[y, x]:
                x0 = x
                while x < 16 and body[y, x]:
                    x += 1
                out[y, x0:x] = 5
                out[y, x0] = 3
                if x - x0 > 1:
                    out[y, x - 1] = 0xF
            else:
                x += 1
    return out


def used_tiles(vram):
    """BG tile numbers referenced by the BG1 / BG2 maps (incl. their 16x16 neighbours)"""
    used = set()
    for base in (BG1_MAP, BG2_MAP):
        for ty in range(64):
            for tx in range(64):
                t = map_entry(vram, base, tx, ty) & 0x3FF
                used.update((t, t + 1, t + 16, t + 17))
    return used


def free_tiles(vrams, used, n):
    """n 16x16 tile numbers whose 4 chars no BG1 / BG2 map references (any variant)"""
    out = []
    for t in range(0x100, 0x3F0):
        if (t & 0x0F) == 0x0F or len(out) >= n:
            continue
        chars = (t, t + 1, t + 16, t + 17)
        if any(c in used for c in chars) or any(c in used for o in out for c in (o, o + 1, o + 16, o + 17)):
            continue
        if any(o in chars or o + 1 in chars or o + 16 in chars or o + 17 in chars for o in out):
            continue
        out.append(t)            # unreferenced by every map variant: free to overwrite
    return out


def indexed(png, cg, pal):
    """RGBA piece -> colour indices of OBJ palette pal (alpha 0 -> 0)"""
    im = np.array(Image.open(png).convert('RGBA'))
    cols = {}
    for i in range(1, 16):
        v = cg[128 + 16 * pal + i]
        rgb = (((v & 31) << 3) | ((v & 31) >> 2), (((v >> 5) & 31) << 3) | (((v >> 5) & 31) >> 2),
               (((v >> 10) & 31) << 3) | (((v >> 10) & 31) >> 2))
        cols.setdefault(rgb, i)
    out = np.zeros(im.shape[:2], np.uint8)
    miss = 0
    for y in range(im.shape[0]):
        for x in range(im.shape[1]):
            r, g, b, a = im[y, x]
            if a == 0:
                continue
            k = cols.get((int(r), int(g), int(b)))
            if k is None:
                miss += 1
                k = min(cols.items(), key=lambda kv: sum((int(c1) - int(c2)) ** 2 for c1, c2 in zip(kv[0], (r, g, b))))[1]
            out[y, x] = k
    return out, miss


def main():
    os.makedirs(OUT, exist_ok=True)
    m = read_json(os.path.join(MENUS, 'menus.json'))
    scr = lambda k: os.path.join(MENUS, 'screens', k)
    vram_menu = bytearray(rd(os.path.join(scr('players'), 'vram.bin')))
    cg_menu = rd(os.path.join(scr('players'), 'cgram.bin'))
    vram_title = rd(os.path.join(scr('title'), 'vram.bin'))
    cg_title = rd(os.path.join(scr('title'), 'cgram.bin'))
    stage_vram = [rd(os.path.join(scr('stage_%02d' % s), 'vram.bin')) for s in range(1, 11)]
    stage_cg = [rd(os.path.join(scr('stage_%02d' % s), 'cgram.bin')) for s in range(1, 11)]
    # the stage screen's own BG1 cells (STAGE label, number, arrows) come from the stage dump
    st_vram = rd(os.path.join(scr('stage'), 'vram.bin'))
    for ty in range(14):
        for tx in range(48, 64):
            a = BG1_MAP + ((ty & 31) * 32 + (tx & 31)) * 2 + (0x800 if tx & 32 else 0)
            vram_menu[a:a + 2] = st_vram[a:a + 2]

    # -- words of the wall's extra row (orange label font) -------------------------------------
    font, bg, pal = glyphs(vram_menu)
    print('font letters:', ''.join(sorted(font)))
    words = {}
    want = {'TALL': 'TALL', 'CLASSIC': 'CLASSIC'}
    imgs = {k: compose_word(font, bg, w) for k, w in want.items() if all(c in font for c in w)}
    # the silver digit 0 for the results' win counts: the "0" cell of TIME 2:00 ($1248)
    # without the neighbouring 0's outline column on its left
    zero = tile16(vram_menu, 0x1248).copy()
    zero[:, 0] = int(np.bincount(tile16(vram_menu, GREEN).ravel()).argmax())
    imgs['DIGIT0'] = zero
    imgs['STAR'] = star_glyph(int(np.bincount(tile16(vram_menu, GREEN).ravel()).argmax()))
    need = sum(img.shape[1] // 16 for img in imgs.values())
    used = used_tiles(vram_menu)
    for v in stage_vram:
        used |= used_tiles(v)
    # + every entry the menus write at run time (cursor / arrow animations, value variants,
    # stage numbers): any int in those tables taken as a map word
    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                yield from walk(v)
        elif isinstance(o, list):
            for v in o:
                yield from walk(v)
        elif isinstance(o, int) and o >= 0x100:
            t = o & 0x3FF
            yield from (t, t + 1, t + 16, t + 17)
    used |= set(walk(m['elements'])) | set(walk({k: m['stage_select'][k] for k in ('number_cell', 'arrows_anim')}))
    for seq in m['elements']['cursor_anim'].values():      # the cursor's 2nd cell = entry + 2
        used |= set(walk([e + 2 for e, _ in seq]))
    slots = free_tiles([bytes(vram_menu)] + stage_vram, used, need)
    if len(slots) < need:
        raise SystemExit('not enough free tiles for the words: %d < %d' % (len(slots), need))
    k = 0
    for name, img in imgs.items():
        ent = []
        for c in range(img.shape[1] // 16):
            t = slots[k]
            k += 1
            cell = img[:, c * 16:(c + 1) * 16]
            put_char(vram_menu, t, cell[0:8, 0:8])
            put_char(vram_menu, t + 1, cell[0:8, 8:16])
            put_char(vram_menu, t + 16, cell[8:16, 0:8])
            put_char(vram_menu, t + 17, cell[8:16, 8:16])
            ent.append((GREEN & 0xFC00) | t)          # the green cell's palette (= the font's)
        words[name] = ent
    # the word cells use the green cell's palette / priority bits (the label font shares it)
    print('words:', {k: [hex(e) for e in v] for k, v in words.items()})

    # -- sprite pieces (bottom strip, "go") as colour indices ---------------------------------------
    cgw = np.frombuffer(cg_menu, '<u2')
    strip = m['sprites']['bottom_strip']
    go = m['stage_select']['go']
    pieces, misses = [], 0
    piece_meta = {'strip': [], 'go': []}
    for kind, plist, prefix in (('strip', strip['pieces'], 'bottom'), ('go', go.get('pieces', []), 'go')):
        for p in plist:
            px, miss = indexed(os.path.join(MENUS, 'sprites', p['png']), cgw, p['pal'])
            misses += miss
            piece_meta[kind].append({'i': len(pieces), 'w': p['w'], 'h': p['h'], 'pal': p['pal']})
            buf = np.zeros(256, np.uint8)
            buf[:px.size] = px.ravel()
            pieces.append(bytes(buf))
    if misses:
        print('  sprite pieces: %d pixels matched to the nearest palette colour' % misses)

    # -- the binary ------------------------------------------------------------------------------
    blobs, index, off = [], {}, 0

    def add(name, data):
        nonlocal off
        data = bytes(data)
        index[name] = [off, len(data)]
        blobs.append(data)
        off += len(data)
        pad = (-off) & 15
        if pad:
            blobs.append(b'\0' * pad)
            off += pad

    add('vram.title', vram_title)
    add('cgram.title', cg_title)
    add('vram.menu', vram_menu)
    add('cgram.menu', cg_menu)
    for s in range(10):
        add('chars.%02d' % (s + 1), stage_vram[s][0:0x2000])
        add('cgram.%02d' % (s + 1), stage_cg[s])
    add('pieces', b''.join(pieces))
    with open(os.path.join(OUT, 'menu.bin'), 'wb') as f:
        for b in blobs:
            f.write(b)

    title = read_json(os.path.join(scr('title'), 'screen.json'))
    ss = m['stage_select']
    manifest = {
        'version': 1, 'note': 'generated by tools/sb2/extract/menupack.py from the user ROM; do not commit',
        'bin': 'menu.bin', 'blobs': index,
        'ppu': {k: read_json(os.path.join(scr(k), 'screen.json'))['ppu'] for k in ('title', 'mode', 'players', 'rules', 'stage')},
        'title_sprites': [s for s in title['sprites'] if s.get('i', 1) != 0],
        'title_cursor': m['sprites']['title_cursor'],
        'strip': {'period': strip['period_frames'], 'frames': strip['frames'], 'pieces': piece_meta['strip']},
        'go': {'runs': go['runs'], 'pieces': piece_meta['go'], 'fade_after': go['runs'][0].get('fade_starts_frames_after_press', 98)},
        'elements': m['elements'],
        'stage_select': {k: ss[k] for k in ('number_cell', 'arrows_anim', 'arrows_cells', 'change_transition', 'enter_transition', 'preview_hole_px')},
        'stages': [{'stage': s['stage'], 'bg2_hofs': s['bg2_hofs'], 'bg2_vofs': s['bg2_vofs']} for s in ss['stages']],
        'words': words,
        'timing': m['timing'],
        'input': m['input'],
        'mini': {'atlas': 'mini_tall.png', 'w': 112, 'h': 208},
    }
    with open(os.path.join(OUT, 'menu.json'), 'w') as f:
        json.dump(manifest, f)
    print('wrote', os.path.join(OUT, 'menu.bin'), off, 'bytes')
    subprocess.check_call(['node', os.path.join(HERE, '..', 'render', 'minimaps.mjs')])


if __name__ == '__main__':
    main()
