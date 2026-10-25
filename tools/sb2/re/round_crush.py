"""Sudden-death side effects: P1 drops a bomb on (2,4), walks down; the timer is poked so
the first falling block lands on the bomb. Logs the bomb slot, P1 bomb counters and P1
death, and a second run where P1 stays on (2,4) to get crushed.
    python3 round_crush.py
"""
from sb2lib import *   # noqa


def run(stay):
    G.load('battle_start')
    G.step()
    G.w16(0x5E10, 0); G.w16(0x5E12, 34); G.w16(0x5E14, 0x30)
    pads = [B.A] + ([0] * 120 if stay else [B.DOWN] * 30 + [0] * 90)
    out = []
    for i, p in enumerate(pads):
        G.step(p)
        out.append((i, G.tick(), '%02X' % (G.cell(2, 4) & 0xff), '%04X' % G.r16(0x12000),
                    G.r8(poff(0, 0xF1)), G.r8(poff(0, 0xF8)), '%04X' % G.r16(poff(0, 0)),
                    G.r16(0x5E12), '%X' % G.r16(0x5D0E)))
    prev = None
    for o in out:
        if o[2:] != prev:
            print(o)
            prev = o[2:]


G = Game()
print('cols: frame tick cell(2,4) bomb0.flags P1.F1(bombs in hand) P1.F8(out) P1.flags sec 5D0E')
print('-- P1 walks away'); run(False)
print('-- P1 stays'); run(True)
