#!/usr/bin/env python3
"""Extract sector-aligned RC resources and validated PS1 TIM textures.
PNG previews use the first palette; raw TIMs retain every palette and STP bit.
"""
import argparse, hashlib, json, struct
from pathlib import Path
from PIL import Image


def chunks(data):
    entries=[]
    for off in range(0,2048,8):
        kind,size=struct.unpack_from('<II',data,off)
        if kind==0 and size==0: break
        if not 0<kind<256 or not size: raise ValueError('Invalid RC table')
        entries.append((kind,size))
    else: raise ValueError('Unterminated RC table')
    pos=2048
    for kind,size in entries:
        if pos+size>len(data): raise ValueError('RC chunk extends past EOF')
        yield kind,pos,data[pos:pos+size]
        pos+=(size+2047)//2048*2048
    if pos!=len(data): raise ValueError('Unaccounted RC sectors')


def tim(data):
    if len(data)<20 or data[:4]!=b'\x10\0\0\0': raise ValueError('Not TIM')
    flags=struct.unpack_from('<I',data,4)[0]; mode=flags&7
    if flags & ~15 or mode not in (0,1,2): raise ValueError('Unsupported TIM mode')
    def block(pos, empty=False):
        if pos+12>len(data): raise ValueError('Truncated TIM block')
        size,x,y,w,h=struct.unpack_from('<I4H',data,pos)
        if size!=12+w*h*2 or (not empty and (not w or not h)) or pos+size>len(data): raise ValueError('Invalid TIM block size')
        return pos+size,(x,y,w,h),data[pos+12:pos+size]
    pos=8; palette=None; clut=None
    if flags&8: pos,clut,palette=block(pos)
    pos,rect,pixels=block(pos, empty=True)
    if pos!=len(data): raise ValueError('Trailing TIM bytes')
    x,y,words,h=rect; w=words*{0:4,1:2,2:1}[mode]
    def color(v):
        return ((v&31)*255//31,((v>>5)&31)*255//31,((v>>10)&31)*255//31,0 if v==0 else 255)
    if not w and not h and palette is not None:
        im=Image.new('RGBA',(clut[2],clut[3])); im.putdata([color(v[0]) for v in struct.iter_unpack('<H',palette)])
        return im,dict(mode=mode,vram_rect=rect,clut_rect=clut,width=0,height=0,palette_only=True)
    if not w or not h: raise ValueError('Empty TIM image')
    if mode==2: rgba=[color(v[0]) for v in struct.iter_unpack('<H',pixels)]
    else:
        count=16 if mode==0 else 256
        if palette is None or len(palette)<count*2: raise ValueError('Missing TIM palette')
        pal=[color(v[0]) for v in struct.iter_unpack('<H',palette[:count*2])]
        indices=[j for b in pixels for j in (b&15,b>>4)] if mode==0 else pixels
        rgba=[pal[i] for i in indices]
    im=Image.new('RGBA',(w,h)); im.putdata(rgba)
    return im,dict(mode=mode,vram_rect=rect,clut_rect=clut,width=w,height=h)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('rc',type=Path);p.add_argument('--out',type=Path,required=True); a=p.parse_args()
    a.out.mkdir(parents=True,exist_ok=True); manifest=[]
    for src in sorted(a.rc.glob('*.RC')):
        for index,(kind,offset,data) in enumerate(chunks(src.read_bytes())):
            stem=f'{src.stem}-{index:02d}-type{kind}'
            (a.out/(stem+'.bin')).write_bytes(data)
            item=dict(source=src.name,index=index,kind=kind,offset=offset,size=len(data),sha256=hashlib.sha256(data).hexdigest())
            if data[:4]==b'\x10\0\0\0':
                try:
                    im,info=tim(data); im.save(a.out/(stem+'.png'));item['tim']=info
                except ValueError as ex: item['tim_error']=str(ex)
            manifest.append(item)
    (a.out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(resources=len(manifest),textures=sum('tim' in e for e in manifest),tim_errors=[e for e in manifest if 'tim_error'in e])))

if __name__=='__main__': main()
