#!/usr/bin/env python3
"""Extract original menu layers from observed GPU draws into a PRIVATE pack.
No commercial assets or draw tables belong in the public source tree.
"""
import argparse,base64,io,json,importlib.util
from pathlib import Path
import numpy as np
from PIL import Image
from harness import ROOT
spec=importlib.util.spec_from_file_location('replay',ROOT/'tools/bw/replay-gpu.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
parser=argparse.ArgumentParser();parser.add_argument('--presentation',type=Path,default=ROOT/'data/bw/pack/presentation.json');parser.add_argument('--out',type=Path,default=ROOT/'data/bw/pack/presentation.json');args=parser.parse_args()
D=ROOT/'data/bw/menu-gpu'
presentation=json.loads(args.presentation.read_text());images=presentation['images']
def load(name):
 d=D/name;return json.loads((d/'packets.json').read_text()),np.frombuffer((d/'before.vram').read_bytes(),dtype='<u2').reshape(512,1024)
def sprite(vr,p,bright=False):
 raw=mod.texture(vr,p);a=mod.rgba(raw)
 if not bright:
  for c in range(3):a[:,:,c]=np.minimum((((raw>>(c*5))&31).astype(np.uint32)*((p['color']>>(c*8))&255))>>7,31)*255//31
 return Image.fromarray(a)
def save(name,im):
 b=io.BytesIO();im.save(b,format='PNG');images[name]='data:image/png;base64,'+base64.b64encode(b.getvalue()).decode();im.save(D/(name+'.png'))
def layer(name,source,predicate,box=(0,0,320,240),bright=False):
 ps,vr=load(source);out=Image.new('RGBA',(box[2],box[3]))
 for p in ps:
  if p['code']!='0x64' or not predicate(p):continue
  im=sprite(vr,p,bright);out.alpha_composite(im,(p['x']-box[0],p['y']-((p['ex_regs'][5]>>11)&2047)-box[1]))
 save(name,out)
# Keep exact original composition, including copyright, logo pieces and art.
base=lambda p:p['index']<=36 or p['index'] in [40,42,44]
layer('menuTitle','press3',base,bright=True)
layer('menuTitleDim','press3',base)
layer('menuMain','press3',lambda p:p['index']>=46)
layer('menuModes','mode',lambda p:p['index']>=46)
layer('menuHead','press3',lambda p:p['index']==38,box=(40,140,16,16))
layer('menuBattle','royal0',lambda p:not(p['tpage']==30 and p['clut']==30930))
layer('menuPlayers','royal1',lambda p:p['clut'] not in [32274,32338,30930])
layer('menuMan','royal1',lambda p:p['clut']==32274 and p['y']%240==92,box=(236,92,36,16))
layer('menuCom','royal1',lambda p:p['clut']==32338 and p['y']%240==192,box=(236,192,36,16))
layer('menuFeather','royal1',lambda p:p['clut']==30930,box=(48,90,18,20))
# The original title font, with its own highlighted glyph rows.
ps,vr=load('press3');p=next(p for p in ps if p.get('tpage')==140 and p.get('clut')==30784).copy();p.update(u=0,v=0,width=256,height=192,color=0x808080);save('menuAlphabet',sprite(vr,p))
# Separate rule values from the original paper/labels so time and target wins
# reflect the actual settings instead of being baked into a screenshot.
layer('menuRules','players-confirmed',lambda p:not(p['tpage']==30 and p['clut']==30930) and not(p['tpage']==31 and p['x']>=240 and p['y']%240 in [112,132]))
ps,vr=load('players-confirmed')
for name,clut in [('menuNumbersGreen',32402),('menuNumbersRed',32338)]:
 p=next(p for p in ps if p.get('tpage')==31 and p.get('clut')==clut).copy();p.update(u=0,v=112,width=176,height=16,color=0x808080);save(name,sprite(vr,p))
# Portrait layout uses separate paper, labels and title art; letters/characters
# keep their aspect ratio while the paper gets a taller central section.
layer('portraitTitle','press3',lambda p:p['index']<=36 and p['index']!=24,bright=True)
layer('portraitCopyright','press3',lambda p:p['index']==24 or p['index'] in [40,42,44],box=(0,200,320,32),bright=True)
layer('portraitPaper','royal1',lambda p:p['clut']==30848)
for key,source in [('Battle','royal0'),('Players','royal1'),('Rules','players-confirmed')]:
 layer('portrait'+key+'Heading',source,lambda p:p['tpage']==31 and p['y']%240==26,box=(0,0,320,56))
for i in range(5):
 layer('portraitPlayer'+str(i),'royal1',lambda p:p['clut']==31762 and p['y']%240==92+i*25,box=(0,92+i*25,320,20))
for i in range(6):
 layer('portraitRule'+str(i),'players-confirmed',lambda p:p['tpage']==31 and p['y']%240==92+i*20 and not(i in [1,2] and p['x']>=240),box=(0,92+i*20,320,20))
for i in range(2):
 layer('portraitBattle'+str(i),'royal0',lambda p:p['tpage']==31 and p['y']%240==112+i*40,box=(0,112+i*40,320,20))
args.out.write_text(json.dumps(presentation));print('Private original menu layers:',args.out)
