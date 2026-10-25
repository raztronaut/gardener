"""Metasprite capture: group OAM entries into objects, render them from the live VRAM
(bomber graphics are streamed into VRAM every frame, so a frame must be rendered
from the VRAM of the same frame), and de-duplicate by pixel content.

Coordinates: OAM/screen space (snes9x output row r == OAM y r, measured).  The game's
player x/y ($7E8082/$7E8084 + 0x100*i) lead the OAM by one frame.
Anchor convention for bombers: (dx, dy) = sprite image top-left - (x, y + 17) where
(x, y) is the player's x/y of the previous frame.  For a bomber standing exactly on
cell (c, r), (x, y + 17) is the top-left of that cell on screen, so the anchor is
directly "where to draw the frame relative to the cell's top-left".
"""
import hashlib

import numpy as np

from snesgfx import decode_oam, obj_size, compose_sprites, render_sprite, crop_alpha
from capture import player_xy

CELL_DY = 17


def onscreen(s, ppu):
    w, h = obj_size(ppu, s['large'])
    y = s['y'] if s['y'] < 240 else s['y'] - 256
    return y < 224 and y + h > 0 and s['x'] < 256 and s['x'] + w > 0 and s['y'] != 0xE0


def sy(s):
    return s['y'] if s['y'] < 240 else s['y'] - 256


class Library:
    """Unique metasprite frames keyed by content (cgram-index image incl. palette)."""

    def __init__(self):
        self.frames = []        # dicts: id, img (int16 cgram idx), pieces, category, colour
        self.by_hash = {}

    def add(self, img, pieces, category, colour=None, extra=None):
        h = hashlib.sha1(img.tobytes() + str(img.shape).encode()).hexdigest()[:16]
        k = (category, h)
        if k in self.by_hash:
            fr = self.frames[self.by_hash[k]]
            fr['count'] += 1
            return fr['id']
        fid = len(self.frames)
        fr = dict(id=fid, img=img, pieces=pieces, category=category, colour=colour, count=1,
                  hash=h)
        if extra:
            fr.update(extra)
        self.frames.append(fr)
        self.by_hash[k] = fid
        return fid


def group_bomber(oam_list, ppu, pal, xy, box=(-24, -28, 40, 44)):
    x, y = xy
    out = []
    for s in oam_list:
        if s['pal'] != pal or not onscreen(s, ppu):
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
    """Assign this frame's sprites to bombers (pal i near player i) and fx clusters.
    Returns {'bombers': {i: (frame_id, anchor, (x0,y0))}, 'fx': [(frame_id, (x0,y0))]}."""
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
        anchor = (x0 - xy[0], y0 - (xy[1] + CELL_DY))
        fid = lib.add(img, pieces, 'bomber', i, extra=dict(anchor=anchor, tag=tag))
        res['bombers'][i] = (fid, anchor, (x0, y0))
    if others:
        rest = [s for s in spr if s['i'] not in used]
        for g in cluster(rest, ppu):
            img, pos, pieces = render_group(vram, ppu, g)
            if img is None:
                continue
            x0, y0 = pos
            fid = lib.add(img, pieces, 'fx', None, extra=dict(tag=tag, pos=(x0, y0)))
            res['fx'].append((fid, (x0, y0)))
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
