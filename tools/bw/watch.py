#!/usr/bin/env python3
"""Trace original MIPS stores to a specified RAM interval in a saved match."""
import argparse,ctypes as C,json
from pathlib import Path
from harness import Psx,ROOT

def main():
 p=argparse.ArgumentParser();p.add_argument('state',type=Path);p.add_argument('--start',type=lambda x:int(x,0),required=True);p.add_argument('--size',type=int,default=4);p.add_argument('--pad',type=lambda x:int(x,0),default=0);p.add_argument('--frames',type=int,default=12);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 s=Psx(core=ROOT/'data/bw/upstream/pcsx-rearmed/pcsx_rearmed_libretro.so')
 s.lib.retro_bw_watch.argtypes=[C.c_uint32,C.c_uint32];s.lib.retro_bw_watch.restype=C.POINTER(C.c_uint32)
 s.lib.retro_bw_watch_count.restype=C.c_uint32;s.load(a.state.read_bytes());ptr=s.lib.retro_bw_watch(a.start,a.start+a.size)
 records=[];last=0
 for frame in range(a.frames):
  s.run(1,a.pad);n=s.lib.retro_bw_watch_count()
  for i in range(last,n):
   pc,addr,value,code=ptr[i*4:i*4+4];records.append(dict(frame=frame,pc=hex(pc),address=hex(0x80000000+addr),value=hex(value),instruction=hex(code)))
  last=n
 s.close();a.out.write_text(json.dumps(dict(truncated=last==65536,writes=records),indent=2)+'\n');print(json.dumps(dict(writes=len(records),pcs=sorted(set(x['pc'] for x in records)))))
if __name__=='__main__':main()
