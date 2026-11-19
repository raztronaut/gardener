"""Package only household-local runtime assets. Never write ROM data under public/."""
from pathlib import Path
import hashlib,json,shutil,subprocess,sys
ROOT=Path(__file__).resolve().parents[2];out=ROOT/'data/bw/pack';out.mkdir(exist_ok=True)
files={'battle.ram':('data/bw/gpu/frame.ram',2097152),'battle.vram':('data/bw/gpu/before.vram',1048576)}
for name,(source,size) in files.items():
 b=(ROOT/source).read_bytes()
 if len(b)!=size:raise ValueError('Unexpected asset size: '+source)
 (out/name).write_bytes(b)
audio=json.loads((out/'audio.json').read_text())
names=['battle.ram','battle.vram','audio.json','music.ogg',*audio['sounds'].values()]
presentation=out/'presentation.json'
subprocess.run([sys.executable,str(ROOT/'tools/bw/prepare-presentation.py'),'--out',str(presentation)],check=True)
subprocess.run([sys.executable,str(ROOT/'tools/bw/build-menu-pack.py'),'--presentation',str(presentation),'--out',str(presentation)],check=True)
manifest={'version':4,'game':'Bomberman World (USA)','mode':'Garden portrait battle','arena':{'columns':11,'rows':27,'projection':'portrait oblique, shear 1/10','footprint':'rectangle','spawn':'bounded three-cell pockets'},'presentation':json.loads(presentation.read_text()),'sourceExeSha256':'34b3d7a3657a6b161acf8b5802a22f29bc89e0a8f73c1fdbb94cc607bb75c626','files':{n:{'bytes':(out/n).stat().st_size,'sha256':hashlib.sha256((out/n).read_bytes()).hexdigest()} for n in names}}
(out/'pack.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Private World runtime pack:',sum(f['bytes'] for f in manifest['files'].values()),'bytes')

# Add all original stage sectors and their private captures.
subprocess.run([sys.executable,str(ROOT/'tools/bw/build-stages.py')],check=True)
