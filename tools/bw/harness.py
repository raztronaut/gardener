#!/usr/bin/env python3
"""Isolated headless PCSX-ReARMed baseline: no wall, sound device or real saves.
Capture frames, RAM and states for measured World reverse engineering.
"""
import ctypes as C
import argparse,json,hashlib
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
class GameInfo(C.Structure):
    _fields_=[('path',C.c_char_p),('data',C.c_void_p),('size',C.c_size_t),('meta',C.c_char_p)]
ENV=C.CFUNCTYPE(C.c_bool,C.c_uint,C.c_void_p)
VIDEO=C.CFUNCTYPE(None,C.c_void_p,C.c_uint,C.c_uint,C.c_size_t)
AUDIO=C.CFUNCTYPE(None,C.c_int16,C.c_int16)
BATCH=C.CFUNCTYPE(C.c_size_t,C.c_void_p,C.c_size_t)
POLL=C.CFUNCTYPE(None)
INPUT=C.CFUNCTYPE(C.c_int16,C.c_uint,C.c_uint,C.c_uint,C.c_uint)
class Psx:
    def __init__(self, core=None):
        self.dir=ROOT/'data/bw/harness';self.dir.mkdir(parents=True,exist_ok=True)
        self.directory=str(self.dir).encode();self.values=[];self.fmt=0;self.pads=[0]*5;self.frame=None
        self.lib=C.CDLL(str(core or ROOT/'data/tools/retroarch/pcsx_rearmed_libretro.so'))
        self.callbacks=[ENV(self.env),VIDEO(self.video),AUDIO(lambda l,r:None),BATCH(lambda p,n:n),POLL(lambda:None),INPUT(self.input)]
        for name,cb in zip(['environment','video_refresh','audio_sample','audio_sample_batch','input_poll','input_state'],self.callbacks):
            getattr(self.lib,'retro_set_'+name)(cb)
        self.lib.retro_load_game.argtypes=[C.POINTER(GameInfo)];self.lib.retro_load_game.restype=C.c_bool
        self.lib.retro_get_memory_data.argtypes=[C.c_uint];self.lib.retro_get_memory_data.restype=C.c_void_p
        self.lib.retro_get_memory_size.argtypes=[C.c_uint];self.lib.retro_get_memory_size.restype=C.c_size_t
        self.lib.retro_serialize_size.restype=C.c_size_t
        self.lib.retro_serialize.argtypes=[C.c_void_p,C.c_size_t];self.lib.retro_serialize.restype=C.c_bool
        self.lib.retro_unserialize.argtypes=[C.c_void_p,C.c_size_t];self.lib.retro_unserialize.restype=C.c_bool
        self.lib.retro_init()
        self.path=str(ROOT/'data/roms/Bomberman World (USA).chd').encode()
        if not self.lib.retro_load_game(C.byref(GameInfo(self.path,None,0,None))): raise RuntimeError('load failed')
        for port in range(2): self.lib.retro_set_controller_port_device(port,1)
    def env(self,cmd,data):
        if cmd in (9,31): C.cast(data,C.POINTER(C.c_char_p))[0]=self.directory; return True
        if cmd==10: self.fmt=C.cast(data,C.POINTER(C.c_int))[0];return self.fmt in (0,1,2)
        if cmd==3: C.cast(data,C.POINTER(C.c_bool))[0]=True;return True
        if cmd==16:
            pairs=C.cast(data,C.POINTER(C.c_char_p));i=0
            while pairs[i]:
                spec=pairs[i+1].decode();value=spec.split(';',1)[1].strip().split('|')[0].encode()
                key=pairs[i].decode()
                overrides={'pcsx_rearmed_drc':b'disabled','pcsx_rearmed_bios':b'HLE','pcsx_rearmed_frameskip_type':b'disabled'}
                self.values.append((pairs[i],overrides.get(key,value)));i+=2
            return True
        if cmd==15:
            pair=C.cast(data,C.POINTER(C.c_char_p))
            for key,value in self.values:
                if key==pair[0]:pair[1]=value;return True
            return False
        if cmd==17: C.cast(data,C.POINTER(C.c_bool))[0]=False;return True
        if cmd==51|0x10000:return True
        if cmd==47|0x10000:C.cast(data,C.POINTER(C.c_int))[0]=3;return True
        return False
    def input(self,port,device,index,key):
        if port>=len(self.pads) or device!=1:return 0
        return self.pads[port] if key==256 else (self.pads[port]>>key)&1
    def video(self,p,w,h,pitch):
        if not p:return
        raw=np.frombuffer(C.string_at(p,pitch*h),dtype=np.uint8).reshape(h,pitch)
        if self.fmt==1:
            a=raw[:,:w*4].copy().view('<u4').reshape(h,w);rgb=np.stack([(a>>16)&255,(a>>8)&255,a&255],axis=-1)
        else:
            a=raw[:,:w*2].copy().view('<u2').reshape(h,w)
            if self.fmt==2: rgb=np.stack([((a>>11)&31)*255//31,((a>>5)&63)*255//63,(a&31)*255//31],axis=-1)
            else: rgb=np.stack([((a>>10)&31)*255//31,((a>>5)&31)*255//31,(a&31)*255//31],axis=-1)
        self.frame=rgb.astype('uint8')
    def run(self,n,pad=0):
        if isinstance(pad,(list,tuple)):
            self.pads=list(pad)+[0]*(5-len(pad))
        else: self.pads=[pad,0,0,0,0]
        for _ in range(n):self.lib.retro_run()
    def ram(self):
        n=self.lib.retro_get_memory_size(2);p=self.lib.retro_get_memory_data(2)
        if not p or not n:raise RuntimeError('No system RAM exposed')
        return C.string_at(p,n)
    def save(self):
        n=self.lib.retro_serialize_size();buf=C.create_string_buffer(n)
        if not self.lib.retro_serialize(buf,n):raise RuntimeError('serialize failed')
        return buf.raw
    def load(self,data):
        buf=C.create_string_buffer(data)
        if not self.lib.retro_unserialize(buf,len(data)):raise RuntimeError('unserialize failed')
    def close(self):
        self.lib.retro_unload_game();self.lib.retro_deinit()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--frames',type=int,default=600);p.add_argument('--pad',type=lambda x:int(x,0),default=0);p.add_argument('--load',type=Path);p.add_argument('--name',default='boot');p.add_argument('--core',type=Path);a=p.parse_args()
    if not a.name.replace('-','').replace('_','').isalnum():raise ValueError('Simple capture name required')
    s=Psx(core=a.core)
    try:
        if a.load:s.load(a.load.read_bytes())
        s.run(a.frames,a.pad)
        out=s.dir/a.name
        if s.frame is not None:Image.fromarray(s.frame).save(str(out)+'.png')
        ram=s.ram();Path(str(out)+'.ram').write_bytes(ram);Path(str(out)+'.state').write_bytes(s.save())
        print(json.dumps(dict(frames=a.frames,ram_size=len(ram),ram_sha256=hashlib.sha256(ram).hexdigest(),capture=str(out))))
    finally:s.close()
if __name__=='__main__':main()
