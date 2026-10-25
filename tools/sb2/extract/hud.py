"""HUD + between-round screens.

    python3 hud.py

HUD (battle top bar = BG3, 2bpp, map $5C00, chars $5000, rows 0-2 of the tilemap):
  hud/hud_start.png       the bar at match start, 256x24 RGBA (BG3 rows 0-2)
  hud/hud_chars.png       every BG3 character used by the bar, in its palette (atlas)
  hud/glyphs.png          digit glyphs 0-9 + ':' as drawn in the timer/win counters
  hud/hud.json            tilemap rows, cell roles, glyph -> tile entries, face states,
                          timer cadence (frames per displayed second), palettes
Screens (hud/screens/): every distinct screen the game shows between rounds in a
4-human stage-1 match where white wins three rounds (scoreboard with trophies, match
winner), a draw (all four die at once) and the time-up/sudden-death run:
  screens/<name>_NNNN.png  key frames (full 256x224 emulator frames)
  screens/<name>_NNNN_bg{1,2,3}.png  their BG layers decoded from VRAM (RGBA)
  screens.json            sequence, frame numbers, durations, PPU registers per key frame
"""
import collections
import hashlib
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Snes, B, ASSETS, state_path, write_json, save_rgba, mkdir  # noqa: E402
from snesgfx import (to_rgba, render_bg_cell, decode_entry, cgram_hex, tilemap_entries,  # noqa: E402
                     render_bg, decode_oam)

OUT = os.path.join(ASSETS, 'hud')
HUD_ROWS = 3
# cell roles in BG3 row 1 (measured: these cells change with the timer / wins / deaths)
FACE_COLS = {'white': (3, 4), 'black': (8, 9), 'red': (19, 20), 'blue': (24, 25)}
WIN_COL = {'white': 6, 'black': 11, 'red': 22, 'blue': 27}
TIMER_COLS = {'minutes': 14, 'colon': 15, 'tens': 16, 'ones': 17}


def bg3_map(S):
    return S.vram().view('<u2')[0x5C00:0x6000].reshape(32, 32).copy()


def render_cells(vram, cg, char_base, entries):
    """2bpp 8x8 cells (H, W entries) -> cgram-index image."""
    H, W = entries.shape
    out = np.full((H * 8, W * 8), -1, np.int16)
    for y in range(H):
        for x in range(W):
            img, _ = render_bg_cell(vram, char_base, int(entries[y, x]), 2, False)
            out[y * 8:y * 8 + 8, x * 8:x * 8 + 8] = img
    return out


def screens_capture(S, base, name, pads, out, every=0):
    """Run pads; save a key frame whenever the BG tilemaps/registers change (and every
    `every` frames if >0) while the screen is not black.  Returns [key frame dicts]."""
    keys = []
    last = None
    for f, p in enumerate(pads):
        S.step(p)
        ppu = S.ppu()
        if ppu['brightness'] == 0 or ppu['forced_blank']:
            last = None
            continue
        if ppu['bgmode'] == 1 and ppu['bg2_sc_base'] == 0x4000 and ppu['bg3_sc_base'] == 0x5C00:
            last = 'arena'          # the battle itself is covered by stages.py
            continue
        v = S.vram()
        sig = hashlib.sha1(v[0x4000 * 2:0x6000 * 2].tobytes() +
                           str([ppu[k] for k in ('bgmode', 'bg1_sc_base', 'bg2_sc_base', 'bg3_sc_base',
                                                 'bg1_char_base', 'bg2_char_base', 'tm')]).encode()).hexdigest()
        if sig != last or (every and f % every == 0):
            fn = '%s_%04d' % (name, f)
            S.png(os.path.join(out, fn + '.png'))
            cg = S.cgram()
            for L in (1, 2, 3):
                if ppu['tm'] & (1 << (L - 1)):
                    try:
                        cimg, _, _ = render_bg(v, ppu, L)
                        save_rgba(os.path.join(out, '%s_bg%d.png' % (fn, L)), to_rgba(cimg, cg))
                    except KeyError:
                        pass
            keys.append(dict(file=fn + '.png', frame=f, brightness=ppu['brightness'],
                             changed_bg=sig != last,
                             ppu={k: ppu[k] for k in ('bgmode', 'bgmode_raw', 'bg1_sc_base', 'bg2_sc_base',
                                                      'bg3_sc_base', 'bg1_char_base', 'bg2_char_base',
                                                      'bg3_char_base', 'bg1_hofs', 'bg1_vofs', 'bg2_hofs',
                                                      'bg2_vofs', 'bg3_hofs', 'bg3_vofs', 'tm', 'ts',
                                                      'obj_name_base')}))
            last = sig
    return keys


def main():
    mkdir(OUT)
    sdir = mkdir(OUT, 'screens')
    S = Snes(multitap=True)
    S.load_state_file(state_path('mt4_stage01'))
    S.run(2)
    base = S.save_state()
    ppu = S.ppu()
    v = S.vram()
    cg = S.cgram()
    cb = ppu['bg3_char_base']
    m0 = bg3_map(S)
    hud_entries = m0[:HUD_ROWS]
    strip = render_cells(v, cg, cb, hud_entries)
    save_rgba(os.path.join(OUT, 'hud_start.png'), to_rgba(strip, cg))

    # ---- full idle match: timer from 2:00 to 0:00, sudden death, deaths --------------
    hist = []
    for f in range(7600):
        S.step(0)
        hist.append(bg3_map(S)[:HUD_ROWS])
    hist = np.stack(hist)
    vfin = S.vram()
    # second run for the faces: all four drop a bomb and stay -> every face turns 'dead'
    S.load_state(base)
    hist_faces = []
    for f in range(400):
        S.step((B.A,) * 4 + (0,) if 10 <= f < 12 else 0)
        hist_faces.append(bg3_map(S)[:HUD_ROWS])
    hist_faces = np.concatenate([hist, np.stack(hist_faces)])

    # timer: seconds counter states in order of appearance
    tc = [TIMER_COLS[k] for k in ('minutes', 'tens', 'ones')]
    seq = []
    for f in range(len(hist)):
        key = tuple(int(hist[f, r, c]) for c in tc for r in (1, 2))
        if seq and key[0::2] == seq[-1][0][0::2]:     # only the top row decides
            seq[-1][2] += 1
            continue
        if not seq or seq[-1][0] != key:
            seq.append([key, f, 1])
        else:
            seq[-1][2] += 1
    # expected: 2:00, 1:59, ... 0:00 -> map glyph cells to digits
    glyph = {}
    t = 120
    conflicts = 0
    durations = []
    for key, f, n in seq:
        if t < 0 or (n > 90 and t < 120):    # timer stopped (round over) -> stop mapping
            break
        mm, ss = divmod(t, 60)
        digits = (mm, ss // 10, ss % 10)
        for k, d in enumerate(digits):
            g = (key[2 * k], key[2 * k + 1])
            if glyph.setdefault(d, g) != g:
                conflicts += 1
        durations.append(n)
        t -= 1
    colon = (int(m0[1, TIMER_COLS['colon']]), int(m0[2, TIMER_COLS['colon']]))
    # glyph atlas: digits 0-9 then ':'
    gl = np.full((16, 11 * 8), -1, np.int16)
    for d in range(10):
        if d in glyph:
            ent = np.array([[glyph[d][0]], [glyph[d][1]]], np.uint16)
            gl[:, d * 8:d * 8 + 8] = render_cells(v, cg, cb, ent)
    gl[:, 80:88] = render_cells(v, cg, cb, np.array([[colon[0]], [colon[1]]], np.uint16))
    save_rgba(os.path.join(OUT, 'glyphs.png'), to_rgba(gl, cg))

    # faces: distinct states of each face block over the run
    faces = {}
    face_png = []
    for name, (c0, c1) in FACE_COLS.items():
        states = collections.OrderedDict()
        for f in range(len(hist_faces)):
            k = tuple(int(x) for x in hist_faces[f, :, c0:c1 + 1].ravel())
            states.setdefault(k, f)
        lst = []
        for k, f in states.items():
            ent = np.array(k, np.uint16).reshape(HUD_ROWS, 2)
            lst.append(dict(first_frame=f if f < len(hist) else 'run2+%d' % (f - len(hist)),
                            entries=[[int(x) for x in row] for row in ent]))
            face_png.append(render_cells(v, cg, cb, ent))
        faces[name] = lst
    if face_png:
        fa = np.concatenate([np.pad(x, ((0, 0), (0, 2)), constant_values=-1) for x in face_png], 1)
        save_rgba(os.path.join(OUT, 'faces.png'), to_rgba(fa, cg))

    # every BG3 char used in the HUD (start + run), each in the palette it was used with
    used = sorted(set(int(x) for x in np.unique(hist_faces)) | set(int(x) for x in np.unique(hud_entries)))
    used = [e for e in used if e & 0x3ff]
    ca = np.full((((len(used) + 15) // 16) * 8, 16 * 8), -1, np.int16)
    chars = []
    for k, e in enumerate(used):
        img, _ = render_bg_cell(v, cb, e & ~0xC000, 2, False)
        x, y = (k % 16) * 8, (k // 16) * 8
        ca[y:y + 8, x:x + 8] = img
        d = decode_entry(e)
        chars.append(dict(entry=e, tile=d['tile'], pal=d['pal'], prio=d['prio'], rect=[x, y, 8, 8]))
    save_rgba(os.path.join(OUT, 'hud_chars.png'), to_rgba(ca, cg))
    # HUD frames at a few moments (start, sudden death, end)
    for f in (0, 3000, 5000, 7000, 7599):
        save_rgba(os.path.join(OUT, 'hud_f%04d.png' % f), to_rgba(render_cells(vfin, cg, cb, hist[f]), cg))

    hexes = cgram_hex(cg)
    hud = dict(
        note='BG3 2bpp 8x8 cells; entries are raw tilemap words (tile | pal<<10 | prio<<13 | '
             'hflip<<14 | vflip<<15). BG3 palette p = cgram[4p:4p+4]. Screen row y shows '
             'BG3 row y + vofs + 1 (vofs %d).' % ppu['bg3_vofs'],
        bg3=dict(sc_base=ppu['bg3_sc_base'], char_base=cb, hofs=ppu['bg3_hofs'], vofs=ppu['bg3_vofs']),
        rows=[[int(x) for x in row] for row in hud_entries],
        cells=dict(faces=FACE_COLS, wins=WIN_COL, timer=TIMER_COLS,
                   note='column numbers in BG3 rows 0-2; win digit and timer digits are '
                        '8x16 glyphs = row 1 (top) + row 2 (bottom)'),
        glyphs={str(d): dict(top=glyph[d][0], bottom=glyph[d][1], rect=[d * 8, 0, 8, 16])
                for d in sorted(glyph)},
        colon=dict(top=colon[0], bottom=colon[1], rect=[80, 0, 8, 16]),
        glyph_conflicts=conflicts,
        timer_frames_per_second=dict(values=collections.Counter(durations[1:-1]).most_common(4),
                                     note='frames each displayed timer value stayed on screen '
                                          '(4 idle humans, no lag)'),
        faces=faces,
        chars=chars,
        palettes_bg3=[hexes[4 * p:4 * p + 4] for p in range(8)],
        files=dict(start='hud_start.png', glyphs='glyphs.png', faces='faces.png', chars='hud_chars.png'),
    )
    write_json(os.path.join(OUT, 'hud.json'), hud)
    print('hud: glyphs', sorted(glyph), 'conflicts', conflicts, 'faces',
          {k: len(v_) for k, v_ in faces.items()})

    # ---- screens --------------------------------------------------------------------
    allkeys = {}
    # white wins 3 rounds: each round the others blow themselves up
    S.load_state(base)
    seqk = []
    for rnd in range(3):
        pads = [(0, B.A, B.A, B.A, 0)] * 3 + [(0, 0, 0, 0, 0)] * 1300
        seqk += [dict(k, round=rnd + 1) for k in screens_capture(S, base, 'win%d' % (rnd + 1), pads, sdir, every=60)]
        # wait for the next round to be live if needed
        for _ in range(600):
            p = S.ppu()
            if p['brightness'] == 15 and p['bg2_sc_base'] == 0x4000 and not p['forced_blank']:
                break
            S.step(0)
    allkeys['white_wins_match'] = seqk
    # extra: what follows the match (results / back to menu)
    allkeys['after_match'] = screens_capture(S, base, 'after', [0] * 1500, sdir, every=90)
    # draw: everybody dies at once
    S.load_state(base)
    allkeys['draw'] = screens_capture(S, base, 'draw', [(B.A,) * 4 + (0,)] * 3 + [0] * 1300, sdir, every=60)
    write_json(os.path.join(OUT, 'screens.json'), dict(
        note='Key frames: saved when the BG tilemaps/registers change (changed_bg) and every '
             '60/90 frames. Frame numbers are relative to the start of each sequence.',
        sequences=allkeys))
    print('screens:', {k: len(v_) for k, v_ in allkeys.items()})


if __name__ == '__main__':
    main()
