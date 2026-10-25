"""Per-tick log of a COM bomber's AI state (for checking notes-ai.md).

    python3 ai_trace.py [state] [slot] [frames] [level_index]
Prints: tick, $32&3, cell (cx,cy), +BE, +DC, +D8, +EC, +6E (input), plan buffer
entries ($0500 + $100*slot), danger at own cell.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sb2lib import Game, B, poff  # noqa: E402


def plan(G, slot):
    base = 0x500 + 0x100 * slot
    out = []
    for k in range(6):
        d = G.r16(base + 4 * k)
        if d == 0xFFFF:
            break
        out.append('%s%d' % ({0x100: 'R', 0x200: 'L', 0x400: 'D', 0x800: 'U', 0: '-'}.get(d, '%X' % d),
                             G.r16(base + 4 * k + 2)))
    return ','.join(out)


def main():
    st = sys.argv[1] if len(sys.argv) > 1 else 'battle_start'
    slot = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 600
    G = Game()
    G.load(st)
    G.step()
    if len(sys.argv) > 4:
        for i in range(4):
            G.w16(poff(i, 0xD2), int(sys.argv[4]))
    last = None
    for f in range(n):
        G.step(0)
        t = G.tick()
        if t == last:
            continue
        last = t
        a = G.r16(poff(slot, 0xA8))
        cx, cy = (a & 0x7F) // 2, a // 0x80
        print('%5d %d (%2d,%2d) BE=%04X DC=%02X D8=%02X EC=%02X in=%04X dng=%04X cell=%02X plan=%s' % (
            t, t & 3, cx, cy, G.r16(poff(slot, 0xBE)), G.r16(poff(slot, 0xDC)), G.r16(poff(slot, 0xD8)),
            G.r16(poff(slot, 0xEC)), G.r16(poff(slot, 0x6E)), G.r16(0x18000 + a), G.r16(0x1C000 + a) & 0xFF,
            plan(G, slot)))


if __name__ == '__main__':
    main()
