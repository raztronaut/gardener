"""Measure COM-level effects: all 4 bombers COM (P1 forced to COM via +04 bit0),
COM level index poked into every +D2, then count bombs placed per COM and the
tick each one died.   python3 ai_levels.py [state] [frames] [levels...]"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sb2lib import Game, poff  # noqa: E402


def run(G, st, lvl, frames):
    G.load(st)
    G.step()
    for i in range(4):
        G.w16(poff(i, 0x04), G.r16(poff(i, 0x04)) | 1)
        G.w16(poff(i, 0xD2), lvl)
    bombs = [0] * 4
    died = [None] * 4
    prev = [G.r8(poff(i, 0xF8)) for i in range(4)]
    for f in range(frames):
        G.step(0)
        for i in range(4):
            v = G.r8(poff(i, 0xF8))
            if v > prev[i]:
                bombs[i] += v - prev[i]
            prev[i] = v
            if died[i] is None and G.r16(poff(i, 0)) & 0x0800:
                died[i] = G.tick()
    return bombs, died


def main():
    st = sys.argv[1] if len(sys.argv) > 1 else 'battle_start'
    frames = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
    lv = [int(x) for x in sys.argv[3:]] or [0, 4, 8]
    G = Game()
    for l in lv:
        b, d = run(G, st, l, frames)
        print('level index %d (COM LEVEL %d): bombs %s  died at tick %s' % (l, l + 1, b, d))


if __name__ == '__main__':
    main()
