"""Build household-private stage assets from observed original GPU/RAM captures."""
import base64,hashlib,io,json,struct,shutil
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'data/bw/complete/stages';out=ROOT/'data/bw/pack'
names=['Standard','Candy Store','Jungle Tunnel','Brick Castle','Volcano','Slippy Valley','Chimney Blast','Slow or Fast','Desert Warp','Seesaw Park']
def png(im):
 b=io.BytesIO();im.save(b,format='PNG');return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
def primitive(b,p):
 u=lambda a:struct.unpack_from('<I',b,a&0x1fffff)[0]
 q=u(p+16);n=u(q);assert 0<n<32
 seq=u(p+8);sx,sy=struct.unpack_from('<hh',b,(seq&0x1fffff)+4)
 result=[]
 for i in range(n):
  a=(q&0x1fffff)+4+20*i;uvdxdy=struct.unpack_from('<BBbb',b,a);clut,tp,w,h=struct.unpack_from('<4H',b,a+4)
  result.append(dict(zip(['u','v','dx','dy'],uvdxdy),clut=clut,tpage=tp,width=w,height=h,sx=sx,sy=sy))
 return result
pack=json.loads((out/'pack.json').read_text());stages=[]
for survey in range(10):
 d=D/f'gpu-{survey}';b=(d/'frame.ram').read_bytes();index=struct.unpack_from('<H',b,0x78aac)[0]
 ps=json.loads((d/'packets.json').read_text());bg=[]
 for p in ps[:214]:
  if p.get('code') not in ['0x64','0x65']:continue
  q={key:p[key] for key in ['x','y','width','height','u','v','clut','tpage']};q['y']-=((p['ex_regs'][3]>>10)&511);bg.append(q)
 assert len(bg)==99
 preview=Image.open(D/f'select-{survey}.png').convert('RGB')
 # Preserve the original selected island, stage lettering and selection screen.
 entry={'id':index,'name':names[index],'preview':png(preview)};stages.append(entry)
 if not index:continue
 info={'stage':index,'background':bg,'terrain':{'pillar':primitive(b,0x7f65c),'pillar2':primitive(b,0x7f6a8),'soft':primitive(b,0x7f6f4)}}
 (out/f'stage-{index}.json').write_text(json.dumps(info))
 for ext,source in [('ram','frame.ram'),('vram','before.vram')]:shutil.copyfile(d/source,out/f'stage-{index}.{ext}')
 for ext in ['ram','vram','json']:
  name=f'stage-{index}.{ext}';raw=(out/name).read_bytes();pack['files'][name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
pack['stages']=sorted(stages,key=lambda s:s['id']);pack['version']=5
(out/'pack.json').write_text(json.dumps(pack));print('Built all ten original stage selections; nine additional native stage packs.')
