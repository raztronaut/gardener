#!/usr/bin/env python3
"""Decode captured GP0 primitives using the analysis core's command length table."""
import json,re,struct,collections
from pathlib import Path
from harness import ROOT
import sys
D=Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'data/bw/gpu'
def signed(v,b):return (v&((1<<b)-1))-(1<<b) if v&(1<<(b-1)) else v&((1<<b)-1)
def main():
 source=(ROOT/'data/bw/upstream/pcsx-rearmed/plugins/gpulib/gpu.c').read_text()
 table=source.split('const unsigned char cmd_lengths[256] =',1)[1].split('};',1)[0]
 lens=[int(x) for x in re.findall(r'\b\d+\b',re.sub(r'//[^\n]*','',table))];assert len(lens)==256
 words=list(struct.unpack('<'+'I'*((D/'gp0.bin').stat().st_size//4),(D/'gp0.bin').read_bytes())); regs=json.loads((D/'capture.json').read_text())['ex_regs'];pos=0;packets=[]
 while pos<len(words):
  code=words[pos]>>24;n=lens[code]+1
  if 0xa0<=code<=0xbf:n+=((words[pos+2]&65535)*(words[pos+2]>>16)+1)//2
  if 0x48<=code<=0x5f:raise ValueError('Polyline must be decoded explicitly')
  packet=words[pos:pos+n];assert len(packet)==n
  item={'index':len(packets),'word_offset':pos,'code':hex(code),'words':packet,'ex_regs':regs.copy()}
  if 0xe0<=code<=0xe7:regs[code&7]=packet[0]
  if 0x20<=code<=0x3f:
   textured=bool(code&4);gouraud=bool(code&16);count=4 if code&8 else 3;verts=[];offset=regs[5];j=1;color=packet[0]&0xffffff
   for k in range(count):
    if gouraud and k:color=packet[j]&0xffffff;j+=1
    xy=packet[j];j+=1;v={'x':signed(xy,11)+signed(offset,11),'y':signed(xy>>16,11)+signed(offset>>11,11),'color':color}
    if textured:
     uv=packet[j];j+=1;v.update(u=uv&255,v=(uv>>8)&255)
     if k==0:item['clut']=uv>>16
     if k==1:item['tpage']=uv>>16;regs[1]=(regs[1]&~0x1ff)|(uv>>16&0x1ff)
    verts.append(v)
   item['vertices']=verts;assert j==n
  if 0x60<=code<=0x7f:
   offset=regs[5];xy=packet[1];kind=(code>>3)&3
   width,height=(packet[-1]&65535,packet[-1]>>16) if kind==0 else [(0,0),(1,1),(8,8),(16,16)][kind]
   item.update(x=signed(xy,11)+signed(offset,11),y=signed(xy>>16,11)+signed(offset>>11,11),width=width,height=height,color=packet[0]&0xffffff)
   if code&4:item.update(u=packet[2]&255,v=(packet[2]>>8)&255,clut=packet[2]>>16,tpage=regs[1]&0x1ff)
  packets.append(item);pos+=n
 (D/'packets.json').write_text(json.dumps(packets,indent=2)+'\n')
 counts=collections.Counter(p['code'] for p in packets);print(dict(counts))
 for p in packets:
  if 'vertices'in p:print(p['index'],p['code'],p.get('tpage'),p.get('clut'),p['vertices'])
if __name__=='__main__':main()
