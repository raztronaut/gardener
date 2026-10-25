"""Cross references: find JSL/JSR/JMP/JML (and long/abs operands) to an address range.
    python3 xref.py C0B200 C0B9FF        # callers into [lo, hi]
Uses the exec M/X map so only executed instructions are scanned when available."""
import sys
import numpy as np
from dis65816 import Dis, rom_off


def xrefs(D, lo, hi, only_exec=True):
    out = []
    mx = D.mx
    rom = D.rom
    for off in range(len(rom) - 4):
        if only_exec and mx is not None and not mx[off]:
            continue
        op = rom[off]
        bank = 0xC0 | (off >> 16)
        pc = (bank << 16) | (off & 0xffff)
        if op in (0x22, 0x5C):
            t = rom[off + 1] | rom[off + 2] << 8 | rom[off + 3] << 16
        elif op in (0x20, 0x4C):
            t = (pc & 0xff0000) | rom[off + 1] | rom[off + 2] << 8
        else:
            continue
        if lo <= t <= hi:
            out.append((pc, op, t))
    return out


if __name__ == '__main__':
    lo = int(sys.argv[1], 16)
    hi = int(sys.argv[2], 16) if len(sys.argv) > 2 else lo
    D = Dis()
    for pc, op, t in xrefs(D, lo, hi, '--all' not in sys.argv):
        print('%06X %s %06X' % (pc, {0x22: 'JSL', 0x5C: 'JML', 0x20: 'JSR', 0x4C: 'JMP'}[op], t))
