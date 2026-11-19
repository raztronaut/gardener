"""Bounded article extraction; emit only inert, allowlisted HTML (stdlib only)."""
import sys, json, re, html, ipaddress
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
ALLOWED=set('p br h1 h2 h3 h4 h5 h6 strong b em i u s del a img figure figcaption blockquote ul ol li pre code table thead tbody tfoot tr th td hr sup sub details summary'.split())
DROP=set('script style nav footer aside form svg math iframe object embed template button input select textarea canvas'.split())
VOID=set('area base br col embed hr img input link meta param source track wbr'.split())
class Node:
 def __init__(self,tag='',attrs=()): self.tag=tag;self.attrs=dict(attrs);self.children=[]
class Parser(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root];self.count=0
 def handle_starttag(self,tag,attrs):
  self.count+=1
  if self.count>45000 or len(self.stack)>150:raise ValueError('Article too complex')
  n=Node(tag,attrs);self.stack[-1].children.append(n)
  if tag not in VOID:self.stack.append(n)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==tag:del self.stack[i:];break
 def handle_data(self,s):self.stack[-1].children.append(s)
def text(n):
 if isinstance(n,str):return n
 if n.tag in DROP:return ''
 return ' '.join(text(c) for c in n.children)
def walk(n):
 if isinstance(n,str):return
 yield n
 for c in n.children:yield from walk(c)
def safe_url(value,base,image=False):
 try:
  url=urljoin(base,value.strip());u=urlsplit(url)
  if u.scheme not in ('https','http') or not u.hostname or u.username or u.password:return ''
  host=u.hostname.lower()
  if host=='localhost' or host.endswith(('.local','.localhost')) or '.' not in host:return ''
  try:
   if not ipaddress.ip_address(host).is_global:return ''
  except ValueError:pass
  return url[:4096]
 except ValueError:return ''
def extract(raw,base):
 p=Parser();p.feed(raw)
 nodes=list(walk(p.root))
 candidates=[n for n in nodes if n.tag in ('article','main') or n.attrs.get('role')=='main' or re.search(r'(?:^|[ _-])(?:article-body|entry-content|post-content|article-content)(?:$|[ _-])',n.attrs.get('class',''))]
 articles=[n for n in candidates if n.tag=='article' and len(text(n))>500]
 best=max(articles or candidates,key=lambda n:len(text(n)),default=None)
 if best is None:best=next((n for n in nodes if n.tag=='body'),p.root)
 seen_captions=set()
 def render(n):
  if isinstance(n,str):return html.escape(n)
  t=n.tag
  if t == 'h1':return ''
  if t in DROP or n.attrs.get('aria-hidden')=='true' or 'hidden' in n.attrs:return ''
  if t=='figcaption':
   caption=re.sub(r'\s+',' ',text(n)).strip()
   if caption in seen_captions:return ''
   seen_captions.add(caption)
  if t=='picture':
   imgs=[c for c in walk(n) if c.tag=='img']
   sources=[c.attrs.get('srcset','') for c in walk(n) if c.tag=='source' and not c.attrs.get('type','').endswith('avif')]
   if imgs and sources:imgs[0].attrs['srcset']=', '.join(sources)+' , '+imgs[0].attrs.get('srcset','')
  content=''.join(render(c) for c in n.children)
  if t not in ALLOWED:return content
  attrs=''
  if t=='img':
   a=n.attrs;src=a.get('data-src') or a.get('data-original') or a.get('src','')
   # Prefer a full-size candidate from responsive/lazy publisher images.
   srcset=a.get('data-srcset') or a.get('srcset','')
   choices=[c.strip().split() for c in srcset.split(',') if c.strip()]
   if choices:
    def size(c):
     try:
      if len(c)>1:return float(c[-1].rstrip('wx'))
      from urllib.parse import parse_qs
      q=parse_qs(urlsplit(c[0]).query);return float(q.get('width',['0'])[0])*float(q.get('dpr',['1'])[0])
     except ValueError:return 0
    src=max(choices,key=size)[0]
   src=safe_url(src,base,True)
   if not src:return ''
   if any(a.get(k,'').isdigit() and int(a[k])<=2 for k in ('width','height')):return ''
   attrs=' src="'+html.escape(src,quote=True)+'" alt="'+html.escape(a.get('alt','')[:1000],quote=True)+'" loading="lazy" decoding="async" referrerpolicy="no-referrer"'
  if t=='a':
   url=safe_url(n.attrs.get('href',''),base)
   if url:attrs=' href="'+html.escape(url,quote=True)+'" target="_blank" rel="noopener noreferrer"'
  if t in ('td','th'):
   for k in ('colspan','rowspan'):
    v=n.attrs.get(k,'')
    if v.isdigit() and 0<int(v)<=30:attrs+=' '+k+'="'+v+'"'
  if t=='ol' and re.fullmatch(r'\d{1,5}',n.attrs.get('start','')):attrs+=' start="'+n.attrs['start']+'"'
  return '<'+t+attrs+'>'+('' if t in VOID else content+'</'+t+'>')
 return {'html':render(best),'text':re.sub(r'\s+',' ',text(best)).strip()[:100000]}
if __name__=='__main__':
 raw=sys.stdin.buffer.read(3145729)
 if len(raw)>3145728:raise ValueError('Article exceeds 3 MB')
 print(json.dumps(extract(raw.decode('utf-8','replace'),sys.argv[1])))
