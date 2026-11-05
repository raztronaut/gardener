import sys, json, xml.etree.ElementTree as ET
from urllib.parse import urlparse
raw=sys.stdin.buffer.read(1048577)
if len(raw)>1048576 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ValueError('unsupported feed')
root=ET.fromstring(raw)
def name(el): return el.tag.rsplit('}',1)[-1]
def value(el,key):
 for c in el:
  if name(c)==key: return ''.join(c.itertext()).strip()[:500]
 return ''
items=[]
for e in root.iter():
 if name(e) not in ('item','entry'): continue
 title=value(e,'title'); url=value(e,'link')
 if name(e)=='entry':
  for c in e:
   if name(c)=='link' and c.get('rel','alternate')=='alternate': url=c.get('href',''); break
 if not title or urlparse(url).scheme not in ('http','https'): continue
 items.append({'title':title,'url':url,'date':value(e,'pubDate') or value(e,'published') or value(e,'updated')})
 if len(items)>=25: break
print(json.dumps(items))
