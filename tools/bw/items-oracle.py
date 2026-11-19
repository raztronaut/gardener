"""Verify item destruction/reveal/pickup against the isolated original interpreter."""
import ctypes as C,hashlib,json,struct
from harness import Psx,ROOT
D=ROOT/'data/bw/conformance/items';spec=json.loads((D/'js-cases.json').read_text())
s=Psx(core=ROOT/'data/bw/upstream/pcsx-rearmed/pcsx_rearmed_libretro.so');s.load((ROOT/'data/bw/harness/fight3.state').read_bytes());ptr=s.lib.retro_get_memory_data(2)
s.lib.retro_bw_call.argtypes=[C.c_uint32]*5+[C.POINTER(C.c_uint32)];s.lib.retro_bw_call.restype=C.c_int
for case in spec['cases']:
 base=(D/(case['name']+'.ram')).read_bytes();C.memmove(ptr,base,len(base));hashes=[]
 for frame in range(spec['frames']):
  if frame==90:
   for off,value in [(0x4c,3*320+160),(0x4e,1*256+128),(0x52,3),(0x54,1)]:C.memmove(ptr+0xcda98+off,struct.pack('<H',value),2)
  for pc in spec['funcs']:
   result=C.c_uint32()
   if not s.lib.retro_bw_call(pc,0,0,0,0,C.byref(result)):raise RuntimeError(hex(pc))
  h=hashlib.sha256()
  for lo,hi in spec['ranges']:h.update(C.string_at(ptr+lo,hi-lo))
  digest=h.hexdigest();hashes.append(digest)
  assert digest==case['hashes'][frame],f'Original item {case["name"]} differs at frame {frame}'
 case['hashes']=hashes;print('Verified original item',case['name'],flush=True)
s.close();(D/'cases.json').write_text(json.dumps(spec));print('All 22 crate contents × 110 ticks agree with the original machine.')
