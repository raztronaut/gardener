#!/usr/bin/env python3
"""Controlled original-engine bomb experiments. All mutations are recorded.
This creates synthetic arrangements inside a captured stage, not retail replay claims.
"""
import ctypes as C, json, struct
from pathlib import Path
from harness import Psx,ROOT
P=0x800cda98;B=0x800cdee8;GRID=0x800cbc80

def main():
 out=ROOT/'data/bw/bomb-scenarios';out.mkdir(exist_ok=True)
 s=Psx(core=ROOT/'data/bw/upstream/pcsx-rearmed/pcsx_rearmed_libretro.so')
 s.lib.retro_bw_call.argtypes=[C.c_uint32]*5+[C.POINTER(C.c_uint32)];s.lib.retro_bw_call.restype=C.c_int
 s.lib.retro_bw_watch.argtypes=[C.c_uint32,C.c_uint32];s.lib.retro_bw_watch.restype=C.POINTER(C.c_uint32);s.lib.retro_bw_watch_count.restype=C.c_uint32
 results=[]
 for name,second,barrier in [('single',None,None),('adjacent-chain',4,None),('pillar-stops-chain',5,0x7f76),('block-stops-chain',5,0x3e60)]:
  s.load((ROOT/'data/bw/harness/fight3.state').read_bytes());ptr=s.lib.retro_get_memory_data(2);mutations=[]
  def put(addr,size,value):
   raw=int(value).to_bytes(size,'little');C.memmove(ptr+(addr&0x1fffff),raw,size);mutations.append([hex(addr),size,value])
  def cell(r,c,value):put(GRID+2*(r*64+c),2,value)
  # Isolate the bomb pool and its matching grid occupancy; keep the original stage.
  for n in range(40):put(B+n*0x7c+0x56,2,10)
  ram=s.ram()
  for i in range(3840):
   value=struct.unpack_from('<H',ram,0xcbc80+i*2)[0]
   if value&0x3f80==0x3f80 and value&0x7f==1:put(GRID+i*2,2,0x4001)
  put(P+0x8c,2,3);put(P+0x8e,2,3);put(P+0xda,1,3)
  for c in [2,3,4,5,6]:cell(17,c,0x4001)
  if barrier is not None:cell(17,4,barrier)
  bombs=[]
  for col,fuse in [(3,150 if second is None else 2)]+([(second,80)] if second else []):
   put(P+0x92,2,fuse);result=C.c_uint32()
   if not s.lib.retro_bw_call(0x80025058,P,17,col,0,C.byref(result)) or not result.value:raise RuntimeError('Original bomb creation failed')
   bombs.append(result.value)
  initial=s.ram();(out/(name+'-initial.ram')).write_bytes(initial)
  watch=s.lib.retro_bw_watch(GRID,GRID+7680);events=[];previous=None
  for frame in range(190 if second is None else 115):
   s.run(1);ram=s.ram();bs=[]
   for address in bombs:
    p=address&0x1fffff;bs.append({'layer':struct.unpack_from('<h',ram,p+0x56)[0],'fuse':struct.unpack_from('<H',ram,p+0x6c)[0]})
   cells=[struct.unpack_from('<H',ram,0xcbc80+2*(17*64+c))[0] for c in range(2,7)]
   # Store each frame: fuse ordering and a one-frame chain delay matter.
   events.append({'frame':frame,'bombs':bs,'cells':cells})
  n=s.lib.retro_bw_watch_count();writes=[]
  for i in range(n):
   pc,addr,value,code=watch[i*4:i*4+4];writes.append({'pc':hex(pc),'address':hex(addr|0x80000000),'value':value&65535})
  summary={'name':name,'controlled_setup':True,'mutations':mutations,'bomb_addresses':[hex(p) for p in bombs],'events':events,'grid_writes':writes,'watch_truncated':n==65536}
  (out/(name+'.json')).write_text(json.dumps(summary,indent=2)+'\n')
  detonations=[next((e['frame'] for e in events if e['bombs'][i]['layer']==10),None) for i in range(len(bombs))]
  results.append({'name':name,'first_free_slot_frame':detonations,'grid_write_pcs':sorted(set(w['pc'] for w in writes))});print(results[-1],flush=True)
 s.close();(out/'summary.json').write_text(json.dumps(results,indent=2)+'\n')
if __name__=='__main__':main()
