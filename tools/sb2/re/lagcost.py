"""Per-tick CPU cost of the original battle loop, measured in master cycles.

    python3 lagcost.py                 # every vector -> data/sb2/re/lag/<name>.npz
    python3 lagcost.py cpu_round ...   # only some
    python3 lagcost.py --summary       # print the table from the saved files

Replays each test vector (data/sb2/vectors, same start state / settle / pokes / pads as
vectors.py) in the harness with the v2 cycle hooks (tools/sb2/harness/sb2_shim.cpp):
every instruction at the PCs below is logged with the running master-cycle counter, so
each frame gives exact timestamps for

    NMI entry 00FD84 (and A = $16 at 00FDA5: 0 -> the NMI found the tick unfinished = lag)
    NMI exit  00FDEE
    tick start C0FB23 (the main loop leaves its wait on $36)
    each top-level JSL of the main loop C0FB39..C0FB89, INC $16 at C0FB8D (tick done),
    C0FB96 (C100BD after the tick), C0FB18 (back in the wait)
    per object in C01E1D: C01E3C (object pointer in A), C01E64 (COM AI C0C54B),
    C01E68 (after the AI), C01E94 (OAM build C09C7B), C01E98 (object done)

From those: the tick's work in cycles (start -> INC $16, NMI time inside removed), the
cost of each routine, of the AI per COM call, of the OAM build per object, and of the NMI.
The frame is 262 lines x 1364 = 357368 master cycles (NTSC, 60.0988 Hz).

Output per vector (npz): ticks[] records (see FIELDS), nmis[] (start, end, lag flag),
and the vector's frame -> tick grouping for the model fit (tools/sb2/conformance/lagfit.mjs).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), HERE]
import numpy as np  # noqa: E402
from snes import Snes, STATES_DIR, ROOT  # noqa: E402
from hooks import Hooks  # noqa: E402

VEC = os.path.join(ROOT, 'data', 'sb2', 'vectors')
OUT = os.path.join(ROOT, 'data', 'sb2', 're', 'lag')
MYSTATES = os.path.join(ROOT, 'data', 'sb2', 're', 'states')
FRAME = 262 * 1364

NMI_IN, NMI_A16, NMI_OUT = 0x00FD84, 0x00FDA5, 0x00FDEE
T_START, T_DONE, T_POST, T_WAIT = 0xC0FB23, 0xC0FB8D, 0xC0FB96, 0xC0FB18
MAIN_JSL = [0xC0FB39 + 4 * k for k in range(21)]          # C00C36 .. C00A38
MAIN_NAMES = ['C00C36', 'C00000', 'C01602', 'C0D8E8', 'C10C3C', 'C0D843', 'C036E6', 'C01E1D',
              'C10CAF', 'C0DCB4', 'C0E0AA', 'C0E076', 'C0DA42', 'C00617', 'C005EA', 'C1334B',
              'C09615', 'C11C1A', 'C10971', 'C00CAA', 'C00A38']
O_PTR, O_AI, O_AIEND, O_OAM, O_END = 0xC01E3C, 0xC01E64, 0xC01E68, 0xC01E94, 0xC01E98
# every call site of the per-object loop (segment k = site k .. the next traced site)
O_SITES = [0xC01E3C, 0xC01E48, 0xC01E4C, 0xC01E64, 0xC01E68, 0xC01E6C, 0xC01E70, 0xC01E74, 0xC01E78,
           0xC01E7C, 0xC01E80, 0xC01E84, 0xC01E88, 0xC01E8C, 0xC01E90, 0xC01E94, 0xC01E98]
O_NAMES = ['head', 'C0A4F7', 'run?', 'C0C54B', 'C022E2', 'C03686', 'C04337', 'C065F1', 'C05741',
           'C0A474', 'C08230', 'C02945', 'C0224A', 'C0A146', 'C0A120', 'C09C7B', 'end']
PCS = [NMI_IN, NMI_A16, NMI_OUT, T_START, T_DONE, T_POST, T_WAIT] + MAIN_JSL + O_SITES


def load_state(S, name):
    for d in (STATES_DIR, MYSTATES):
        p = os.path.join(d, name + '.state')
        if os.path.exists(p):
            S.load_state_file(p)
            return
    raise FileNotFoundError(name)


def measure(S, H, v):
    load_state(S, v['start']['state'])
    for _ in range(v['start']['settle_frames']):
        S.step(0)
    w = S.wram(live=True)
    for a, b, c in v['start']['pokes']:
        w[a] = b & 0xff
        if c == 2:
            w[a + 1] = (b >> 8) & 0xff
    H.trace_config(1, 0)               # empty range: only the PC set
    H.trace_pcs([], on=False)
    H.trace_pcs(PCS)
    H.enable(trace=True)
    H.trace()
    evs = []
    for i, fr in enumerate(v['frames']):
        H.set_tag(i)
        S.step(tuple(fr['pads']))
        t = H.trace()
        if len(t):
            evs.append(t)
    H.off()
    ev = np.concatenate(evs) if evs else np.zeros(0)
    # unwrap the 32-bit cycle counter
    cyc = ev['cyc'].astype(np.int64)
    wraps = np.cumsum(np.r_[0, (np.diff(cyc) < -(1 << 31)).astype(np.int64)])
    cyc = cyc + (wraps << 32)
    return ev, cyc


def analyse(ev, cyc):
    pc = ev['pc']
    # NMIs: entry .. exit, with the $16 flag
    nmis = []
    cur = None
    for k in range(len(ev)):
        p = pc[k]
        if p == NMI_IN:
            cur = [cyc[k], 0, 1, int(ev['tag'][k])]
        elif p == NMI_A16 and cur is not None:
            cur[2] = 1 if ev['a'][k] else 0       # 1 = the previous tick had completed
        elif p == NMI_OUT and cur is not None:
            cur[1] = cyc[k]
            nmis.append(cur)
            cur = None
    nmis = np.array(nmis, np.int64).reshape(-1, 4)

    def nmi_time(a, b):
        """cycles of NMI handlers inside [a, b)"""
        if not len(nmis):
            return 0
        s = np.clip(nmis[:, 0], a, b)
        e = np.clip(nmis[:, 1], a, b)
        return int((e - s).sum())

    ticks = []
    k = 0
    n = len(ev)
    while k < n:
        if pc[k] != T_START:
            k += 1
            continue
        t0 = cyc[k]
        rec = dict(start=int(t0), frame=int(ev['tag'][k]), routines=[0] * 21, ai=[], oam=[], objs=0, obj=[])
        objsegs = []

        def close_obj(rec, segs, objp, tend):
            # [ptr, cycles per segment (17, NMI time removed)]; oam = segment 15
            seg = [0] * len(O_SITES)
            pts = segs + [(None, tend)] if segs[-1][1] != tend else segs
            for (a, ta), (_, tb) in zip(pts, pts[1:]):
                seg[a] += int(tb - ta - nmi_time(ta, tb))
            rec['obj'].append([objp] + seg)
            rec['oam'].append([objp, seg[15]])
        marks = {}
        objp = None
        obj_t = None
        ai_t = None
        oam_t = None
        j = k + 1
        while j < n and pc[j] != T_START:
            p = pc[j]
            if p in MAIN_JSL_SET:
                marks[MAIN_JSL.index(p)] = cyc[j]
            elif p == T_DONE:
                marks[21] = cyc[j]
                rec['done'] = int(cyc[j])
                rec['done_frame'] = int(ev['tag'][j])
            elif p == T_POST:
                rec['post'] = int(cyc[j])
            elif p == T_WAIT and 'done' in rec and 'wait' not in rec:
                rec['wait'] = int(cyc[j])
                rec['wait_frame'] = int(ev['tag'][j])
            elif p in O_SITE_SET:
                if p == O_PTR:
                    if objp is not None:
                        close_obj(rec, objsegs, objp, cyc[j])
                    objp = int(ev['a'][j])
                    objsegs = []
                    rec['objs'] += 1
                if objp is not None:
                    objsegs.append((O_SITES.index(p), cyc[j]))
                if p == O_END and objp is not None:
                    close_obj(rec, objsegs, objp, cyc[j])
                    objp = None
                if p == O_AI:
                    ai_t = cyc[j]
                elif p == O_AIEND and ai_t is not None:
                    rec['ai'].append([objp, int(cyc[j] - ai_t - nmi_time(ai_t, cyc[j]))])
                    ai_t = None
                elif p == O_OAM:
                    oam_t = cyc[j]
            j += 1
        if 'done' in rec:
            for r in range(21):
                if r in marks and (r + 1) in marks:
                    rec['routines'][r] = int(marks[r + 1] - marks[r] - nmi_time(marks[r], marks[r + 1]))
            rec['work'] = int(rec['done'] - t0 - nmi_time(t0, rec['done']))
            if 'wait' in rec:
                rec['work_wait'] = int(rec['wait'] - t0 - nmi_time(t0, rec['wait']))
            ticks.append(rec)
        k = j
    return nmis, ticks


MAIN_JSL_SET = set(MAIN_JSL)
O_SITE_SET = set(O_SITES)


def run(names):
    os.makedirs(OUT, exist_ok=True)
    groups = {}
    for n in names:
        v = json.load(open(os.path.join(VEC, n + '.json')))
        groups.setdefault(v['start']['multitap'], []).append(n)
    if len(groups) > 1:
        import subprocess
        for flag, ns in groups.items():
            subprocess.check_call([sys.executable, __file__] + ns)
        return
    for flag, ns in groups.items():
        S = Snes(render=False, multitap=flag)
        H = Hooks(S)
        for n in ns:
            v = json.load(open(os.path.join(VEC, n + '.json')))
            ev, cyc = measure(S, H, v)
            nmis, ticks = analyse(ev, cyc)
            json.dump(dict(name=n, frames=len(v['frames']), nmis=nmis.tolist(), ticks=ticks,
                           frame_cycles=FRAME), open(os.path.join(OUT, n + '.json'), 'w'))
            w = np.array([t['work'] for t in ticks])
            lag = int((nmis[:, 2] == 0).sum()) if len(nmis) else 0
            print('%-22s frames %5d ticks %5d  work mean %6d max %6d  lag NMIs %d' % (
                n, len(v['frames']), len(ticks), w.mean() if len(w) else 0, w.max() if len(w) else 0, lag))


def summary():
    for f in sorted(os.listdir(OUT)):
        d = json.load(open(os.path.join(OUT, f)))
        w = np.array([t['work'] for t in d['ticks']])
        n = np.array(d['nmis'])
        print('%-22s ticks %5d work mean %6d p99 %6d max %6d  nmi mean %5d  lag %d' % (
            d['name'], len(w), w.mean(), np.percentile(w, 99), w.max(),
            (n[:, 1] - n[:, 0]).mean(), (n[:, 2] == 0).sum()))


if __name__ == '__main__':
    a = sys.argv[1:]
    if '--summary' in a:
        summary()
    else:
        names = [x for x in a if not x.startswith('--')] or sorted(
            f[:-5] for f in os.listdir(VEC) if f.endswith('.json'))
        run(names)
