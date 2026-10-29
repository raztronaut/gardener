#!/usr/bin/env python3
"""Garden Edition — trace the gardeners over the original bombers' pose pieces.

    python3 tools/sb2/garden/trace_bombers.py [--write]   (needs data/sb2: the user's ROM pack)

The bombers' poses (ROM C5, 16x16 pieces, streamed per frame) are used as TEMPLATES:
the silhouettes, the motion and the anchors stay, every piece is redrawn as a little
gardener by rules —
  helmet       -> a sun hat: a dome crown (inset), a band, a wide brim at the eye line;
                  under the brim brown hair; the antenna ball -> a two-leaf sprout
  visor / face -> the face (skin, shaded skin at the edges, the eyes)
  suit         -> overalls (the outfit colour = the player's identity)
  white limbs  -> shirt sleeves above the belt, overall legs below
  pink hands   -> green gardening gloves ; pink feet -> brown wellies
  belt buckle  -> the hat-band accent
The result is written as editable text grids (tools/sb2/garden/src/bombers/pieces.txt,
one 16x16 grid per piece in the garden legend); pieces are then polished by hand there —
build.py reads only that file. Without --write it previews to data/sb2/garden/.

Garden legend (OBJ palette index):  . 0  # 1 outline  s 2 skin  z 3 skin shade
  h 4 hat light  H 5 hat  K 6 hat dark  u 7 outfit light  U 8 outfit  D 9 outfit dark
  w 10 white  g 11 leaf/glove light  G 12 leaf/glove dark  b 13 brown  B 14 brown dark
  a 15 accent (hat band, buckle)
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, 'lib'))

LEG = '.#szhHKuUDwgGbBa'
O_HELM = {2, 5, 11, 12, 13, 14}


def load_pieces():
    m = json.load(open(os.path.join(ROOT, 'data/sb2/assets/pack/pack.json')))
    b = open(os.path.join(ROOT, 'data/sb2/assets/pack/sb2.bin'), 'rb').read()
    o, l = m['blobs']['rom.C5']
    C5 = b[o:o + l]
    from gfx import decode4
    out = {}
    for t in range(0, 0x3C0, 2):
        if (t >> 4) & 1:            # 16x16 pieces start on even rows of the 16-tile sheet
            continue
        p = np.zeros((16, 16), np.int32)
        for k, (dy, dx) in enumerate(((0, 0), (0, 8), (8, 0), (8, 8))):
            tt = t + (16 if dy else 0) + (1 if dx else 0)
            p[dy:dy + 8, dx:dx + 8] = decode4(C5, tt * 32)
        if p.any():
            out[t] = p
    return out


def comps(mask):
    """4-connected components of a boolean mask -> list of [(y, x)]"""
    H, W = mask.shape
    seen = np.zeros_like(mask)
    out = []
    for y in range(H):
        for x in range(W):
            if mask[y, x] and not seen[y, x]:
                st, cc = [(y, x)], []
                seen[y, x] = True
                while st:
                    a, b = st.pop()
                    cc.append((a, b))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        yy, xx = a + dy, b + dx
                        if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not seen[yy, xx]:
                            seen[yy, xx] = True
                            st.append((yy, xx))
                out.append(cc)
    return out


def near(mask, y, x, r=1):
    H, W = mask.shape
    return mask[max(0, y - r):min(H, y + r + 1), max(0, x - r):min(W, x + r + 1)].any()


def _edge(m, y, x):
    H, W = m.shape
    return any(not (0 <= y + dy < H and 0 <= x + dx < W) or not m[y + dy, x + dx]
               for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)))


def _face_kind(skin, frame, helm):
    face = skin | frame
    if skin.sum() < 3:
        return 'back', None
    ys, xs = np.nonzero(face)
    hy, hx = np.nonzero(helm | face)
    d = xs.mean() - hx.mean()
    if abs(d) <= 1.6:
        return 'front', d
    return ('left' if d < 0 else 'right'), d


def _below_brim(out, p, y0, kind, skin, frame, helm, blk):
    """face / hair under the brim (rows >= y0), for head pieces and the head rows at the top
    of body pieces"""
    H, W = p.shape
    head = helm | skin | frame | (blk & False)
    hx = np.nonzero((helm | skin | frame).any(axis=0))[0]
    cx = (hx.min() + hx.max()) / 2.0 if len(hx) else 7.5
    fx = np.nonzero((skin | frame).any(axis=0))[0]
    for y in range(y0, H):
        for x in range(W):
            if out[y, x]:
                continue
            v = p[y, x]
            if v == 0:
                continue
            if skin[y, x]:
                out[y, x] = 2
            elif frame[y, x]:
                # the visor's frame becomes face: skin, outlined only where it meets nothing
                out[y, x] = 1 if _edge(p > 0, y, x) else 2
            elif v == 1 and near(skin, y, x):
                # eyes: 2 px tall (the original's slits are 4)
                out[y, x] = 2 if (y >= 2 and p[y - 2, x] == 1 and near(skin, y - 2, x)) else 1
            elif helm[y, x]:
                edge = _edge(p > 0, y, x) or v == 5
                face_side = False
                if kind in ('left', 'right') and len(fx):
                    # a side view: the face reaches from its edge to the head's middle
                    face_side = (x <= cx) if kind == 'left' else (x >= cx)
                if edge:
                    out[y, x] = 1
                elif face_side:
                    out[y, x] = 2
                else:
                    below = y + 1 >= H or p[y + 1, x] in (0, 1, 5)
                    out[y, x] = 14 if (below or v in (5, 13, 14)) else 13
    return out


def dither_hair(x, y):
    return ((x + y) % 3) != 0


def trace(p):
    """one original piece (indices) -> garden piece (legend indices 0..15)"""
    H, W = p.shape
    out = np.zeros_like(p)
    hi3 = (p == 3)
    helm = np.isin(p, list(O_HELM))
    for y in range(H):
        for x in range(W):
            if hi3[y, x] and near(helm, y, x) and not near(p == 7, y, x):
                helm[y, x] = True
    skin = p == 6
    frame = p == 8
    pink = p == 7
    suit = np.isin(p, [9, 10])
    blk = p == 1
    kind, _ = _face_kind(skin, frame, helm)
    # torso: the first row with suit / limb colours (the head ends above it)
    trow = [y for y in range(H) if (suit[y] | (p[y] == 4)).any()]
    ts = trow[0] if trow else H
    is_head = helm[:max(1, ts)].sum() >= 20 and ts >= 10
    yb = None
    if is_head:
        hm = helm.copy()
        hm[ts:, :] = False
        ys, xs = np.nonzero(hm)
        top, bot = int(ys.min()), int(ys.max())
        fy = [y for y in np.nonzero((skin | frame).any(axis=1))[0] if y >= top]
        if kind != 'back' and len(fy):
            yb = int(min(fy))
        else:
            yb = top + 5
        yb = min(H - 1, max(top + 4, yb))
        # crown: the helmet above the brim, its lowest three rows inset by a pixel
        crown = hm.copy()
        crown[yb:, :] = False
        for y in range(top, yb):
            row = np.nonzero(crown[y])[0]
            if len(row) > 6 and (yb - y) <= 3:
                crown[y, row.min()] = False
                crown[y, row.max()] = False
        cyx = np.nonzero(crown)
        cxl, cxr, ctop = cyx[1].min(), cyx[1].max(), cyx[0].min()
        for y in range(top, yb):
            for x in range(W):
                if not crown[y, x]:
                    continue
                if _edge(crown, y, x):
                    out[y, x] = 1
                elif y == yb - 1:
                    out[y, x] = 15                  # the band
                else:
                    rel = (x - cxl) / max(1, (cxr - cxl))
                    yr = (y - ctop) / max(1, (yb - 2 - ctop))
                    out[y, x] = 4 if (rel < 0.45 and yr < 0.75) or (y == ctop + 1 and rel < 0.7) else (6 if rel > 0.8 else 5)
        # the brim
        span = np.nonzero(hm[yb] | (skin | frame)[yb] | hm[min(H - 1, yb + 1)])[0]
        if len(span):
            bl, br = span.min() - 1, span.max() + 1
            if kind == 'left':
                bl -= 1
            if kind == 'right':
                br += 1
            bl, br = max(0, bl), min(W - 1, br)
            for x in range(bl, br + 1):
                out[yb, x] = 1 if x in (bl, br) else (4 if x < bl + (br - bl) * 0.6 else 5)
            if yb + 1 < H:
                for x in range(bl, br + 1):
                    if p[yb + 1, x] == 0 and x not in (bl, br):
                        out[yb + 1, x] = 1
                    elif x in (bl, br):
                        out[yb + 1, x] = 1 if p[yb + 1, x] else 0
                    elif skin[yb + 1, x] or frame[yb + 1, x]:
                        out[yb + 1, x] = 3          # the brim's shadow on the face
                    else:
                        out[yb + 1, x] = 6          # the brim's underside
            # an outline above the brim where it sticks out past the crown
            for x in range(bl, br + 1):
                if yb - 1 >= 0 and out[yb - 1, x] == 0 and p[yb - 1, x] == 0:
                    out[yb - 1, x] = 0
        _below_brim(out, p, yb + 2, kind, skin, frame, helm, blk)
    elif ts > 0:
        # head rows at the top of a body piece (the chin, the hair at the back)
        _below_brim(out, p, 0, kind, skin & (np.arange(H)[:, None] < ts), frame & (np.arange(H)[:, None] < ts),
                    helm & (np.arange(H)[:, None] < ts), blk)
    # ---- the sprout, the gloves, the wellies ------------------------------------------------
    sy = np.nonzero(suit.any(axis=1))[0]
    belt = int(sy.max()) if len(sy) else 99
    for cc in comps(pink | (hi3 & ~helm)):
        ys_ = [a for a, _ in cc]
        if not any(p[a, b] == 7 for a, b in cc):
            continue
        top_, cyy = min(ys_), sum(ys_) / len(ys_)
        inside_helm = is_head and kind == 'back' and sum(near(helm, a, b) for a, b in cc) >= len(cc) * 0.6
        if inside_helm:
            kd = 'hat'
        elif is_head and yb is not None and top_ < yb - 1 and len(cc) <= 10:
            kd = 'sprout'
        elif cyy >= belt + 1 or (belt == 99 and cyy >= 10 and not is_head):
            kd = 'boot'
        else:
            kd = 'glove'
        for a, b in cc:
            if out[a, b] and kd != 'hat':
                continue
            v = p[a, b]
            if kd == 'hat':
                if a < yb - 1:
                    out[a, b] = 5
                elif a == yb - 1:
                    out[a, b] = 15
                elif a > yb + 1:
                    out[a, b] = 13
            elif kd == 'sprout':
                out[a, b] = 11 if v == 3 else 12
            elif kd == 'boot':
                out[a, b] = 13 if (v == 3 or a == top_) else 14
            else:
                out[a, b] = 11 if (v == 3 or a <= cyy - 0.5) else 12
    # a sprout on top of the hat in back views (the antenna ball is hidden behind the head)
    if is_head and kind == 'back':
        cyx = np.nonzero(out[:yb] != 0)
        if len(cyx[0]):
            t0 = cyx[0].min()
            xs_ = [x for x in range(W) if out[t0, x]]
            ax = (min(xs_) + max(xs_)) // 2
            if t0 >= 2:
                out[t0 - 1, ax] = 12
                out[t0 - 2, ax] = 11
                out[t0 - 2, ax + 1] = 11
                out[t0 - 1, ax + 1] = 12
    # ---- the torso and legs -------------------------------------------------------------------
    for y in range(H):
        for x in range(W):
            if out[y, x] or p[y, x] == 0:
                continue
            v = p[y, x]
            if v in (1, 5):
                out[y, x] = 1
            elif v == 9:
                out[y, x] = 8
            elif v == 10:
                out[y, x] = 9
            elif v == 4:
                out[y, x] = (8 if near(suit, y, x) else 9) if y > belt else 10
            elif v == 6:
                out[y, x] = 15
            elif v == 8:
                out[y, x] = 3 if near(skin, y, x) else 1
            elif v == 3:
                out[y, x] = 10
            elif v == 7:
                out[y, x] = 12
            elif v in (2, 11, 12, 13, 14):
                out[y, x] = 5 if v in (2, 12) else 6
            else:
                out[y, x] = 1
    # overall straps: the bib's edge next to a sleeve is lighter
    for y in range(min(H, belt)):
        for x in range(1, W):
            if out[y, x] == 8 and out[y, x - 1] in (10, 1) and not (x + 1 < W and out[y, x + 1] in (10, 1)):
                out[y, x] = 7
    return out


def to_text(g):
    return '\n'.join(''.join(LEG[v] for v in row) for row in g)


# preview palette (the white gardener + the others)
def original_palette():
    m = json.load(open(os.path.join(ROOT, 'data/sb2/assets/pack/pack.json')))
    b = open(os.path.join(ROOT, 'data/sb2/assets/pack/sb2.bin'), 'rb').read()
    o, l = m['blobs']['rom.C1']
    C1 = b[o:o + l]
    w16 = lambda a: C1[a] | (C1[a + 1] << 8)
    ptr = w16(0xD7B0)
    from gfx import rgb
    return [rgb(w16(ptr + 2 * i)) for i in range(16)]


def preview(pieces, traced, path):
    from PIL import Image, ImageDraw
    sys.path.insert(0, os.path.join(HERE, 'src'))
    import bombers
    pal = bombers.palette_rgb('white')
    ks = sorted(traced)
    cols, S = 16, 3
    cw = 16 * S * 2 + 10
    img = Image.new('RGB', (cols * cw, ((len(ks) + cols - 1) // cols) * (16 * S + 14)), (30, 0, 30))
    d = ImageDraw.Draw(img)
    opal = original_palette()
    for i, t in enumerate(ks):
        ox, oy = (i % cols) * cw, (i // cols) * (16 * S + 14)
        for k, (src, pl) in enumerate(((pieces[t], opal), (traced[t], pal))):
            a = np.zeros((16, 16, 3), np.uint8)
            a[:] = (70, 110, 70)
            for y in range(16):
                for x in range(16):
                    if src[y, x]:
                        a[y, x] = pl[src[y, x]]
            img.paste(Image.fromarray(a).resize((16 * S, 16 * S), Image.NEAREST), (ox + k * 16 * S, oy + 12))
        d.text((ox, oy), str(t), fill=(255, 255, 0))
    img.save(path)


def load_pairs():
    """(head tile, body tile) pairs of the poses the census saw: the head piece 16 px above
    the body piece at the same x, the way most poses are built"""
    m = json.load(open(os.path.join(ROOT, 'data/sb2/assets/pack/pack.json')))
    b = open(os.path.join(ROOT, 'data/sb2/assets/pack/sb2.bin'), 'rb').read()
    o, l = m['blobs']['rom.C2']
    C2 = b[o:o + l]
    cen = json.load(open(os.path.join(ROOT, 'data/sb2/garden/census.json')))
    pairs = {}
    for ps in cen['poses']:
        ad = ps['pose'] & 0xFFFF
        n = C2[ad]
        ad += 1
        pcs = []
        for i in range(n):
            dx, dy = (C2[ad] ^ 0x80) - 0x80, (C2[ad + 1] ^ 0x80) - 0x80
            tid = ((C2[ad + 3] & 0x0F) << 8) | C2[ad + 4]
            fl = C2[ad + 2] & 0xC0
            ad += 5
            if tid < 0x3C0 and not fl:
                pcs.append((dx, dy, tid))
        for (x1, y1, t1) in pcs:
            for (x2, y2, t2) in pcs:
                if x1 == x2 and y2 == y1 + 16:
                    pairs[(t1, t2)] = pairs.get((t1, t2), 0) + ps['count']
    return pairs


def trace_all(pieces):
    out = {}
    pairs = load_pairs()
    for (h, b), cnt in sorted(pairs.items(), key=lambda kv: -kv[1]):
        if h not in pieces or b not in pieces:
            continue
        comp = np.concatenate([pieces[h], pieces[b]], 0)
        g = trace(comp)
        if h not in out:
            out[h] = g[:16]
        if b not in out:
            out[b] = g[16:]
    for t, p in pieces.items():
        if t not in out:
            out[t] = trace(p)
    return out


def main():
    pieces = load_pieces()
    traced = trace_all(pieces)
    os.makedirs(os.path.join(ROOT, 'data/sb2/garden'), exist_ok=True)
    preview(pieces, traced, os.path.join(ROOT, 'data/sb2/garden/trace_preview.png'))
    if '--write' in sys.argv:
        path = os.path.join(HERE, 'src', 'bombers', 'pieces.txt')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write('# Garden Edition gardeners: one 16x16 grid per pose piece (C5 tile number).\n')
            f.write('# Legend (OBJ palette index): . 0  # 1 outline  s 2 skin  z 3 skin shade  h 4 hat light\n')
            f.write('#   H 5 hat  K 6 hat dark  u 7 outfit light  U 8 outfit  D 9 outfit dark  w 10 white\n')
            f.write('#   g 11 leaf/glove light  G 12 leaf/glove dark  b 13 brown  B 14 brown dark  a 15 accent\n\n')
            for t in sorted(traced):
                f.write('@%d\n%s\n\n' % (t, to_text(traced[t])))
        print('wrote', path)


if __name__ == '__main__':
    main()
