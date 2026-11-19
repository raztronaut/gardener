#!/usr/bin/env python3
"""Record helper outputs by executing original machine code, not a second model."""
import ctypes as C,json,random
from pathlib import Path
from harness import Psx,ROOT
s=Psx(core=ROOT/'data/bw/upstream/pcsx-rearmed/pcsx_rearmed_libretro.so')
s.load((ROOT/'data/bw/harness/fight3.state').read_bytes())
s.lib.retro_bw_call.argtypes=[C.c_uint32]*5+[C.POINTER(C.c_uint32)];s.lib.retro_bw_call.restype=C.c_int
cases=[]
def call(name,pc,args):
 result=C.c_uint32()
 if not s.lib.retro_bw_call(pc,*(args+[0]*(4-len(args))),C.byref(result)):raise RuntimeError(f'Original call did not return: {hex(pc)}')
 cases.append(dict(name=name,args=args,result=result.value))
for x in [-32768,-129,-1,0,1,2,13,17,29,30,63,64,127,128,32767,65535,65536]:
 for name,pc in [('columnCenter',0x8001ba78),('rowCenter',0x8001ba9c)]:call(name,pc,[x])
rng=random.Random(40680)
coords=[(l,r,c) for l in [-1,0,1,2,65536] for r in [-1,0,17,29,30] for c in [-1,0,3,63,64]]
coords += [(rng.randrange(2),rng.randrange(30),rng.randrange(64)) for _ in range(200)]
ram=s.ram();grid=ram[0xcbc80:0xcbc80+7680]
for args in coords:
 for name,pc in [('validCell',0x8001bab4),('cellFlags',0x8001d354),('cellType10to13',0x8001d8c0)]:call(name,pc,list(args))
s.close();out=ROOT/'data/bw/conformance';out.mkdir(exist_ok=True)
(out/'grid.bin').write_bytes(grid);(out/'helpers.json').write_text(json.dumps(cases)+'\n');print(len(cases),'original-machine-code cases recorded')
