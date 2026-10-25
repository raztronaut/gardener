"""Shared helpers for SB2 battle RE experiments (RAM map constants + pokes).

All addresses are WRAM offsets (CPU address = $7E0000 + offset). See NOTES-re.md.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, '..', 'harness'), HERE]
import numpy as np
from snes import Snes, B, STATES_DIR, ROOT   # noqa: E402

# ---- globals -------------------------------------------------------------
STAGE = 0x001A          # word: battle stage id (0,1,2,5,6,7,8,9,A,B for stages 1..10)
MODE = 0x00B9           # word: bit15 = battle mode
FRAME = 0x0032          # word: logic tick counter (+1 per executed game frame)
NMI = 0x0036            # word: NMI counter (+1 per video frame)
OFS_Y = 0x5EFB          # word: arena Y offset used for grid lookup (0x17)
OFS_X = 0x5F01          # word: arena X offset (0x08)
PLAYER_LIST = 0x2620    # words: pointers to player objects, $FFFF terminated

# ---- grids (bank $7F) ----------------------------------------------------
GRID = 0x1C000          # $7FC000: collision grid, word per cell, 64 cells x 32 rows (row stride 0x80 bytes)
GRID_BASE = 0x1D000     # $7FD000: underlay (value restored when a bomb/fire/item leaves)
GRID_W, GRID_H = 64, 32
INNER = (2, 4, 13, 11)  # first inner col, row, width, height (cols 2..14, rows 4..14)

# ---- players ($7E8000 + 0x100*i) ----------------------------------------
PBASE = 0x8000
PSIZE = 0x100


def poff(i, field):
    return PBASE + PSIZE * i + field


def cell_of(x, y, ofs_x=8, ofs_y=0x17):
    return ((x + ofs_x) & 0x3F0) >> 4, ((y + ofs_y) & 0x3F0) >> 4


def grid_index(cx, cy):
    return cy * 0x80 + cx * 2


class Game:
    def __init__(self, render=False, multitap=False):
        self.S = Snes(render=render, multitap=multitap)

    def load(self, name):
        p = name if os.path.isabs(name) else os.path.join(STATES_DIR, name + '.state')
        self.S.load_state_file(p)

    def w(self):
        return self.S.wram(live=True)

    def r8(self, off):
        return int(self.w()[off])

    def r16(self, off):
        w = self.w()
        return int(w[off]) | (int(w[off + 1]) << 8)

    def w8(self, off, v):
        self.w()[off] = v & 0xff

    def w16(self, off, v):
        w = self.w()
        w[off] = v & 0xff
        w[off + 1] = (v >> 8) & 0xff

    def grid(self):
        g = self.w()[GRID:GRID + 0x1000].view('<u2').reshape(GRID_H, GRID_W)
        return g.copy()

    def cell(self, cx, cy):
        return self.r16(GRID + grid_index(cx, cy))

    def set_cell(self, cx, cy, v, base=None):
        self.w16(GRID + grid_index(cx, cy), v)
        if base is not None:
            self.w16(GRID_BASE + grid_index(cx, cy), base)

    def clear_soft(self):
        """Make every soft block (0xC2) floor in the logic grids (visuals untouched)."""
        for cy in range(GRID_H):
            for cx in range(GRID_W):
                if self.cell(cx, cy) & 0xFF == 0xC2:
                    self.set_cell(cx, cy, 0, 0)

    def player(self, i):
        b = PBASE + PSIZE * i
        return dict(x=self.r16(b + 0x10), xf=self.r16(b + 0x12), y=self.r16(b + 0x18),
                    yf=self.r16(b + 0x1A), flags=self.r16(b), f2=self.r16(b + 2), f4=self.r16(b + 4),
                    speed=self.r8(b + 0xF0), inp=self.r16(b + 0x6E))

    def step(self, pads=0):
        self.S.step(pads)

    def tick(self):
        return self.r16(FRAME)


def grid_text(g, x0=1, y0=3, x1=16, y1=16):
    rows = []
    for cy in range(y0, y1):
        rows.append(' '.join('%02X' % (g[cy, cx] & 0xff) for cx in range(x0, x1)))
    return '\n'.join(rows)
