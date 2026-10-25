"""Battle audio: music tracks (.spc at the moment each starts + recorded .ogg with the
loop point found in the recording) and sound effects (.ogg each, isolated by diffing
against an identical run without the action).

    python3 sound.py            -> data/sb2/assets/audio/{music,sfx}/ + audio.json

Sound commands: the CPU talks to the SPC700 driver through APU port 0 (S.smp()
['cpu_to_spc'][0]); bit 7 toggles to repeat a command, so id = port0 & $7F.  Song data
is uploaded in bulk (port 3 = $5A/$59/$22/$2E/$08 handshake) before a "play" command.
Measured ids (battle): $01 play uploaded battle song, $02 play uploaded DRAW song,
$42 explosion, $43 glove lift, $44 kick, $45 throw, $46 round over, $48 bomb placed,
$4C item get / scoreboard, $4E "Hurry!", $55 skull get, $61 kick-item get, $72 first
falling block, $53/$70 roulette tick/stop.
"""
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Snes, B, ASSETS, state_path, write_json, mkdir, tap, bright  # noqa: E402
from audio import AudioRecorder  # noqa: E402  (harness)
from capture import spawn_item  # noqa: E402

OUT = os.path.join(ASSETS, 'audio')
RATE = 32040
TIMER_STOP = 0x5E21      # $7E5E20 bit 15 = timer stopped (phase 2b, notes-round.md)
BULK_PORT3 = {0x5A, 0x59, 0x22, 0x2E, 0x08}


def write_ogg(path, pcm):
    rec = AudioRecorder(path, RATE)
    rec.write(np.clip(pcm, -32768, 32767).astype('<i2'))
    rec.close()
    return path


def cmd_id(S):
    c = S.smp()['cpu_to_spc']
    return c[0] & 0x7F, c


class Tape:
    """Step the emulator, keep PCM per frame, sound-command log and a short ring of
    savestates (to dump an .spc at an earlier frame)."""

    def __init__(self, S):
        self.S = S
        self.pcm = []
        self.cmds = []
        self.prev = None
        self.ring = {}
        self.n = 0

    def step(self, pads=0, keep_state=False, poke=None):
        if keep_state:
            self.ring[self.n] = self.S.save_state()
            for k in [k for k in self.ring if k < self.n - 8]:
                del self.ring[k]
        if poke:
            poke(self.S)
        self.S.step(pads)
        self.pcm.append(self.S.audio())
        c = tuple(self.S.smp()['cpu_to_spc'])
        if c != self.prev:
            self.cmds.append((self.n, c[0] & 0x7F, c))
        self.prev = c
        self.n += 1

    def audio(self, lo=0, hi=None):
        return np.concatenate(self.pcm[lo:hi]) if self.pcm[lo:hi] else np.zeros((0, 2), np.int16)


def find_loop(pcm, min_loop_s=5.0, skip_s=1.0):
    """Loop of a recording via normalised autocorrelation (mono, 8x decimated), the
    shortest lag whose correlation is within 1.5% of the best; the lag is refined at the
    full rate and the loop start is the first point from which the audio repeats after
    one loop length.  Returns (start_sample, length_samples, score) or None."""
    x = pcm.astype(np.float64).mean(1)
    D = 8
    n8 = len(x) // D
    y = x[:n8 * D].reshape(n8, D).mean(1)
    sk = int(skip_s * RATE / D)
    a = y[sk:]
    N = len(a)
    L2 = 1 << int(np.ceil(np.log2(2 * N)))
    F = np.fft.rfft(a, L2)
    r = np.fft.irfft(F * np.conj(F), L2)[:N]
    c2 = np.cumsum(np.concatenate([[0], a ** 2]))
    lags = np.arange(N)
    e1 = c2[N - lags]                  # energy of a[0:N-L]
    e2 = c2[N] - c2[lags]              # energy of a[L:N]
    norm = r / (np.sqrt(e1 * e2) + 1e-9)
    lo = int(min_loop_s * RATE / D)
    hi = int(N * 0.55)
    if hi <= lo:
        return None
    seg = norm[lo:hi]
    best = float(seg.max())
    if best < 0.9:
        return None
    cand = np.nonzero(seg >= best - 0.015)[0]
    Lc = int(cand[0]) + lo
    # local max around the first candidate
    w = int(0.05 * RATE / D)
    Lc = Lc + int(np.argmax(norm[Lc:Lc + w])) if Lc + w < len(norm) else Lc
    # refine at full rate on a 6 s window in the middle of the recording
    L0 = Lc * D
    mid = len(x) // 3
    W = int(6 * RATE)
    if mid + W + L0 + 64 > len(x):
        mid = max(0, len(x) - W - L0 - 64)
    ref = x[mid:mid + W]
    bestL, bestv = L0, -1
    for L in range(L0 - 24, L0 + 25):
        b = x[mid + L:mid + L + W]
        if len(b) < W:
            continue
        v = float((ref * b).sum() / (np.sqrt((ref ** 2).sum() * (b ** 2).sum()) + 1e-9))
        if v > bestv:
            bestL, bestv = L, v
    L = bestL
    # loop start: first s where the next 2 s repeat one loop later
    step = int(0.02 * RATE)
    Wd = int(2.0 * RATE)
    start = None
    for s0 in range(0, len(x) - L - Wd, step):
        a1 = x[s0:s0 + Wd]
        b1 = x[s0 + L:s0 + L + Wd]
        if np.abs(a1 - b1).mean() < 0.03 * (np.abs(a1).mean() + 1):
            start = s0
            break
    if start is None:
        return None
    return start, L, round(bestv, 5)


def record_song(S, name, setup, trigger, seconds, outdir, stop_timer=True, note=''):
    """setup(S, tape) brings the game to just before the song; then step until
    trigger(tape) is true (the play command), dump .spc there and record."""
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
    # .spc at the command frame (state saved before that frame + one step)
    st = tape.ring.get(start)
    cur = S.save_state()
    S.load_state(st)
    S.step(0)
    S.audio()
    spc = os.path.join(outdir, name + '.spc')
    S.save_spc(spc, song=name, comment='Super Bomberman 2 battle: ' + name)
    S.load_state(cur)

    def poke(S_):
        if stop_timer:
            w = S_.wram(live=True)
            w[TIMER_STOP] |= 0x80
    t0 = tape.n
    for _ in range(int(seconds * S.fps)):
        tape.step(0, poke=poke)
    pcm = tape.audio(t0 - 1)
    # trim leading silence (song audible)
    mono = np.abs(pcm.astype(np.int32)).max(1)
    nz = np.nonzero(mono > 64)[0]
    lead = int(nz[0]) if len(nz) else 0
    pcm = pcm[lead:]
    loop = find_loop(pcm)
    full = os.path.join(outdir, name + '.ogg')
    write_ogg(full, pcm)
    info = dict(name=name, spc=name + '.spc', ogg=name + '.ogg', note=note,
                command_frame=start, recorded_seconds=round(len(pcm) / RATE, 3),
                sample_rate=RATE, leading_silence_trimmed_samples=lead)
    if loop:
        s, L, sc = loop
        info.update(loop_start_sample=int(s), loop_length_samples=int(L),
                    loop_start_s=round(s / RATE, 3), loop_length_s=round(L / RATE, 3),
                    loop_match_score=round(sc, 4))
        lp = os.path.join(outdir, name + '_loop.ogg')
        write_ogg(lp, pcm[:s + L])
        info['ogg_intro_plus_one_loop'] = name + '_loop.ogg'
    else:
        info['loop'] = 'not found (one-shot or longer than the recording)'
    print('music', name, info.get('loop_length_s'), info.get('loop_start_s'))
    return info


def after_upload_play(play_id):
    """Trigger: command `play_id` issued after a bulk upload was seen."""
    state = {'bulk': False}

    def trig(tape):
        n, cid, c = tape.cmds[-1] if tape.cmds else (None, None, None)
        if n is None or n != tape.n - 1:
            return False
        if c[3] in BULK_PORT3 and c[3] != 0:
            state['bulk'] = True
            return False
        return state['bulk'] and cid == play_id and c[3] == 0
    return trig


def isolate(S, base, name, with_pads, n, outdir, without_pads=None, poke_a=None, poke_b=None,
            want_id=None, tail_s=0.15, note=''):
    """Run A (with the action) and B (without) from the same state; residual = A - B."""
    def run(pads, poke):
        S.load_state(base)
        S.audio()
        tape = Tape(S)
        for f in range(n):
            tape.step(pads[f] if isinstance(pads, list) else pads, poke=(lambda s_, f=f: poke(s_, f)) if poke else None)
        return tape
    A = run(with_pads, poke_a)
    Bt = run(without_pads if without_pads is not None else [0] * n, poke_b)
    a = A.audio().astype(np.int32)
    b = Bt.audio().astype(np.int32)
    m = min(len(a), len(b))
    res = a[:m] - b[:m]
    # first frame where the wanted command appears only in A
    cmdsB = set((f, c) for f, c, _ in Bt.cmds)
    newc = [(f, c) for f, c, _ in A.cmds if (f, c) not in cmdsB and (want_id is None or c == want_id)]
    if not newc:
        print('!! no new sound command for', name)
        return None
    f0, cid = newc[0]
    s0 = sum(len(p) for p in A.pcm[:f0])
    mono = np.abs(res).max(1)
    nz = np.nonzero(mono[s0:] > 48)[0]
    if not len(nz):
        print('!! silent residual for', name)
        return None
    lo = s0 + int(nz[0])
    # end: last sample above threshold before a 0.3 s quiet gap
    tail = int(tail_s * RATE)
    quiet = int(0.3 * RATE)
    hi = lo
    k = lo
    while k < len(mono):
        if mono[k] > 48:
            hi = k
        elif k - hi > quiet:
            break
        k += 1
    clip = res[lo:hi + tail]
    raw = a[lo:hi + tail]
    write_ogg(os.path.join(outdir, name + '.ogg'), clip)
    write_ogg(os.path.join(outdir, name + '_with_music.ogg'), raw)
    peak = int(np.abs(clip).max())
    print('sfx', name, 'id $%02X' % cid, 'len %.2fs' % (len(clip) / RATE), 'peak', peak)
    return dict(name=name, sound_id='$%02X' % cid, ogg=name + '.ogg',
                ogg_with_music=name + '_with_music.ogg', seconds=round(len(clip) / RATE, 3),
                peak=peak, command_frame=f0, method='diff (A with action - B without)', note=note)


def main():
    mdir = mkdir(OUT, 'music')
    sdir = mkdir(OUT, 'sfx')
    S = Snes(multitap=True, render=False)
    music = []

    # ---- stage themes -------------------------------------------------------------
    for st in range(1, 11):
        def setup(S_, tape, st=st):
            S_.load_state_file(state_path('stage_select_4p_mt'))
            for _ in range(st - 1):
                tape.step(B.RIGHT)
                for _ in range(50):
                    tape.step(0)
            tape.step(B.START)
        info = record_song(S, 'battle_stage%02d' % st, setup, after_upload_play(1), 330, mdir,
                           note='stage %d battle theme; recorded with the round timer frozen '
                                '($7E5E20 bit15) so no time-up interrupts it' % st)
        if info:
            info['stage'] = st
            music.append(info)
    # ---- draw ---------------------------------------------------------------------
    def setup_draw(S_, tape):
        S_.load_state_file(state_path('mt4_stage01'))
        S_.run(2)
        for _ in range(3):
            tape.step((B.A,) * 4 + (0,))
    info = record_song(S, 'draw', setup_draw, after_upload_play(2), 40, mdir, stop_timer=False,
                       note='DRAW screen song (everybody died): upload + play $02')
    if info:
        music.append(info)

    # ---- match victory -------------------------------------------------------------
    def setup_victory(S_, tape):
        S_.load_state_file(state_path('mt4_stage01'))
        S_.run(2)
        for rnd in range(3):
            for f in range(1003 if rnd < 2 else 600):
                tape.step((0, B.A, B.A, B.A, 0) if f < 3 else 0)
            if rnd < 2:
                for _ in range(600):
                    p = S_.ppu()
                    if p['brightness'] == 15 and p['bg2_sc_base'] == 0x4000 and not p['forced_blank']:
                        break
                    tape.step(0)
    info = record_song(S, 'victory', setup_victory, after_upload_play(1), 60, mdir, stop_timer=False,
                       note='after the 3rd win: VICTORY!! screen then roulette (the roulette '
                            'tick/stop sounds $53/$70 are in this recording)')
    if info:
        music.append(info)

    # ---- sound effects (diff) -------------------------------------------------------
    sfx = []
    from sprites import lab_state, pads_from, script, KICK, GLOVE, BOMB_UP
    base = lab_state(S)

    def P1(parts, n):
        return pads_from({0: script(parts)}, n)
    # bomb place + explosion: P1 drops a bomb and walks out of range (cleared arena)
    act = P1([('-', 10), ('A', 1), ('RIGHT', 60), ('DOWN', 40), ('-', 200)], 320)
    r = isolate(S, base, 'bomb_place', act, 320, sdir, want_id=0x48)
    r and sfx.append(r)
    r = isolate(S, base, 'explosion', act, 320, sdir, want_id=0x42, tail_s=0.3)
    r and sfx.append(r)
    # item get (bomb up), kick-item get, skull get
    for nm, it, cid in (('item_get', BOMB_UP, 0x4C), ('item_get_kick', KICK, 0x61), ('item_get_skull', 0x160A, 0x55)):
        S.load_state(base)
        spawn_item(S, 2, 1, it)
        b2 = S.save_state()
        r = isolate(S, b2, nm, P1([('-', 2), ('RIGHT', 28), ('-', 60)], 90), 90, sdir,
                    without_pads=P1([('-', 90)], 90), want_id=cid)
        r and sfx.append(r)
    # kick: kick item, bomb, walk into it
    S.load_state(base)
    spawn_item(S, 2, 1, KICK)
    b2 = S.save_state()
    seq = [('-', 2), ('RIGHT', 28), ('-', 6), ('A', 1), ('-', 2), ('RIGHT', 30), ('-', 8)]
    pre = P1(seq + [('-', 120)], 197)
    act = P1(seq + [('LEFT', 40), ('-', 80)], 197)
    r = isolate(S, b2, 'kick', act, 197, sdir, without_pads=pre, want_id=0x44)
    r and sfx.append(r)
    # glove lift / throw
    S.load_state(base)
    spawn_item(S, 2, 1, GLOVE)
    b2 = S.save_state()
    seq = [('-', 2), ('RIGHT', 28), ('-', 6), ('A', 1), ('-', 6)]
    pre = P1(seq + [('-', 120)], 163)
    act = P1(seq + [('A', 20), ('-', 100)], 163)
    r = isolate(S, b2, 'glove_lift', act, 163, sdir, without_pads=pre, want_id=0x43)
    r and sfx.append(r)
    r = isolate(S, b2, 'throw', act, 163, sdir, without_pads=pre, want_id=0x45)
    r and sfx.append(r)
    # round over (draw): all four blow up (B: nobody does anything)
    S.load_state(base)
    b2 = S.save_state()
    r = isolate(S, b2, 'round_over_draw', [(B.A,) * 4 + (0,)] * 3 + [0] * 520, 523, sdir,
                want_id=0x46, tail_s=0.5,
                note='sent when the round ends with no survivor, just before the DRAW song is '
                     'uploaded; the residual also contains the end of the explosions')
    r and sfx.append(r)
    # hurry + first falling block: A = normal clock, B = clock frozen (no hurry, no blocks)
    S.load_state_file(state_path('mt4_stage01'))
    S.run(2)
    S.run(5150)          # displayed ~0:42 (0:38 = tick 5394)
    b2 = S.save_state()

    def freeze(S_, f):
        S_.wram(live=True)[TIMER_STOP] |= 0x80
    r = isolate(S, b2, 'hurry', [0] * 500, 500, sdir, poke_b=freeze, want_id=0x4E, tail_s=0.3)
    r and sfx.append(r)
    r = isolate(S, b2, 'falling_block_first', [0] * 800, 800, sdir, poke_b=freeze, want_id=0x72,
                tail_s=0.3)
    r and sfx.append(r)
    write_json(os.path.join(OUT, 'audio.json'), dict(
        note='Music: .spc = APU snapshot taken right after the play command (open in any SPC '
             'player); .ogg = harness recording from the first audible sample (vorbis q6, '
             '32040 Hz stereo); loop_* = loop found in the recording (samples at 32040 Hz). '
             'SFX: residual of two otherwise identical runs (with/without the action), so '
             'the music cancels; *_with_music.ogg is the raw mix for comparison. If an '
             'effect steals a music voice, that voice appears inverted in the residual.',
        music=music, sfx=sfx,
        not_captured=['death (no separate death sound command is sent; the explosion covers it)',
                      'menu sounds (not battle)']))


if __name__ == '__main__':
    main()
