"""Per-tick full-WRAM trace of a vector, for debugging the JS core against the original.

    python3 wtrace.py <vector> [max_frames]     -> data/sb2/conformance/wtrace/<vector>.bin

Replays the vector's start (state, settle, pokes) and pads in the emulator. One record
per logic tick: frames are grouped by the tick counter $32 (it advances in the NMI at
the start of a frame, then that tick runs and reads that frame's pads); the record is
the WRAM at the end of the group's last frame that still shows the group's first $B9
(long ticks lag into the following frames; after a round's final tick $B9 changes and
the frozen scoreboard frames are skipped). File format
(read by wtrace.mjs): 'SB2W' u32 version=1 u32 count, then per record: u32 frame,
u32 tick ($32 after the frame), u32 n, n bytes = zlib(deflate) of (WRAM xor previous
record's WRAM) (the first record is xor'ed against the start WRAM = start/<vector>.wram).
"""
import json, os, struct, sys, zlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), os.path.join(HERE, '..', 're')]
import numpy as np
from snes import Snes, STATES_DIR, ROOT

VEC = os.path.join(ROOT, 'data', 'sb2', 'vectors')
OUT = os.path.join(ROOT, 'data', 'sb2', 'conformance', 'wtrace')
MYSTATES = os.path.join(ROOT, 'data', 'sb2', 're', 'states')


def compare_frames(frames, t0, rng0, start=0):
    """(first_frame, complete_frame) of every executed tick. Frames are grouped by
    truth.tick ($32 is incremented by the NMI at the start of a frame; the tick then runs
    and reads that frame's pads). The tick is complete at the last frame of its group that
    still shows the group's first $B9 (a 2-frame group = the tick lagged into the next
    frame; frozen post-round screens change $B9). A group whose rng equals the previous
    tick's rng ran no tick: $32 was incremented twice (the NMI hit between INC $16 and the
    main loop's wait, so the next NMI counted the same tick again) — the skipped value
    never runs, and the next tick runs with $32 = its truth.tick."""
    out = []
    i = start
    prev = t0
    prng = rng0
    n = len(frames)
    while i < n:
        t = frames[i]['truth']['tick']
        if t == prev:
            i += 1
            continue
        j = i
        while j + 1 < n and frames[j + 1]['truth']['tick'] == t:
            j += 1
        b9 = frames[i]['truth']['timer'][5]
        c = i
        while c < j and frames[c + 1]['truth']['timer'][5] == b9:
            c += 1
        r = frames[c]['truth']['rng']
        if r != prng or t < prev:
            out.append((i, c))
            prng = r
        prev = t
        i = j + 1
    return out


def main():
    name = sys.argv[1]
    maxf = int(sys.argv[2]) if len(sys.argv) > 2 else None
    v = json.load(open(os.path.join(VEC, name + '.json')))
    S = Snes(render=False, multitap=v['start']['multitap'])
    st = v['start']['state']
    for d in (STATES_DIR, MYSTATES):
        p = os.path.join(d, st + '.state')
        if os.path.exists(p):
            S.load_state_file(p); break
    for _ in range(v['start']['settle_frames']):
        S.step(0)
    w = S.wram(live=True)
    for off, val, size in v['start']['pokes']:
        w[off] = val & 0xff
        if size == 2:
            w[off + 1] = (val >> 8) & 0xff
    t0 = v['initial']['globals']['tick']
    skip = 0                     # same start as vcover.py (complete a lagged settle tick)
    while skip < len(v['frames']) and v['frames'][skip]['truth']['tick'] == t0:
        S.step(tuple(v['frames'][skip]['pads']))
        skip += 1
    prev = S.wram()
    recs = []
    n = len(v['frames']) if maxf is None else min(maxf, len(v['frames']))
    rng0 = int(prev[0xD6]) | int(prev[0xD7]) << 8
    want = set(c for f, c in compare_frames(v['frames'][:n], t0, rng0, skip))
    for i in range(skip, n):
        S.step(tuple(v['frames'][i]['pads']))
        if i in want:
            cur = S.wram()
            t = int(cur[0x32]) | int(cur[0x33]) << 8
            recs.append((i, t, zlib.compress((cur ^ prev).tobytes(), 6)))
            prev = cur
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + '.bin'), 'wb') as f:
        f.write(b'SB2W' + struct.pack('<II', 1, len(recs)))
        for i, t, z in recs:
            f.write(struct.pack('<III', i, t, len(z)))
            f.write(z)
    print(name, len(recs), 'ticks')


if __name__ == '__main__':
    main()
