#!/usr/bin/env python3
"""Replay observed World rectangle draws and extract palette-correct sprite pieces.
Fails on unsupported draw commands. Does not claim general PS1 GPU emulation.
"""
import json,hashlib
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from harness import ROOT
import sys
D=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'data/bw/gpu'
def rgba(words):
 a=np.asarray(words,dtype=np.uint16)
 return np.stack([(a&31)*255//31,((a>>5)&31)*255//31,((a>>10)&31)*255//31,np.where(a==0,0,255)],axis=-1).astype('uint8')
def texture(vram,p):
 tp=p['tpage'];depth=(tp>>7)&3
 if depth==3:raise ValueError('Unsupported texture mode')
 u=(np.arange(p['width'])+p['u'])&255;v=(np.arange(p['height'])+p['v'])&255
 regs=p['ex_regs'];window=regs[2]
 if window&0xfffff:raise ValueError('Nonzero texture window not implemented')
 if regs[1]&0x3000:raise ValueError('Flipped texture not implemented')
 x=(tp&15)*64;y=((tp>>4)&1)*256;factor=[4,2,1][depth]
 words=vram[(y+v[:,None])&511,(x+u[None,:]//factor)&1023]
 if depth==2:return words.copy()
 indices=(words >> ((u[None,:]%factor)*(4 if depth==0 else 8))) & (15 if depth==0 else 255)
 clut=p['clut'];return vram[(clut>>6)&511,((clut&63)*16+indices)&1023].copy()
def main():
 vram=np.frombuffer((D/'before.vram').read_bytes(),dtype='<u2').reshape(512,1024).copy()
 expected=np.frombuffer((D/'after.vram').read_bytes(),dtype='<u2').reshape(512,1024)
 packets=json.loads((D/'packets.json').read_text());pieces={};out=D/'pieces';out.mkdir(exist_ok=True)
 for p in packets:
  code=int(p['code'],16);words=p['words'];regs=p['ex_regs']
  if code in [0,1,0x1f] or 0xe0<=code<=0xe7:continue
  if code==2:
   x=(words[1]&1023)&~15;y=(words[1]>>16)&511;w=((words[2]&1023)+15)&~15;h=(words[2]>>16)&511
   color=(words[0]&255)>>3|(((words[0]>>8)&255)>>3)<<5|(((words[0]>>16)&255)>>3)<<10
   vram[(y+np.arange(h)[:,None])&511,(x+np.arange(w)[None,:])&1023]=color;continue
  if code==0x80:
   sx=words[1]&1023;sy=(words[1]>>16)&511;dx=words[2]&1023;dy=(words[2]>>16)&511;w=((words[3]-1)&1023)+1;h=(((words[3]>>16)-1)&511)+1
   vram[(dy+np.arange(h)[:,None])&511,(dx+np.arange(w)[None,:])&1023]=vram[(sy+np.arange(h)[:,None])&511,(sx+np.arange(w)[None,:])&1023].copy();continue
  if code not in [0x64,0x65]:raise ValueError(f'Unsupported command {hex(code)}')
  raw=texture(vram,p);sprite=raw.copy()
  if not code&1:
   cols=[(p['color']>>shift)&255 for shift in [0,8,16]]
   sprite=(raw&0x8000).astype(np.uint32)
   for c,shift in zip(cols,[0,5,10]):sprite |= np.minimum(((raw.astype(np.uint32)>>shift)&31)*c>>7,31)<<shift
   sprite=sprite.astype(np.uint16)
  signature=[p.get(k) for k in ['tpage','clut','u','v','width','height','color','code']]
  key=hashlib.sha256(json.dumps(signature).encode()).hexdigest()[:16]
  if key not in pieces:
   im=rgba(sprite);im[:,:,3]=np.where(raw==0,0,255);Image.fromarray(im).save(out/(key+'.png'));pieces[key]={'key':key,'signature':signature,'draws':[]}
  pieces[key]['draws'].append({'packet':p['index'],'x':p['x'],'y':p['y']})
  x,y=p['x'],p['y'];clip=regs[3];end=regs[4]
  x0=max(x,clip&1023,0);y0=max(y,(clip>>10)&511,0);x1=min(x+p['width'],(end&1023)+1,1024);y1=min(y+p['height'],((end>>10)&511)+1,512)
  if x1<=x0 or y1<=y0:continue
  src=sprite[y0-y:y1-y,x0-x:x1-x];valid=raw[y0-y:y1-y,x0-x:x1-x]!=0;dst=vram[y0:y1,x0:x1]
  if regs[6]&2:valid &= (dst&0x8000)==0
  if regs[6]&1:src=src|0x8000
  dst[valid]=src[valid]
 diff=vram!=expected
 report={'commands':len(packets),'sprite_draws':sum(len(p['draws']) for p in pieces.values()),'unique_pieces':len(pieces),'different_vram_pixels':int(diff.sum()),'total_vram_pixels':int(vram.size)}
 (D/'replay.json').write_text(json.dumps(report,indent=2)+'\n');(out/'manifest.json').write_text(json.dumps(list(pieces.values()),indent=2)+'\n')
 Image.fromarray(rgba(vram)[240:480,:320,:3]).save(D/'replayed-frame.png');Image.fromarray((diff*255).astype('uint8')).save(D/'replay-difference.png')
 if diff.any():
  yy,xx=np.where(diff);report['first_differences']=[{'x':int(x),'y':int(y),'got':hex(int(vram[y,x])),'expected':hex(int(expected[y,x]))} for y,x in zip(yy[:12],xx[:12])]
 print(json.dumps(report,indent=2))
 # Palette-correct pieces, at 2x nearest-neighbor with labels for review.
 sheet=Image.new('RGB',(800,((len(pieces)+7)//8)*100),(35,35,35));draw=ImageDraw.Draw(sheet)
 for i,p in enumerate(pieces.values()):
  im=Image.open(out/(p['key']+'.png'));im.thumbnail((88,76),Image.NEAREST)
  x=(i%8)*100;y=(i//8)*100;sheet.paste(im,(x,y),im);draw.text((x,y+78),f'{i}: {p["draws"][0]["packet"]}',fill='white')
 sheet.save(D/'sprite-pieces.jpg')
 if diff.any():raise SystemExit('Replay mismatch; investigate before accepting renderer')
if __name__=='__main__':main()
