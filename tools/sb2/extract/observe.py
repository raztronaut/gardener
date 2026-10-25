"""Observation runs: let the game play itself and log, every frame, the arena's BG2
entries, the WRAM grid codes, CGRAM, OAM, player x/y and which BG character tiles
were rewritten.  The logs (data/sb2/assets/cache/obs_*.npz) feed stages.py
(metatile labelling + animation timing) and sprites.py.

    python3 observe.py STAGE [--frames N] [--kind com|idle]

kind=com : harness state battle_stageNN (P1 human idle + 3 COM, COM LEVEL 5); the
           COMs bomb the whole arena, collect/burn items, die, win rounds; P1 stands
           still and is killed early.  Several rounds in N frames.
kind=idle: derived state mt4_stageNN (4 humans, nobody presses anything): only the
           stage's own animations run (animated tiles, palette cycling, gimmicks).
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Snes, CACHE, state_path, mt_stage_state_name, mkdir  # noqa: E402
from capture import grid, arena_entries, player_xy  # noqa: E402

CHAR_WORDS = 0x4000     # BG1/BG2 4bpp characters: VRAM words $0000-$3FFF (1024 tiles)


def obs_path(stage, kind):
    return os.path.join(CACHE, 'obs_%s_stage%02d.npz' % (kind, stage))


def run(stage, frames, kind):
    mkdir(CACHE)
    S = Snes(multitap=(kind == 'idle'), render=False)
    name = mt_stage_state_name(stage) if kind == 'idle' else 'battle_stage%02d' % stage
    S.load_state_file(state_path(name))
    S.run(2)
    v0 = S.vram()
    start_vram = v0.copy()
    start_cgram = S.cgram()
    start_wram = S.wram()
    start_oam = S.oam()
    ent = np.zeros((frames, 13, 15), np.uint16)
    grd = np.zeros((frames, 13, 15), np.uint8)
    cg = np.zeros((frames, 512), np.uint8)
    oam = np.zeros((frames, 544), np.uint8)
    pxy = np.zeros((frames, 4, 2), np.int16)
    live = np.zeros(frames, bool)
    scroll = np.zeros((frames, 4), np.int16)    # bg1 h/v, bg2 h/v
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
                        start_wram=start_wram, start_oam=start_oam)
    print('wrote', out, 'live frames', int(live.sum()), 'char changes', len(char_changes))
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', type=int)
    ap.add_argument('--frames', type=int, default=0)
    ap.add_argument('--kind', default='com', choices=['com', 'idle'])
    a = ap.parse_args()
    n = a.frames or (24000 if a.kind == 'com' else 1200)
    run(a.stage, n, a.kind)
