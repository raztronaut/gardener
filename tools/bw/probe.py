#!/usr/bin/env python3
"""Compare controlled inputs from one original-game state, with instruction coverage."""
import ctypes as C, json, hashlib, argparse
from pathlib import Path
import numpy as np
from PIL import Image
from harness import Psx, ROOT

def main():
 p=argparse.ArgumentParser();p.add_argument('state',type=Path);p.add_argument('--frames',type=int,default=12);p.add_argument('--out',type=Path,default=ROOT/'data/bw/probe');a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
 core=ROOT/'data/bw/upstream/pcsx-rearmed/pcsx_rearmed_libretro.so'
 s=Psx(core=core);s.lib.retro_bw_trace.argtypes=[C.c_int];s.lib.retro_bw_trace.restype=C.POINTER(C.c_uint32)
 ptr=s.lib.retro_bw_trace(0);counts=np.ctypeslib.as_array(ptr,shape=(0x80000,));runs={}
 for name,mask in [('idle',0),('right',128),('down',32),('bomb',256),('idle-repeat',0),('idle-untraced',0)]:
  s.load(a.state.read_bytes());counts[:]=0;s.lib.retro_bw_trace(name != 'idle-untraced');s.run(a.frames,mask);s.lib.retro_bw_trace(0)
  ram=s.ram();(a.out/(name+'.ram')).write_bytes(ram);np.save(a.out/(name+'-counts.npy'),counts)
  Image.fromarray(s.frame).save(a.out/(name+'.png'));runs[name]=dict(ram=hashlib.sha256(ram).hexdigest(),frame=hashlib.sha256(s.frame.tobytes()).hexdigest(),executed_addresses=int(np.count_nonzero(counts)))
 s.close();assert runs['idle']==runs['idle-repeat'], 'Repeat diverged'
 for key in ['ram','frame']:assert runs['idle'][key]==runs['idle-untraced'][key], 'Instrumentation changed output'
 idle=np.frombuffer((a.out/'idle.ram').read_bytes(),dtype='<u4');diff={}
 for name in ['right','down','bomb']:
  r=np.frombuffer((a.out/(name+'.ram')).read_bytes(),dtype='<u4');idx=np.flatnonzero(r!=idle)
  diff[name]=[dict(address=hex(0x80000000+int(i)*4),idle=hex(int(idle[i])),value=hex(int(r[i]))) for i in idx]
 (a.out/'diff.json').write_text(json.dumps(diff,indent=2)+'\n');(a.out/'summary.json').write_text(json.dumps(runs,indent=2)+'\n')
 print(json.dumps(dict(runs=runs,different_words={k:len(v) for k,v in diff.items()},repeat_exact=runs['idle']==runs['idle-repeat']),indent=2))
if __name__=='__main__':main()
