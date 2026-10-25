"""Small 65816 disassembler for the SB2 HiROM image.

    python3 dis65816.py C08000 [count] [--m8|--m16] [--x8|--x16] [--mx FILE]
    python3 dis65816.py --range C0A000 C0A100

Addresses are CPU addresses (HiROM: ROM offset = ((bank & 0x3F) << 16) | addr).
Operand sizes for immediate M/X ops come from (in order): the exec M/X map
recorded by the harness hook (data/sb2/re/exec_mx.npy, see trace.py), or
REP/SEP tracking within the linear sweep, or the --m/--x defaults.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
ROM = os.path.join(ROOT, 'data', 'roms', 'Super Bomberman 2 (USA).sfc')
MXMAP = os.path.join(ROOT, 'data', 'sb2', 're', 'exec_mx.npy')

# mode codes -> (operand bytes or special, format)
MODES = {
    'imp': (0, '{op}'),
    'acc': (0, '{op} A'),
    'imm8': (1, '{op} #${v:02X}'),
    'immM': ('M', '{op} #${v}'),
    'immX': ('X', '{op} #${v}'),
    'dp': (1, '{op} ${v:02X}'),
    'dpx': (1, '{op} ${v:02X},X'),
    'dpy': (1, '{op} ${v:02X},Y'),
    'idp': (1, '{op} (${v:02X})'),
    'idpx': (1, '{op} (${v:02X},X)'),
    'idpy': (1, '{op} (${v:02X}),Y'),
    'ildp': (1, '{op} [${v:02X}]'),
    'ildpy': (1, '{op} [${v:02X}],Y'),
    'abs': (2, '{op} ${v:04X}'),
    'absx': (2, '{op} ${v:04X},X'),
    'absy': (2, '{op} ${v:04X},Y'),
    'long': (3, '{op} ${v:06X}'),
    'longx': (3, '{op} ${v:06X},X'),
    'iabs': (2, '{op} (${v:04X})'),
    'iabsx': (2, '{op} (${v:04X},X)'),
    'ilabs': (2, '{op} [${v:04X}]'),
    'sr': (1, '{op} ${v:02X},S'),
    'isry': (1, '{op} (${v:02X},S),Y'),
    'rel': (1, '{op} {t}'),
    'rell': (2, '{op} {t}'),
    'bm': (2, '{op} {v}'),
}

OPS = {}
def _d(s):
    for item in s.split(';'):
        item = item.strip()
        if not item:
            continue
        code, op, mode = item.split()
        OPS[int(code, 16)] = (op, mode)

_d("""00 BRK imm8;01 ORA idpx;02 COP imm8;03 ORA sr;04 TSB dp;05 ORA dp;06 ASL dp;07 ORA ildp;
08 PHP imp;09 ORA immM;0A ASL acc;0B PHD imp;0C TSB abs;0D ORA abs;0E ASL abs;0F ORA long;
10 BPL rel;11 ORA idpy;12 ORA idp;13 ORA isry;14 TRB dp;15 ORA dpx;16 ASL dpx;17 ORA ildpy;
18 CLC imp;19 ORA absy;1A INC acc;1B TCS imp;1C TRB abs;1D ORA absx;1E ASL absx;1F ORA longx;
20 JSR abs;21 AND idpx;22 JSL long;23 AND sr;24 BIT dp;25 AND dp;26 ROL dp;27 AND ildp;
28 PLP imp;29 AND immM;2A ROL acc;2B PLD imp;2C BIT abs;2D AND abs;2E ROL abs;2F AND long;
30 BMI rel;31 AND idpy;32 AND idp;33 AND isry;34 BIT dpx;35 AND dpx;36 ROL dpx;37 AND ildpy;
38 SEC imp;39 AND absy;3A DEC acc;3B TSC imp;3C BIT absx;3D AND absx;3E ROL absx;3F AND longx;
40 RTI imp;41 EOR idpx;42 WDM imm8;43 EOR sr;44 MVP bm;45 EOR dp;46 LSR dp;47 EOR ildp;
48 PHA imp;49 EOR immM;4A LSR acc;4B PHK imp;4C JMP abs;4D EOR abs;4E LSR abs;4F EOR long;
50 BVC rel;51 EOR idpy;52 EOR idp;53 EOR isry;54 MVN bm;55 EOR dpx;56 LSR dpx;57 EOR ildpy;
58 CLI imp;59 EOR absy;5A PHY imp;5B TCD imp;5C JML long;5D EOR absx;5E LSR absx;5F EOR longx;
60 RTS imp;61 ADC idpx;62 PER rell;63 ADC sr;64 STZ dp;65 ADC dp;66 ROR dp;67 ADC ildp;
68 PLA imp;69 ADC immM;6A ROR acc;6B RTL imp;6C JMP iabs;6D ADC abs;6E ROR abs;6F ADC long;
70 BVS rel;71 ADC idpy;72 ADC idp;73 ADC isry;74 STZ dpx;75 ADC dpx;76 ROR dpx;77 ADC ildpy;
78 SEI imp;79 ADC absy;7A PLY imp;7B TDC imp;7C JMP iabsx;7D ADC absx;7E ROR absx;7F ADC longx;
80 BRA rel;81 STA idpx;82 BRL rell;83 STA sr;84 STY dp;85 STA dp;86 STX dp;87 STA ildp;
88 DEY imp;89 BIT immM;8A TXA imp;8B PHB imp;8C STY abs;8D STA abs;8E STX abs;8F STA long;
90 BCC rel;91 STA idpy;92 STA idp;93 STA isry;94 STY dpx;95 STA dpx;96 STX dpy;97 STA ildpy;
98 TYA imp;99 STA absy;9A TXS imp;9B TXY imp;9C STZ abs;9D STA absx;9E STZ absx;9F STA longx;
A0 LDY immX;A1 LDA idpx;A2 LDX immX;A3 LDA sr;A4 LDY dp;A5 LDA dp;A6 LDX dp;A7 LDA ildp;
A8 TAY imp;A9 LDA immM;AA TAX imp;AB PLB imp;AC LDY abs;AD LDA abs;AE LDX abs;AF LDA long;
B0 BCS rel;B1 LDA idpy;B2 LDA idp;B3 LDA isry;B4 LDY dpx;B5 LDA dpx;B6 LDX dpy;B7 LDA ildpy;
B8 CLV imp;B9 LDA absy;BA TSX imp;BB TYX imp;BC LDY absx;BD LDA absx;BE LDX absy;BF LDA longx;
C0 CPY immX;C1 CMP idpx;C2 REP imm8;C3 CMP sr;C4 CPY dp;C5 CMP dp;C6 DEC dp;C7 CMP ildp;
C8 INY imp;C9 CMP immM;CA DEX imp;CB WAI imp;CC CPY abs;CD CMP abs;CE DEC abs;CF CMP long;
D0 BNE rel;D1 CMP idpy;D2 CMP idp;D3 CMP isry;D4 PEI dp;D5 CMP dpx;D6 DEC dpx;D7 CMP ildpy;
D8 CLD imp;D9 CMP absy;DA PHX imp;DB STP imp;DC JML ilabs;DD CMP absx;DE DEC absx;DF CMP longx;
E0 CPX immX;E1 SBC idpx;E2 SEP imm8;E3 SBC sr;E4 CPX dp;E5 SBC dp;E6 INC dp;E7 SBC ildp;
E8 INX imp;E9 SBC immM;EA NOP imp;EB XBA imp;EC CPX abs;ED SBC abs;EE INC abs;EF SBC long;
F0 BEQ rel;F1 SBC idpy;F2 SBC idp;F3 SBC isry;F4 PEA abs;F5 SBC dpx;F6 INC dpx;F7 SBC ildpy;
F8 SED imp;F9 SBC absy;FA PLX imp;FB XCE imp;FC JSR iabsx;FD SBC absx;FE INC absx;FF SBC longx""")
assert len(OPS) == 256


def rom_off(pc):
    bank, off = (pc >> 16) & 0xff, pc & 0xffff
    return (((bank & 0x3f) << 16) | off) & 0xfffff


class Dis:
    def __init__(self, rom=None, mxmap=None, labels=None):
        self.rom = open(rom or ROM, 'rb').read()
        self.mx = None
        p = mxmap or MXMAP
        if os.path.exists(p):
            import numpy as np
            self.mx = np.load(p)
        self.labels = labels or {}

    def byte(self, pc):
        return self.rom[rom_off(pc)]

    def flags_at(self, pc, m, x):
        """Return (m8, x8) using the exec map if it has a single combination."""
        if self.mx is not None:
            v = int(self.mx[rom_off(pc)])
            if v:
                ms = {(b >> 1) & 1 for b in range(4) if v & (1 << b)}
                xs = {b & 1 for b in range(4) if v & (1 << b)}
                if len(ms) == 1:
                    m = bool(ms.pop())
                if len(xs) == 1:
                    x = bool(xs.pop())
        return m, x

    def one(self, pc, m=True, x=True):
        """Decode one instruction. Returns (length, text, info dict). m/x True = 8-bit."""
        m, x = self.flags_at(pc, m, x)
        op = self.byte(pc)
        name, mode = OPS[op]
        n, fmt = MODES[mode]
        if n == 'M':
            n = 1 if m else 2
        elif n == 'X':
            n = 1 if x else 2
        raw = [self.byte((pc & 0xff0000) | ((pc + 1 + i) & 0xffff)) for i in range(n)]
        v = 0
        for i, b in enumerate(raw):
            v |= b << (8 * i)
        info = {'op': name, 'mode': mode, 'v': v, 'len': 1 + n, 'm8': m, 'x8': x}
        if mode == 'rel':
            t = (pc & 0xff0000) | ((pc + 2 + (v - 256 if v >= 128 else v)) & 0xffff)
            info['target'] = t
            txt = fmt.format(op=name, t=self.lab(t))
        elif mode == 'rell':
            t = (pc & 0xff0000) | ((pc + 3 + (v - 65536 if v >= 32768 else v)) & 0xffff)
            info['target'] = t
            txt = fmt.format(op=name, t=self.lab(t))
        elif mode == 'bm':
            txt = '%s $%02X,$%02X' % (name, raw[0], raw[1])
        elif mode in ('immM', 'immX'):
            txt = fmt.format(op=name, v=('%02X' if n == 1 else '%04X') % v)
        else:
            txt = fmt.format(op=name, v=v)
            if name in ('JSR', 'JMP') and mode == 'abs':
                info['target'] = (pc & 0xff0000) | v
                txt += self.cmt(info['target'])
            elif name in ('JSL', 'JML') and mode == 'long':
                info['target'] = v
                txt += self.cmt(v)
        return 1 + n, txt, info

    def lab(self, t):
        return self.labels.get(t, '$%06X' % t)

    def cmt(self, t):
        return ('  ; ' + self.labels[t]) if t in self.labels else ''

    def sweep(self, pc, count=None, end=None, m=True, x=True, stop_at_return=False):
        out = []
        i = 0
        while (count is None or i < count) and (end is None or pc < end):
            n, txt, info = self.one(pc, m, x)
            m, x = info['m8'], info['x8']
            if info['op'] == 'REP':
                if info['v'] & 0x20: m = False
                if info['v'] & 0x10: x = False
            elif info['op'] == 'SEP':
                if info['v'] & 0x20: m = True
                if info['v'] & 0x10: x = True
            raw = ' '.join('%02X' % self.byte((pc & 0xff0000) | ((pc + k) & 0xffff)) for k in range(n))
            lbl = self.labels.get(pc)
            if lbl:
                out.append('%s:' % lbl)
            out.append('%06X  %-12s %s' % (pc, raw, txt))
            pc = (pc & 0xff0000) | ((pc + n) & 0xffff)
            i += 1
            if stop_at_return and info['op'] in ('RTS', 'RTL', 'RTI', 'JMP', 'JML', 'BRA', 'BRL'):
                break
        return out, pc


    def func(self, entry, m=True, x=True, maxn=4000):
        """Recursive-descent listing of one routine: follows branches/jumps inside
        the routine (not JSR/JSL), tracks REP/SEP along paths, stops at RTS/RTL/RTI/
        JMP-indirect. Returns sorted lines; '...' marks gaps."""
        seen = {}
        work = [(entry, m, x)]
        calls = set()
        while work and len(seen) < maxn:
            pc, m, x = work.pop()
            while pc not in seen:
                n, txt, info = self.one(pc, m, x)
                m, x = info['m8'], info['x8']
                op = info['op']
                if op == 'REP':
                    if info['v'] & 0x20: m = False
                    if info['v'] & 0x10: x = False
                elif op == 'SEP':
                    if info['v'] & 0x20: m = True
                    if info['v'] & 0x10: x = True
                elif op == 'PLP':
                    pass
                seen[pc] = (n, txt)
                nxt = (pc & 0xff0000) | ((pc + n) & 0xffff)
                if op in ('JSR', 'JSL') and 'target' in info:
                    calls.add(info['target'])
                if op in ('RTS', 'RTL', 'RTI', 'STP', 'BRK'):
                    break
                if op in ('BRA', 'BRL') or (op in ('JMP', 'JML') and info['mode'] in ('abs', 'long')):
                    t = info['target']
                    if op == 'JML' or (t >> 16) != (entry >> 16) or abs((t & 0xffff) - (entry & 0xffff)) > 0x2000:
                        break     # tail jump elsewhere
                    pc = t
                    continue
                if op in ('JMP', 'JML'):
                    break
                if 'target' in info and info['mode'] in ('rel', 'rell'):
                    work.append((info['target'], m, x))
                pc = nxt
        out = []
        prev_end = None
        for pc in sorted(seen):
            n, txt = seen[pc]
            if prev_end is not None and pc != prev_end:
                out.append('        ...')
            lbl = self.labels.get(pc)
            if lbl:
                out.append('%s:' % lbl)
            raw = ' '.join('%02X' % self.byte((pc & 0xff0000) | ((pc + k) & 0xffff)) for k in range(n))
            out.append('%06X  %-12s %s' % (pc, raw, txt))
            prev_end = (pc & 0xff0000) | ((pc + n) & 0xffff)
        return out, sorted(calls)


def main(argv):
    args = [a for a in argv if not a.startswith('--')]
    m = '--m16' not in argv
    x = '--x16' not in argv
    D = Dis()
    if '--func' in argv:
        for a in args:
            lines, calls = D.func(int(a, 16), m=m, x=x)
            print('; ---- routine %s  (calls: %s)' % (a.upper(), ' '.join('%06X' % c for c in calls)))
            print('\n'.join(lines))
            print()
        return
    if '--range' in argv:
        lo, hi = int(args[0], 16), int(args[1], 16)
        lines, _ = D.sweep(lo, end=hi, m=m, x=x)
    else:
        pc = int(args[0], 16)
        cnt = int(args[1]) if len(args) > 1 else 40
        lines, _ = D.sweep(pc, count=cnt, m=m, x=x)
    print('\n'.join(lines))


if __name__ == '__main__':
    main(sys.argv[1:])
