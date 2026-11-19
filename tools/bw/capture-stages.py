"""Capture all original stage selections using the installed offline analysis harness."""
import sys
from harness import Psx,ROOT
from PIL import Image,ImageDraw
import struct,json
s=Psx();base=(ROOT/'data/bw/harness/arena.state').read_bytes();out=ROOT/'data/bw/complete/stages';out.mkdir(exist_ok=True)
records=[]
for n in range(10):
 s.load(base);s.run(30)
 for _ in range(n):s.run(4,128);s.run(90)
 Image.fromarray(s.frame).save(out/f'select-{n}.png');(out/f'select-{n}.state').write_bytes(s.save());s.run(4,1)
 frames=0
 for i in range(30):
  s.run(20);frames+=20;ram=s.ram();timer=struct.unpack_from('<H',ram,0x78bf8)[0]
  if 10500<timer<10800:break
 Image.fromarray(s.frame).save(out/f'fight-{n}.png');(out/f'fight-{n}.state').write_bytes(s.save());(out/f'fight-{n}.ram').write_bytes(ram)
 record={'selection':n,'frames':frames,'timer':timer,'stage':struct.unpack_from('<H',ram,0x78aac)[0],'bombs':struct.unpack_from('<H',ram,0xcda98+0x8e)[0],'fire':ram[0xcda98+0xda]};records.append(record);print(record,flush=True)
s.close();(out/'survey.json').write_text(json.dumps(records,indent=2))
sheet=Image.new('RGB',(640,5*260));d=ImageDraw.Draw(sheet)
for n in range(10):sheet.paste(Image.open(out/f'select-{n}.png'),((n%2)*320,(n//2)*260));d.text(((n%2)*320,(n//2)*260+240),str(n),fill='white')
sheet.save(out/'selection-sheet.png')
