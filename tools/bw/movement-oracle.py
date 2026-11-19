#!/usr/bin/env python3
"""Differential fixtures from original US World MIPS routines (isolated core only)."""
import ctypes as C, json, random, struct, hashlib
from pathlib import Path
import numpy as np
from harness import Psx, ROOT

PCS={'canEnter':0x8001c120,'updateCell':0x8001c0a4,'centerErrorX':0x8001bd10,'centerErrorY':0x8001bd44,'contact':0x8001c268,'bombContact':0x8001c4bc,'playerContact':0x8001c61c,'resolveUp':0x8001c738,'resolveDown':0x8001c8f8,'resolveLeft':0x8001cab8,'resolveRight':0x8001cc68,'alignX':0x8001ea1c,'alignY':0x8001ebd0,'chooseAxis':0x8001ed7c,'move':0x8001eef8}
PCS['tickBombFuse']=0x80024f98
P=0x800cda98; Q=P+0xdc; B=0x800cdee8; LO=0xcbc80; HI=0xd3e00

def main():
 out=ROOT/'data/bw/conformance/movement';out.mkdir(parents=True,exist_ok=True)
 s=Psx(core=ROOT/'data/bw/upstream/pcsx-rearmed/pcsx_rearmed_libretro.so')
 s.load((ROOT/'data/bw/harness/fight3.state').read_bytes())
 base=s.ram(); ptr=s.lib.retro_get_memory_data(2)
 s.lib.retro_bw_call.argtypes=[C.c_uint32]*5+[C.POINTER(C.c_uint32)];s.lib.retro_bw_call.restype=C.c_int
 rows=[];rng=random.Random(6801108)
 def h(addr,value):return [addr,2,value&65535]
 def w(addr,value):return [addr,4,value&0xffffffff]
 def byte(addr,value):return [addr,1,value&255]
 def cell(l,r,c,value):return h(0x800cbc80+2*(l*1920+r*64+c),value)
 def run(name,args,patches=(),label=''):
  ram=bytearray(base)
  for addr,size,val in patches:struct.pack_into({1:'<B',2:'<H',4:'<I'}[size],ram,addr&0x1fffff,val)
  raw=bytes(ram);C.memmove(ptr,raw,len(raw)); result=C.c_uint32()
  if not s.lib.retro_bw_call(PCS[name],*(args+[0]*(4-len(args))),C.byref(result)):
   raise RuntimeError(f'Original function did not return: {name}')
  after=C.string_at(ptr+LO,HI-LO);before=raw[LO:HI]
  changed=np.flatnonzero(np.frombuffer(before,dtype='u1')!=np.frombuffer(after,dtype='u1'))
  writes=[[LO+int(i),after[int(i)]] for i in changed]
  rows.append({'name':name,'args':args,'patches':patches,'result':None if name in ['move','updateCell','tickBombFuse'] else result.value,'writes':writes,'label':label})
 # Fuse update includes remote input consumption, owner restrictions and saturation.
 padptr=struct.unpack_from('<I',base,0x78c00)[0]
 for fuse in [0,1,2,149,150,65535]:
  for flags in [0,4,0x80]:run('tickBombFuse',[B],[w(B+0x68,flags),h(B+0x6c,fuse)],'normal fuse')
 for owner in [0,1,4,5,255]:
  for slot in [0,1,255]:
   for flags in [0,0x4000000,0x8000000]:
    for pending in [0,1,3,0xffff]:
     patches=[w(B+0x68,8),h(B+0x6c,150),byte(B+0x73,owner),byte(B+0x74,slot),h(padptr+2,1)]
     if owner<5:patches += [w(P+owner*0xdc+0x68,flags),h(P+owner*0xdc+0xac,pending)]
     run('tickBombFuse',[B],patches,'remote fuse')
 # Exhaust all collision masks against representative flag combinations.
 for flags in [0,0x80,0x200,0x400,0x800,0x1000,0x3e00,0x3f80,0x4000,0x7f00,0xfe00]:
  for mask in range(128):run('canEnter',[0,17,3,mask],[cell(0,17,3,flags|1)],'cell flags and actor mask')
 for l,r,c in [(-1,17,3),(2,17,3),(0,-1,3),(0,30,3),(0,17,-1),(0,17,64),(65536,17,3)]:
  for mask in [1,3,5,8,16,32,64]:run('canEnter',[l,r,c,mask],label='grid boundary')
 for ground in [0x4001,0x3f81,0x3e60,0x7f7f]:
  for mask in [1,3,5,8,16,32,64]:run('canEnter',[1,17,3,mask],[cell(1,17,3,0x7f04),cell(0,17,3,ground)],'type 4 redirects layer')
 # Directional body contacts: contact boundaries, fractional coordinates, overlap.
 for direction in [0,0x40,0x80,0xc0,0x20]:
  for dx in [-321,-320,-319,-304,-16,0,16,304,319,320,321]:
   for dy in [-256,-255,-240,0,240,255,256]:
    patches=[h(P+0x4c,1600+dx),h(P+0x4e,4400+dy),h(Q+0x4c,1600),h(Q+0x4e,4400)]
    run('contact',[P+0x4c,Q+0x4c,direction],patches,'body contact boundary')
 # Raw coordinate conversion includes negative/signed-16 wrapping behavior.
 for x in [-32768,-321,-320,-319,-17,-16,-1,0,159,160,319,320,321,32767]:
  for y in [-32768,-257,-256,-255,-1,0,127,128,255,256,32767]:
   patches=[h(P+0x4c,x),h(P+0x4e,y),h(P+0x50,rng.choice([0,255,256,-1]))]
   for name in ['updateCell','centerErrorX','centerErrorY']:run(name,[P+0x4c],patches,'coordinate boundary')
 # Deterministic synthetic arenas exercise blocked neighbors, snapping and masks.
 for n in range(600):
  r=rng.randrange(1,28);c=rng.randrange(1,17);layer=rng.randrange(2)
  patches=[h(P+0x52,c),h(P+0x54,r),h(P+0x56,layer),h(P+0x50,layer*256),h(P+0x4c,c*320+160+rng.randrange(-170,171)),h(P+0x4e,r*256+128+rng.randrange(-140,141)),h(P+0x58,rng.choice([1,18,32,64])),h(P+0x5a,rng.choice([1,18,32,64])),h(P+0x62,rng.choice([1,3,5,8,16,32,64])),h(P+0xae,rng.randrange(16)<<4),byte(P+0xd5,rng.randrange(2)),h(P+0x76,rng.choice([0,0,1])),h(P+0x78,rng.choice([0,0,1]))]
  for dy in [-1,0,1]:
   for dx in [-1,0,1]:patches.append(cell(layer,r+dy,c+dx,rng.choice([0x4001,0x3e60,0x3f81,0x7f7f,0x4010,0x4013])))
  for name in ['alignX','alignY']:run(name,[P,rng.choice([-1,1])],patches,'turn alignment')
  run('chooseAxis',[P,rng.choice([-1,1]),rng.choice([-1,1])],patches,'diagonal selection')
  for name in ['resolveUp','resolveDown','resolveLeft','resolveRight']:run(name,[P+0x4c],patches,'directional collision')
  run('move',[P],patches,'movement dispatch')
 # In-place bombs and special-floor player interactions, including exceptions.
 for n in range(100):
  direction=rng.choice([0,0x40,0x80,0xc0]);dx=rng.randrange(-350,351);dy=rng.randrange(-280,281)
  patches=[h(P+0x4c,1120),h(P+0x4e,4480),h(P+0x52,3),h(P+0x54,17),h(P+0x56,0),h(P+0x62,rng.choice([0,1,2,3])),cell(0,17,3,0x4010),h(Q+0x4c,1120+dx),h(Q+0x4e,4480+dy),h(Q+0x52,3),h(Q+0x54,17),h(Q+0x56,0),w(Q+0x68,rng.choice([0,0x20,0x40000])),w(Q+0x64,rng.choice([0,P+0x4c])),h(B+0x4c,1120+dx),h(B+0x4e,4480+dy),h(B+0x56,0),w(B+0x68,0x4000),w(0x800cda80,rng.choice([0,B+0x4c]))]
  for name in ['bombContact','playerContact']:run(name,[P+0x4c,direction],patches,'actor collision exemptions')
  for name in ['resolveUp','resolveDown','resolveLeft','resolveRight']:run(name,[P+0x4c],patches,'collision plus grid')
 s.close();(out/'baseline.ram').write_bytes(base)
 (out/'cases.json').write_text(json.dumps({'baseline_sha256':hashlib.sha256(base).hexdigest(),'observed_range':[LO,HI],'cases':rows})+'\n')
 print(len(rows),'original movement/collision calls recorded',flush=True)
if __name__=='__main__':main()
