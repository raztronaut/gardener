"""Per-stage background extraction (all 10 battle stages).

    python3 stages.py [STAGE ...]        (needs observe.py caches: obs_idle_*, obs_com_*)

Writes data/sb2/assets/stages/stageNN/:
  chars_bg12.png   BG1/BG2 4bpp characters, 1024 tiles, 16/row, INDEXED PNG
                   (pixel value = colour index 0..15 within its palette; 0 = transparent)
  chars_bg3.png    BG3 2bpp characters (HUD font), 256 tiles, indexed (0..3)
  palettes.json    CGRAM at match start (256 BGR555 words + '#rrggbb'), per palette rows
  tilemaps.json    BG1/BG2/BG3 registers + raw tilemap entries at match start
  bg1.png bg2.png bg3.png   whole tilemaps rendered (RGBA, transparent = hw transparent)
  screen.png       the emulator frame at match start (256x224, what the TV shows)
  arena.png        BG2 arena region (15x13 cells = 240x208) at match start
  metatiles.png    every distinct 16x16 BG2 cell (16 per row) incl. bombs, flames, items
  anim_tiles.png   frames of character-animated metatiles (stages 5, 6)
  stage.json       manifest (see NOTES-extract.md)
"""
import collections
import hashlib
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ASSETS, CACHE, write_json, save_rgba, mkdir, NSTAGES  # noqa: E402
from snesgfx import (cgram_words, cgram_hex, to_rgba, decode_tile, render_bg_cell,  # noqa: E402
                     render_bg, tile_sheet, decode_entry, tilemap_entries, bg_window)
from observe import PPU_KEYS, obs_path  # noqa: E402
from sprites_lib import find_cycle  # noqa: E402

CELL = 16
ARENA_X0, ARENA_Y0 = 1, 3

CODE_KIND = {0x00: 'floor', 0x01: 'flame', 0x41: 'item_burn', 0x43: 'bomb', 0x44: 'item',
             0xC1: 'pressure_block', 0xC2: 'soft_block', 0xC4: 'hard_block', 0xC5: 'hard_block',
             0xC6: 'wall'}

# --- tile families (char numbers, identical layout on every stage; verified by observation)
SOFT_DESTROY = [224, 226, 228, 230, 232, 234]
FLAME_ROWS = [288, 320, 352, 384, 416]                      # flame animation frames 0..4
FLAME_ORDER = [0, 1, 2, 3, 4, 3, 4, 3, 4, 3, 2, 1, 0]
FLAME_PIECES = {0: 'end_up', 2: 'end_down', 4: 'end_left', 6: 'end_right',
                8: 'arm_v', 10: 'arm_h', 12: 'center'}
ITEM_BURN = [302, 334, 366, 398, 430, 488, 490]
BOMB_TYPES = {   # first tile -> (name, frames, item tile that grants it, player +$F3 value)
    256: ('normal', [256, 258, 260, 262], None, 0),
    264: ('remote', [264, 266, 268, 270], 526, 1),
    448: ('rubber', [448, 450, 452], 552, 8),
    456: ('pierce', [456, 458, 460, 462], 516, 4),
    480: ('power', [480, 482, 484, 486], 554, 2),
}
# tile -> (name, effect).  Effects measured here by spawning the item next to P1 and
# walking over it (player-struct byte that changed); names follow phase 2b's item
# handler table (NOTES-re.md "Item pickup").  Battle deck kinds = the first 14.
ITEMS = {
    512: ('bomb_up', '+$E1 bomb capacity +1'), 514: ('fire_up', '+$E2 fire +1'),
    516: ('pierce_bomb', '+$F3 = 4 (pierce bombs)'), 518: ('full_fire', '+$E2 fire = 9'),
    520: ('bomb_pass', '+$FA = 1'), 522: ('skull', 'disease (+$F5), +$E9'),
    526: ('remote_bomb', '+$F3 = 1 (remote bombs, B detonates)'),
    544: ('wall_pass', '+$FB = 1 (walk through soft blocks)'),
    546: ('speed_up', '+$E0 speed +1'), 548: ('kick', '+$FF = 1'),
    550: ('glove', '+$FE = 1 (A on own bomb lifts, release throws)'),
    552: ('rubber_bomb', '+$F3 = 8 (rubber bombs)'), 554: ('power_bomb', '+$F3 = 2 (power bomb)'),
    576: ('heart', '+$EF = 1 (one hit of protection)'),
    524: ('vest_icon', 'not in the battle deck; no struct change when picked up'),
    556: ('question_icon', 'not in the battle deck; no struct change'),
    558: ('clock_icon', 'not in the battle deck (normal game)'),
    578: ('unknown_578', 'not in the battle deck'), 580: ('unknown_580', 'not in the battle deck'),
    582: ('unknown_582', 'not in the battle deck'), 584: ('unknown_584', 'not in the battle deck'),
    586: ('apple_icon', 'score item (normal game)'), 588: ('ice_cream_icon', 'score item (normal game)'),
    590: ('cake_icon', 'score item (normal game)'),
}
ITEM_PAL = 5
SOFT_REGROW = [192, 194, 196, 198]   # stage 10: mushrooms sprout back (floor -> soft block)

# visual descriptions of stage-specific grid codes (from looking at metatiles.png; what they
# DO is phase 2b's business -- see tools/sb2/NOTES-re.md / SPEC.md)
GIMMICK_DESC = {
    2: {0x07: 'ice floor', 0x08: 'ice floor, shadowed', 0x0A: 'ice floor variant',
        0x49: 'dark round hole'},
    3: {0xFB: 'rare code seen near the water (transient)'},
    4: {0x0E: 'dirt track ring; flames on it use track-specific tiles (flipped)'},
    5: {0x14: 'red/yellow diamond pad (character-animated)'},
    6: {0x50: 'red / blue round pads'},
    7: {0x0F: 'numbered pads 1-5 and the yellow "!" pad'},
    8: {0x12: 'orange gear panel', 0x13: 'orange "S" panel',
        **{c: 'conveyor belt piece' for c in range(0x14, 0x1F)}},
    9: {0x3C: 'arrow panel up', 0x3D: 'arrow panel down', 0x3E: 'arrow panel right',
        0x3F: 'arrow panel left'},
}


def entry_of(tile, pal, hflip=False, vflip=False, prio=0):
    return tile | (pal << 10) | (prio << 13) | (0x4000 if hflip else 0) | (0x8000 if vflip else 0)


def family(e):
    """Name an entry by its tile family (or None)."""
    d = decode_entry(e)
    t, p = d['tile'], d['pal']
    if t in SOFT_DESTROY:
        return dict(kind='soft_destroy', frame=SOFT_DESTROY.index(t), pal=p,
                    name='soft_destroy_%d_p%d' % (SOFT_DESTROY.index(t), p))
    if t in ITEM_BURN:
        return dict(kind='item_burn', frame=ITEM_BURN.index(t), pal=p,
                    name='item_burn_%d_p%d' % (ITEM_BURN.index(t), p))
    for row in FLAME_ROWS:
        if row <= t < row + 14 and (t - row) in FLAME_PIECES:
            pc = FLAME_PIECES[t - row]
            fr = FLAME_ROWS.index(row)
            return dict(kind='flame', piece=pc, frame=fr, pal=p, name='flame_%s_%d_p%d' % (pc, fr, p))
    for t0, (bn, frames, _, _) in BOMB_TYPES.items():
        if t in frames:
            return dict(kind='bomb', bomb_type=bn, frame=frames.index(t), pal=p,
                        name='bomb_%s_%d_p%d' % (bn, frames.index(t), p))
    if t in SOFT_REGROW and STAGE[0] == 10:
        return dict(kind='soft_regrow', frame=SOFT_REGROW.index(t), name='soft_regrow_%d' % SOFT_REGROW.index(t))
    if t in ITEMS and p == ITEM_PAL:
        return dict(kind='item', item=ITEMS[t][0], name='item_' + ITEMS[t][0])
    return None


def derived_entries():
    out = []
    for p in (1, 2, 3, 4):
        out += [entry_of(t, p) for t in SOFT_DESTROY + ITEM_BURN]
        out += [entry_of(r + o, p) for r in FLAME_ROWS for o in FLAME_PIECES]
        for _, (bn, frames, _, _) in BOMB_TYPES.items():
            out += [entry_of(t, p) for t in frames]
    out += [entry_of(t, ITEM_PAL) for t in ITEMS]
    return out


def indexed_png(path, idx, ncol):
    """Save uint8 index image as a paletted PNG: grey ramp, index 0 transparent."""
    im = Image.fromarray(idx.astype(np.uint8), 'P')
    pal = []
    for i in range(256):
        v = int(i * 255 / max(1, ncol - 1)) if i < ncol else 0
        pal += [v, v, v]
    im.putpalette(pal)
    im.info['transparency'] = 0
    im.save(path, transparency=0)


def run_lengths(col, live):
    """[(value, start, length)] for one cell's per-frame entries over live frames."""
    out = []
    prev = None
    for f in range(len(col)):
        if not live[f]:
            prev = None
            continue
        v = int(col[f])
        if prev is not None and v == prev[0] and prev[1] + prev[2] == f:
            prev[2] += 1
        else:
            prev = [v, f, 1]
            out.append(prev)
    return out


def mode(xs):
    if not xs:
        return None
    return collections.Counter(xs).most_common(1)[0][0]


STAGE = [0]
_GLOBAL = {}


def tile_trans(trans):
    out = collections.defaultdict(list)
    for (a, b), ls in trans.items():
        out[(a & 0x3ff, b & 0x3ff)] += ls
    return out


def global_tile_trans():
    """Tile-pair durations pooled over the COM runs of all stages (cached)."""
    if 'tt' not in _GLOBAL:
        tt = collections.defaultdict(list)
        fam = set(t for _, (_, fr, _, _) in BOMB_TYPES.items() for t in fr) | set(ITEM_BURN) | \
            set(SOFT_DESTROY) | set(r + o for r in FLAME_ROWS for o in FLAME_PIECES)
        paths = [obs_path(st, 'com') for st in range(1, NSTAGES + 1)] + [obs_path(1, 'bombs')]
        for p in paths:
            if not os.path.exists(p):
                continue
            cd = np.load(p)
            live, ent = cd['live'], cd['ent']
            for r in range(13):
                for c in range(15):
                    runs = run_lengths(ent[:, r, c], live)
                    for (a, s0, l0), (b, s1, l1) in zip(runs, runs[1:]):
                        if s0 + l0 == s1 and (a & 0x3ff) in fam:
                            tt[(a & 0x3ff, b & 0x3ff)].append(l0)
        _GLOBAL['tt'] = tt
    return _GLOBAL['tt']


def extract(stage):
    STAGE[0] = stage
    od = np.load(obs_path(stage, 'idle'))
    cd = np.load(obs_path(stage, 'com'))
    outdir = mkdir(ASSETS, 'stages', 'stage%02d' % stage)
    vram, cg = od['start_vram'], od['start_cgram']
    ppu = dict(zip(PPU_KEYS, [int(x) for x in od['start_ppu']]))
    ppu['bgmode'] = ppu['bgmode']
    words = cgram_words(cg)

    # ---- characters, palettes ---------------------------------------------------
    indexed_png(os.path.join(outdir, 'chars_bg12.png'), tile_sheet(vram, ppu['bg2_char_base'] * 2, 1024, 4), 16)
    indexed_png(os.path.join(outdir, 'chars_bg3.png'), tile_sheet(vram, ppu['bg3_char_base'] * 2, 256, 2), 4)
    hexes = cgram_hex(cg)
    write_json(os.path.join(outdir, 'palettes.json'), dict(
        note='CGRAM at match start. BG palettes: 4bpp BG1/BG2 palette p = cgram[16p:16p+16]; '
             'BG3 2bpp palette p = cgram[4p:4p+4]; OBJ palette p = cgram[128+16p:...]. '
             'Colour 0 of every palette is transparent (cgram[0] is the backdrop).',
        bgr555=[int(w) for w in words], rgb=hexes,
        bg=[hexes[16 * p:16 * p + 16] for p in range(8)],
        obj=[hexes[128 + 16 * p:128 + 16 * p + 16] for p in range(8)]))

    # ---- tilemaps -----------------------------------------------------------------
    tm = dict(note='entries are raw SNES tilemap words: bits 0-9 tile, 10-12 palette, 13 priority, '
                   '14 hflip, 15 vflip. For 16x16-tile layers the cell = tiles t, t+1, t+16, t+17. '
                   'Screen pixel (x, y) shows layer pixel (x + hofs, y + vofs + 1) (measured).',
              ppu=ppu, layers={})
    for L in (1, 2, 3):
        bpp = {1: 4, 2: 4, 3: 2}[L]
        big = bool(ppu['bgmode_raw'] & (0x10 << (L - 1)))
        ent = tilemap_entries(vram, ppu['bg%d_sc_base' % L], ppu['bg%d_sc_size' % L])
        cimg, prio, _ = render_bg(vram, ppu, L, mode=ppu['bgmode'])
        save_rgba(os.path.join(outdir, 'bg%d.png' % L), to_rgba(cimg, cg))
        tm['layers']['bg%d' % L] = dict(
            sc_base=ppu['bg%d_sc_base' % L], sc_size=ppu['bg%d_sc_size' % L],
            char_base=ppu['bg%d_char_base' % L], bpp=bpp, tile_px=16 if big else 8,
            hofs=ppu['bg%d_hofs' % L], vofs=ppu['bg%d_vofs' % L],
            width=int(ent.shape[1]), height=int(ent.shape[0]),
            entries=[[int(x) for x in row] for row in ent])
        if L == 2:
            bg2_c = cimg
    write_json(os.path.join(outdir, 'tilemaps.json'), tm)
    save_rgba(os.path.join(outdir, 'screen.png'), od['start_frame'])
    save_rgba(os.path.join(outdir, 'arena.png'),
              to_rgba(bg2_c[ARENA_Y0 * 16:(ARENA_Y0 + 13) * 16, ARENA_X0 * 16:(ARENA_X0 + 15) * 16], cg))

    # ---- metatile collection -----------------------------------------------------
    bg2 = np.array(tm['layers']['bg2']['entries'], np.uint16)
    live = cd['live']
    ent_c, grid_c = cd['ent'], cd['grid']
    codes = collections.defaultdict(collections.Counter)
    seen = collections.Counter()
    first = {}
    for f in np.nonzero(live)[0]:
        e = ent_c[f]
        g = grid_c[f]
        for v, k in zip(*np.unique(e, return_counts=True)):
            seen[int(v)] += int(k)
            first.setdefault(int(v), int(f))
        # code per entry (vectorised by pairing)
        pair = (e.astype(np.uint32) << 8) | g
        for v, k in zip(*np.unique(pair, return_counts=True)):
            codes[int(v) >> 8][int(v) & 0xff] += int(k)
    start_grid = od['grid'][0]
    start_ent = od['ent'][0]
    for r in range(13):
        for c in range(15):
            codes[int(start_ent[r, c])][int(start_grid[r, c])] += 0
    # entries on the start map (all screens), the 'empty arena' copy and derived families
    cand = set(int(x) for x in np.unique(bg2)) | set(seen) | set(derived_entries())
    cells = {}
    for e in sorted(cand):
        img, pr = render_bg_cell(vram, ppu['bg2_char_base'], e, 4, True)
        if (img < 0).all():
            continue
        cells[e] = img
    # dedupe identical renderings (keep the lowest entry as canonical, list aliases)
    by_img = collections.OrderedDict()
    for e, img in cells.items():
        h = hashlib.sha1(img.tobytes()).hexdigest()
        by_img.setdefault(h, []).append(e)

    def kind_of(e):
        fam = family(e)
        if fam:
            return fam
        cnt = codes.get(e)
        if cnt and sum(cnt.values()) > 0:
            code = cnt.most_common(1)[0][0]
        elif e in set(int(x) for x in start_ent.ravel()):
            code = int(start_grid[np.nonzero(start_ent == e)][0])
        else:
            code = None
        if code is None:
            return dict(kind='border')
        return dict(kind=CODE_KIND.get(code, 'gimmick_%02x' % code), code=code)

    metas = []
    eid = {}
    namecount = collections.Counter()
    for h, es in by_img.items():
        e = es[0]
        info = kind_of(e)
        if 'name' not in info:
            base = info['kind']
            info['name'] = '%s_%d' % (base, namecount[base])
            namecount[base] += 1
        mid = len(metas)
        d = decode_entry(e)
        cnt = collections.Counter()
        for a in es:
            cnt.update(codes.get(a, {}))
        m = dict(id=mid, name=info['name'], kind=info['kind'],
                 rect=[(mid % 16) * CELL, (mid // 16) * CELL, CELL, CELL],
                 entry=e, entries=es, tile=d['tile'], pal=d['pal'], prio=d['prio'],
                 hflip=d['hflip'], vflip=d['vflip'],
                 grid_codes={'%02x' % k: v for k, v in sorted(cnt.items())},
                 observed_frames=int(sum(seen.get(a, 0) for a in es)),
                 on_start_map=bool(any((bg2 == a).any() for a in es)))
        for k in ('piece', 'frame', 'pal', 'bomb_type', 'item', 'code'):
            if k in info and k not in ('pal',):
                m[k] = info[k]
        if m['kind'] == 'item':
            m['effect'] = ITEMS[m['tile']][1]
        if 'code' in m and m['code'] in GIMMICK_DESC.get(stage, {}):
            m['description'] = GIMMICK_DESC[stage][m['code']]
        metas.append(m)
        for a in es:
            eid[a] = mid
    n = len(metas)
    rows = (n + 15) // 16
    atlas = np.full((rows * CELL, 16 * CELL), -1, np.int16)
    for m in metas:
        x, y = m['rect'][:2]
        atlas[y:y + CELL, x:x + CELL] = cells[m['entry']]
    save_rgba(os.path.join(outdir, 'metatiles.png'), to_rgba(atlas, cg))

    def ids_of(block):
        return [[eid.get(int(v), -1) for v in row] for row in block]

    # ---- grid / maps ------------------------------------------------------------
    arena0 = bg2[ARENA_Y0:ARENA_Y0 + 13, ARENA_X0:ARENA_X0 + 15]
    empty0 = bg2[32 + ARENA_Y0:32 + ARENA_Y0 + 13, ARENA_X0:ARENA_X0 + 15]
    # the visible frame: BG2 cells 0..16 x 1..15 (screen window with hofs 8 / vofs 22)
    view = bg2[0:16, 0:17]

    # ---- animations (durations = mode of observed run lengths in the COM run) ------
    trans = collections.defaultdict(list)       # (a, b) -> [durations of a before b]
    lifetimes = collections.defaultdict(list)
    for r in range(13):
        for c in range(15):
            runs = run_lengths(ent_c[:, r, c], live)
            for (a, s0, l0), (b, s1, l1) in zip(runs, runs[1:]):
                if s0 + l0 == s1:
                    trans[(a, b)].append(l0)

    def dur(a, b):
        """Mode of observed durations of entry a before entry b on this stage; for the
        tile families (bombs, flames, burns) falls back to the same tile pair with any
        owner palette, then to all 10 stages pooled (+ the bomb lab), whenever fewer
        than 8 samples exist."""
        ls = trans.get((a, b), [])
        if len(ls) < 8:                    # few samples: lag frames could dominate
            ls = tile_trans(trans).get((a & 0x3ff, b & 0x3ff), [])
        if len(ls) < 8 and decode_entry(a)['pal'] != 6:
            ls = global_tile_trans().get((a & 0x3ff, b & 0x3ff), []) or ls
        return mode(ls)

    anims = {}
    for p in (1, 2, 3, 4):
        seq = [entry_of(t, p) for t in SOFT_DESTROY]
        fr = [dict(metatile=eid.get(a), duration=dur(a, b)) for a, b in zip(seq, seq[1:])]
        fr.append(dict(metatile=eid.get(seq[-1]),
                       duration=mode([l for (a, b), ls in trans.items() if a == seq[-1] for l in ls])))
        anims['soft_destroy_p%d' % p] = dict(loop=False, frames=fr,
                                             then='floor or the hidden item')
        seq = [entry_of(t, p) for t in ITEM_BURN]
        fr = [dict(metatile=eid.get(a), duration=dur(a, b)) for a, b in zip(seq, seq[1:])]
        fr.append(dict(metatile=eid.get(seq[-1]),
                       duration=mode([l for (a, b), ls in trans.items() if a == seq[-1] for l in ls])))
        anims['item_burn_p%d' % p] = dict(loop=False, frames=fr, then='floor')
        for t0, (bn, frames, item, f3) in BOMB_TYPES.items():
            seq = [entry_of(t, p) for t in frames]
            fr = []
            for i, a in enumerate(seq):
                b = seq[(i + 1) % len(seq)]
                fr.append(dict(metatile=eid.get(a), duration=dur(a, b)))
            anims['bomb_%s_p%d' % (bn, p)] = dict(
                loop=True, frames=fr, granted_by_item=ITEMS[item][0] if item else None,
                first_frame_duration=mode([l for (a, b), ls in trans.items()
                                           if a == seq[0] and b == seq[1] for l in ls[:1]]),
                note='durations: mode of observed run lengths; the very first frame after '
                     'placement can differ (see first_frame_duration)')
        # flames: rows 0,1,2,3,4,3,4,3,4,3,2,1,0 per piece (measured in the bomb lab and the
        # COM runs; 13 frames x 2 = the 26 ticks of fire)
        order = FLAME_ORDER
        for off, pc in FLAME_PIECES.items():
            seq = [entry_of(FLAME_ROWS[k] + off, p) for k in order]
            fr = []
            for i, a in enumerate(seq):
                if i + 1 < len(seq):
                    d0 = dur(a, seq[i + 1])
                else:
                    d0 = mode([l for (x, y), ls in trans.items() if x == a and
                               decode_entry(y)['tile'] not in range(288, 432) for l in ls])
                fr.append(dict(metatile=eid.get(a), duration=d0))
            anims['flame_%s_p%d' % (pc, p)] = dict(loop=False, frames=fr, then='floor')

    if stage == 10:
        rg = {m['tile']: m['entry'] for m in metas if m['kind'] == 'soft_regrow'}
        seq = [rg[t] for t in SOFT_REGROW if t in rg]
        fr = [dict(metatile=eid.get(a), duration=dur(a, b)) for a, b in zip(seq, seq[1:])]
        soft = [b for (a, b) in trans if a == seq[-1]]
        if soft:
            fr.append(dict(metatile=eid.get(seq[-1]), duration=dur(seq[-1], soft[0])))
        anims['soft_regrow'] = dict(loop=False, frames=fr, then='soft block (mushroom)',
                                    note='stage 10 only: destroyed mushrooms grow back')

    # character (VRAM) animations from the idle run
    tile_anims = []
    anim_png = None
    cc_f, cc_t, cc_d = od['cc_f'], od['cc_t'], od['cc_d']
    if len(cc_f):
        tiles = sorted(set(int(t) for t in cc_t))
        # per frame state of the animated tiles
        state = {t: vram[t * 32:t * 32 + 32].copy() for t in tiles}
        T = len(od['live'])
        hist = []
        idx = 0
        order = np.argsort(cc_f, kind='stable')
        cc_f, cc_t, cc_d = cc_f[order], cc_t[order], cc_d[order]
        for f in range(T):
            while idx < len(cc_f) and cc_f[idx] == f:
                state[int(cc_t[idx])] = cc_d[idx]
                idx += 1
            hist.append(hashlib.sha1(b''.join(state[t].tobytes() for t in tiles)).hexdigest())
            if f == 0 or hist[-1] != hist[-2]:
                pass
        # snapshots of each distinct phase
        phases = []
        seen_h = {}
        state = {t: vram[t * 32:t * 32 + 32].copy() for t in tiles}
        idx = 0
        runs = []
        for f in range(T):
            while idx < len(cc_f) and cc_f[idx] == f:
                state[int(cc_t[idx])] = cc_d[idx]
                idx += 1
            h = hist[f]
            if h not in seen_h:
                seen_h[h] = len(phases)
                phases.append({t: state[t].copy() for t in tiles})
            if runs and runs[-1][0] == seen_h[h]:
                runs[-1][1] += 1
            else:
                runs.append([seen_h[h], 1])
        # which metatiles use the animated tiles
        users = [m for m in metas if any((m['tile'] + o) in tiles for o in (0, 1, 16, 17))]
        strip = np.full((max(1, len(users)) * CELL, len(phases) * CELL), -1, np.int16)
        for pi, ph in enumerate(phases):
            v2 = vram.copy()
            for t, data in ph.items():
                v2[t * 32:t * 32 + 32] = data
            for ui, m in enumerate(users):
                img, _ = render_bg_cell(v2, ppu['bg2_char_base'], m['entry'], 4, True)
                strip[ui * CELL:(ui + 1) * CELL, pi * CELL:(pi + 1) * CELL] = img
        save_rgba(os.path.join(outdir, 'anim_tiles.png'), to_rgba(strip, cg))
        anim_png = 'anim_tiles.png'
        cyc = find_cycle([tuple(x) for x in runs]) or runs[1:-1]
        tile_anims.append(dict(
            tiles=tiles, metatiles=[m['id'] for m in users], phases=len(phases),
            atlas=anim_png, atlas_layout='row = metatile (order of "metatiles"), column = phase',
            sequence=[dict(phase=a, duration=b) for a, b in cyc[:64]],
            note='phase sequence measured over %d idle frames (first/last run trimmed)' % T))

    # palette animations (idle run)
    pal_anims = []
    cgi = od['cgram'].view('<u2')
    for ci in np.nonzero((cgi != cgi[0]).any(0))[0]:
        col = cgi[:, ci]
        runs = []
        for v in col:
            if runs and runs[-1][0] == v:
                runs[-1][1] += 1
            else:
                runs.append([int(v), 1])
        core = runs[1:-1]
        cyc = find_cycle([tuple(x) for x in runs])
        if cyc:
            core = [list(x) for x in cyc]
        pal_anims.append(dict(cgram_index=int(ci), palette=int(ci) // 16, colour=int(ci) % 16,
                              loop=bool(cyc),
                              sequence=[dict(bgr555=a, rgb='#%02x%02x%02x' % tuple(
                                  int(x) for x in ((np.array([a & 31, (a >> 5) & 31, (a >> 10) & 31]) << 3)
                                                   | (np.array([a & 31, (a >> 5) & 31, (a >> 10) & 31]) >> 2))),
                                  duration=b) for a, b in core[:32]]))

    # gimmick cells whose entry changes during the COM run (e.g. trampolines)
    gimmick_anims = {}
    for (a, b), ls in trans.items():
        ma, mb = eid.get(a), eid.get(b)
        if ma is None or mb is None:
            continue
        ka, kb = metas[ma]['kind'], metas[mb]['kind']
        if ka.startswith('gimmick') or kb.startswith('gimmick'):
            gimmick_anims['%d->%d' % (ma, mb)] = dict(from_metatile=ma, to_metatile=mb,
                                                       duration_mode=mode(ls), count=len(ls))

    bg1_live = cd['bg1_used'][live]
    manifest = dict(
        stage=stage,
        source=dict(state='derived mt4_stage%02d (4 humans, idle) for the start; com4_stage%02d '
                          '(4 COM) run of %d frames (%d live) for dynamics' % (stage, stage, len(live), int(live.sum()))),
        geometry=dict(cell=CELL, arena_cols=15, arena_rows=13,
                      arena_origin_in_bg2_px=[ARENA_X0 * CELL, ARENA_Y0 * CELL],
                      bg2_scroll=[ppu['bg2_hofs'], ppu['bg2_vofs']],
                      screen_from_bg2='screen = bg2 - (hofs, vofs + 1) = bg2 - (%d, %d)'
                                      % (ppu['bg2_hofs'], ppu['bg2_vofs'] + 1),
                      arena_cell_screen_px='cell (c, r) top-left on screen = (%d + 16c, %d + 16r)'
                                           % (ARENA_X0 * CELL - ppu['bg2_hofs'],
                                              ARENA_Y0 * CELL - ppu['bg2_vofs'] - 1)),
        files=dict(metatiles='metatiles.png', chars='chars_bg12.png', chars_bg3='chars_bg3.png',
                   palettes='palettes.json', tilemaps='tilemaps.json', arena='arena.png',
                   screen='screen.png', bg='bg1.png bg2.png bg3.png', anim_tiles=anim_png),
        metatiles=metas,
        grid_start=ids_of(arena0),
        grid_codes_start=[[int(x) for x in row] for row in start_grid],
        grid_empty=ids_of(empty0),
        view_bg2_cells=dict(note='BG2 cells x 0..16, y 0..15 at match start (covers the whole '
                                 'visible screen incl. the HUD rows and the side borders)',
                            ids=ids_of(view)),
        animations=anims,
        tile_animations=tile_anims,
        palette_animations=pal_anims,
        gimmick_transitions=gimmick_anims,
        bg1_used_during_match=int(bg1_live.max()) if len(bg1_live) else 0,
    )
    write_json(os.path.join(outdir, 'stage.json'), manifest)
    print('stage %d: %d metatiles, %d anims, %d tile anims, %d palette anims'
          % (stage, len(metas), len(anims), len(tile_anims), len(pal_anims)))
    return manifest


if __name__ == '__main__':
    stages = [int(a) for a in sys.argv[1:]] or list(range(1, NSTAGES + 1))
    for s in stages:
        extract(s)
