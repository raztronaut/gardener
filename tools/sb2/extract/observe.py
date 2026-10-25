"""Observation runs: let the game play itself and log, every frame, the arena's BG2
entries, the WRAM grid codes, CGRAM, OAM, player x/y and which BG character tiles
were rewritten.  The logs (data/sb2/assets/cache/obs_*.npz) feed stages.py
(metatile labelling + animation timing) and sprites.py.

    python3 observe.py STAGE [--frames N] [--kind com|idle]

kind=com : derived state com4_stageNN (all 4 bombers COM, COM LEVEL 5); the COMs
           bomb the whole arena, kick/throw, collect/burn items, die, win rounds.
           Several rounds in N frames.
kind=idle: derived state mt4_stageNN (4 humans, nobody presses anything): only the
           stage's own animations run (animated tiles, palette cycling, gimmicks).
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Snes, CACHE, state_path, mt_stage_state_name, com4_stage_state_name, mkdir  # noqa: E402
from capture import grid, arena_entries, player_xy  # noqa: E402

PPU_KEYS = ['bgmode', 'bgmode_raw', 'bg1_sc_base', 'bg1_sc_size', 'bg1_char_base', 'bg1_hofs',
            'bg1_vofs', 'bg2_sc_base', 'bg2_sc_size', 'bg2_char_base', 'bg2_hofs', 'bg2_vofs',
            'bg3_sc_base', 'bg3_sc_size', 'bg3_char_base', 'bg3_hofs', 'bg3_vofs', 'obsel',
            'obj_name_base', 'obj_name_base2', 'obj_size_select', 'tm', 'ts', 'cgwsel', 'cgadsub']
CHAR_WORDS = 0x4000     # BG1/BG2 4bpp characters: VRAM words $0000-$3FFF (1024 tiles)


def obs_path(stage, kind):
    return os.path.join(CACHE, 'obs_%s_stage%02d.npz' % (kind, stage))


def run(stage, frames, kind):
    mkdir(CACHE)
    S = Snes(multitap=(kind == 'idle'), render=(kind == 'idle'))
    name = mt_stage_state_name(stage) if kind == 'idle' else com4_stage_state_name(stage)
    S.load_state_file(state_path(name))
    S.run(2)
    v0 = S.vram()
    start_vram = v0.copy()
    start_cgram = S.cgram()
    start_wram = S.wram()
    start_oam = S.oam()
    start_frame = S.frame()
    start_ppu = np.array([S.ppu()[k] for k in PPU_KEYS], np.int32)
    ent = np.zeros((frames, 13, 15), np.uint16)
    grd = np.zeros((frames, 13, 15), np.uint8)
    cg = np.zeros((frames, 512), np.uint8)
    oam = np.zeros((frames, 544), np.uint8)
    pxy = np.zeros((frames, 4, 2), np.int16)
    live = np.zeros(frames, bool)
    scroll = np.zeros((frames, 4), np.int16)    # bg1 h/v, bg2 h/v
    bg1_used = np.zeros(frames, np.int16)       # non-zero BG1 tilemap entries
    char_changes = []       # (frame, tile, 32 bytes)
    prev_chars = v0[:CHAR_WORDS * 2].copy()
    for f in range(frames):
        S.step(0)
        v = S.vram(live=True)
        w = S.wram(live=True)
        p = S.ppu()
        ent[f] = arena_entries(v)
        grd[f] = grid(w)
        cg[f] = S.cgram(live=True)
        oam[f] = S.oam(live=True)
        for i in range(4):
            pxy[f, i] = player_xy(w, i)
        live[f] = (p['brightness'] == 15 and not p['forced_blank'] and p['bg2_sc_base'] == 0x4000
                   and p['bgmode'] == 1)
        scroll[f] = (p['bg1_hofs'], p['bg1_vofs'], p['bg2_hofs'], p['bg2_vofs'])
        bg1_used[f] = int(np.count_nonzero(v.view('<u2')[0x5800:0x5C00]))
        chars = v[:CHAR_WORDS * 2]
        if live[f]:
            diff = np.nonzero(chars != prev_chars)[0]
            if len(diff):
                for t in np.unique(diff // 32):
                    char_changes.append((f, int(t), chars[t * 32:t * 32 + 32].copy()))
        prev_chars = chars.copy()
    cc_f = np.array([c[0] for c in char_changes], np.int32)
    cc_t = np.array([c[1] for c in char_changes], np.int32)
    cc_d = np.array([c[2] for c in char_changes], np.uint8).reshape(-1, 32)
    out = obs_path(stage, kind)
    np.savez_compressed(out, ent=ent, grid=grd, cgram=cg, oam=oam, pxy=pxy, live=live,
                        scroll=scroll, cc_f=cc_f, cc_t=cc_t, cc_d=cc_d,
                        start_vram=start_vram, start_cgram=start_cgram,
                        start_wram=start_wram, start_oam=start_oam, start_frame=start_frame,
                        start_ppu=start_ppu, bg1_used=bg1_used)
    print('wrote', out, 'live frames', int(live.sum()), 'char changes', len(char_changes))
    return out


def run_bombs(stage=1):
    """Bomb lab: for each bomb type (normal + the 4 bomb items) P1 picks the item up,
    drops a bomb and walks away; B detonates remote bombs at the end.  Logged like a
    COM run (ent/grid/live) so stages.py can pool the tile timings."""
    from sprites import lab_state, pads_from, script
    from capture import spawn_item
    S = Snes(multitap=True, render=False)
    base = lab_state(S)
    ents, grids, lives = [], [], []
    for item in (None, 0x160E, 0x1604, 0x1628, 0x162A):    # -, remote, pierce, rubber, power
        S.load_state(base)
        if item:
            spawn_item(S, 2, 1, item)
        pads = pads_from({0: script([('-', 2), ('RIGHT', 28), ('-', 6), ('A', 1), ('RIGHT', 40),
                                     ('DOWN', 30), ('-', 260), ('B', 2), ('-', 120)])}, 489)
        for p in pads:
            S.step(p)
            ents.append(arena_entries(S.vram(live=True)))
            grids.append(grid(S.wram(live=True)))
            lives.append(True)
        for _ in range(2):          # separator
            ents.append(ents[-1])
            grids.append(grids[-1])
            lives.append(False)
    out = obs_path(stage, 'bombs')
    np.savez_compressed(out, ent=np.array(ents, np.uint16), grid=np.array(grids, np.uint8),
                        live=np.array(lives, bool))
    print('wrote', out)
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', type=int)
    ap.add_argument('--frames', type=int, default=0)
    ap.add_argument('--kind', default='com', choices=['com', 'idle', 'bombs'])
    a = ap.parse_args()
    if a.kind == 'bombs':
        run_bombs(a.stage)
        sys.exit(0)
    n = a.frames or (24000 if a.kind == 'com' else 1200)
    run(a.stage, n, a.kind)
