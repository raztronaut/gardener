"""Metasprite capture: group OAM entries into objects, render them from the live VRAM
(bomber graphics are streamed into VRAM every frame, so a frame must be rendered
from the VRAM of the same frame), and de-duplicate by pixel content.

Coordinates: OAM/screen space (snes9x output row r == OAM y r, measured).  The game's
player x/y ($7E8082/$7E8084 + 0x100*i) lead the OAM by one frame.
Anchor convention for bombers: (dx, dy) = sprite image top-left - (x - 8, y - 7) where
(x, y) is the player's logical position ($7E8010/$7E8018 + 0x100*i) of the previous
frame.  For a bomber standing exactly on cell (c, r), (x - 8, y - 7) is the top-left of
that cell on screen, so the anchor is "where to draw the frame relative to the cell's
top-left" (and, while walking, relative to the interpolated cell position).
"""
import hashlib

import numpy as np

from snesgfx import decode_oam, obj_size, compose_sprites, render_sprite, crop_alpha
from capture import player_xy



def onscreen(s, ppu):
    w, h = obj_size(ppu, s['large'])
    y = s['y'] if s['y'] < 240 else s['y'] - 256
    return y < 224 and y + h > 0 and s['x'] < 256 and s['x'] + w > 0 and s['y'] != 0xE0


def sy(s):
    return s['y'] if s['y'] < 240 else s['y'] - 256


def shape_key(img):
    """Palette-independent key: colour index within the 16-colour palette + transparency,
    plus the palette numbers relative to the lowest one (multi-palette composites)."""
    idx = np.where(img < 0, -1, img % 16).astype(np.int16)
    pals = np.unique(img[img >= 0] // 16)
    rel = np.where(img < 0, -1, img // 16 - (pals.min() if len(pals) else 0)).astype(np.int16)
    return hashlib.sha1(idx.tobytes() + rel.tobytes() + str(img.shape).encode()).hexdigest()[:16]


class Library:
    """Unique metasprite frames keyed by SHAPE (palette-independent), so the same pose of
    the 4 bomber colours is one entry.  `img` keeps the first occurrence (cgram indices);
    `colours` / `palettes` record who/which OBJ palettes were seen with it."""

    def __init__(self):
        self.frames = []
        self.by_hash = {}

    def add(self, img, pieces, category, colour=None, extra=None):
        h = shape_key(img)
        k = (category, h)
        pal0 = int(img[img >= 0].min() // 16) if (img >= 0).any() else 0
        if k in self.by_hash:
            fr = self.frames[self.by_hash[k]]
            fr['count'] += 1
            if colour is not None:
                fr['colours'].add(colour)
            fr['palettes'].add(pal0 - 8)
            return fr['id']
        fid = len(self.frames)
        fr = dict(id=fid, img=img, pieces=pieces, category=category, count=1, hash=h,
                  colours=set([colour]) if colour is not None else set(),
                  palettes=set([pal0 - 8]))
        if extra:
            fr.update(extra)
        self.frames.append(fr)
        self.by_hash[k] = fid
        return fid


def group_bomber(oam_list, ppu, pal, xy, box=(-32, -48, 32, 24)):
    """Bomber i = OBJ palette i, using its streamed VRAM slots: tiles 4i and 4i+2 (two
    16x16 sprites, 16x32 total; measured).  Bombs carried/kicked use the owner's palette
    but other tiles, so they are NOT part of the bomber."""
    x, y = xy
    out = []
    for s in oam_list:
        if s['pal'] != pal or not onscreen(s, ppu):
            continue
        if (s['tile'] & 0x1ff) not in (4 * pal, 4 * pal + 2):
            continue
        if x + box[0] <= s['x'] <= x + box[2] and y + box[1] <= sy(s) <= y + box[3]:
            out.append(s)
    return out


def cluster(sprites, ppu, gap=2):
    """Connected components of OAM boxes (touching within `gap` px), any palette."""
    boxes = []
    for s in sprites:
        w, h = obj_size(ppu, s['large'])
        boxes.append((s['x'], sy(s), s['x'] + w, sy(s) + h))
    n = len(sprites)
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for i in range(n):
        for j in range(i + 1, n):
            a, b = boxes[i], boxes[j]
            if a[0] - gap < b[2] and b[0] - gap < a[2] and a[1] - gap < b[3] and b[1] - gap < a[3]:
                parent[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(sprites[i])
    return list(groups.values())


def render_group(vram, ppu, group):
    """-> (img int16 cropped to opaque pixels, (x0, y0) screen pos of img, pieces).
    pieces: OAM entries relative to (x0, y0), in OAM order (first = on top)."""
    img, (gx, gy) = compose_sprites(vram, ppu, group)
    bb = crop_alpha(img)
    if bb is None:
        return None, None, None
    x0, y0, x1, y1 = bb
    img = img[y0:y1, x0:x1].copy()
    ox, oy = gx + x0, gy + y0
    pieces = []
    for s in sorted(group, key=lambda s: s['i']):
        w, h = obj_size(ppu, s['large'])
        pieces.append(dict(dx=s['x'] - ox, dy=sy(s) - oy, tile=s['tile'], w=w, h=h,
                           hflip=s['hflip'], vflip=s['vflip'], pal=s['pal'], prio=s['prio']))
    return img, (ox, oy), pieces


def capture_frame(lib, vram, ppu, oam, prev_wram, colours=range(4), others=True, tag=None):
    """Assign this frame's sprites to bombers (pal i + slot tiles, near player i) and keep
    every other OAM entry as an individual fx piece (de-duplicated by shape).
    Returns {'bombers': {i: (shape_id, anchor, (x0, y0))},
             'fx': [(piece_id, x, y, pal, prio, oam_index)]}."""
    spr = [s for s in decode_oam(oam) if onscreen(s, ppu)]
    used = set()
    res = {'bombers': {}, 'fx': []}
    for i in colours:
        xy = player_xy(prev_wram, i)
        g = group_bomber(spr, ppu, i, xy)
        if not g:
            continue
        img, pos, pieces = render_group(vram, ppu, g)
        if img is None:
            continue
        x0, y0 = pos
        for s in g:
            used.add(s['i'])
        anchor = (x0 - (xy[0] - 8), y0 - (xy[1] - 7))
        fid = lib.add(img, pieces, 'bomber', i, extra=dict(anchor=anchor, tag=tag))
        res['bombers'][i] = (fid, anchor, (x0, y0))
    if others:
        for s in spr:
            if s['i'] in used or (s['tile'] & 0x1ff) < 16 and s['pal'] < 4 and \
                    (s['tile'] & 0x1ff) in (4 * s['pal'], 4 * s['pal'] + 2):
                continue
            img = render_sprite(vram, ppu, s)
            if (img < 0).all():
                continue
            w, h = obj_size(ppu, s['large'])
            pieces = [dict(dx=0, dy=0, tile=s['tile'], w=w, h=h, hflip=s['hflip'],
                           vflip=s['vflip'], pal=s['pal'], prio=s['prio'])]
            fid = lib.add(img, pieces, 'fx', None, extra=dict(tag=tag, w=w, h=h))
            res['fx'].append((fid, s['x'], sy(s), s['pal'], s['prio'], s['i']))
    return res


def segments(ids):
    """[(id, run_length), ...] run-length encoding of a per-frame id list (None kept)."""
    out = []
    for v in ids:
        if out and out[-1][0] == v:
            out[-1][1] += 1
        else:
            out.append([v, 1])
    return [(a, b) for a, b in out]


def find_cycle(segs, min_reps=2):
    """Find the shortest repeating (id, duration) cycle in a list of segments
    (ignoring the first and last, which may be truncated).  Returns list or None."""
    core = segs[1:-1]
    for L in range(1, len(core) // min_reps + 1):
        cyc = core[:L]
        ok = True
        reps = 0
        for k in range(0, len(core) - L + 1, L):
            if core[k:k + L] != cyc:
                ok = False
                break
            reps += 1
        if ok and reps >= min_reps:
            return cyc
    return None
