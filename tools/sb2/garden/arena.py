"""Garden Edition — the arenas as CELL ART (display.js stageArt, ppu.js setArt).

Each stage module (src/stages/sNN.py) paints its garden on 512 x 512 canvases in map space
(the BG2 map: 32 x 32 cells of 16 px), per layout (tall / original), from where the game
puts each metatile at the start of a match (maps.json, mapdump.mjs):
    base   the ground everywhere (opaque)            decal  flowers, clover, pebbles ...
    shade  where the ground lies in shadow (bool)    obj / obj2  the static walls: hard
                                                     blocks, borders, hedges, trees ...
Shadows of obj / obj2 fall down-right onto the ground by themselves (S.CAST).
The canvases are cut per cell into 16 x 16 PICTURES (deduplicated; <= 15 colours each, one
BG palette row each), a stack per cell = the static ground the renderer composes once per
round. Cells that change during a match are CLASSES drawn over that ground:
    mode 1  the ground only (floors, hard blocks, walls: painted in the stack)
    mode 2  picture layers: soft blocks (variants by a per-cell hash), pods (the bombs),
            the sudden-death block, gimmick tiles
    mode 3  the ORIGINAL's characters over the ground: fire, burning blocks, burning items,
            items. Which of their pixels are the original's floor is measured at run time
            on the original pack (display.js), so nothing of the original is copied here.
Palette rows: 3 (fire, burning) and 5 (items) stay the original's; 2 = the pods (+ spare);
1, 4, 6, 7 = the garden. Index 0 of a picture = transparent.
"""
import importlib
import json
import os

import numpy as np

from gfx import T, rgb, encode4

KEY_FLIPS = lambda e: (e & 0x3FF) | ((e >> 4) & 0xC00)        # tile | hflip << 10 | vflip << 11
GARDEN_ROWS = [6, 7, 1, 4, 2]
FIRE_KINDS = ('flame', 'soft_destroy', 'item_burn')


class Layout:
    """one layout's start map: names per cell, helpers for painters"""
    def __init__(self, name, rows, byent, kinds):
        self.name = name
        self.grid = [[byent.get(rows[cy][cx]) for cx in range(32)] for cy in range(32)]
        self.kinds = kinds
        ys = [cy for cy in range(32) if any(self.grid[cy][cx] for cx in range(17))]
        self.y0, self.y1 = (2, 30) if name == 'tall' else (2, 16)
        self.cells = [(cx, cy) for cy in range(self.y0, self.y1 + 1) for cx in range(0, 17)]
        self.rows_with_content = ys

    def at(self, cx, cy):
        if 0 <= cx < 32 and 0 <= cy < 32:
            return self.grid[cy][cx]
        return None

    def kind(self, cx, cy):
        n = self.at(cx, cy)
        return self.kinds.get(n) if n else None


class Canvas:
    def __init__(self):
        self.base = np.full((512, 512), T, np.int32)
        self.decal = np.full((512, 512), T, np.int32)
        self.obj = np.full((512, 512), T, np.int32)
        self.obj2 = np.full((512, 512), T, np.int32)
        self.shade = np.zeros((512, 512), bool)
        self.noshadow = np.zeros((512, 512), bool)     # obj pixels that cast no shadow

    def put(self, layer, img, x, y):
        dst = getattr(self, layer)
        h, w = img.shape
        sub = dst[y:y + h, x:x + w]
        m = img[:sub.shape[0], :sub.shape[1]] >= 0
        sub[m] = img[:sub.shape[0], :sub.shape[1]][m]


class StageArt:
    def __init__(self, st, report):
        self.st = st
        self.report = report
        self.pics = []          # [img16 colour (or bool mask), is_shade, pin_row]
        self.index = {}

    def pic(self, img, pin=None, who=''):
        if img is None or not (img >= 0).any():
            return None
        if len(set(int(v) for v in np.unique(img) if v >= 0)) > 15:
            raise SystemExit('stage %d: picture %s has %d colours (max 15)' % (
                self.st, who, len(set(int(v) for v in np.unique(img) if v >= 0))))
        key = ('p', pin, img.tobytes())
        if key not in self.index:
            self.index[key] = len(self.pics)
            self.pics.append([img.copy(), False, pin, who])
        return self.index[key]

    def shadepic(self, mask):
        if not mask.any():
            return None
        key = ('s', mask.tobytes())
        if key not in self.index:
            self.index[key] = len(self.pics)
            self.pics.append([mask.copy(), True, None, 'shade'])
        return self.index[key]


def solve_rows(sets, pins_row, colour_pins, rows=GARDEN_ROWS, report=None, st=0):
    """sets: list of (colour set, pinned row or None, who). Returns {row: [16 colours]},
    and the row of each set. Greedy (pinned first, then biggest first into the row that
    needs the fewest new colours), retried with other orders when it does not fit."""
    import random
    uniq = {}
    for i, (cs, pin, who) in enumerate(sets):
        uniq.setdefault((frozenset(cs), pin), []).append(i)
    keys = list(uniq)
    fail = None
    for attempt in range(400):
        pal = {r: set() for r in rows}
        for c, r in colour_pins.items():
            pal[r].add(c)
        free = lambda i: keys[i][1] is None and not any(c in colour_pins for c in keys[i][0])
        order = sorted(range(len(keys)), key=lambda i: (free(i), -len(keys[i][0])))
        if attempt:
            rnd = random.Random(attempt)
            order = sorted(order, key=lambda i: (free(i), -len(keys[i][0]) + rnd.random() * 6))
        where = {}
        ok = True
        for i in order:
            cs, pin = keys[i]
            forced = {colour_pins[c] for c in cs if c in colour_pins}
            if pin is not None:
                forced.add(pin)
            if len(forced) > 1:
                raise SystemExit('stage %d: %s needs rows %s' % (st, sets[uniq[keys[i]][0]][2], forced))
            cand = list(forced) if forced else rows
            best = None
            for r in cand:
                new = len(cs - pal[r])
                score = new - 0.01 * len(cs & pal[r])
                if len(pal[r] | cs) <= 15 and (best is None or score < best[0]):
                    best = (score, r)
            if best is None:
                ok = False
                fail = (i, pal)
                break
            pal[best[1]] |= cs
            where[i] = best[1]
        if ok:
            break
    else:
        i, pal = fail
        cs, pin = keys[i]
        msg = 'stage %d: no palette row for %s (%d colours)\n' % (st, sets[uniq[keys[i]][0]][2], len(cs))
        for r in rows:
            msg += '  row %d: %d colours %s\n' % (r, len(pal[r]), ' '.join('#%02x%02x%02x' % rgb(c) for c in sorted(pal[r], key=lambda c: sum(rgb(c)))))
        allc = set()
        for k in keys:
            allc |= k[0]
        msg += '  %d colours in all' % len(allc)
        raise SystemExit(msg)
    if attempt and report is not None:
        report.append('stage %d: palette packed on attempt %d' % (st, attempt + 1))
    out = {}
    for r, cols in pal.items():
        if not cols:
            continue
        lst = [0] + sorted(cols, key=lambda c: sum(rgb(c)))
        out[r] = lst + [0] * (16 - len(lst))
    res = [None] * len(sets)
    for i, k in enumerate(keys):
        for j in uniq[k]:
            res[j] = where[i]
    return out, res


def lum(c):
    r, g, b = rgb(c)
    return 0.3 * r + 0.59 * g + 0.11 * b


def shade_target(c, k=0.62):
    """a shadowed colour: darker, a little cooler (sky light in the shade)"""
    r, g, b = rgb(c)
    r, g, b = r * k * 0.92, g * k * 0.97, b * k * 1.08 + 6
    return (min(255, r), min(255, g), min(255, b))


def nearest(target, cands):
    best = None
    for c in cands:
        r, g, b = rgb(c)
        d = (r - target[0]) ** 2 * 0.3 + (g - target[1]) ** 2 * 0.59 + (b - target[2]) ** 2 * 0.11
        if best is None or d < best[0]:
            best = (d, c)
    return best


def build_stage(st, mod, meta, maps, report, objects, pack_ppu, id_base=0):
    """-> dict: pics (list of (img, is_shade)), cls, stat {layout: stacks}, masks, maskRefs,
    rows (palette rows solved), shade map (colour -> colour), chars (VRAM chars to write)"""
    A = StageArt(st, report)
    S = mod.Stage() if hasattr(mod, 'Stage') else mod
    kinds = {x['name']: x['kind'] for x in meta['metatiles']}
    byent = {}
    for x in meta['metatiles']:
        for e in x['entries']:
            byent.setdefault(e, x['name'])
    static_kinds = set(getattr(S, 'STATIC_KINDS', ('hard_block', 'wall', 'border')))
    floor_kinds = set(getattr(S, 'FLOOR_KINDS', ('floor',)))
    stat = {}
    for lay in ('tall', 'original'):
        L = Layout(lay, maps[lay + str(st)], byent, kinds)
        cv = Canvas()
        S.paint(cv, L)
        # shadows of the static walls onto the ground
        alpha = ((cv.obj >= 0) | (cv.obj2 >= 0)) & ~cv.noshadow
        dx, dy = getattr(S, 'CAST', (2, 3))
        cv.shade |= __import__('nature').cast_shadow(alpha, dx, dy, soft=getattr(S, 'SOFT_SHADOW', True))
        stacks = {}
        for (cx, cy) in L.cells:
            sl = (slice(cy * 16, cy * 16 + 16), slice(cx * 16, cx * 16 + 16))
            st_ = []
            b = cv.base[sl]
            if (b < 0).any() and (cy >= L.y0 + 1 and cy <= L.y1 - 1):
                report.append('stage %d %s: cell %d,%d ground has holes' % (st, lay, cx, cy))
            for layer in ('base', 'decal'):
                i = A.pic(getattr(cv, layer)[sl], who='%s %s %d,%d' % (lay, layer, cx, cy))
                if i is not None:
                    st_.append(i)
            i = A.shadepic(cv.shade[sl] & (cv.obj[sl] < 0) & (cv.obj2[sl] < 0))
            if i is not None:
                st_.append(i)
            for layer in ('obj', 'obj2'):
                i = A.pic(getattr(cv, layer)[sl], who='%s %s %d,%d' % (lay, layer, cx, cy))
                if i is not None:
                    st_.append(i)
            stacks[(cx, cy)] = st_
        stat[lay] = stacks
    # classes
    cls = []
    masks = []
    refs = []
    soft = S.soft()
    soft_ids = [A.pic(im, who='soft %d' % k) for k, im in enumerate(soft)]
    regrow = S.regrow() if hasattr(S, 'regrow') else {}
    press = A.pic(S.pressure(), who='pressure')
    gim = S.gimmicks() if hasattr(S, 'gimmicks') else {}
    charcells = getattr(S, 'CHAR_CELLS', {})        # name -> row (255 = its own): chars over ground
    mask_ref_names = set(getattr(S, 'MASK_REFS', ()))
    pod_ids = {}
    seen = set()
    unknown = []
    for x in meta['metatiles']:
        k, n = x['kind'], x['name']
        for e in x['entries']:
            key = KEY_FLIPS(e)
            if key in seen:
                continue
            seen.add(key)
            if k == 'bomb':
                pk = (x['bomb_type'], x['frame'])
                if pk not in pod_ids:
                    pod_ids[pk] = A.pic(objects.pod(x['bomb_type'], x['frame']), pin=2, who='pod %s %d' % pk)
                cls.append([key, 2, 0, [[1, 1, 0, [pod_ids[pk]]]]])
            elif k in FIRE_KINDS:
                cls.append([key, 3, 3, None])
                masks.append([key, e])
            elif k == 'item':
                cls.append([key, 3, 255, None])
                masks.append([key, e])
            elif n in charcells:
                cls.append([key, 3, charcells[n], None])
            elif k in floor_kinds or k in static_kinds:
                cls.append([key, 1, 0, None])
            elif k == 'soft_block':
                cls.append([key, 2, 0, [[1, 1, 1, soft_ids]]])
            elif k == 'soft_regrow':
                frames = regrow[n]
                cls.append([key, 2, 0, [[1, 1, 1, [A.pic(im, who=n) for im in frames]]]])
            elif k == 'pressure_block':
                cls.append([key, 2, 0, [[1, 1, 0, [press]]]])
            elif n in gim:
                v = gim[n]
                ims = v if isinstance(v, list) else [v]
                # pictures are drawn unflipped: an entry's flips apply to them
                fl = lambda im: (im[:, ::-1] if e & 0x4000 else im)[::-1 if e & 0x8000 else 1, :]
                cls.append([key, 2, 0, [[1, 1, 2, [A.pic(np.ascontiguousarray(fl(im)), who=n) for im in ims]]]])
            elif k == 'bg1_overlay':
                pass
            else:
                unknown.append(n)
            if k in floor_kinds or n in mask_ref_names:
                refs.append(e)
    for key in getattr(S, 'GROUND_KEYS', ()):
        cls.append([key, 1, 0, None])
    if unknown:
        report.append('stage %d: no art for %s (original pictures)' % (st, ', '.join(unknown)))
    # chars (animated cells, BG1 overlays): images per char tile (pinned rows)
    chars = S.chars() if hasattr(S, 'chars') else {}
    anims = S.anims() if hasattr(S, 'anims') else []
    # palette rows
    sets = []
    owners = []
    for i, (img, is_shade, pin, who) in enumerate(A.pics):
        if is_shade:
            continue
        sets.append((set(int(v) for v in np.unique(img) if v >= 0), pin, who))
        owners.append(('pic', i))
    for t, (row, img) in chars.items():
        sets.append((set(int(v) for v in np.unique(img) if v >= 0), row, 'char %s' % (t,)))
        owners.append(('char', t))
    for an in anims:
        for fr, im in an['frames']:
            sets.append((set(int(v) for v in np.unique(im) if v >= 0), an['pal'], 'anim $%02X' % an['tile']))
            owners.append(('anim', None))
    colour_pins = {}
    for row, cyc in getattr(S, 'CYCLES', {}).items():
        for c in cyc['colours']:
            colour_pins[c] = row
    rows, where = solve_rows(sets, None, colour_pins, report=report, st=st)
    pic_row = {}
    for (kind, i), r in zip(owners, where):
        if kind == 'pic':
            pic_row[i] = r
    # pictures -> CGRAM indices
    out_pics = []
    for i, (img, is_shade, pin, who) in enumerate(A.pics):
        if is_shade:
            out_pics.append(np.where(img, 1, 0).astype(np.uint8).ravel())
            continue
        r = pic_row[i]
        P = rows[r]
        idx = np.zeros(256, np.uint8)
        flat = img.ravel()
        for j, v in enumerate(flat):
            if v >= 0:
                idx[j] = r * 16 + P.index(int(v), 1)
        out_pics.append(idx)
    # the shade map: every colour -> its shadowed colour (any row)
    cg = {}
    for r, P in rows.items():
        for i, c in enumerate(P):
            if i:
                cg.setdefault(c, r * 16 + i)
    allc = list(cg.keys())
    explicit = getattr(S, 'SHADE', {})
    shade = list(range(256))
    worst = 0
    for r, P in rows.items():
        for i, c in enumerate(P):
            if not i or (c == 0 and i >= len(P)):
                continue
            if c in explicit and explicit[c] in cg:
                shade[r * 16 + i] = cg[explicit[c]]
                continue
            d, best = nearest(shade_target(c), [x for x in allc if lum(x) < lum(c)] or allc)
            shade[r * 16 + i] = cg[best]
            worst = max(worst, d)
    # stacks -> bytes
    stat_bytes = {}
    for lay, stacks in stat.items():
        b = bytearray()
        for cell in range(1024):
            cy, cx = divmod(cell, 32)
            s = stacks.get((cx, cy), [])
            b.append(len(s))
            for i in s:
                b += int(i + id_base).to_bytes(2, 'little')
        stat_bytes[lay] = bytes(b)
    report.append('stage %d: %d pictures, rows %s, shade err %.0f' % (
        st, len(A.pics), ' '.join('%d:%d' % (r, len([c for c in P[1:] if c or True]) - P[1:].count(0)) for r, P in sorted(rows.items())), worst ** 0.5))
    return {'pics': out_pics, 'cls': cls, 'stat': stat_bytes, 'masks': masks, 'refs': refs,
            'rows': rows, 'shade': bytes(shade), 'chars': chars, 'anims': anims,
            'cycles': getattr(S, 'CYCLES', {}), 'colour_pics': A.pics, 'pic_row': pic_row}
