"""Check the escape-direction model (notes-ai.md) against the game: random danger
maps poked into $7F8000 around a COM, run one tick, compare the COM's plan buffer.
    python3 ai_escape_check.py [trials]"""
import sys
import os
import random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sb2lib import Game, poff, GRID  # noqa: E402

DANGER = 0x18000
R, L, D, U = 0x100, 0x200, 0x400, 0x800


def blocked_fwd(c):
    return c in (0x0E, 0x43, 0x01) or (c & 0x80)


def blocked_side(c):
    return c in (0x43, 0x01) or (c & 0x80)


def scan(grid, dng, cell, d, s1, s2):
    cur, n = cell, 0
    while True:
        cur += d
        if cur >= 0x2000 or cur < 0:
            return 0, n
        if blocked_fwd(grid(cur)):
            return 0, n
        n += 1
        if dng(cur) == 0:
            return 0x8000, n
        for s, fl in ((s1, 0x8002), (s2, 0x8003)):
            if not blocked_side(grid(cur + s)) and dng(cur + s) == 0:
                return fl, n


def model(grid, dng, cell):
    r = scan(grid, dng, cell, 2, -0x80, 0x80)
    l = scan(grid, dng, cell, -2, -0x80, 0x80)
    u = scan(grid, dng, cell, -0x80, -2, 2)
    dn = scan(grid, dng, cell, 0x80, -2, 2)
    h = hc = None
    if r[0] and (not l[0] or r[1] >= l[1]):
        h, hc = R, r
    elif l[0]:
        h, hc = L, l
    v = vc = None
    if dn[0] and (not u[0] or dn[1] >= u[1]):
        v, vc = D, dn
    elif u[0]:
        v, vc = U, u
    if not h and not v:
        return None
    if v and (not h or vc[1] < hc[1]):
        ch, res = v, vc
    else:
        ch, res = h, hc
    plan = [(ch, res[1])]
    if res[0] & 2:
        if ch in (R, L):
            plan.append((D if res[0] & 1 else U, 1))
        else:
            plan.append((R if res[0] & 1 else L, 1))
    return plan


def main():
    trials = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    G = Game()
    G.load('battle_start')
    G.step()
    base = G.S.save_state()
    rnd = random.Random(7)
    ok = bad = skip = 0
    for t in range(trials):
        G.S.load_state(base)
        floors = [(cx, cy) for cy in range(4, 15) for cx in range(2, 15) if G.cell(cx, cy) & 0xFF == 0]
        cx, cy = rnd.choice(floors)
        cell = cy * 0x80 + cx * 2
        G.w16(poff(1, 0x10), cx * 16)
        G.w16(poff(1, 0x18), cy * 16 - 16)
        G.w16(poff(1, 0xBE), 0)
        G.w16(poff(1, 0xA8), cell)
        G.w16(poff(1, 0x38), cell)
        # random danger blob around the cell
        for y in range(3, 16):
            for x in range(1, 16):
                G.w16(DANGER + y * 0x80 + x * 2, 0xFFFF if (abs(x - cx) + abs(y - cy) <= rnd.randint(0, 4)) else 0)
        G.w16(DANGER + cell, 0xFFFF)
        grid = lambda a: G.r16(GRID + a) & 0xFF
        dng = lambda a: G.r16(DANGER + a)
        exp = model(grid, dng, cell)
        G.step(0)
        if not (G.r16(poff(1, 0xBE)) & 0x4000):
            skip += 1
            continue
        got = []
        b = 0x600
        for k in range(4):
            d = G.r16(b + 4 * k)
            if d == 0xFFFF:
                break
            got.append((d, G.r16(b + 4 * k + 2)))
        if exp is None:
            e = [(0, 0xFFF)]
        else:
            e = exp
        # the executor may already have consumed nothing (count only drops on reaching a cell centre)
        if got == e:
            ok += 1
        else:
            bad += 1
            if bad < 10:
                print('cell', (cx, cy), 'exp', e, 'got', got)
    print('ok', ok, 'bad', bad, 'skipped', skip)


if __name__ == '__main__':
    main()
