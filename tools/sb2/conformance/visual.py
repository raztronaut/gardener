"""Visual conformance: the port's renderer (public/arcade/sb2/render/) against the original.

    python3 tools/sb2/conformance/visual.py [names...] [--n 8] [--lag 1] [--all-frames]

For each vector (data/sb2/vectors/<name>.json): pick --n ticks spread over the trace
(plus every death), replay the vector in the harness (same start state, settle frames,
pokes and per-frame pads as vectors.py) with rendering on, and grab the original's frame;
render the same tick with the JS core + renderer (visual_render.mjs); compare pixel by
pixel in 15-bit colour (the harness framebuffer is RGB565 -> compared as 5:5:5).

Frame <-> tick: the tick that completes in vector frame i is uploaded by the NMI that
ends frame i (OAM / VRAM / CGRAM DMA), so the picture of tick(i) is harness frame i+lag
(lag = 1, measured: see NOTES-render.md).

Outputs data/sb2/conformance/visual/<name>/: truth_<i>.png, port_<i>.png,
diff_<i>.png (truth | port | diff, x2; diff = differing pixels in red over a dimmed
truth), and report.json; prints one line per sample and a summary table.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness')]
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from snes import Snes, STATES_DIR, ROOT  # noqa: E402

VEC = os.path.join(ROOT, 'data', 'sb2', 'vectors')
OUT = os.path.join(ROOT, 'data', 'sb2', 'conformance', 'visual')
MYSTATES = os.path.join(ROOT, 'data', 'sb2', 're', 'states')
NODE = 'node'
RENDER = os.path.join(HERE, 'visual_render.mjs')

DEFAULT = ['walk_cleared', 'bomb_chain', 'bomb_softblocks', 'item_burn', 'kick', 'glove_throw',
           'death_two', 'cpu_round', 'cpu_round_1p', 'cpu_stage02', 'cpu_stage03', 'cpu_stage04',
           'cpu_stage05', 'cpu_stage06', 'cpu_stage07', 'cpu_stage08', 'cpu_stage09', 'cpu_stage10',
           'timeout_sudden_death', 'skull_swap', 'remote_detonate', 'item_skull']


def load_state(S, st):
    for d in (STATES_DIR, MYSTATES):
        p = os.path.join(d, st + '.state')
        if os.path.exists(p):
            S.load_state_file(p)
            return
    raise FileNotFoundError(st)


def pick(v, ticks, n):
    """ticks: [(frame, tick)] from the port run; spread n samples + death frames."""
    frames = [f for f, _ in ticks]
    if not frames:
        return []
    out = set()
    for k in range(n):
        out.add(frames[min(len(frames) - 1, int((k + 0.5) * len(frames) / n))])
    fset = set(frames)
    for i, fr in enumerate(v['frames']):
        if fr['truth'].get('deaths'):
            for d in (i + 6, i + 30):
                cand = [f for f in frames if f >= d]
                if cand:
                    out.add(cand[0])
    return sorted(x for x in out if x in fset)


def harness_frames(v, want, lags):
    """Replay the vector, return {frame_index + lag: rgb array} for every wanted frame."""
    S = Snes(render=True, multitap=v['start']['multitap'])
    load_state(S, v['start']['state'])
    for _ in range(v['start']['settle_frames']):
        S.step(0)
    w = S.wram(live=True)
    for off, val, size in v['start']['pokes']:
        w[off] = val & 0xff
        if size == 2:
            w[off + 1] = (val >> 8) & 0xff
    need = {f + l for f in want for l in lags}
    last = max(need) if need else -1
    got = {}
    for i, fr in enumerate(v['frames']):
        if i > last:
            break
        S.step(tuple(fr['pads']))
        if i in need:
            got[i] = S.frame().copy()
    return got


def to555(rgb):
    return (rgb[..., 0].astype(np.int32) >> 3) | ((rgb[..., 1].astype(np.int32) >> 3) << 5) | ((rgb[..., 2].astype(np.int32) >> 3) << 10)


def diff_png(path, truth, port):
    same = to555(truth) == to555(port)
    d = (truth.astype(np.float32) * 0.35).astype(np.uint8)
    d[~same] = (255, 40, 40)
    row = np.concatenate([truth, np.full((224, 4, 3), 255, np.uint8), port,
                          np.full((224, 4, 3), 255, np.uint8), d], axis=1)
    Image.fromarray(row).resize((row.shape[1] * 2, row.shape[0] * 2), Image.NEAREST).save(path)


def child(name, frames, lags):
    v = json.load(open(os.path.join(VEC, name + '.json')))
    got = harness_frames(v, frames, lags)
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    np.savez_compressed(os.path.join(d, 'truth.npz'), **{str(k): a for k, a in got.items()})


def main():
    a = sys.argv[1:]
    if a and a[0] == '--child':
        child(a[1], [int(x) for x in a[3].split(',')], [int(x) for x in a[2].split(',')])
        return
    n = int(a[a.index('--n') + 1]) if '--n' in a else 8
    lags = [int(x) for x in a[a.index('--lag') + 1].split(',')] if '--lag' in a else [1]
    skip = {a[a.index('--n') + 1] if '--n' in a else None, a[a.index('--lag') + 1] if '--lag' in a else None}
    names = [x for x in a if not x.startswith('--') and x not in skip] or DEFAULT
    rows = []
    for name in names:
        v = json.load(open(os.path.join(VEC, name + '.json')))
        ticks = json.loads(subprocess.check_output([NODE, RENDER, '--ticks', name], cwd=ROOT))
        frames = pick(v, ticks, n)
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        info = json.loads(subprocess.check_output([NODE, RENDER, name, d] + [str(f) for f in frames], cwd=ROOT))
        subprocess.check_call([sys.executable, __file__, '--child', name, ','.join(map(str, lags)),
                               ','.join(map(str, frames))])
        truth = np.load(os.path.join(d, 'truth.npz'))
        tick_of = dict(ticks)
        res = []
        for f in frames:
            port = np.fromfile(os.path.join(d, 'port_%d.rgba' % f), np.uint8).reshape(224, 256, 4)[..., :3]
            best = None
            for l in lags:
                k = str(f + l)
                if k not in truth:
                    continue
                t = truth[k]
                pct = float((to555(t) == to555(port)).mean() * 100)
                if best is None or pct > best[0]:
                    best = (pct, l, t)
            if best is None:
                continue
            pct, l, t = best
            Image.fromarray(t).save(os.path.join(d, 'truth_%d.png' % f))
            Image.fromarray(port).save(os.path.join(d, 'port_%d.png' % f))
            diff_png(os.path.join(d, 'diff_%d.png' % f), t, port)
            res.append({'frame': f, 'tick': tick_of.get(f), 'lag': l, 'match': round(pct, 4)})
            print('%-22s frame %5d tick %5d lag %d  %8.4f%%' % (name, f, tick_of.get(f, -1), l, pct))
        json.dump({'name': name, 'samples': res, 'port': info}, open(os.path.join(d, 'report.json'), 'w'), indent=1)
        if res:
            rows.append((name, len(res), min(r['match'] for r in res), sum(r['match'] for r in res) / len(res),
                         sum(1 for r in res if r['match'] == 100.0)))
    print('\n%-22s %4s %9s %9s %6s' % ('vector', 'n', 'min %', 'mean %', 'exact'))
    for r in rows:
        print('%-22s %4d %9.4f %9.4f %6d' % r)
    if rows:
        tot = sum(r[1] for r in rows)
        print('%-22s %4d %9.4f %9.4f %6d' % ('ALL', tot, min(r[2] for r in rows),
                                             sum(r[3] * r[1] for r in rows) / tot, sum(r[4] for r in rows)))


if __name__ == '__main__':
    main()
