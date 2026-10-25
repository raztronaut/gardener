"""Per-frame capture of everything the extractors need, plus WRAM facts we rely on.

WRAM facts used by the extractors (measured in the harness, 2026-10-25, battle mode;
phase 2b owns the authoritative RAM map in tools/sb2/NOTES-re.md):
  * player structs: $7E8000 + 0x100*i (i = 0..3 = P1 white, P2 black, P3 red, P4 blue)
      +0x10 u16  x, +0x18 u16 y: logical position in arena pixels; a bomber centred on
                 arena cell (c, r) has x = 16c + 16, y = 16r + 32, and that cell's top-left
                 on screen is (x - 8, y - 7).  The OAM lags these by one frame.
      (+0x82/+0x84 look like x/y but are the OAM position of one sprite piece: +0x84
       toggles by 16 depending on which piece is drawn first -- don't use them.)
  * arena grid: $7FC180 + r*0x80 + (c+1)*2, r = 0..12, c = 0..14 (byte per cell; the
      15x13 grid includes the outer wall ring).  Codes seen: 00 floor, 01 flame,
      41 burning item, 43 bomb, 44 item, C1 pressure block (sudden death), C2 soft block,
      C4/C5 hard, C6 outer wall (stage gimmicks add more).
  * BG2 tilemap mirror: $7FA000 (32x32 entries, same layout as VRAM $4000).  Writing an
      item tile here + in VRAM + grid code 44 spawns a real, collectable item.
Screen geometry (battle): BG2 64x64 16x16-tile map at VRAM $4000, arena cell (c, r)
at BG2 pixel (16 + 16c, 48 + 16r); screen = BG - (hofs, vofs + 1) = BG - (8, 23).
"""
import numpy as np

from snesgfx import decode_oam, render_bg, render_sprite, obj_size, compose_sprites

PLAYER_BASE = 0x8000          # WRAM offset of P1 struct
PLAYER_STRIDE = 0x100
GRID_BASE = 0x1C180           # WRAM offset ($7FC180)
GRID_STRIDE = 0x80
MIRROR_BASE = 0x1A000         # WRAM offset of BG2 tilemap mirror ($7FA000)
BG2_MAP = 0x4000              # VRAM word address of BG2 tilemap
ARENA_W, ARENA_H = 15, 13
ARENA_X0, ARENA_Y0 = 1, 3     # arena cell (0,0) = BG2 map cell (1,3)


def grid(w):
    """(13, 15) uint8 grid codes from a WRAM array."""
    out = np.zeros((ARENA_H, ARENA_W), np.uint8)
    for r in range(ARENA_H):
        a = GRID_BASE + r * GRID_STRIDE + 2
        out[r] = w[a:a + 2 * ARENA_W:2]
    return out


def arena_entries(vram):
    v = np.asarray(vram, np.uint8).view('<u2')
    m = v[BG2_MAP:BG2_MAP + 1024].reshape(32, 32)
    return m[ARENA_Y0:ARENA_Y0 + ARENA_H, ARENA_X0:ARENA_X0 + ARENA_W].copy()


def player_xy(w, i):
    """Logical position (arena pixels): cell (c, r) centre-aligned = (16c+16, 16r+32)."""
    b = PLAYER_BASE + PLAYER_STRIDE * i
    return int(w[b + 0x10]) | (int(w[b + 0x11]) << 8), int(w[b + 0x18]) | (int(w[b + 0x19]) << 8)


def cell_of_xy(x, y):
    return (x - 16) / 16.0, (y - 32) / 16.0


def cell_screen_of_xy(x, y):
    """Screen top-left of the cell a bomber at logical (x, y) is aligned to."""
    return x - 8, y - 7


def spawn_item(S, c, r, entry):
    """Put a collectable item (BG2 entry, e.g. 0x1624) on arena cell (c, r)."""
    w = S.wram(live=True)
    v = S.vram(live=True).view('<u2')
    g = GRID_BASE + r * GRID_STRIDE + (c + 1) * 2
    w[g] = 0x44
    w[g + 1] = 0
    m = MIRROR_BASE + ((r + ARENA_Y0) * 32 + (c + ARENA_X0)) * 2
    w[m] = entry & 0xff
    w[m + 1] = entry >> 8
    v[BG2_MAP + (r + ARENA_Y0) * 32 + (c + ARENA_X0)] = entry


def set_cell(S, c, r, code, entry):
    """Overwrite an arena cell: grid code + BG2 entry (VRAM + WRAM mirror)."""
    w = S.wram(live=True)
    v = S.vram(live=True).view('<u2')
    g = GRID_BASE + r * GRID_STRIDE + (c + 1) * 2
    w[g] = code
    m = MIRROR_BASE + ((r + ARENA_Y0) * 32 + (c + ARENA_X0)) * 2
    w[m] = entry & 0xff
    w[m + 1] = entry >> 8
    v[BG2_MAP + (r + ARENA_Y0) * 32 + (c + ARENA_X0)] = entry


class Frame:
    __slots__ = ('n', 'oam', 'cgram', 'vram', 'ppu', 'wram', 'pads')


class Trace:
    """Run frames and keep full snapshots (VRAM 64K, CGRAM, OAM, WRAM 128K, PPU regs).
    ~200 KB/frame: keep traces to a few thousand frames."""

    def __init__(self, S, keep_wram=True, keep_vram=True):
        self.S = S
        self.frames = []
        self.keep_wram = keep_wram
        self.keep_vram = keep_vram

    def snap(self, pads=None):
        S = self.S
        f = Frame()
        f.n = len(self.frames)
        f.oam = S.oam()
        f.cgram = S.cgram()
        f.vram = S.vram() if self.keep_vram else None
        f.wram = S.wram() if self.keep_wram else None
        f.ppu = S.ppu()
        f.pads = pads
        self.frames.append(f)
        return f

    def run(self, n, pads=0):
        if isinstance(pads, list):
            get = pads.__getitem__
        elif callable(pads):
            get = pads
        else:
            get = lambda i: pads
        for i in range(n):
            p = get(i)
            self.S.step(p)
            self.snap(p)
        return self


# ---- sprite grouping -----------------------------------------------------------
def onscreen(s, ppu):
    w, h = obj_size(ppu, s['large'])
    y = s['y'] if s['y'] < 240 else s['y'] - 256
    return y < 224 and y + h > 0 and s['x'] < 256 and s['x'] + w > 0


def bomber_sprites(f, i, box=(-24, -28, 40, 44)):
    """OAM entries drawn for bomber i in frame f: palette i, near the player's x/y from
    the PREVIOUS frame's struct (OAM lags one frame) -- caller passes `f.prev_xy`."""
    ppu = f.ppu
    x, y = f.prev_xy[i]
    out = []
    for s in decode_oam(f.oam):
        if s['pal'] != i or not onscreen(s, ppu):
            continue
        sy = s['y'] if s['y'] < 240 else s['y'] - 256
        if x + box[0] <= s['x'] <= x + box[2] and y + box[1] <= sy <= y + box[3]:
            out.append(s)
    return out
