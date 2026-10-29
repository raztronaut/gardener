# per-second analysis of a sound file: level, band levels, spectral flatness, events
import sys, json, subprocess, os, re
import numpy as np
SR = 32000
def ffm(args, **kw):
    return subprocess.run(['nice', '-n', '10', 'ffmpeg', '-hide_banner', '-nostdin', '-threads', '2'] + args, **kw)
def analyze(path, out_npz, ss=None, t=None):
    a = []
    if ss is not None: a += ['-ss', str(ss)]
    if t is not None: a += ['-t', str(t)]
    p = subprocess.Popen(['nice', '-n', '10', 'ffmpeg', '-hide_banner', '-nostdin', '-threads', '2', '-loglevel', 'error'] + a + ['-i', path, '-ac', '1', '-ar', str(SR), '-f', 's16le', '-'], stdout=subprocess.PIPE)
    f = np.fft.rfftfreq(SR, 1 / SR); win = np.hanning(SR)
    bands = {'low': (40, 250), 'mid': (250, 2000), 'bird': (2000, 8000), 'hi': (8000, 14000)}
    idx = {k: (f >= lo) & (f < hi) for k, (lo, hi) in bands.items()}
    fl = (f >= 500) & (f < 12000)
    rows = []
    while True:
        b = p.stdout.read(SR * 2)
        if len(b) < SR * 2: break
        x = np.frombuffer(b, '<i2').astype(np.float32) / 32768
        rms = np.sqrt(np.mean(x * x)) + 1e-9
        P = np.abs(np.fft.rfft(x * win)) ** 2 + 1e-20
        r = [20 * np.log10(rms), np.max(np.abs(x))]
        r += [10 * np.log10(P[idx[k]].sum()) for k in bands]
        pf = P[fl]; r.append(np.exp(np.mean(np.log(pf))) / np.mean(pf))  # spectral flatness 0.5-12k
        rows.append(r)
    p.wait()
    A = np.array(rows, dtype=np.float32)
    np.save(out_npz, A)
    return A
def loud(path, af=None):
    r = ffm(['-i', path] + (['-af', af + ',ebur128=peak=true'] if af else ['-af', 'ebur128=peak=true']) + ['-f', 'null', '-'], capture_output=True, text=True, errors='replace')
    s = r.stderr[r.stderr.rfind('Summary'):]
    g = lambda k: float(re.search(k + r':\s+(-?[\d.]+|-inf)', s).group(1).replace('-inf', '-99'))
    return dict(I=g('I'), LRA=g('LRA'), TP=g('Peak'))
def summarize(A):
    lv = A[:, 0]; med = np.median(lv)
    ev = int(np.sum(lv > med + 12))
    low_rel = np.median(A[:, 2] - np.log10(np.sum(10 ** (A[:, 2:6] / 10), axis=1)) * 10)
    hi_floor = np.percentile(A[:, 5], 10); bird_floor = np.percentile(A[:, 4], 10); bird_p90 = np.percentile(A[:, 4], 90)
    return dict(secs=len(A), rms_med=round(float(med), 1), rms_p95=round(float(np.percentile(lv, 95)), 1), events12=ev,
                low_rel_db=round(float(low_rel), 1), flat_med=round(float(np.median(A[:, 6])), 3),
                hi_minus_bird_floor=round(float(hi_floor - bird_floor), 1), bird_dyn=round(float(bird_p90 - bird_floor), 1))
if __name__ == '__main__':
    W = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    meta = json.load(open(os.path.join(W, 'meta.json')))
    res_p = os.path.join(W, 'analysis.json'); res = json.load(open(res_p)) if os.path.exists(res_p) else {}
    keys = sys.argv[1:] or list(meta)
    for k in keys:
        if k in res and '--force' not in sys.argv: continue
        if k not in meta: continue
        A = analyze(meta[k]['path'], os.path.join(W, 'an', k + '.npy'))
        s = summarize(A); s.update(loud(meta[k]['path']))
        res[k] = s; json.dump(res, open(res_p, 'w'), indent=1)
        print(k, s, flush=True)
