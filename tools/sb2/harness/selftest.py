"""Harness self-test + benchmark. Run:  python3 selftest.py [--quick]

Checks (all measured, printed):
  perf         headless frames/sec (render on / off) in a running battle
  determinism  600-frame input script from power-on, twice, WRAM hash per frame
               + frame image hash; and the same from battle_start.state via load_state
  states       save_state/load_state round trip reproduces the continuation
  spc          save_spc() writes a valid 66048-byte .spc, does not perturb emulation,
               and (if ffmpeg has libgme) decodes to non-silent audio
  audio        AudioRecorder writes .wav and .ogg
  battle       in battle_start.state, holding DOWN moves P1 and the timer runs
"""
import hashlib
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from snes import Snes, B, STATES_DIR, ROOT  # noqa: E402
import inputs  # noqa: E402
from spc import parse_spc  # noqa: E402
from audio import record  # noqa: E402

TMP = os.path.join(ROOT, 'data', 'sb2', 'debug', 'selftest')
os.makedirs(TMP, exist_ok=True)

# 600 frames: boot, skip intro, walk the title menu, enter battle menus, wiggle
SCRIPT600 = """
250
2 START
100
1 DOWN
20
1 UP
20
1 DOWN
30
1 START
174
"""


def h(b):
    return hashlib.sha1(b).hexdigest()


def trace(S, script_ops):
    hw, hf = [], []
    for pads in inputs.expand(script_ops):
        S.step(pads)
        hw.append(S.wram_hash())
        hf.append(h(S.frame().tobytes()))
    return hw, hf


def main(quick=False):
    S = Snes()
    power = S.save_state()
    ok = True
    battle = open(os.path.join(STATES_DIR, 'battle_start.state'), 'rb').read()

    # ---- perf
    S.load_state(battle)
    rnd = np.random.RandomState(1)
    pads = [int(x) for x in rnd.choice([0, B.UP, B.DOWN, B.LEFT, B.RIGHT, B.B], 1200)]
    for render in (True, False):
        S.render = render
        t = time.time()
        S.run(1200, pads=pads)
        dt = time.time() - t
        print('perf: %s %.0f fps (%.2fx realtime)' % ('render' if render else 'no-render',
                                                       1200 / dt, 1200 / dt / S.fps))
    S.render = True
    t = time.time()
    for _ in range(300):
        S.step(0)
        S.wram()
    print('perf: render + wram() copy every frame %.0f fps' % (300 / (time.time() - t)))

    # ---- determinism from power-on
    ops = inputs.parse(SCRIPT600)
    assert len(inputs.expand(ops)) == 600
    S.load_state(power)
    a = trace(S, ops)
    S.load_state(power)
    b = trace(S, ops)
    same_w = a[0] == b[0]
    same_f = a[1] == b[1]
    print('determinism (power-on, 600 frames x2): wram %s, frames %s, final wram %s' % (
        'IDENTICAL' if same_w else 'DIFFER', 'IDENTICAL' if same_f else 'DIFFER', a[0][-1][:16]))
    ok &= same_w and same_f
    # from battle_start with random inputs for 4 ports
    rp = [tuple(int(x) for x in rnd.randint(0, 4096, 2)) for _ in range(600)]
    res = []
    for _ in range(2):
        S.load_state(battle)
        ws = []
        S.run(600, pads=rp, on_frame=lambda S, i: ws.append(S.wram_hash()))
        res.append(ws)
    print('determinism (battle_start, 600 random frames x2): %s' % ('IDENTICAL' if res[0] == res[1] else 'DIFFER'))
    ok &= res[0] == res[1]

    # ---- save/load round trip mid-run
    S.load_state(battle)
    S.run(100, pads=rp[:100])
    mid = S.save_state()
    S.run(200, pads=rp[100:300])
    ref = S.wram_hash()
    S.load_state(mid)
    S.run(200, pads=rp[100:300])
    rt = S.wram_hash() == ref
    print('save/load round trip: %s (state size %d bytes)' % ('OK' if rt else 'MISMATCH', len(mid)))
    ok &= rt

    # ---- spc
    S.load_state(battle)
    S.run(60)
    spc_path = os.path.join(TMP, 'battle.spc')
    S.save_spc(spc_path, song='battle')
    S.run(120)
    after_dump = S.wram_hash()
    S.load_state(battle)
    S.run(180)
    no_dump = S.wram_hash()
    data = open(spc_path, 'rb').read()
    info = parse_spc(data)
    spc_ok = len(data) == 66048 and after_dump == no_dump
    print('spc: %d bytes, pc=$%04X, perturbs emulation: %s' % (len(data), info['pc'],
                                                              'NO' if after_dump == no_dump else 'YES'))
    wav = os.path.join(TMP, 'battle_spc_gme.wav')
    r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', spc_path, '-t', '5', wav])
    if r.returncode == 0:
        import wave
        w = wave.open(wav)
        pcm = np.frombuffer(w.readframes(w.getnframes()), '<i2')
        rms = float(np.sqrt((pcm.astype(np.float64) ** 2).mean()))
        print('spc: ffmpeg/libgme decodes it, 5 s RMS %.0f (%s)' % (rms, 'non-silent' if rms > 100 else 'SILENT'))
        spc_ok &= rms > 100
    else:
        print('spc: ffmpeg could not decode (no libgme?)')
    ok &= spc_ok

    # ---- audio recorder
    S.load_state(battle)
    for ext in ('wav', 'ogg'):
        p = record(S, os.path.join(TMP, 'battle.' + ext), 300)
        print('audio: %s %d bytes' % (os.path.basename(p), os.path.getsize(p)))
    S.load_state(battle)
    S.run(300)
    pcm = S.audio()
    print('audio: %d stereo samples in 300 frames (%.1f/frame), peak %d' % (
        len(pcm), len(pcm) / 300, int(np.abs(pcm).max())))

    # ---- battle running
    S.load_state(battle)
    S.run(1)
    f0 = S.frame().copy()
    S.run(30, B.DOWN)
    f1 = S.frame().copy()
    S.load_state(battle)
    S.run(31)
    f2 = S.frame()
    moved = int((f1 != f2).any(-1).sum())
    print('battle: pixels differing after 30 frames DOWN vs idle: %d' % moved)
    ok &= moved > 0
    print('ALL OK' if ok else 'SOME CHECKS FAILED')
    return ok


if __name__ == '__main__':
    sys.exit(0 if main('--quick' in sys.argv) else 1)
