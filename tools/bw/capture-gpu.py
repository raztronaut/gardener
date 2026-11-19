#!/usr/bin/env python3
"""Capture an original rendered battle frame plus its actual GP0 stream and VRAM."""
import ctypes as C, hashlib, json, argparse
from pathlib import Path
from PIL import Image
from harness import Psx, ROOT

def main():
 p=argparse.ArgumentParser();p.add_argument('--frames',type=int,default=2);p.add_argument('--pad',type=lambda v:int(v,0),default=0);p.add_argument('--load',type=Path,default=ROOT/'data/bw/harness/fight3.state');p.add_argument('--out',type=Path,default=ROOT/'data/bw/gpu');a=p.parse_args()
 out=a.out;out.mkdir(parents=True,exist_ok=True)
 s=Psx(core=ROOT/'data/bw/upstream/pcsx-rearmed/pcsx_rearmed_libretro.so')
 s.lib.retro_bw_gpu_capture.argtypes=[C.c_int];s.lib.retro_bw_gpu_capture.restype=C.POINTER(C.c_uint32)
 s.lib.retro_bw_gpu_count.restype=C.c_uint32
 s.lib.retro_bw_vram.restype=C.POINTER(C.c_uint16)
 s.lib.retro_bw_gpu_ex_regs.restype=C.POINTER(C.c_uint32)
 state=a.load.read_bytes();runs=[]
 for enabled in [False,True]:
  s.lib.retro_bw_gpu_capture(0);s.load(state);s.run(a.frames,a.pad)
  before=C.string_at(s.lib.retro_bw_vram(),1024*512*2)
  regs=list(s.lib.retro_bw_gpu_ex_regs()[:8]);p=s.lib.retro_bw_gpu_capture(int(enabled))
  s.run(1,a.pad);after=C.string_at(s.lib.retro_bw_vram(),1024*512*2)
  n=s.lib.retro_bw_gpu_count();s.lib.retro_bw_gpu_capture(0)
  hashes={'ram':hashlib.sha256(s.ram()).hexdigest(),'frame':hashlib.sha256(s.frame.tobytes()).hexdigest(),'vram':hashlib.sha256(after).hexdigest()};runs.append(hashes)
  if enabled:
   if s.lib.retro_bw_gpu_overflow():raise RuntimeError('GPU capture overflow')
   (out/'before.vram').write_bytes(before);(out/'after.vram').write_bytes(after);(out/'gp0.bin').write_bytes(C.string_at(p,n*4));(out/'frame.ram').write_bytes(s.ram());Image.fromarray(s.frame).save(out/'frame.png')
   meta={'warmup_frames':a.frames,'pad':a.pad,'ex_regs':regs,'words':n,'frame_shape':list(s.frame.shape),'hashes':hashes}
 s.close();assert runs[0]==runs[1], 'GPU observation changes original result'
 meta['observation_equivalent']=True;(out/'capture.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta))
if __name__=='__main__':main()
