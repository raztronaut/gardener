"""WRAM watching / diffing tools.

1. Per-frame history (what changed, when):
       W = RamWatch(S)                 # snapshots WRAM after every frame you run via W
       W.run(120, pads=B.RIGHT)
       W.changed()                     # addresses that changed at least once
       W.series(0x0C40)                # value of $7E0C40 per frame
       W.report(addrs)                 # compact text table

2. Counterfactual diff (the deterministic-emulator trick: "what does X change?"):
       d = event_diff(S, state, frames=60, with_pads=B.B, without_pads=0)
       # runs the same state twice, once with X and once without, and lists
       # addresses whose values differ (and from which frame on)

3. Classic narrowing search (cheat-finder style):
       srch = Search(S)                # candidates = all 128K bytes
       ... do something ...; srch.keep('changed')
       ... nothing ...;      srch.keep('same')
       srch.keep('eq', 3); srch.keep('dec'); srch.candidates()

Addresses are WRAM offsets 0x00000-0x1FFFF; CPU address = 0x7E0000 + offset
(and offsets < 0x2000 are also mirrored at $00-$3F:0000-1FFF).
"""
import numpy as np


def fmt_addr(off):
    return '$%06X' % (0x7E0000 + off)


class RamWatch:
    def __init__(self, S, include_initial=True):
        self.S = S
        self.frames = []          # list of np.uint8 arrays (128 KB each)
        self.pads = []
        if include_initial:
            self.frames.append(S.wram())
            self.pads.append(None)

    def step(self, pads=0):
        self.S.step(pads)
        self.frames.append(self.S.wram())
        self.pads.append(pads)

    def run(self, n, pads=0):
        if isinstance(pads, list):
            for p in pads[:n]:
                self.step(p)
        elif callable(pads):
            for i in range(n):
                self.step(pads(i))
        else:
            for _ in range(n):
                self.step(pads)

    def matrix(self, lo=0, hi=None):
        return np.stack(self.frames)[:, lo:hi]

    def changed(self, lo=0, hi=None, min_changes=1):
        """Offsets whose value changed between consecutive snapshots >= min_changes times."""
        m = self.matrix(lo, hi)
        n = (np.diff(m.astype(np.int16), axis=0) != 0).sum(0)
        return [int(i) + lo for i in np.nonzero(n >= min_changes)[0]]

    def change_counts(self):
        m = self.matrix()
        return (np.diff(m.astype(np.int16), axis=0) != 0).sum(0)

    def series(self, off, width=1):
        m = self.matrix()
        v = m[:, off].astype(np.int64)
        for k in range(1, width):
            v |= m[:, off + k].astype(np.int64) << (8 * k)
        return v

    def changed_at(self, frame_index):
        """Offsets that changed going into snapshot `frame_index` (1-based frame)."""
        a, b = self.frames[frame_index - 1], self.frames[frame_index]
        return [int(i) for i in np.nonzero(a != b)[0]]

    def report(self, offs, every=1, maxcols=40):
        rows = []
        for o in offs:
            s = self.series(o)[::every][:maxcols]
            rows.append('%s %s' % (fmt_addr(o), ' '.join('%02X' % x for x in s)))
        return '\n'.join(rows)


def event_diff(S, state, frames, with_pads, without_pads=0, settle=0):
    """Run `state` twice for `frames` frames: once with with_pads (int/tuple/list/
    callable as in Snes.run) and once with without_pads. Returns a list of
    (offset, first_frame_differs, values_with[-1], values_without[-1]) for every WRAM
    byte that ever differs, sorted by first divergence."""
    def trace(p):
        S.load_state(state)
        W = RamWatch(S, include_initial=False)
        W.run(frames, p)
        if settle:
            W.run(settle, 0)
        return W.matrix()
    a = trace(with_pads)
    b = trace(without_pads)
    diff = a != b
    anyd = diff.any(0)
    first = np.argmax(diff, axis=0)
    out = [(int(o), int(first[o]), int(a[-1, o]), int(b[-1, o])) for o in np.nonzero(anyd)[0]]
    out.sort(key=lambda t: (t[1], t[0]))
    return out


class Search:
    """Narrow down candidate WRAM addresses by successive predicates."""

    def __init__(self, S):
        self.S = S
        self.prev = S.wram()
        self.mask = np.ones(self.prev.size, bool)

    def keep(self, how, value=None):
        cur = self.S.wram()
        p, c = self.prev.astype(np.int16), cur.astype(np.int16)
        cond = {
            'changed': c != p, 'same': c == p,
            'inc': c > p, 'dec': c < p,
            'eq': c == (value if value is not None else 0),
            'ne': c != (value if value is not None else 0),
            'delta': (c - p) == (value if value is not None else 0),
        }[how]
        self.mask &= cond
        self.prev = cur
        return int(self.mask.sum())

    def candidates(self, limit=200):
        idx = np.nonzero(self.mask)[0][:limit]
        cur = self.S.wram()
        return [(int(i), fmt_addr(int(i)), int(cur[i])) for i in idx]
