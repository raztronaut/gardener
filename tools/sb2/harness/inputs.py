"""Input-script player.

Format (one command per line, '#' starts a comment):

    <frames> [P1] [P2] [P3] [P4] [P5]   hold these buttons for <frames> frames
    !save <path>                        save state (relative paths -> data/sb2/states/)
    !load <path>                        load state
    !png  <path>                        save current frame (relative -> data/sb2/debug/)
    !mark <name>                        remember the current frame number

Buttons: B Y SELECT START UP DOWN LEFT RIGHT A X L R joined with '+', or '-'
for none, or a hex mask (0x108).  Missing ports are released.  Example:

    250                 # wait through the intro
    2 START             # skip it
    60
    1 DOWN              # cursor to BATTLE GAME
    10
    1 START
    30 RIGHT+B -        # P1 right+B, P2 nothing

CLI:  python3 inputs.py script.txt [--state in.state] [--save out.state]
          [--png out.png] [--sheet out.png --every 30] [--multitap]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from snes import B, STATES_DIR, DEBUG_DIR  # noqa: E402


def parse(text):
    """-> list of ops: ('run', frames, (p1, p2, ...)) | ('save'|'load'|'png'|'mark', arg)."""
    ops = []
    for ln, line in enumerate(text.splitlines(), 1):
        line = line.split('#', 1)[0].strip()
        if not line:
            continue
        if line.startswith('!'):
            cmd, _, arg = line[1:].partition(' ')
            cmd = cmd.lower()
            if cmd not in ('save', 'load', 'png', 'mark'):
                raise ValueError('line %d: unknown directive %r' % (ln, cmd))
            ops.append((cmd, arg.strip()))
            continue
        parts = line.split()
        try:
            n = int(parts[0])
            pads = tuple(B.parse(p) for p in parts[1:])
        except ValueError as e:
            raise ValueError('line %d: %s' % (ln, e))
        ops.append(('run', n, pads))
    return ops


def expand(ops):
    """Flatten run ops into a per-frame list of pad tuples (directives ignored)."""
    out = []
    for op in ops:
        if op[0] == 'run':
            out.extend([op[2]] * op[1])
    return out


def to_text(frames_pads):
    """Inverse of expand: compress a per-frame list of pad tuples into script text."""
    lines, prev, n = [], None, 0
    for p in list(frames_pads) + [None]:
        p = None if p is None else (tuple(p) if not isinstance(p, int) else (p,))
        if p == prev and p is not None:
            n += 1
            continue
        if prev is not None:
            while len(prev) > 1 and prev[-1] == 0:
                prev = prev[:-1]
            lines.append(' '.join([str(n)] + [B.fmt(x) for x in prev]))
        prev, n = p, 1
    return '\n'.join(lines) + '\n'


def _path(p, d):
    return p if os.path.isabs(p) else os.path.join(d, p)


def play(S, script, on_frame=None):
    """Run a script (text or parsed ops) on Snes S. Returns {mark: frame_count}."""
    ops = parse(script) if isinstance(script, str) else script
    marks = {}
    for op in ops:
        kind = op[0]
        if kind == 'run':
            S.run(op[1], pads=op[2] if op[2] else 0, on_frame=on_frame)
        elif kind == 'save':
            S.save_state_file(_path(op[1], STATES_DIR))
        elif kind == 'load':
            S.load_state_file(_path(op[1], STATES_DIR))
        elif kind == 'png':
            S.png(_path(op[1], DEBUG_DIR))
        elif kind == 'mark':
            marks[op[1]] = S.frame_count
    return marks


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description='play an sb2 input script')
    ap.add_argument('script')
    ap.add_argument('--state', help='load this state first')
    ap.add_argument('--save', help='save state at the end')
    ap.add_argument('--png', help='save last frame')
    ap.add_argument('--sheet', help='contact sheet of every Nth frame')
    ap.add_argument('--every', type=int, default=30)
    ap.add_argument('--multitap', action='store_true')
    a = ap.parse_args(argv)
    from snes import Snes
    S = Snes(multitap=a.multitap)
    if a.state:
        S.load_state_file(a.state)
    sh = None
    cb = None
    if a.sheet:
        from sheet import Sheet
        sh = Sheet()
        cb = lambda S, i: (S.frame_count % a.every == 0) and sh.add(S, 'f%d' % S.frame_count)
    text = sys.stdin.read() if a.script == '-' else open(a.script).read()
    marks = play(S, text, on_frame=cb)
    if a.save:
        S.save_state_file(a.save)
    if a.png:
        S.png(a.png)
    if sh:
        sh.save(a.sheet, cols=5)
    print('frames', S.frame_count, 'wram', S.wram_hash(), 'marks', marks)


if __name__ == '__main__':
    main(sys.argv[1:])
