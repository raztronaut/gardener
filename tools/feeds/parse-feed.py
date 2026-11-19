import sys, json, re, xml.etree.ElementTree as ET
from html.parser import HTMLParser
from importlib.machinery import SourceFileLoader
from pathlib import Path
rich_extract=SourceFileLoader("garden_article",str(Path(__file__).with_name("parse-article.py"))).load_module().extract
from urllib.parse import urlparse, urljoin
raw=sys.stdin.buffer.read(1048577)
if len(raw)>1048576: raise ValueError('oversize feed')
class Text(HTMLParser):
 def __init__(self): super().__init__(convert_charrefs=True); self.parts=[]; self.skip=0
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style'): self.skip+=1
  if tag in ('p','div','br','li'): self.parts.append('\n')
 def handle_endtag(self,tag):
  if tag in ('script','style'): self.skip=max(0,self.skip-1)
  if tag in ('p','div','li'): self.parts.append('\n')
 def handle_data(self,data):
  if not self.skip:self.parts.append(data)
def clean(s,limit):
 p=Text();p.feed(s);return re.sub(r'\s+',' ',' '.join(p.parts)).strip()[:limit]
if len(sys.argv)>1 and sys.argv[1]=='discover':
 class Links(HTMLParser):
  def __init__(self): super().__init__();self.links=[]
  def handle_starttag(self,tag,attrs):
   a=dict(attrs)
   if tag=='link' and 'alternate' in a.get('rel','').lower() and a.get('type','').lower() in ('application/rss+xml','application/atom+xml','application/feed+json'):
    self.links.append({'url':urljoin(sys.argv[2],a.get('href','')),'title':a.get('title','Feed')[:120]})
 p=Links();p.feed(raw.decode('utf-8','replace'));print(json.dumps(p.links[:8]));sys.exit()
# Explicit Almanac website fallback: these are publisher article links, not RSS.
if len(sys.argv)>1 and sys.argv[1]=='almanac':
 class Almanac(HTMLParser):
  def __init__(self):super().__init__(convert_charrefs=True);self.heading=None;self.url='';self.title=[];self.items=[];self.seen=set()
  def handle_starttag(self,tag,attrs):
   a=dict(attrs)
   if tag in ('h2','h3') and 'field-content' in a.get('class',''):self.heading=tag;self.url='';self.title=[]
   if self.heading and tag=='a':self.url=urljoin('https://www.almanac.com',a.get('href',''))
  def handle_data(self,data):
   if self.heading:self.title.append(data)
  def handle_endtag(self,tag):
   if tag!=self.heading:return
   title=clean(' '.join(self.title),500);u=urlparse(self.url)
   if title and u.scheme=='https' and u.hostname in ('www.almanac.com','almanac.com') and self.url not in self.seen:
    self.seen.add(self.url);self.items.append({'title':title,'url':self.url,'date':'','summary':'From The Old Farmer’s Almanac website. Open the article to read the full guide.','content':'','coverage':'website excerpt'})
   self.heading=None
 p=Almanac();p.feed(raw.decode('utf-8','replace'));print(json.dumps(p.items[:40]));sys.exit()
# JSON Feed uses the same bounded text/link sanitization as RSS and Atom.
if raw.lstrip().startswith(b'{'):
 data=json.loads(raw)
 if not str(data.get('version','')).startswith('https://jsonfeed.org/version/') or not isinstance(data.get('items'),list): raise ValueError('unsupported JSON Feed')
 items=[]
 for item in data['items'][:80]:
  url=item.get('url') or item.get('external_url') or ''; parsed=urlparse(url)
  title=clean(str(item.get('title') or ''),500)
  if not title or parsed.scheme not in ('http','https') or parsed.username or not parsed.hostname:continue
  prose=str(item.get('content_html') or item.get('content_text') or item.get('summary') or '')
  items.append({'title':title,'url':url[:2048],'date':item.get('date_published') or item.get('date_modified') or '', 'summary':clean(str(item.get('summary') or prose),700),'content':clean(prose,10000),'html':rich_extract(prose,url)['html']})
  if len(items)>=40:break
 print(json.dumps(items));sys.exit()
if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper(): raise ValueError('unsupported feed')
root=ET.fromstring(raw)
def name(el): return el.tag.rsplit('}',1)[-1]
def value(el,key):
 for c in el:
  if name(c)==key and not c.tag.startswith('{http://search.yahoo.com/mrss/}'): return ''.join(c.itertext()).strip()[:30000]
 return ''
items=[]
for e in root.iter():
 if name(e) not in ('item','entry'): continue
 title=clean(value(e,'title'),500); url=value(e,'link')
 if name(e)=='entry':
  for c in e:
   if name(c)=='link' and c.get('rel','alternate')=='alternate': url=c.get('href',''); break
 parsed=urlparse(url)
 if not title or parsed.scheme not in ('http','https') or parsed.username or not parsed.hostname: continue
 summary=clean(value(e,'description') or value(e,'summary') or value(e,'encoded') or value(e,'content'),700)
 content=clean(value(e,'encoded') or value(e,'content') or value(e,'description') or value(e,'summary'),10000)
 items.append({'title':title,'url':url[:2048],'date':value(e,'pubDate') or value(e,'published') or value(e,'updated'),'summary':summary,'content':content,'html':rich_extract(value(e,'encoded') or value(e,'content') or value(e,'description') or value(e,'summary'),url)['html']})
 if len(items)>=40: break
print(json.dumps(items))
