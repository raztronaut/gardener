#!/usr/bin/env python3
"""Disassemble the household's executable or battle overlay (includes unclassified data).
Uses capstone 5.0.6 in data/bw/venv; generated listings stay in data/bw.
"""
import argparse,hashlib
from pathlib import Path
from capstone import Cs,CS_ARCH_MIPS,CS_MODE_MIPS32,CS_MODE_LITTLE_ENDIAN
from harness import ROOT
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--overlay',action='store_true');p.add_argument('--start',type=lambda x:int(x,0));p.add_argument('--end',type=lambda x:int(x,0));p.add_argument('--out',type=Path,required=True);a=p.parse_args()
if a.overlay:
 b=(ROOT/'data/bw/files/BIN/BAT_S.BIN').read_bytes();base=0x800e3578
else:
 b=(ROOT/'data/bw/files/SLUS_006.80').read_bytes()
 if hashlib.sha256(b).hexdigest()!='34b3d7a3657a6b161acf8b5802a22f29bc89e0a8f73c1fdbb94cc607bb75c626':raise ValueError('Unrecognized executable revision')
 b=b[2048:];base=0x80010000
start=base if a.start is None else a.start;end=base+len(b) if a.end is None else a.end
if not base<=start<end<=base+len(b) or start%4:raise ValueError('Range outside loaded image or unaligned')
cs=Cs(CS_ARCH_MIPS,CS_MODE_MIPS32|CS_MODE_LITTLE_ENDIAN);cs.skipdata=True
with a.out.open('w') as f:
 f.write('# Raw linear disassembly: data may decode as instructions. Use runtime coverage.\n')
 for i in cs.disasm(b[start-base:end-base],start):f.write(f'{i.address:08x} {i.mnemonic:8} {i.op_str}\n')
print(a.out)
