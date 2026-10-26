"""The original BATTLE-mode menus: screens, graphics, animations, input behaviour, timing
and sounds, measured in the harness -> data/sb2/assets/menus/ (gitignored).

    python3 tools/sb2/extract/menus.py            # everything (screens + measurements)
    python3 tools/sb2/extract/menus.py --sound    # also menu music + SFX (adds to audio.json)

Flow (power-on -> title state of the harness, tools/sb2/harness/paths.py):
  title  (NORMAL GAME / BATTLE GAME / PASSWORD, bomb cursor = sprite)
    -> DOWN, START: fade out, black (menu song upload), fade in
  mode   (SINGLE MATCH / TAG MATCH)          BG1 scroll x 0
  players(1P..4P  MAN / COM / OFF)           BG1 scroll x 256
  rules  (COM LEVEL, BATTLE, TIME, G-BOMBER) BG1 scroll x 512
  stage  (STAGE n, preview = BG2 behind a hole in BG1)  BG1 scroll x 768
    -> START: fade out, load, the match fades in
All four menu screens live side by side in one 1024x1024 BG1 (16x16 tiles) and are
switched by scrolling; the bottom strip (two bombers kicking a bomb, + their shadows) is
sprites. Everything is measured; see tools/sb2/NOTES-menus.md for the numbers.
"""
import hashlib
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import Snes, B, ASSETS, state_path, write_json, mkdir, save_rgba  # noqa: E402
from snesgfx import (render_bg, render_bg_cell, to_rgba, decode_oam, visible, render_sprite,  # noqa: E402
                     tile_sheet, tilemap_entries, cgram_words, cgram_rgb, obj_size)

OUT = os.path.join(ASSETS, 'menus')
CACHE = os.path.join(ASSETS, 'cache')
SCREEN_X = {0: 'mode', 256: 'players', 512: 'rules', 768: 'stage'}
PPU_KEYS = ('bgmode', 'bgmode_raw', 'bg3_priority', 'bg1_sc_base', 'bg1_sc_size', 'bg1_char_base',
            'bg1_hofs', 'bg1_vofs', 'bg2_sc_base', 'bg2_sc_size', 'bg2_char_base', 'bg2_hofs',
            'bg2_vofs', 'bg3_sc_base', 'bg3_sc_size', 'bg3_char_base', 'bg3_hofs', 'bg3_vofs',
            'tm', 'ts', 'cgwsel', 'cgadsub', 'coldata_r', 'coldata_g', 'coldata_b', 'obsel',
            'obj_name_base', 'obj_name_base2', 'obj_size_select', 'mosaic_raw', 'hdmaen',
            'brightness', 'forced_blank')
BUTTONS = ['A', 'B', 'X', 'Y', 'L', 'R', 'SELECT', 'START', 'UP', 'DOWN', 'LEFT', 'RIGHT']


# ---------------------------------------------------------------------------------------
# small helpers
def ports(S):
    return [int(v) for v in S.smp()['cpu_to_spc']]


def vis_map(S, L=1):
    """Visible 16x14 entries of a 16x16-tile BG (scroll applied)."""
    p = S.ppu()
    e = tilemap_entries(S.vram(), p['bg%d_sc_base' % L], p['bg%d_sc_size' % L])
    h = p['bg%d_hofs' % L]
    v = (p['bg%d_vofs' % L] + 1) & 1023
    ys = (np.arange(15) + v // 16) % 64
    xs = (np.arange(17) + h // 16) % 64
    return e[ys][:, xs][:14, :16]


def screen_of(S):
    p = S.ppu()
    if p['bgmode'] == 1 and p['bg2_sc_base'] == 0x4000 and p['bg1_sc_base'] == 0x5800:
        return 'battle'
    if p['bgmode'] != 1 or p['bg1_sc_base'] != 0x4000:
        return 'other'
    if p['bg1_hofs'] == 256 and sprites_n(S) > 30:
        return 'title'
    return SCREEN_X.get(p['bg1_hofs'], 'other')


def sprites_n(S):
    return len([s for s in decode_oam(S.oam()) if visible(s)])


def frame_rec(S):
    p = S.ppu()
    o = S.oam()
    return dict(b=p['brightness'], fb=int(p['forced_blank']), mos=p['mosaic_raw'],
                h1=p['bg1_hofs'], v1=p['bg1_vofs'], h2=p['bg2_hofs'], v2=p['bg2_vofs'],
                sc1=p['bg1_sc_base'], sc2=p['bg2_sc_base'], mode=p['bgmode'],
                port=ports(S), oam=hashlib.sha1(o.tobytes()).hexdigest()[:10],
                map=hashlib.sha1(vis_map(S).tobytes()).hexdigest()[:10] if p['bg1_sc_base'] == 0x4000 else '',
                scr=screen_of(S))


def trace(S, pads, n=None):
    """Step through pads (list of masks, or (mask, frames) pairs); per-frame records."""
    seq = []
    for x in pads:
        if isinstance(x, tuple):
            seq += [x[0]] * x[1]
        else:
            seq.append(x)
    if n:
        seq += [0] * (n - len(seq))
    out = []
    for i, m in enumerate(seq):
        S.step(m)
        r = frame_rec(S)
        r['f'] = i
        r['pad'] = B.fmt(m) if m else ''
        out.append(r)
    return out


def sound_cmds(tr, port=0):
    """New commands on an APU port: [(frame, id, raw)] (id = raw & $7F, bit 7 = repeat toggle)."""
    out = []
    prev = None
    for r in tr:
        v = r['port'][port]
        if prev is not None and v != prev:
            out.append((r['f'], v & 0x7F, v))
        prev = v
    return out


def runs(tr, key):
    """Compress a per-frame key into [(first_frame, value, frames)]."""
    out = []
    for r in tr:
        v = r[key]
        if out and out[-1][1] == v:
            out[-1][2] += 1
        else:
            out.append([r['f'], v, 1])
    return out


# ---------------------------------------------------------------------------------------
# states (built from the harness's title state; deterministic)
def cache_state(name):
    return os.path.join(CACHE, 'menu_%s.state' % name)


def build_states(S):
    os.makedirs(CACHE, exist_ok=True)
    S.load_state_file(state_path('title'))
    S.run(2)
    S.save_state_file(cache_state('title'))
    S.run(1, B.DOWN)
    S.run(20)
    S.run(1, B.START)
    for _ in range(600):                      # until the mode screen is bright and settled
        S.step(0)
        if S.ppu()['brightness'] == 15 and screen_of(S) == 'mode':
            break
    S.run(30)
    S.save_state_file(cache_state('mode'))
    for nm in ('players', 'rules', 'stage'):
        S.run(1, B.START)
        S.run(60)
        S.save_state_file(cache_state(nm))
    assert screen_of(S) == 'stage', screen_of(S)


def load(S, name):
    S.load_state_file(cache_state(name))
    S.step(0)


# ---------------------------------------------------------------------------------------
# screen dumps
def indexed_png(path, idx, ncol):
    from PIL import Image
    im = Image.fromarray(idx.astype(np.uint8), 'P')
    pal = []
    for i in range(256):
        g = int(i * 255 / max(1, ncol - 1)) if i < ncol else 0
        pal += [g, g, g]
    im.putpalette(pal)
    im.save(path)


def obj_layer(S):
    """All visible sprites composed into a 256x224 RGBA image (priority ignored), + list."""
    v, p, cg = S.vram(), S.ppu(), S.cgram()
    spr = [s for s in decode_oam(S.oam()) if visible(s)]
    out = np.full((224, 256), -1, np.int16)
    for s in sorted(spr, key=lambda s: -s['i']):
        img = render_sprite(v, p, s)
        h, w = img.shape
        y = s['y'] if s['y'] < 240 else s['y'] - 256
        for yy in range(h):
            py = y + yy
            if not 0 <= py < 224:
                continue
            for xx in range(w):
                px = s['x'] + xx
                if 0 <= px < 256 and img[yy, xx] >= 0:
                    out[py, px] = img[yy, xx]
    return to_rgba(out, cg), spr


def dump_screen(S, key, extra=None):
    """Everything about the current picture -> menus/screens/<key>/."""
    d = mkdir(OUT, 'screens', key)
    p = S.ppu()
    v, cg = S.vram(), S.cgram()
    S.png(os.path.join(d, 'frame.png'))
    S.png(os.path.join(OUT, 'ref', key + '.png'))
    open(os.path.join(d, 'vram.bin'), 'wb').write(v.tobytes())
    open(os.path.join(d, 'cgram.bin'), 'wb').write(cg.tobytes())
    layers = {}
    for L in (1, 2, 3):
        try:
            cimg, prio, ent = render_bg(v, p, L)
        except KeyError:
            continue
        save_rgba(os.path.join(d, 'bg%d.png' % L), to_rgba(cimg, cg))
        bpp = 4 if L < 3 else 2
        layers['bg%d' % L] = dict(
            sc_base=p['bg%d_sc_base' % L], sc_size=p['bg%d_sc_size' % L],
            char_base=p['bg%d_char_base' % L], bpp=bpp,
            tile_px=16 if p['bgmode_raw'] & (0x10 << (L - 1)) else 8,
            hofs=p['bg%d_hofs' % L], vofs=p['bg%d_vofs' % L],
            width=int(ent.shape[1]), height=int(ent.shape[0]),
            on_main=bool(p['tm'] & (1 << (L - 1))), on_sub=bool(p['ts'] & (1 << (L - 1))),
            image='bg%d.png' % L, entries=ent.astype(int).tolist())
    # characters (indexed) for composing new tilemaps
    indexed_png(os.path.join(d, 'chars_bg12.png'), tile_sheet(v, p['bg1_char_base'] * 2, 1024, 4), 16)
    indexed_png(os.path.join(d, 'chars_bg3.png'), tile_sheet(v, p['bg3_char_base'] * 2, 1024, 2), 4)
    rgba, spr = obj_layer(S)
    save_rgba(os.path.join(d, 'obj.png'), rgba)
    words = cgram_words(cg)
    rgb = cgram_rgb(cg)
    info = dict(
        key=key, screen=screen_of(S), ppu={k: (int(p[k]) if not isinstance(p[k], bool) else p[k]) for k in PPU_KEYS},
        files=dict(frame='frame.png', obj='obj.png', vram='vram.bin', cgram='cgram.bin',
                   chars_bg12='chars_bg12.png', chars_bg3='chars_bg3.png'),
        palettes=dict(bgr555=[int(x) for x in words], rgb=rgb.astype(int).tolist()),
        layers=layers,
        sprites=[dict(s, w=obj_size(p, s['large'])[0], h=obj_size(p, s['large'])[1]) for s in spr])
    if extra:
        info.update(extra)
    write_json(os.path.join(d, 'screen.json'), info)
    return info


def cell_patch(S, entries, L=1):
    """Render a block of 16x16 BG cells (2D list of entries) to RGBA."""
    p = S.ppu()
    v, cg = S.vram(), S.cgram()
    bpp = 4 if L < 3 else 2
    big = bool(p['bgmode_raw'] & (0x10 << (L - 1)))
    n = 16 if big else 8
    ent = np.asarray(entries)
    out = np.full((ent.shape[0] * n, ent.shape[1] * n), -1, np.int16)
    for y in range(ent.shape[0]):
        for x in range(ent.shape[1]):
            img, _ = render_bg_cell(v, p['bg%d_char_base' % L], int(ent[y, x]), bpp, big)
            out[y * n:y * n + n, x * n:x * n + n] = img
    return to_rgba(out, cg)


def map_diff_box(a, b):
    d = np.argwhere(a != b)
    if not len(d):
        return None
    (r0, c0), (r1, c1) = d.min(0), d.max(0)
    return [int(r0), int(c0), int(r1) + 1, int(c1) + 1]       # rows/cols of 16x16 cells


# ---------------------------------------------------------------------------------------
# measurements
def button_table(S, screen):
    """Tap each button once on `screen`; what happens (screen change, map/oam change, sound)."""
    out = {}
    load(S, screen)
    trace(S, [0], 90)
    m0 = vis_map(S)               # idle reference after the same 90 frames (animations)
    for name in BUTTONS:
        load(S, screen)
        s0 = screen_of(S)
        tr = trace(S, [getattr(B, name)], 90)
        snd = sound_cmds(tr)
        scr = None
        for r in tr:
            sc = r['scr'] if r['scr'] != 'other' else None
            if r['b'] < 15 or r['fb']:
                scr = 'fade/black (frame %d)' % r['f']
                break
            if sc and sc != s0:
                scr = '%s (frame %d)' % (sc, r['f'])
                break
        m1 = vis_map(S)
        out[name] = dict(
            goes_to=scr, sound=['$%02X@%d' % (c, f) for f, c, _ in snd],
            map_changed=map_diff_box(m0, m1) if not scr else None)
    return out


def cursor_rows(m, arrow_col=1, blank=None):
    return m[:, arrow_col].tolist()


def menu_rows(screen):
    """Row y (16x16 cells) of each item on a menu screen (measured from the cursor)."""
    return {'mode': [4, 6], 'players': [2, 4, 6, 8], 'rules': [2, 4, 6, 8]}[screen]


def measure_cursor(S, screen):
    """Cursor cell (col 1..2) entries over time (blink/animation), and per-item rows."""
    load(S, screen)
    seq = []
    for f in range(240):
        S.step(0)
        m = vis_map(S)
        seq.append([int(x) for x in m[:, 1]])
    # animation of the cursor cell: entries at the cursor row over time
    rows = menu_rows(screen)
    r0 = rows[0]
    anim = []
    for f, col in enumerate(seq):
        e = col[r0]
        if anim and anim[-1][0] == e:
            anim[-1][1] += 1
        else:
            anim.append([e, 1])
    return anim


def measure_values(S, screen, rows, cols, button, maxn=12, gap=14):
    """Press `button` on each row until the value cells repeat; variants + patches."""
    res = []
    for k, row in enumerate(rows):
        load(S, screen)
        for _ in range(k):
            S.run(1, B.DOWN)
            S.run(gap)
        m = vis_map(S)
        seen = [m[row, cols[0]:cols[1]].copy()]
        sounds = []
        for i in range(maxn):
            tr = trace(S, [getattr(B, button)], gap)
            sounds += ['$%02X' % c for _, c, _ in sound_cmds(tr)]
            m = vis_map(S)
            cur = m[row, cols[0]:cols[1]].copy()
            if any((cur == s).all() for s in seen):
                seen.append(cur)
                break
            seen.append(cur)
        res.append(dict(row=row, cells=[cols[0], cols[1]],
                        sequence=[[int(x) for x in s] for s in seen], sounds=sounds))
    return res


def save_variants(S, screen, vals, names):
    """Patch PNGs for every value variant (rendered from the screen's own VRAM)."""
    load(S, screen)
    out = []
    for k, v in enumerate(vals):
        vs = []
        for j, s in enumerate(v['sequence'][:-1]):
            nm = names[k][j] if k < len(names) and j < len(names[k]) else 'v%d' % j
            fn = '%s_row%d_%s.png' % (screen, k + 1, nm)
            save_rgba(os.path.join(OUT, 'elements', fn), cell_patch(S, [s]))
            vs.append(dict(name=nm, entries=s, png=fn))
        out.append(dict(item=k, row=v['row'], cols=v['cells'],
                        bbox_px=[v['cells'][0] * 16, v['row'] * 16, (v['cells'][1] - v['cells'][0]) * 16, 16],
                        variants=vs, sounds=v['sounds']))
    return out


def measure_repeat(S, screen, button, frames=200, row=None, cols=None):
    """Hold a d-pad direction: frames at which the cursor / value changes."""
    load(S, screen)
    prev = vis_map(S)
    ch = []
    for f in range(frames):
        S.step(getattr(B, button))
        m = vis_map(S)
        sub = (lambda x: x[row, cols[0]:cols[1]]) if row is not None else (lambda x: x[:, 1:3])
        if row is not None:
            if not (sub(m) == sub(prev)).all():
                ch.append(f)
        else:
            # cursor moved: a cell of col 1 changed on two rows at once
            dif = np.argwhere(m[:, 1] != prev[:, 1]).ravel()
            if len(dif) >= 2:
                ch.append(f)
        prev = m
    return ch


def earliest_input(S, screen_from, button_go, probe, check, maxk=60, pre=()):
    """After `button_go` on screen_from, the first frame k (0 = the frame after the press)
    at which a `probe` tap is accepted (check(S) true 30 frames later)."""
    for k in range(0, maxk):
        load(S, screen_from)
        for b in pre:
            S.run(1, getattr(B, b))
            S.run(20)
        S.run(1, getattr(B, button_go))
        S.run(k)
        S.run(1, getattr(B, probe))
        for _ in range(400):            # until the target screen is up and bright
            S.step(0)
            if S.ppu()['brightness'] == 15 and not S.ppu()['forced_blank'] and screen_of(S) not in ('other',):
                break
        S.run(20)
        if check(S):
            return k
    return None


class PieceAtlas:
    """Distinct sprite pieces by their PIXELS (the menu bombers' poses are streamed into a
    few fixed VRAM tiles every frame, so tile numbers are not stable ids)."""

    def __init__(self, prefix):
        self.prefix = prefix
        self.ids = {}
        self.meta = []

    def add(self, S, s, v=None, p=None, cg=None):
        v = S.vram() if v is None else v
        p = S.ppu() if p is None else p
        cg = S.cgram() if cg is None else cg
        img = to_rgba(render_sprite(v, p, s), cg)
        k = hashlib.sha1(img.tobytes()).hexdigest()
        if k not in self.ids:
            i = len(self.meta)
            self.ids[k] = i
            fn = '%s_%03d.png' % (self.prefix, i)
            save_rgba(os.path.join(OUT, 'sprites', fn), img)
            self.meta.append(dict(id=i, png=fn, w=int(img.shape[1]), h=int(img.shape[0]),
                                  vram_tile=s['tile'], pal=s['pal'], hflip=s['hflip'], vflip=s['vflip']))
        return self.ids[k]


def strip_frame(S, atlas, ymin=120):
    v, p, cg = S.vram(), S.ppu(), S.cgram()
    spr = [s for s in decode_oam(S.oam()) if visible(s) and s['y'] >= ymin]
    return [[atlas.add(S, s, v, p, cg), s['x'], s['y'], s['prio']] for s in spr]


def measure_bottom(S, screen='players', frames=1200):
    """The bottom strip: two bombers kicking a bomb back and forth (+ shadow sprites).
    Per-frame sprite lists, the loop period, and an atlas of every distinct piece."""
    load(S, screen)
    atlas = PieceAtlas('bottom')
    recs = []
    for _ in range(frames):
        S.step(0)
        recs.append(strip_frame(S, atlas))
    period = None
    for P in range(2, frames // 2):
        if all(recs[i] == recs[i + P] for i in range(frames - P)):
            period = P
            break
    frames_c = []
    for s in recs[:period or 0]:
        if frames_c and frames_c[-1]['pieces'] == s:
            frames_c[-1]['duration'] += 1
        else:
            frames_c.append(dict(pieces=s, duration=1))
    return dict(period_frames=period, start_state=screen, pieces=atlas.meta, frames=frames_c,
                note='piece = [atlas id, x, y, OAM priority] in OAM index order (lower index drawn '
                     'on top). Palette-4 pieces with priority 0 are the SHADOWS: hidden on the main '
                     'screen (under BG1), visible on the sub screen (TS = OBJ), and colour math '
                     'SUBTRACTS them from BG1 (CGADSUB $81): shadow pixel = max(0, BG1 - OBJ colour) '
                     'per 5-bit channel. The loop runs continuously on every menu screen.')


def measure_title_cursor(S):
    load(S, 'title')
    seq = []
    for f in range(300):
        S.step(0)
        o = decode_oam(S.oam())[0]
        seq.append((o['tile'], o['x'], o['y'], o['pal'], o['hflip']))
    anim = []
    for s in seq:
        if anim and anim[-1][0] == s:
            anim[-1][1] += 1
        else:
            anim.append([s, 1])
    # confirm: START on BATTLE GAME -> the cursor sprite during the fade
    load(S, 'title')
    S.run(1, B.DOWN)
    S.run(20)
    conf = []
    S.run(1, B.START)
    for f in range(30):
        S.step(0)
        o = decode_oam(S.oam())[0]
        conf.append((o['tile'], o['x'], o['y'], o['pal']))
    # atlas of the cursor frames
    v, cg, p = S.vram(), S.cgram(), S.ppu()
    tiles = sorted(set((a[0], a[3]) for a, _ in anim) | set((c[0], c[3]) for c in conf))
    files = {}
    load(S, 'title')
    v, cg, p = S.vram(), S.cgram(), S.ppu()
    for t, pal in tiles:
        img = render_sprite(v, p, dict(tile=t, pal=pal, hflip=False, vflip=False, large=True))
        fn = 'title_cursor_t%03X_p%d.png' % (t, pal)
        save_rgba(os.path.join(OUT, 'sprites', fn), to_rgba(img, cg))
        files['%d,%d' % (t, pal)] = fn
    return dict(idle=[dict(tile=a[0], x=a[1], y=a[2], pal=a[3], frames=n) for a, n in anim],
                confirm=[dict(tile=c[0], x=c[1], y=c[2], pal=c[3]) for c in conf],
                files=files, item_y=[144, 160, 176])


def measure_title_layout(S):
    """Title sprites (the logo / bombers are OBJ): dump + whether anything moves."""
    load(S, 'title')
    hs = set()
    for f in range(240):
        S.step(0)
        spr = [s for s in decode_oam(S.oam()) if visible(s) and s['i'] != 0]
        hs.add(hashlib.sha1(json.dumps(spr).encode()).hexdigest())
    return dict(static_sprites_other_than_cursor=len(hs) == 1)


def measure_title_idle(S):
    load(S, 'title')
    for f in range(3000):
        S.step(0)
        if S.ppu()['brightness'] < 15:
            return f
    return None


def measure_stage_select(S):
    """Stage previews (all 10), the change animation (mosaic + scroll per frame), wrap."""
    res = dict(stages=[])
    load(S, 'stage')
    m0 = vis_map(S)
    base = S.save_state()
    # visible hole in BG1 where BG2 (the preview) shows through
    cimg, _, _ = render_bg(S.vram(), S.ppu(), 1)
    p = S.ppu()
    win = cimg[np.arange(224)[:, None] + ((p['bg1_vofs'] + 1) & 1023), (np.arange(256) + p['bg1_hofs']) & 1023]
    hole = np.argwhere(win < 0)
    (y0, x0), (y1, x1) = hole.min(0), hole.max(0)
    res['preview_hole_px'] = [int(x0), int(y0), int(x1 - x0 + 1), int(y1 - y0 + 1)]
    # one RIGHT: per-frame transition
    tr = trace(S, [B.RIGHT], 60)
    res['change_transition'] = [dict(f=r['f'], mosaic_size=r['mos'] >> 4, mosaic_bgs=r['mos'] & 15,
                                     bg2_hofs=r['h2'], bg2_vofs=r['v2']) for r in tr]
    res['change_sounds'] = ['port%d $%02X@%d' % (pt, c, f) for pt in range(4) for f, c, _ in sound_cmds(tr, pt)]
    # every stage at rest
    S.load_state(base)
    for st in range(1, 11):
        for _ in range(80):
            S.step(0)
        p = S.ppu()
        m = vis_map(S)
        key = 'stage_%02d' % st
        info = dump_screen(S, key)
        fr = S.frame()
        x, y, w, h = res['preview_hole_px']
        save_rgba(os.path.join(OUT, 'preview', 'stage%02d.png' % st), np.ascontiguousarray(fr[y:y + h, x:x + w]))
        # the preview in BG2 cells (16x16): visible 16x16 cells of BG2 under the hole
        m2 = vis_map(S, 2)
        res['stages'].append(dict(stage=st, bg2_hofs=p['bg2_hofs'], bg2_vofs=p['bg2_vofs'],
                                  stage_digits_cells=None, bg1_map=m.astype(int).tolist(),
                                  bg2_visible=m2.astype(int).tolist(),
                                  preview_png='preview/stage%02d.png' % st, screen=key))
        S.run(1, B.RIGHT)
    # the number cells: diff of stage 1 vs 2 vs 10 visible maps
    a = np.array(res['stages'][0]['bg1_map'])
    for s in res['stages']:
        s['digit_box_cells'] = map_diff_box(a, np.array(s['bg1_map']))
    # the number: one 16x16 BG1 cell (row 4, col 11), digits 1..9 + a '10' tile
    res['number_cell'] = dict(row=4, col=11, bbox_px=[176, 64, 16, 16],
                              entries={str(s['stage']): s['bg1_map'][4][11] for s in res['stages']})
    load(S, 'stage')
    for st in res['stages']:
        fn = 'stage_number_%02d.png' % st['stage']
        save_rgba(os.path.join(OUT, 'elements', fn), cell_patch(S, [[st['bg1_map'][4][11]]]))
        st['number_png'] = fn
    # wrap: from 1, LEFT -> ?
    S.load_state(base)
    S.run(1, B.LEFT)
    S.run(80)
    m = vis_map(S)
    res['left_from_1_shows'] = [k + 1 for k, s in enumerate(res['stages']) if s['bg1_map'][4][11] == int(m[4, 11])]
    # arrows (cells (4,10) left = hflipped, (4,12) right): animation over time
    S.load_state(base)
    seq = []
    for f in range(200):
        S.step(0)
        m = vis_map(S)
        e = (int(m[4, 10]), int(m[4, 12]))
        if seq and seq[-1][0] == e:
            seq[-1][1] += 1
        else:
            seq.append([e, 1])
    res['arrows_anim'] = [dict(left=a, right=b, frames=n) for (a, b), n in seq]
    load(S, 'stage')
    files = {}
    for (a, b), n in seq:
        for e in (a, b):
            fn = 'stage_arrow_%04X.png' % e
            if fn not in files.values():
                save_rgba(os.path.join(OUT, 'elements', fn), cell_patch(S, [[e]]))
            files['%04X' % e] = fn
    res['arrows_png'] = files
    res['arrows_cells'] = dict(left=[4, 10], right=[4, 12],
                               note='[row, col] of 16x16 BG1 cells; left arrow = right arrow tile hflipped')
    # change animation: every frame of one RIGHT (1 -> 2) as reference pictures
    S.load_state(base)
    for f in range(50):
        S.step(B.RIGHT if f == 0 else 0)
        S.png(os.path.join(OUT, 'ref', 'stage_change_f%02d.png' % f))
    # entering stage select from the rules screen: the preview's mosaic intro
    load(S, 'rules')
    tr = trace(S, [B.START], 60)
    res['enter_transition'] = [dict(f=r['f'], screen=r['scr'], mosaic_size=r['mos'] >> 4, bg2_hofs=r['h2'],
                                    bg2_vofs=r['v2']) for r in tr]
    # hold RIGHT: frames of each change start
    S.load_state(base)
    tr = trace(S, [(B.RIGHT, 200)])
    starts = [r['f'] for k, r in enumerate(tr) if r['mos'] and (k == 0 or not tr[k - 1]['mos'])]
    res['hold_right_change_starts'] = starts
    return res


def preview_tiles(S, sel):
    """Per stage: the preview's 16x16 BG2 cells (entries + PNG of each distinct tile),
    labelled by matching their pixels with the stage's arena metatiles (stages.py)."""
    out = []
    x, y, w, h = sel['preview_hole_px']
    for s in sel['stages']:
        st = s['stage']
        S.load_state_file(cache_state('stage'))
        S.step(0)
        for _ in range(st - 1):
            S.run(1, B.RIGHT)
            S.run(80)
        S.run(5)
        p = S.ppu()
        e = tilemap_entries(S.vram(), p['bg2_sc_base'], p['bg2_sc_size'])
        # BG2 pixel (bx, by) shows at screen (bx - hofs, by - vofs - 1)
        bx0 = (x + p['bg2_hofs']) & 1023
        by0 = (y + p['bg2_vofs'] + 1) & 1023
        cells = []
        for cy in range(by0 // 16, (by0 + h + 15) // 16):
            row = []
            for cx in range(bx0 // 16, (bx0 + w + 15) // 16):
                row.append(int(e[cy % 64, cx % 64]))
            cells.append(row)
        # distinct tiles
        uniq = {}
        for row in cells:
            for ent in row:
                if ent not in uniq:
                    uniq[ent] = len(uniq)
                    save_rgba(os.path.join(OUT, 'preview', 'stage%02d_tile%02d.png' % (st, uniq[ent])),
                              cell_patch(S, [[ent]], L=2))
        labels = label_tiles(S, st, uniq)
        out.append(dict(stage=st, origin_in_bg2_px=[bx0, by0],
                        first_cell_screen_px=[x - (bx0 % 16), y - (by0 % 16)],
                        cells=cells,
                        tiles=[dict(entry=ent, id=i, png='preview/stage%02d_tile%02d.png' % (st, i),
                                    label=labels.get(ent)) for ent, i in uniq.items()]))
    return out


def label_tiles(S, st, uniq):
    """Match preview tiles against the stage's arena metatiles (by RGB, then by shape)."""
    from PIL import Image
    sj = os.path.join(ASSETS, 'stages', 'stage%02d' % st, 'stage.json')
    mp = os.path.join(ASSETS, 'stages', 'stage%02d' % st, 'metatiles.png')
    if not (os.path.exists(sj) and os.path.exists(mp)):
        return {}
    meta = json.load(open(sj))['metatiles']
    atlas = np.asarray(Image.open(mp).convert('RGBA')).astype(int)
    out = {}
    for ent in uniq:
        t = cell_patch(S, [[ent]], L=2).astype(int)
        best = None
        for m in meta:
            x, y, w, h = m['rect']
            a = atlas[y:y + h, x:x + w]
            if a.shape != t.shape:
                continue
            d = float(np.abs(a[..., :3] - t[..., :3]).mean())
            # shape match: same "is this pixel equal to its right/bottom neighbour" pattern
            if best is None or d < best[0]:
                best = (d, m)
        if best:
            out[ent] = dict(kind=best[1].get('kind'), metatile=best[1]['id'], name=best[1].get('name'),
                            mean_abs_rgb_diff=round(best[0], 2))
    return out


def measure_stage_go(S):
    """START on stage select: sprites until the fade, from three phases of the bottom loop."""
    out = []
    atlas = PieceAtlas('go')
    for wait in (0, 17, 35):
        load(S, 'stage')
        S.run(wait)
        S.run(1, B.START)
        recs = []
        fade = None
        for f in range(200):
            S.step(0)
            if S.ppu()['brightness'] < 15:
                fade = f + 1
                break
            recs.append(strip_frame(S, atlas))
        out.append(dict(idle_frames_before_start=wait, fade_starts_frames_after_press=fade,
                        frames=recs if wait == 0 else None))
    return dict(runs=out, pieces=atlas.meta,
                note='frames[k] = sprites of frame k after the START press: [go atlas id, x, y, prio]')


def measure_fades(S):
    """Transitions: title -> mode, mode -> players -> rules -> stage, B back, stage -> match."""
    r = {}
    load(S, 'title')
    S.run(1, B.DOWN)
    S.run(20)
    tr = trace(S, [B.START], 400)
    r['title_to_mode'] = dict(brightness=runs(tr, 'b'), forced_blank=runs(tr, 'fb'),
                              sounds=['$%02X@%d' % (c, f) for f, c, _ in sound_cmds(tr)],
                              port3=['$%02X@%d' % (c, f) for f, c, _ in sound_cmds(tr, 3)][:3])
    for a, b in (('mode', 'players'), ('players', 'rules'), ('rules', 'stage')):
        load(S, a)
        tr = trace(S, [B.START], 60)
        sw = next((x['f'] for x in tr if x['scr'] == b), None)
        r['%s_to_%s' % (a, b)] = dict(switch_frame=sw, brightness=runs(tr, 'b'),
                                      sounds=['$%02X@%d' % (c, f) for f, c, _ in sound_cmds(tr)])
    for a, b in (('players', 'mode'), ('rules', 'players'), ('stage', 'rules')):
        load(S, a)
        tr = trace(S, [B.B], 60)
        sw = next((x['f'] for x in tr if x['scr'] == b), None)
        r['%s_back_to_%s' % (a, b)] = dict(switch_frame=sw, brightness=runs(tr, 'b'),
                                           sounds=['$%02X@%d' % (c, f) for f, c, _ in sound_cmds(tr)])
    load(S, 'stage')
    tr = trace(S, [B.START], 700)
    bright = next((x['f'] for x in tr if x['scr'] == 'battle' and x['b'] == 15 and not x['fb']), None)
    r['stage_to_match'] = dict(brightness=runs(tr, 'b'), forced_blank=runs(tr, 'fb'),
                               first_bright_battle_frame=bright,
                               sounds=['$%02X@%d' % (c, f) for f, c, _ in sound_cmds(tr)],
                               port3=['$%02X@%d' % (c, f) for f, c, _ in sound_cmds(tr, 3)][:3])
    return r


# ---------------------------------------------------------------------------------------
# sound: menu music + menu SFX (same methods as sound.py), merged into audio/audio.json
def record_menu_song(S, name, setup, trigger, seconds, outdir, keepalive=None, note=''):
    """sound.record_song with a keep-alive pad (the title falls into the attract demo
    after 1024 idle frames; any button resets that)."""
    from sound import Tape, find_loop, write_ogg, RATE
    tape = Tape(S)
    setup(S, tape)
    start = None
    for _ in range(3000):
        tape.step(0, keep_state=True)
        if trigger(tape):
            start = tape.n - 1
            break
    if start is None:
        print('!! no trigger for', name)
        return None
    st = tape.ring.get(start)
    cur = S.save_state()
    S.load_state(st)
    S.step(0)
    S.audio()
    S.save_spc(os.path.join(outdir, name + '.spc'), song=name, comment='Super Bomberman 2 menu: ' + name)
    S.load_state(cur)
    t0 = tape.n
    for f in range(int(seconds * S.fps)):
        tape.step(keepalive(f) if keepalive else 0)
    pcm = tape.audio(t0 - 1)
    mono = np.abs(pcm.astype(np.int32)).max(1)
    nz = np.nonzero(mono > 64)[0]
    lead = int(nz[0]) if len(nz) else 0
    pcm = pcm[lead:]
    loop = find_loop(pcm) or find_loop_relaxed(pcm)
    write_ogg(os.path.join(outdir, name + '.ogg'), pcm)
    info = dict(name=name, spc=name + '.spc', ogg=name + '.ogg', note=note, command_frame=start,
                recorded_seconds=round(len(pcm) / RATE, 3), sample_rate=RATE,
                leading_silence_trimmed_samples=lead)
    if loop:
        s0, L = loop['start'], loop['length']
        info.update(loop_start_sample=int(s0), loop_length_samples=int(L),
                    loop_start_s=round(s0 / RATE, 3), loop_length_s=round(L / RATE, 3),
                    loop_correlation=loop['score'], loop_method=loop['method'])
        write_ogg(os.path.join(outdir, name + '_loop.ogg'), pcm[:s0 + L])
        info['ogg_intro_plus_one_loop'] = name + '_loop.ogg'
    else:
        info['loop'] = 'not found (one-shot or longer than the recording)'
    print('music', name, info.get('loop_length_s'), info.get('loop_start_s'), info.get('loop_method'))
    return info


def find_loop_relaxed(pcm, min_loop_s=20.0):
    """sound.find_loop with the autocorrelation threshold lowered (the title song repeats
    with more variation: best normalised autocorrelation 0.80 at 67.7 s); same refinement
    and start search."""
    from sound import _ncc, RATE
    x = pcm.astype(np.float64).mean(1)
    n = len(x)
    D = 32
    y = x[:n // D * D].reshape(-1, D).mean(1)
    N = len(y)
    L2 = 1 << int(np.ceil(np.log2(2 * N)))
    F = np.fft.rfft(y, L2)
    r = np.fft.irfft(F * np.conj(F), L2)[:N]
    c2 = np.cumsum(np.concatenate([[0], y ** 2]))
    lags = np.arange(N)
    norm = r / (np.sqrt(c2[N - lags] * (c2[N] - c2[lags])) + 1e-9)
    sr = RATE / D
    lo, hi = int(min_loop_s * sr), int((n / RATE - 8) * sr)
    if hi <= lo + 3:
        return None
    k = int(np.argmax(norm[lo:hi])) + lo
    if norm[k] < 0.7:
        return None
    L0 = k * D
    W = int(6 * RATE)
    t = max(0, (n - L0 - W) // 2)
    ref = x[t:t + W]
    cands = [(_ncc(ref, x[t + L:t + L + W]), L) for L in range(L0 - 48, L0 + 49) if t + L + W <= n]
    score, L = max(cands)
    w = RATE
    tail = [_ncc(x[s0:s0 + w], x[s0 + L:s0 + L + w]) for s0 in range(n // 4, n - L - w, w)][:30]
    thr = 0.8 * float(np.median(tail))
    for s0 in range(0, n - L - 3 * w, int(0.01 * RATE)):
        if all(_ncc(x[s0 + j * w:s0 + (j + 1) * w], x[s0 + L + j * w:s0 + L + (j + 1) * w]) >= thr for j in range(3)):
            return dict(start=s0, length=L, score=round(score, 4), threshold=round(thr, 3),
                        method='correlation (relaxed: autocorrelation peak %.2f)' % norm[k])
    return None


def sound_part():
    from sound import after_upload_play, isolate
    adir = os.path.join(ASSETS, 'audio')
    mdir, sdir = mkdir(adir, 'music'), mkdir(adir, 'sfx')
    S = Snes(render=False)
    build_states(S)
    music, sfx = [], []

    def setup_title(S_, tape):           # power-on (soft reset) -> skip the intro with START
        S_.reset()
        for f in range(260):
            tape.step(B.START if 250 <= f < 252 else 0)
    keep = lambda f: B.LEFT if f % 600 == 300 else 0      # noqa: E731  (no sound, resets the attract timer)
    info = record_menu_song(S, 'title', setup_title, after_upload_play(1), 330, mdir, keepalive=keep,
                            note='title screen song (upload + play $01 after the intro is skipped); recorded '
                                 'with a LEFT tap every 600 frames to keep the attract demo away')
    if info:
        music.append(info)

    def setup_menu(S_, tape):
        S_.load_state_file(cache_state('title'))
        tape.step(B.DOWN)
        for _ in range(20):
            tape.step(0)
        tape.step(B.START)
    info = record_menu_song(S, 'menu', setup_menu, after_upload_play(3), 150, mdir,
                            note='battle menus song (mode / players / rules / stage select): upload '
                                 'during the black load after BATTLE GAME, then play $03')
    if info:
        music.append(info)
    # sfx on the players screen: cursor ($51) and confirm ($52); A = with the tap, B = idle
    S.load_state_file(cache_state('players'))
    S.step(0)
    base = S.save_state()
    r = isolate(S, base, 'menu_cursor', [B.DOWN] + [0] * 89, 90, sdir, want_id=0x51, max_delay=900,
                note='cursor move / value change in the menus (also the title cursor)')
    r and sfx.append(r)
    S.load_state_file(cache_state('rules'))
    S.step(0)
    base = S.save_state()
    r = isolate(S, base, 'menu_confirm', [B.START] + [0] * 89, 90, sdir, want_id=0x52, max_delay=900,
                note='confirm (START / A) in the menus and on the title; B (back) makes no sound')
    if r:
        # the effect has decayed after ~0.85 s; the rest of the residual is the music voice it
        # displaced (no quiet moment for voices 0+1 within 15 s): trim with a 60 ms fade
        import subprocess
        fn = os.path.join(sdir, 'menu_confirm.ogg')
        tmp = fn + '.tmp.ogg'
        subprocess.check_call(['ffmpeg', '-v', 'quiet', '-y', '-i', fn, '-t', '0.9', '-af',
                               'afade=t=out:st=0.84:d=0.06', '-c:a', 'libvorbis', '-q:a', '6', tmp])
        os.replace(tmp, fn)
        r['seconds'] = 0.9
        r['note'] += '; trimmed to 0.9 s (the residual after that is the displaced music voice)'
        sfx.append(r)
    # merge into audio.json
    ap = os.path.join(adir, 'audio.json')
    aj = json.load(open(ap)) if os.path.exists(ap) else dict(music=[], sfx=[])
    names = {m['name'] for m in music}
    aj['music'] = [m for m in aj.get('music', []) if m['name'] not in names] + music
    names = {x['name'] for x in sfx}
    aj['sfx'] = [x for x in aj.get('sfx', []) if x['name'] not in names] + sfx
    aj['not_captured'] = [x for x in aj.get('not_captured', []) if 'menu' not in x]
    write_json(ap, aj)
    return music, sfx


def after_match():
    """P1 wins 3 rounds (the three others bomb themselves, 4 humans via the multitap, G-BOMBER
    on): scoreboard -> VICTORY!! -> roulette -> back to which menu? (with key frames)"""
    S = Snes(multitap=True)
    S.load_state_file(state_path('mt4_stage01'))
    S.run(2)
    for rnd in range(3):
        for k in range(1003 if rnd < 2 else 600):
            S.step((0, B.A, B.A, B.A, 0) if k < 3 else 0)
        if rnd < 2:
            for _ in range(600):
                p = S.ppu()
                if p['brightness'] == 15 and p['bg2_sc_base'] == 0x4000 and not p['forced_blank']:
                    break
                S.step(0)
    recs = []
    prev = None
    for k in range(3000):
        S.step(0)
        p = S.ppu()
        sc = screen_of(S)
        key = (sc, p['brightness'], bool(p['forced_blank']))
        if key != prev:
            recs.append(dict(f=k, screen=sc, brightness=p['brightness'], forced_blank=bool(p['forced_blank']),
                             bg1_hofs=p['bg1_hofs'], port0='$%02X' % S.smp()['cpu_to_spc'][0]))
            prev = key
        if k in (0, 400, 1200, 2400):
            S.png(os.path.join(OUT, 'ref', 'after_match_f%04d.png' % k))
    out = dict(start='3rd round won by P1 (white), 600 frames after the last bombs',
               changes=recs,
               summary='scoreboard (trophies) -> fade -> VICTORY!! -> fade -> ROULETTE (G-BOMBER on; '
                       'stops on its own without input) -> fade -> the MODE screen (SINGLE MATCH / TAG '
                       'MATCH), menu song $03 again. Key frames ref/after_match_fNNNN.png.')
    write_json(os.path.join(OUT, 'after_match.json'), out)


def texture_report(screens):
    """Which BG1 rows of each menu screen are plain repeatable texture (no unique cells)."""
    out = {}
    for key, info in screens.items():
        L = info['layers'].get('bg1')
        if not L or L['tile_px'] != 16:
            continue
        e = np.array(L['entries'])
        h = L['hofs'] // 16
        v = ((L['vofs'] + 1) & 1023) // 16
        vis = e[(np.arange(14) + v) % 64][:, (np.arange(16) + h) % 64]
        rows = []
        for r in range(14):
            u = sorted(set(int(x) for x in vis[r]))
            rows.append(dict(row=r, y_px=r * 16, distinct=len(u), entries=[int(x) for x in vis[r]]))
        out[key] = rows
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for d in ('screens', 'elements', 'ref', 'sprites', 'preview'):
        mkdir(OUT, d)
    S = Snes()
    build_states(S)
    meta = dict(note='Measured in the harness (snes9x, 60.0988 Hz frames). Frame numbers in a '
                     'measurement count from the frame of the press (0 = that frame, as returned '
                     'by S.step); coordinates are 256x224 screen pixels; BG cells are 16x16.',
                screens={}, flow={}, input={}, timing={}, elements={}, sprites={}, stage_select={})
    # --- screens
    shots = {}
    for nm in ('title', 'mode', 'players', 'rules', 'stage'):
        load(S, nm)
        shots[nm] = dump_screen(S, nm)
        meta['screens'][nm] = dict(dir='screens/%s' % nm, screen=screen_of(S), bg1_hofs=S.ppu()['bg1_hofs'])
    # cursor variants on each list screen + title cursor positions
    for nm, n in (('mode', 2), ('players', 4), ('rules', 4)):
        for k in range(1, n):
            load(S, nm)
            for _ in range(k):
                S.run(1, B.DOWN)
                S.run(14)
            S.png(os.path.join(OUT, 'ref', '%s_cursor%d.png' % (nm, k + 1)))
    for k in range(1, 3):
        load(S, 'title')
        for _ in range(k):
            S.run(1, B.DOWN)
            S.run(14)
        S.png(os.path.join(OUT, 'ref', 'title_cursor%d.png' % (k + 1)))
    # --- input behaviour
    meta['input']['buttons'] = {nm: button_table(S, nm) for nm in ('title', 'mode', 'players', 'rules', 'stage')}
    meta['input']['hold_repeat'] = dict(
        rules_hold_right_value_changes=measure_repeat(S, 'rules', 'RIGHT', 200, row=2, cols=(11, 14)),
        rules_hold_down_cursor_moves=measure_repeat(S, 'rules', 'DOWN', 120),
        players_hold_down_cursor_moves=measure_repeat(S, 'players', 'DOWN', 120))
    meta['input']['earliest_input_after_switch'] = dict(
        players_after_mode_start=earliest_input(S, 'mode', 'START', 'DOWN',
                                                lambda S_: screen_of(S_) == 'players' and vis_map(S_)[4, 1] != 0x1222),
        rules_after_players_start=earliest_input(S, 'players', 'START', 'DOWN',
                                                 lambda S_: screen_of(S_) == 'rules' and vis_map(S_)[4, 1] != 0x1222),
        stage_after_rules_start=earliest_input(S, 'rules', 'START', 'B',
                                               lambda S_: screen_of(S_) == 'rules'),
        mode_after_title_start=earliest_input(S, 'title', 'START', 'DOWN',
                                              lambda S_: screen_of(S_) == 'mode' and vis_map(S_)[6, 1] != 0x1222, maxk=400,
                                              pre=('DOWN',)),
    )
    # --- cursor animation (BG cells) and values
    meta['elements']['cursor_anim'] = {nm: measure_cursor(S, nm) for nm in ('mode', 'players', 'rules')}
    cur_png = {}
    load(S, 'players')
    for e, _ in meta['elements']['cursor_anim']['players']:
        fn = 'cursor_%04X.png' % e
        save_rgba(os.path.join(OUT, 'elements', fn), cell_patch(S, [[e, e + 2]]))
        cur_png['%04X' % e] = fn
    meta['elements']['cursor_png'] = cur_png
    meta['elements']['cursor_note'] = ('the cursor = 2 BG1 cells (cols 1..2 of the item row; '
                                       'entry e and e+2); cursor_anim lists [entry of col 1, frames]')
    pv = measure_values(S, 'players', [2, 4, 6, 8], (11, 14), 'RIGHT')
    pl = measure_values(S, 'players', [2, 4, 6, 8], (11, 14), 'LEFT')
    rv = measure_values(S, 'rules', [2, 4, 6, 8], (11, 14), 'RIGHT')
    rl = measure_values(S, 'rules', [2, 4, 6, 8], (11, 14), 'LEFT')
    meta['elements']['players_values'] = save_variants(S, 'players', pv, [
        ['MAN', 'COM', 'OFF'], ['MAN', 'COM', 'OFF'], ['COM', 'OFF'], ['COM', 'OFF']])
    meta['elements']['players_values_left'] = pl
    meta['elements']['rules_values'] = save_variants(S, 'rules', rv, [
        ['5', '6', '7', '8', '9', '1', '2', '3', '4'], ['3', '4', '5', '1', '2'],
        ['2min', '3min', '5min', 'inf', '1min'], ['ON', 'OFF']])
    meta['elements']['rules_items'] = ['COM LEVEL', 'BATTLE', 'TIME', 'G-BOMBER']
    meta['elements']['players_items'] = ['1PLAYER', '2PLAYER', '3PLAYER', '4PLAYER']
    meta['elements']['mode_items'] = ['SINGLE MATCH', 'TAG MATCH']
    meta['elements']['title_items'] = ['NORMAL GAME', 'BATTLE GAME', 'PASSWORD']
    meta['elements']['rules_values_left'] = rl
    # --- sprites
    meta['sprites']['bottom_strip'] = measure_bottom(S)
    meta['sprites']['title_cursor'] = measure_title_cursor(S)
    meta['sprites']['title'] = measure_title_layout(S)
    meta['timing']['title_idle_to_attract_fade'] = measure_title_idle(S)
    # --- stage select
    sel = measure_stage_select(S)
    sel['preview'] = preview_tiles(S, sel)
    sel['go'] = measure_stage_go(S)
    meta['stage_select'] = sel
    # --- fades / transitions
    meta['timing'].update(measure_fades(S))
    meta['texture_rows'] = texture_report(shots)
    # after a whole match (multitap Snes -> its own process)
    import subprocess
    subprocess.check_call([sys.executable, os.path.abspath(__file__), '--after-match'])
    meta['after_match'] = json.load(open(os.path.join(OUT, 'after_match.json')))
    write_json(os.path.join(OUT, 'menus.json'), meta)
    print('wrote', os.path.join(OUT, 'menus.json'))


if __name__ == '__main__':
    if '--sound-only' in sys.argv:
        sound_part()
    elif '--after-match' in sys.argv:
        after_match()
    else:
        main()
        if '--sound' in sys.argv:          # one Snes per process
            import subprocess
            subprocess.check_call([sys.executable, os.path.abspath(__file__), '--sound-only'])
