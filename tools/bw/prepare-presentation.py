#!/usr/bin/env python3
"""Extract World presentation references from the household's measured disc data.
No original pixels, tables or binaries are committed to the source checkout.
"""
import argparse,base64,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);a=p.parse_args()
packets=json.loads((ROOT/'data/bw/gpu/packets.json').read_text())
background=[{key:d[key] for key in ['x','y','width','height','u','v','clut','tpage']}
            for d in packets if d.get('width') and d['index']<214]
assert len(background)==99, 'Revalidate the original stage background capture'
images={name:'data:image/png;base64,'+base64.b64encode((ROOT/f'data/bw/assets/TITLE-{index:02}-type1.png').read_bytes()).decode()
        for name,index in [('titleLeft',14),('titleRight',16),('logo',17),('font',13)]}
a.out.parent.mkdir(parents=True,exist_ok=True)
a.out.write_text(json.dumps({'background':background,'images':images}))
print(a.out)
