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


def _ncc(a, b):
    return float((a * b).sum() / (np.sqrt((a * a).sum() * (b * b).sum()) + 1e-9))


def find_loop(pcm, min_loop_s=5.0):
    """Loop of a recording (the repeats are not sample-exact -- echo/noise state differs
    -- so this is correlation based):
    1. normalised autocorrelation of the 32x-decimated mono signal; the loop length is
       the SHORTEST lag whose peak is within 5% of the best peak (multiples of the loop
       score about the same);
    2. refined at full rate (+-48 samples) by maximising the correlation of a 6 s window;
    3. loop start = first t (10 ms steps) from which three consecutive 1 s windows
       correlate with the audio one loop later at >= 80% of the typical (median)
       between-loop correlation (the repeats are close but not sample-identical: the
       sequencer tempo is not an integer number of output samples per loop, typical
       window correlation 0.85-0.95).
    Returns dict(start, length, score, method) or None."""
    x = pcm.astype(np.float64).mean(1)
    n = len(x)
    D = 32
    n8 = n // D
    y = x[:n8 * D].reshape(n8, D).mean(1)
    N = len(y)
    L2 = 1 << int(np.ceil(np.log2(2 * N)))
    F = np.fft.rfft(y, L2)
    r = np.fft.irfft(F * np.conj(F), L2)[:N]
    c2 = np.cumsum(np.concatenate([[0], y ** 2]))
    lags = np.arange(N)
    norm = r / (np.sqrt(c2[N - lags] * (c2[N] - c2[lags])) + 1e-9)
    sr = RATE / D
    lo = int(min_loop_s * sr)
    hi = int((n / RATE - 8) * sr)
    if hi <= lo + 3:
        return None
    seg = norm[lo:hi]
    pk = np.nonzero((seg[1:-1] > seg[:-2]) & (seg[1:-1] >= seg[2:]))[0] + 1
    if not len(pk):
        return None
    bestv = float(seg[pk].max())
    if bestv < 0.9:
        return None
    good = sorted(int(p) for p in pk if seg[p] >= 0.95 * bestv)
    L0 = (good[0] + lo) * D
    W = int(6 * RATE)
    t = max(0, (n - L0 - W) // 2)
    ref = x[t:t + W]
    cands = [(_ncc(ref, x[t + L:t + L + W]), L) for L in range(L0 - 48, L0 + 49)
             if t + L + W <= n]
    if not cands:
        return None
    score, L = max(cands)
    w = RATE
    tail = [_ncc(x[s0:s0 + w], x[s0 + L:s0 + L + w]) for s0 in range(n // 4, n - L - w, w)][:30]
    if not tail:
        return None
    thr = 0.8 * float(np.median(tail))
    step = int(0.01 * RATE)
    for s0 in range(0, n - L - 3 * w, step):
        if all(_ncc(x[s0 + k * w:s0 + (k + 1) * w], x[s0 + L + k * w:s0 + L + (k + 1) * w]) >= thr
               for k in range(3)):
            return dict(start=s0, length=L, score=round(score, 4), threshold=round(thr, 3),
                        method='correlation')
    return None


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
        s, L = loop['start'], loop['length']
        info.update(loop_start_sample=int(s), loop_length_samples=int(L),
                    loop_start_s=round(s / RATE, 3), loop_length_s=round(L / RATE, 3),
                    loop_correlation=loop['score'], loop_method=loop['method'])
        lp = os.path.join(outdir, name + '_loop.ogg')
        write_ogg(lp, pcm[:s + L])
        info['ogg_intro_plus_one_loop'] = name + '_loop.ogg'
    else:
        info['loop'] = 'not found (one-shot or longer than the recording)'
    info['_head'] = pcm[:int(30 * RATE)].astype(np.float64).mean(1)
    print('music', name, info.get('loop_length_s'), info.get('loop_start_s'), info.get('loop_method'),
          info.get('loop_correlation'))
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


def _env(S):
    d = S.dsp()
    return [int(d[0x10 * v + 8]) for v in range(8)]      # ENVX of the 8 voices


def _run_tape(S, base, pads, n, poke=None):
    S.load_state(base)
    S.audio()
    tape = Tape(S)
    env = []
    for f in range(n):
        tape.step(pads[f] if f < len(pads) else 0, poke=(lambda s_, f=f: poke(s_, f)) if poke else None)
        env.append(_env(S))
    return tape, np.array(env, np.int32)


def isolate(S, base, name, with_pads, n, outdir, without_pads=None, poke_a=None, poke_b=None,
            want_id=None, tail_s=0.15, note='', max_delay=0):
    """Isolate one sound effect.  A = run with the action, B = identical run without it;
    residual = A - B (the music cancels).  An effect plays on one or two DSP voices that
    the music may be using at that moment -- then the residual also holds that music
    voice (inverted).  With max_delay > 0 the action is postponed by d idle frames
    (d < max_delay) so that the voices the effect uses are SILENT in the music for the
    whole effect (voice envelopes ENVX read from the DSP every frame): a quiet moment
    for exactly the channels involved."""
    wo = without_pads if without_pads is not None else [0] * n
    k = next((i for i in range(min(len(with_pads), len(wo))) if with_pads[i] != wo[i]), 0)
    idle = wo[k] if k < len(wo) else 0
    nb = n + max_delay
    Bt, envB = _run_tape(S, base, list(wo) + [idle] * max_delay, nb, poke_b)
    A0, envA = _run_tape(S, base, with_pads, n, poke_a)
    cmdsB = set((f, c) for f, c, _ in Bt.cmds)
    newc = [(f, c) for f, c, _ in A0.cmds if (f, c) not in cmdsB and (want_id is None or c == want_id)]
    if not newc:
        print('!! no new sound command for', name)
        return None
    f0, cid = newc[0]
    hi = min(n, f0 + 8)
    voices = [v for v in range(8) if (envA[f0:hi, v] != envB[f0:hi, v]).any()]
    dur = 0
    same = 0
    for f in range(f0, n):
        if voices and (envA[f, voices] == envB[f, voices]).all():
            same += 1
            if same >= 15:
                dur = f - 14 - f0
                break
        else:
            same = 0
    else:
        dur = n - f0
    d_best, cost_best = 0, None
    if max_delay and voices:
        for d in range(0, max_delay - dur - 1, 2):
            w = envB[f0 + d:f0 + d + dur + 1][:, voices]
            c = int(w.sum())
            if cost_best is None or c < cost_best:
                d_best, cost_best = d, c
            if c == 0:
                break
    if d_best:
        A, _ = _run_tape(S, base, list(with_pads[:k]) + [idle] * d_best + list(with_pads[k:]),
                         n + d_best, poke_a)
    else:
        A = A0
    f1 = f0 + d_best
    a = A.audio().astype(np.int32)
    b = Bt.audio().astype(np.int32)
    m = min(len(a), len(b))
    res = a[:m] - b[:m]
    s0 = sum(len(p) for p in A.pcm[:f1])
    s1 = sum(len(p) for p in A.pcm[:min(len(A.pcm), f1 + dur + 1)])
    mono = np.abs(res).max(1)
    nz = np.nonzero(mono[s0:s1] > 48)[0]
    if not len(nz):
        print('!! silent residual for', name)
        return None
    lo = s0 + int(nz[0])
    hi_s = min(m, s1 + int(tail_s * RATE))
    clip = res[lo:hi_s]
    raw = a[lo:hi_s]
    write_ogg(os.path.join(outdir, name + '.ogg'), clip)
    write_ogg(os.path.join(outdir, name + '_with_music.ogg'), raw)
    peak = int(np.abs(clip).max())
    quiet = cost_best == 0 if max_delay else None
    print('sfx', name, 'id $%02X' % cid, 'voices', voices, 'dur', dur, 'delay', d_best,
          'quiet', quiet, 'len %.2fs' % (len(clip) / RATE), 'peak', peak)
    return dict(name=name, sound_id='$%02X' % cid, ogg=name + '.ogg',
                ogg_with_music=name + '_with_music.ogg', seconds=round(len(clip) / RATE, 3),
                peak=peak, command_frame=f1, dsp_voices=voices, effect_frames=dur,
                action_delay_frames=d_best, music_voices_silent=quiet,
                method='diff (A with action - B without)' +
                       ('; action delayed to a moment where the music leaves the effect\'s '
                        'voices silent' if quiet else ''), note=note)


def main():
    import json
    do_music = '--sfx' not in sys.argv or '--music' in sys.argv
    do_sfx = '--music' not in sys.argv or '--sfx' in sys.argv
    old = {}
    if os.path.exists(os.path.join(OUT, 'audio.json')):
        old = json.load(open(os.path.join(OUT, 'audio.json')))
    mdir = mkdir(OUT, 'music')
    sdir = mkdir(OUT, 'sfx')
    S = Snes(multitap=True, render=False)
    music = [] if do_music else old.get('music', [])
    if do_music:
        music_part(S, mdir, music)
    sfx = sfx_part(S, sdir) if do_sfx else old.get('sfx', [])
    for m_ in music:
        m_.pop('_head', None)
    write_json(os.path.join(OUT, 'audio.json'), dict(
        note='Music: .spc = APU snapshot taken right after the play command (open in any SPC '
             'player); .ogg = harness recording from the first audible sample (vorbis q6, '
             '32040 Hz stereo); loop_* = loop found in the recording (samples at 32040 Hz). '
             'SFX: residual of two otherwise identical runs (with/without the action), so '
             'the music cancels; *_with_music.ogg is the raw mix for comparison. If '
             'music_voices_silent is false, the music was using the effect\'s DSP voice and '
             'that voice appears inverted in the residual.',
        music=music, sfx=sfx,
        not_captured=['death (no separate death sound command is sent; the explosion covers it)',
                      'menu sounds (not battle)']))


def music_part(S, mdir, music):

    # ---- stage themes -------------------------------------------------------------
    for st in range(1, 11):
        def setup(S_, tape, st=st):
            S_.load_state_file(state_path('stage_select_4p_mt'))
            for _ in range(st - 1):
                tape.step(B.RIGHT)
                for _ in range(50):
                    tape.step(0)
            tape.step(B.START)
        note = ('stage %d battle theme; recorded with the round timer frozen ($7E5E20 bit15) '
                'so no time-up interrupts it' % st)
        info = record_song(S, 'battle_stage%02d' % st, setup, after_upload_play(1), 330, mdir, note=note)
        if info and 'loop_length_s' not in info:      # long song: record twice as long
            info = record_song(S, 'battle_stage%02d' % st, setup, after_upload_play(1), 620, mdir,
                               note=note)
        if info:
            info['stage'] = st
            music.append(info)
    # same song on several stages? correlate the first 30 s (+-0.5 s lag, 8x decimated)
    def dec(v):
        k = len(v) // 8
        return v[:k * 8].reshape(k, 8).mean(1)
    for a in range(len(music)):
        for b in range(a):
            x, y = dec(music[a]['_head']), dec(music[b]['_head'])
            m_ = min(len(x), len(y)) - 2100
            best = max(_ncc(x[1000:1000 + m_ - 2000], y[1000 + d:1000 + d + m_ - 2000])
                       for d in range(-200, 201, 2))
            if best > 0.9:
                music[a]['same_song_as'] = music[b].get('same_song_as', music[b]['name'])
                break
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

    return music


def sfx_part(S, sdir):
    sfx = []
    from sprites import lab_state, pads_from, script, KICK, GLOVE, BOMB_UP
    base = lab_state(S)

    def P1(parts, n):
        return pads_from({0: script(parts)}, n)
    # bomb place + explosion: P1 drops a bomb and walks out of range (cleared arena)
    act = P1([('-', 10), ('A', 1), ('RIGHT', 60), ('DOWN', 40), ('-', 200)], 320)
    r = isolate(S, base, 'bomb_place', act, 320, sdir, want_id=0x48, max_delay=5400)
    r and sfx.append(r)
    r = isolate(S, base, 'explosion', act, 320, sdir, want_id=0x42, tail_s=0.3, max_delay=5400)
    r and sfx.append(r)
    # item get (bomb up), kick-item get, skull get
    for nm, it, cid in (('item_get', BOMB_UP, 0x4C), ('item_get_kick', KICK, 0x61), ('item_get_skull', 0x160A, 0x55)):
        S.load_state(base)
        spawn_item(S, 2, 1, it)
        b2 = S.save_state()
        r = isolate(S, b2, nm, P1([('-', 2), ('RIGHT', 28), ('-', 60)], 90), 90, sdir,
                    without_pads=P1([('-', 90)], 90), want_id=cid, max_delay=5400)
        r and sfx.append(r)
    # kick: kick item, bomb, walk into it
    S.load_state(base)
    spawn_item(S, 2, 1, KICK)
    b2 = S.save_state()
    seq = [('-', 2), ('RIGHT', 28), ('-', 6), ('A', 1), ('-', 2), ('RIGHT', 30), ('-', 8)]
    pre = P1(seq + [('-', 120)], 197)
    act = P1(seq + [('LEFT', 40), ('-', 80)], 197)
    r = isolate(S, b2, 'kick', act, 197, sdir, without_pads=pre, want_id=0x44, max_delay=80)
    r and sfx.append(r)
    # glove lift / throw
    S.load_state(base)
    spawn_item(S, 2, 1, GLOVE)
    b2 = S.save_state()
    seq = [('-', 2), ('RIGHT', 28), ('-', 6), ('A', 1), ('-', 6)]
    pre = P1(seq + [('-', 120)], 163)
    act = P1(seq + [('A', 20), ('-', 100)], 163)
    r = isolate(S, b2, 'glove_lift', act, 163, sdir, without_pads=pre, want_id=0x43, max_delay=80)
    r and sfx.append(r)
    r = isolate(S, b2, 'throw', act, 163, sdir, without_pads=pre, want_id=0x45, max_delay=80)
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
    return sfx


if __name__ == '__main__':
    main()
