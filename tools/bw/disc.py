#!/usr/bin/env python3
"""Read-only MODE2/2352 ISO9660 extractor for the household's US World disc.
Generated files belong in ignored data/bw, never in public/ or source control.
"""
import argparse, hashlib, json, struct
from pathlib import Path

class Disc:
    def __init__(self, path):
        self.path = Path(path)
        self.f = self.path.open('rb')
        self.size = self.path.stat().st_size
        if self.size % 2352:
            raise ValueError('Expected a raw 2352-byte-sector data track')
        pvd = self.read(16, 2048)
        if pvd[:7] != b'\x01CD001\x01':
            raise ValueError('Missing ISO9660 primary descriptor')
        self.volume = pvd[40:72].decode('ascii').strip()
        self.root = self.record(pvd[156:190])

    def read(self, lba, size):
        if lba < 0 or size < 0 or (lba + (size+2047)//2048)*2352 > self.size:
            raise ValueError('Extent outside disc')
        out = bytearray()
        for sector in range(lba, lba + (size+2047)//2048):
            self.f.seek(sector*2352)
            raw = self.f.read(2352)
            if raw[:12] != b'\x00'+b'\xff'*10+b'\x00' or raw[15] != 2:
                raise ValueError('Expected MODE2 sector')
            if raw[18] & 0x20:
                raise ValueError('Form2 stream is not an ISO file extent')
            out.extend(raw[24:24+2048])
        return bytes(out[:size])

    @staticmethod
    def record(b):
        if len(b)<34 or b[0]<34 or b[32]+33>b[0]:
            raise ValueError('Invalid directory record')
        lba, size = struct.unpack_from('<I',b,2)[0],struct.unpack_from('<I',b,10)[0]
        if lba != struct.unpack_from('>I',b,6)[0] or size != struct.unpack_from('>I',b,14)[0]:
            raise ValueError('Directory endian copies differ')
        return dict(lba=lba,size=size,directory=bool(b[25]&2),name=b[33:33+b[32]])

    def files(self):
        seen=set()
        def walk(entry,prefix=''):
            if entry['lba'] in seen: raise ValueError('Directory cycle')
            seen.add(entry['lba'])
            data=self.read(entry['lba'],entry['size']); pos=0
            while pos<len(data):
                n=data[pos]
                if not n:
                    pos=(pos//2048+1)*2048; continue
                e=self.record(data[pos:pos+n]); pos+=n
                if e['name'] in (b'\0',b'\1'): continue
                name=e['name'].decode('ascii').split(';')[0]
                if not name or '/' in name or '\\' in name or name in ('.','..'):
                    raise ValueError('Unsafe filename')
                path=prefix+name
                if e['directory']: yield from walk(e,path+'/')
                else: yield dict(path=path,lba=e['lba'],size=e['size'])
        yield from walk(self.root)


def inspect_exe(data):
    if data[:8]!=b'PS-X EXE': return None
    pc,gp,addr,size=struct.unpack_from('<4I',data,0x10)
    return dict(entry_pc=hex(pc),gp=hex(gp),load_address=hex(addr),text_size=hex(size),
                payload_present=len(data)>=2048+size)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('bin',type=Path); p.add_argument('--out',type=Path,required=True)
    a=p.parse_args(); a.out.mkdir(parents=True,exist_ok=True)
    d=Disc(a.bin); entries=[]
    for e in d.files():
        # XA video/audio streams need their raw sectors; preserve the disc source.
        try: data=d.read(e['lba'],e['size'])
        except ValueError as ex:
            e['extraction_error']=str(ex); entries.append(e); continue
        dst=a.out/e['path']; dst.parent.mkdir(parents=True,exist_ok=True)
        if dst.exists() and dst.read_bytes()!=data: raise ValueError(f'Refusing to replace {dst}')
        dst.write_bytes(data)
        e['sha256']=hashlib.sha256(data).hexdigest()
        exe=inspect_exe(data)
        if exe: e['psx_exe']=exe
        entries.append(e)
    result=dict(volume=d.volume,files=entries)
    (a.out/'inventory.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(volume=d.volume,files=len(entries),executables=[e for e in entries if 'psx_exe' in e],skipped=[e['path'] for e in entries if 'extraction_error' in e]),indent=2))

if __name__=='__main__': main()
