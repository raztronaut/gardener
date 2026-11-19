"""Capture original World music/SFX through isolated SPU, with voice-group isolation."""
import ctypes as C,struct,wave,subprocess,json
from harness import Psx,ROOT,BATCH
out=ROOT/'data/bw/pack';out.mkdir(exist_ok=True)
s=Psx(core=ROOT/'data/bw/upstream/pcsx-rearmed/pcsx_rearmed_libretro.so');s.lib.retro_bw_mute.argtypes=[C.c_uint32];s.lib.retro_bw_call.argtypes=[C.c_uint32]*5+[C.POINTER(C.c_uint32)]
chunks=[]
def audio(p,n):chunks.append(C.string_at(p,n*4));return n
cb=BATCH(audio);s.lib.retro_set_audio_sample_batch(cb)
state=(ROOT/'data/bw/harness/fight3.state').read_bytes()
def prepare(mask):
 s.load(state);ptr=s.lib.retro_get_memory_data(2)
 def put(a,fmt,v):C.memmove(ptr+a,struct.pack(fmt,v),struct.calcsize(fmt))
 for i in range(5):put(0xcda98+i*0xdc+0xd2,'B',0);put(0x78c7c+i,'B',0)
 for i in range(40):put(0xcdee8+i*0x7c+0x56,'<H',10)
 for i in range(130):put(0xd0148+i*0x70+0x56,'<H',10)
 ram=s.ram()
 for i in range(3840):
  val=struct.unpack_from('<H',ram,0xcbc80+i*2)[0]
  if (val&0x3f80)==0x3f80 and (val&127)==1:put(0xcbc80+i*2,'<H',0x4001)
 s.lib.retro_bw_mute(mask);s.run(120);chunks.clear()
def save(name):
 p=out/(name+'.wav')
 with wave.open(str(p),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(44100);f.writeframes(b''.join(chunks))
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(p),'-c:a','libvorbis','-q:a','4',str(out/(name+'.ogg'))],check=True)
 print(name,sum(map(len,chunks))//4/44100,flush=True)
if not (out/'music.ogg').exists():prepare(0xff0000);s.run(3600);save('music')
sounds=[4,7,8,10,14,17,22,31,34,37,38,39,44,46,54,86,112,114,115]
for sound in sounds:
 if (out/("sfx-"+str(sound)+".ogg")).exists():continue
 prepare(0x1ffffff);s.lib.retro_bw_mute(0x100ffff);ret=C.c_uint32();s.lib.retro_bw_call(0x80014a78,sound,0xffffffff,0,0,C.byref(ret));s.run(120);save('sfx-'+str(sound))
s.close()
(out/'audio.json').write_text(json.dumps({'sampleRate':44100,'music':'music.ogg','sounds':{str(i):f'sfx-{i}.ogg' for i in sounds},'source':'Original US World SPU capture, voices 0–15 music, 16–23 effects'})+'\n')
