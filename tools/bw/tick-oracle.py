"""Original-machine comparison of complete battle updates, with explicit host boundaries."""
import ctypes as C,json,struct
from harness import Psx,ROOT
s=Psx(core=ROOT/'data/bw/upstream/pcsx-rearmed/pcsx_rearmed_libretro.so')
s.load((ROOT/'data/bw/harness/fight3.state').read_bytes());ptr=s.lib.retro_get_memory_data(2)
s.lib.retro_bw_call.argtypes=[C.c_uint32]*5+[C.POINTER(C.c_uint32)];s.lib.retro_bw_call.restype=C.c_int
base=bytearray((ROOT/'data/bw/gpu/frame.ram').read_bytes())
# Sound is routed to the host in both runs; this test does not claim SPU conformance.
struct.pack_into('<II',base,0x14a78,0x03e00008,0x00001021)
C.memmove(ptr,bytes(base),len(base))
out=ROOT/'data/bw/conformance/ticks';out.mkdir(exist_ok=True);(out/'baseline.ram').write_bytes(base)
funcs=[0x8001be0c,0x80021ec4,0x800e68ec,0x800ecad0,0x800252f0,0x80023efc,0x800e95f4,0x8001be3c]
records=[]
for f in range(360):
 held=0x20 if f<60 else (0x2000 if f==60 else (0x80 if f<130 else 0))
 for a,v in [(0xd9300,held),(0xd92d8,0x2000 if f==60 else 0)]:C.memmove(ptr+a,struct.pack('<H',v),2)
 for pc in funcs:
  result=C.c_uint32()
  if not s.lib.retro_bw_call(pc,0,0,0,0,C.byref(result)):raise RuntimeError(hex(pc))
 # Compare complete grid, players, bombs, effects, AI scratch, RNG. Not stack or CPU register residue.
 ram=s.ram();record=b''.join(ram[lo:hi] for lo,hi in [(0xcad80,0xd3a28),(0xf8e00,0xf9000),(0x9010,0x9014)])
 (out/f'{f:04}.bin').write_bytes(record)
 if f%60==0:print(f,flush=True)
s.close();(out/'case.json').write_text(json.dumps({'frames':360,'functions':funcs,'ranges':[[0xcad80,0xd3a28],[0xf8e00,0xf9000],[0x9010,0x9014]]}))
