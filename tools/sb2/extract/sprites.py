"""Sprite extraction: the 4 bombers (all poses, with animation timing + anchors) and every
other sprite piece (bombs in flight, item scatter puffs, "Hurry!", falling blocks, ...).

    python3 sprites.py            # labs + COM runs -> data/sb2/assets/sprites/

Labs (stage 1, 4 humans via the multitap, soft blocks removed with grid+tilemap pokes so
the bombers can walk the outer corridor):
  walk      every bomber walks the outer ring clockwise (4 directions, 160 f each, 40 f
            idle between) -> walk cycles + idle facings
  death     all four drop a bomb and stand still -> death animation (x4, a draw)
  win_<c>   the other three blow themselves up; <c> stands -> round-win pose
  kick      kick item spawned in front of every bomber, bomb placed, walked into
  glove     glove item, bomb placed, A pressed again on it (lift), carried, thrown
  scatter   items collected then death -> items fly out (puffs)
COM runs (com4 states, 4 COM players) on stages 1, 5, 9 add every pose the AI produces
(carry/throw/kick/stun/...) and the sudden-death "Hurry!" + falling blocks.

Outputs (data/sb2/assets/sprites/):
  bombers_<colour>.png   same layout for white/black/red/blue (OBJ palettes 0..3)
  fx.png                 every non-bomber OAM piece, in the palette it was seen with
  sprites.json           shapes, anchors, OAM pieces, animations, fx events
"""
import collections
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (Snes, B, ASSETS, state_path, mt_stage_state_name, com4_stage_state_name,  # noqa: E402
                    write_json, save_rgba, mkdir, COLOURS)
from snesgfx import to_rgba, cgram_hex  # noqa: E402
from capture import GRID_BASE, GRID_STRIDE, BG2_MAP, set_cell, spawn_item, player_xy  # noqa: E402
from sprites_lib import Library, capture_frame, segments, find_cycle  # noqa: E402

OUT = os.path.join(ASSETS, 'sprites')
KICK, GLOVE, BOMB_UP, FIRE_UP, SKATE = 0x1624, 0x1626, 0x1600, 0x1602, 0x1622

# clockwise ring from each corner: P1 TL, P2 BR, P3 TR, P4 BL
RING = {0: ['RIGHT', 'DOWN', 'LEFT', 'UP'], 1: ['LEFT', 'UP', 'RIGHT', 'DOWN'],
        2: ['DOWN', 'LEFT', 'UP', 'RIGHT'], 3: ['UP', 'RIGHT', 'DOWN', 'LEFT']}
START_CELL = {0: (1, 1), 1: (13, 11), 2: (13, 1), 3: (1, 11)}
STEP = {'RIGHT': (1, 0), 'LEFT': (-1, 0), 'DOWN': (0, 1), 'UP': (0, -1)}


def clear_soft(S):
    """Replace every soft block by the floor the game keeps in BG2's lower screen copy."""
    w = S.wram()
    v = S.vram().view('<u2')
    for r in range(13):
        for c in range(15):
            if w[GRID_BASE + r * GRID_STRIDE + (c + 1) * 2] == 0xC2:
                set_cell(S, c, r, 0, int(v[BG2_MAP + 0x800 + (r + 3) * 32 + c + 1]))


def lab_state(S):
    S.load_state_file(state_path(mt_stage_state_name(1)))
    S.run(2)
    clear_soft(S)
    S.run(1)
    return S.save_state()


def pads_from(per_player, n):
    """per_player: {i: [mask per frame]} -> list of 5-tuples (multitap)."""
    out = []
    for f in range(n):
        out.append(tuple(per_player.get(i, [0] * n)[f] if f < len(per_player.get(i, [])) else 0
                         for i in range(4)) + (0,))
    return out


def script(parts):
    """[('RIGHT', 10), ('-', 5), ('A', 1)] -> per-frame masks."""
    out = []
    for b, n in parts:
        out += [B.parse(b)] * n
    return out


class Recorder:
    def __init__(self, S, lib):
        self.S = S
        self.lib = lib

    def run(self, pads, tag, live_only=True):
        """Step through pads; per frame: bombers {i: (shape, anchor, pos, xy)} and fx list."""
        S = self.S
        prevw = S.wram()
        log = []
        for f, p in enumerate(pads):
            S.step(p)
            ppu = S.ppu()
            ok = ppu['brightness'] > 0 and not ppu['forced_blank']
            if live_only and not (ok and ppu['bg2_sc_base'] == 0x4000):
                log.append(None)
                prevw = S.wram()
                continue
            if ppu['bg2_sc_base'] != 0x4000:
                r = capture_screen(self.lib, S.vram(live=True), ppu, S.oam(), tag)
                r['frame'] = f
                r['sig'] = (ppu['bgmode'], ppu['bg1_sc_base'], ppu['bg2_sc_base'], ppu['bg3_sc_base'],
                            ppu['bg1_char_base'], ppu['bg2_char_base'])
                log.append(r)
                prevw = S.wram()
                continue
            r = capture_frame(self.lib, S.vram(live=True), ppu, S.oam(), prevw, tag=tag)
            for i in r['bombers']:
                r['bombers'][i] = r['bombers'][i] + (player_xy(prevw, i),)
            r['frame'] = f
            log.append(r)
            prevw = S.wram()
        return log


def capture_screen(lib, vram, ppu, oam, tag):
    """Between-round screens (scoreboard, DRAW, VICTORY, roulette): the OAM entries of
    each bomber palette 0-3 are clustered by proximity; the largest cluster of at most
    48x56 px with >= 120 opaque pixels is that bomber (the scoreboard also draws a
    palette-4 copy behind the wall as a shadow -- that one stays an fx piece);
    everything else (trophies, letters, confetti...) becomes individual fx pieces."""
    from snesgfx import decode_oam
    from sprites_lib import onscreen, render_group, cluster
    spr = [s for s in decode_oam(oam) if onscreen(s, ppu)]
    res = {'bombers': {}, 'fx': [], 'screen': True}
    best = {}
    for i in range(4):
        for g in cluster([s for s in spr if s['pal'] == i], ppu, gap=1):
            img, pos, pieces = render_group(vram, ppu, g)
            if img is None or img.shape[1] > 48 or img.shape[0] > 56:
                continue
            n = int((img >= 0).sum())
            if n >= 120 and (i not in best or n > best[i][0]):
                best[i] = (n, g, img, pos, pieces)
    used = set()
    for i, (n, g, img, pos, pieces) in best.items():
        used |= set(s['i'] for s in g)
        fid = lib.add(img, pieces, 'screen_bomber', i, extra=dict(tag=tag, pos=pos))
        res['bombers'][i] = (fid, (0, 0), pos, (0, 0))
    rest = [s for s in spr if s['i'] not in used]
    if rest:
        r = capture_frame(lib, vram, ppu, oam, np.zeros(0x20000, np.uint8), colours=[], tag=tag)
        res['fx'] = [p for p in r['fx'] if p[5] not in used]
    return res


def bomber_track(log, i):
    return [(r['bombers'][i][0], r['bombers'][i][1]) if r and i in r['bombers'] else (None, None)
            for r in log]


def anim_from(track, lo, hi, loop):
    """Animation frames from track[lo:hi]: [{shape, duration, anchor}] (cycle if loop)."""
    ids = [t[0] for t in track[lo:hi]]
    anc = {}
    for t in track[lo:hi]:
        if t[0] is not None and t[1] is not None:
            anc.setdefault(t[0], collections.Counter())[tuple(t[1])] += 1
    segs = segments(ids)
    if loop:
        cyc = find_cycle(segs)
        if cyc:
            segs = cyc
        else:
            segs = segs[1:-1] or segs
    return [dict(shape=a, duration=b, anchor=list(anc[a].most_common(1)[0][0]) if a in anc else None)
            for a, b in segs if a is not None]


def lab_walk(S, base, rec):
    S.load_state(base)
    per = {}
    for i in range(4):
        parts = [('-', 20)]
        for d in RING[i]:
            parts += [(d, 160), ('-', 40)]
        per[i] = script(parts)
    n = len(per[0])
    log = rec.run(pads_from(per, n), 'walk')
    anims = {}
    for i in range(4):
        tr = bomber_track(log, i)
        anims.setdefault(i, {})['idle_down_start'] = anim_from(tr, 0, 20, False)
        t0 = 20
        for d in RING[i]:
            anims[i]['walk_' + d.lower()] = anim_from(tr, t0 + 4, t0 + 156, True)
            anims[i]['idle_' + d.lower()] = anim_from(tr, t0 + 170, t0 + 200, False)[-1:]
            t0 += 200
    return anims


def screen_anims(log, names):
    """Per contiguous run of between-round screen frames with the same PPU signature:
    per colour looping animation.  names: list of names for the runs, in order (runs
    shorter than 30 frames are ignored)."""
    runs = []
    for k, r in enumerate(log):
        if r and r.get('screen'):
            if runs and runs[-1][0] == r['sig'] and runs[-1][2] == k - 1:
                runs[-1][2] = k
            else:
                runs.append([r['sig'], k, k])
    runs = [x for x in runs if x[2] - x[1] >= 30]
    out = {i: {} for i in range(4)}
    for (sig, lo, hi), name in zip(runs, names):
        for i in range(4):
            tr = [(log[k]['bombers'][i][0], None) if log[k] and log[k].get('screen') and i in log[k]['bombers']
                  else (None, None) for k in range(len(log))]
            fr = anim_from(tr, lo, hi + 1, True)
            if fr:
                out[i][name] = fr
    return out, runs


def lab_death(S, base, rec):
    S.load_state(base)
    per = {i: script([('-', 3), ('A', 2), ('-', 1300)]) for i in range(4)}
    log = rec.run(pads_from(per, len(per[0])), 'death', live_only=False)
    anims = {}
    for i in range(4):
        tr = bomber_track(log, i)
        ids = [t[0] for t in tr]
        # the bomb explodes ~150 frames later; the death starts at the first new shape after f60
        stand = ids[10]
        start = next((f for f in range(60, len(ids)) if ids[f] != stand), None)
        end = max((f for f in range(len(ids)) if ids[f] is not None), default=None)
        anims[i] = {'death': anim_from(tr, start, end + 1, False) if start else []}
    sa, _ = screen_anims(log, ['draw_screen'])
    for i in range(4):
        anims[i].update(sa[i])
    return anims, log


def lab_match(S, base, rec):
    """White wins three rounds -> scoreboard x3 -> VICTORY!! screen (-> roulette)."""
    S.load_state(base)
    logs = []
    for rnd in range(3):
        logs += rec.run([(0, B.A, B.A, B.A, 0)] * 3 + [0] * 1000, 'match_r%d' % (rnd + 1), live_only=False)
        for _ in range(600):
            p = S.ppu()
            if p['brightness'] == 15 and p['bg2_sc_base'] == 0x4000 and not p['forced_blank']:
                break
            S.step(0)
            logs.append(None)
    logs += rec.run([0] * 1600, 'match_end', live_only=False)
    sa, runs = screen_anims(logs, ['scoreboard_round1', 'scoreboard_round2', 'scoreboard_round3',
                                   'victory_screen', 'after_victory_1', 'after_victory_2'])
    return sa, logs


def lab_win(S, base, rec, winner):
    S.load_state(base)
    per = {i: script([('-', 3), ('A', 2), ('-', 900)]) for i in range(4) if i != winner}
    per[winner] = script([('-', 905)])
    log = rec.run(pads_from(per, 905), 'win_%s' % COLOURS[winner], live_only=False)
    sa, _ = screen_anims(log, ['scoreboard'])
    out = {}
    for i in range(4):
        if 'scoreboard' in sa[i]:
            out[i] = {('scoreboard_winner' if i == winner else 'scoreboard_loser'): sa[i]['scoreboard']}
    return out, log


def ahead(i, k):
    c, r = START_CELL[i]
    dx, dy = STEP[RING[i][0]]
    return c + dx * k, r + dy * k


def lab_kick(S, base, rec):
    S.load_state(base)
    for i in range(4):
        spawn_item(S, *ahead(i, 1), KICK)
    per = {}
    for i in range(4):
        fwd, back = RING[i][0], {'RIGHT': 'LEFT', 'LEFT': 'RIGHT', 'UP': 'DOWN', 'DOWN': 'UP'}[RING[i][0]]
        per[i] = script([('-', 2), (fwd, 28), ('-', 6), ('A', 1), ('-', 2), (fwd, 30), ('-', 8),
                         (back, 40), ('-', 200)])
    log = rec.run(pads_from(per, len(per[0])), 'kick')
    anims = {}
    for i in range(4):
        tr = bomber_track(log, i)
        lo = 2 + 28 + 6 + 1 + 2 + 30 + 8
        anims[i] = {'kick_sequence': anim_from(tr, lo, lo + 48, False)}
    return anims, log


def lab_glove(S, base, rec):
    S.load_state(base)
    for i in range(4):
        spawn_item(S, *ahead(i, 1), GLOVE)
    per = {}
    for i in range(4):
        fwd = RING[i][0]
        side = RING[i][1]
        per[i] = script([('-', 2), (fwd, 28), ('-', 6), ('A', 1), ('-', 6), ('A', 30),
                         (side + '+A', 30), ('-', 160)])
    log = rec.run(pads_from(per, len(per[0])), 'glove')
    anims = {}
    for i in range(4):
        tr = bomber_track(log, i)
        lo = 2 + 28 + 6 + 1 + 6
        anims[i] = {'glove_lift_carry': anim_from(tr, lo, lo + 30, False),
                    'glove_walk_carry_' + RING[i][1].lower(): anim_from(tr, lo + 30, lo + 60, False),
                    'glove_throw': anim_from(tr, lo + 60, lo + 90, False)}
    return anims, log


def lab_scatter(S, base, rec):
    """Collect bomb-up / fire-up / skate, then die: the collected items fly out."""
    S.load_state(base)
    i = 0
    for k, it in enumerate((BOMB_UP, FIRE_UP, SKATE)):
        spawn_item(S, 2 + k, 1, it)
    per = {0: script([('-', 2), ('RIGHT', 44), ('-', 4), ('A', 2), ('-', 400)])}
    log = rec.run(pads_from(per, len(per[0])), 'scatter')
    return log


def com_run(stage, frames, lib, keep_events):
    S = Snes()
    S.load_state_file(state_path(com4_stage_state_name(stage)))
    S.run(2)
    rec = Recorder(S, lib)
    log = rec.run([0] * frames, 'com_stage%02d' % stage)
    return log


def fx_events(log, name, min_pal=0):
    """Compress a log's fx into per-frame piece lists (only frames with pieces; with
    min_pal, only frames having a piece of OBJ palette >= min_pal)."""
    ev = []
    for r in log:
        if r and r['fx'] and any(p[3] >= min_pal for p in r['fx']):
            ev.append(dict(frame=r['frame'], pieces=[dict(piece=p[0], x=int(p[1]), y=int(p[2]),
                                                          pal=int(p[3]), prio=int(p[4]))
                                                     for p in r['fx']]))
    return dict(name=name, frames=ev)


def pack(frames, cols=16):
    """Fixed grid cells big enough for the largest frame."""
    if not frames:
        return 0, 0, {}
    cw = max(f['img'].shape[1] for f in frames)
    ch = max(f['img'].shape[0] for f in frames)
    rects = {}
    for k, f in enumerate(frames):
        h, w = f['img'].shape
        rects[f['id']] = [(k % cols) * cw, (k // cols) * ch, w, h]
    rows = (len(frames) + cols - 1) // cols
    return cols * cw, rows * ch, rects


def main():
    mkdir(OUT)
    lib = Library()
    S = Snes(multitap=True)
    base = lab_state(S)
    cg = S.cgram()
    rec = Recorder(S, lib)
    anims = {i: {} for i in range(4)}
    events = []
    for i, a in lab_walk(S, base, rec).items():
        anims[i].update(a)
    print('walk done', len(lib.frames))
    a, log = lab_death(S, base, rec)
    for i in a:
        anims[i].update(a[i])
    events.append(fx_events(log, 'lab_death_all_four'))
    for w in range(4):
        a, log = lab_win(S, base, rec, w)
        for i in a:
            if i == w or 'scoreboard_loser' not in anims[i]:
                anims[i].update(a[i])
        if w == 0:
            events.append(fx_events(log, 'lab_round_win_white'))
    a, log = lab_match(S, base, rec)
    for i in a:
        for k, v in a[i].items():
            anims[i]['white_wins_' + k] = v
    events.append(fx_events(log, 'lab_match_white_wins_3'))
    print('death/win done', len(lib.frames))
    a, log = lab_kick(S, base, rec)
    for i in a:
        anims[i].update(a[i])
    events.append(fx_events(log, 'lab_kick'))
    a, log = lab_glove(S, base, rec)
    for i in a:
        anims[i].update(a[i])
    events.append(fx_events(log, 'lab_glove'))
    events.append(fx_events(lab_scatter(S, base, rec), 'lab_item_scatter'))
    print('labs done', len(lib.frames))
    lab_shapes = set(f['id'] for f in lib.frames if f['category'] == 'bomber')
    # COM runs need a non-multitap core -> subprocess-free trick: same process can't
    # create a second Snes, so load com4 states into this multitap core (pads unused).
    com_logs = {}
    for st, n in ((1, 14000), (5, 9000), (9, 9000)):
        S.load_state_file(state_path(com4_stage_state_name(st)))
        S.run(2)
        com_logs[st] = Recorder(S, lib).run([0] * n, 'com_stage%02d' % st)
        print('com', st, len(lib.frames))
    # sudden death / hurry banner: the part of the stage-1 COM log with "Hurry!" pieces
    events.append(fx_events(com_logs[1], 'com_stage01_special_fx', min_pal=4))

    # ---- shapes / atlases -----------------------------------------------------------
    bombers = [f for f in lib.frames if f['category'] in ('bomber', 'screen_bomber')]
    fxs = [f for f in lib.frames if f['category'] == 'fx']
    W, H, rects = pack(bombers)
    for ci, cname in enumerate(COLOURS):
        atlas = np.full((H, W), -1, np.int16)
        for f in bombers:
            x, y, w, h = rects[f['id']]
            img = f['img']
            img = np.where(img < 0, -1, (img % 16) + 128 + 16 * ci)
            atlas[y:y + h, x:x + w] = img
        save_rgba(os.path.join(OUT, 'bombers_%s.png' % cname), to_rgba(atlas, cg))
    # fx pieces: own palette as first seen
    fw, fh, frects = pack(fxs, cols=24)
    fatlas = np.full((max(fh, 1), max(fw, 1)), -1, np.int16)
    for f in fxs:
        x, y, w, h = frects[f['id']]
        fatlas[y:y + h, x:x + w] = f['img']
    save_rgba(os.path.join(OUT, 'fx.png'), to_rgba(fatlas, cg))

    # usage counts per shape and source
    src = collections.defaultdict(collections.Counter)
    for f in lib.frames:
        src[f['id']][f.get('tag')] += f['count']

    def anc_mode(fid):
        return list(lib.frames[fid].get('anchor', (0, 0)))

    named = collections.defaultdict(list)
    for i in anims:
        for name, fr in anims[i].items():
            for x in fr:
                named[x['shape']].append(name)
    shapes = []
    for f in bombers:
        shapes.append(dict(
            id=f['id'], category=f['category'], rect=rects[f['id']], w=int(f['img'].shape[1]), h=int(f['img'].shape[0]),
            anchor=anc_mode(f['id']), colours_seen=sorted(COLOURS[c] for c in f['colours']),
            used_in=sorted(set(named.get(f['id'], []))),
            from_lab=f['id'] in lab_shapes, first_seen=f.get('tag'), count=f['count'],
            pieces=f['pieces']))
    fx_list = [dict(id=f['id'], rect=frects[f['id']], w=f['w'], h=f['h'],
                    palettes_seen=sorted(int(p) for p in f['palettes']),
                    first_seen=f.get('tag'), count=f['count'], oam=f['pieces'][0])
               for f in fxs]
    # identical-across-colours check for the labelled animations
    same = {}
    for name in anims[0]:
        seqs = [[(x['shape'], x['duration']) for x in anims[i].get(name, [])] for i in range(4)]
        same[name] = all(s == seqs[0] for s in seqs)
    # compress the COM event log: only frames with pieces other than bombs-in-flight noise
    write_json(os.path.join(OUT, 'sprites.json'), dict(
        note='Coordinates in screen/OAM pixels. Bomber shapes are palette-independent: '
             'bombers_<colour>.png share one layout (rect). anchor = image top-left minus '
             '(x, y+17), (x, y) = player position from WRAM ($7E8082/84 + $100*i) of the '
             'previous frame; for a bomber centred on a cell this is the offset from the '
             'cell top-left. pieces = the OAM entries (dx, dy relative to image top-left; '
             'tile = VRAM slot the game streamed that frame into, not a stable id). '
             'Durations in frames (60.0988 Hz), measured in the harness.',
        obj_palettes={c: cgram_hex(cg)[128 + 16 * i:128 + 16 * i + 16] for i, c in enumerate(COLOURS)},
        obj_palettes_all=[cgram_hex(cg)[128 + 16 * p:128 + 16 * p + 16] for p in range(8)],
        obsel=dict(size_select=0, sizes='8x8 small / 16x16 large'),
        bomber_atlases={c: 'bombers_%s.png' % c for c in COLOURS},
        bomber_shapes=shapes,
        animations={COLOURS[i]: anims[i] for i in range(4)},
        animations_identical_across_colours=same,
        fx_atlas='fx.png', fx_pieces=fx_list,
        fx_events=events,
    ))
    print('bomber shapes', len(bombers), 'fx pieces', len(fxs))


if __name__ == '__main__':
    main()
