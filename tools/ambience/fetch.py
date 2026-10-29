import sys, json, time, re, os, html, urllib.request, urllib.parse, urllib.error
UA = {'User-Agent': 'GardenerKiosk/1.0 (private home dashboard; ambience sourcing)'}
W = os.environ.get('AMB_WORK') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
meta_p = os.path.join(W, 'meta.json'); meta = json.load(open(meta_p)) if os.path.exists(meta_p) else {}
ia = json.load(open(os.path.join(W, 'lists/iameta.json')))
def get(u, tries=10):
    for i in range(tries):
        try:
            time.sleep(1.5)
            return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=300)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503): raise
            time.sleep(min(300, 30 * (i + 1)))
def strip(s): return ' '.join(html.unescape(re.sub('<[^>]+>', ' ', s or '')).split())
only = sys.argv[1] if len(sys.argv) > 1 else None
for line in open(os.path.join(W, 'cands.tsv')):
    key, place, role, kind, ref = line.rstrip('\n').split('\t')
    if only and not re.fullmatch(only, kind): continue
    if key in meta and os.path.exists(meta[key]['path']): continue
    m = dict(key=key, place=place, role=role)
    if kind == 'C':
        u = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(dict(action='query', format='json', formatversion=2, titles=ref, prop='imageinfo', iiprop='url|size|extmetadata', iiextmetadatafilter='LicenseShortName|LicenseUrl|Artist|ImageDescription|Credit'))
        pg = json.load(get(u))['query']['pages'][0]; ii = pg['imageinfo'][0]; md = ii['extmetadata']
        m.update(title=ref[5:], url=ii['url'].split('?')[0], page=ii['descriptionurl'], duration=ii.get('duration'),
                 license=md.get('LicenseShortName', {}).get('value'), license_url=md.get('LicenseUrl', {}).get('value'),
                 author=strip(md.get('Artist', {}).get('value')), desc=strip(md.get('ImageDescription', {}).get('value'))[:600], source='Wikimedia Commons')
    elif kind in ('IA', 'IAF'):
        ident, _, fname = ref.partition('|')
        o = ia[ident]
        if not fname:
            orig = [f for f in o['files'] if f['source'] == 'original'] or o['files']
            orig.sort(key=lambda f: (0 if re.search(r'\.(wav|flac)$', f['name'], re.I) else 1))
            fname = orig[0]['name']
        f = next(x for x in o['files'] if x['name'] == fname)
        m.update(title=o['title'] + ('' if fname == '' else (' — ' + fname if kind == 'IAF' else '')), url='https://archive.org/download/%s/%s' % (ident, urllib.parse.quote(fname)),
                 page='https://archive.org/details/' + ident, duration=float(f['length']) if f.get('length') and ':' not in str(f['length']) else None,
                 license_url=o['lic'], author=o['creator'], desc=o['desc'][:600], source='Internet Archive' + (' (radio aporee)' if ident.startswith('aporee') else ''))
    else:
        m.update(title=os.path.basename(ref), url=ref, page=None, license='Public domain (U.S. National Park Service)', author='U.S. National Park Service', source='NPS')
    ext = os.path.splitext(urllib.parse.urlparse(m['url']).path)[1].lower() or '.bin'
    m['path'] = os.path.join(W, 'dl', key + ext)
    try:
        with get(m['url']) as r, open(m['path'] + '.part', 'wb') as fo:
            while True:
                b = r.read(1 << 16)
                if not b: break
                fo.write(b)
    except Exception as e:
        print(key, 'FAILED', e, flush=True); continue
    os.rename(m['path'] + '.part', m['path'])
    if kind == 'C': time.sleep(8)
    cur = json.load(open(meta_p)) if os.path.exists(meta_p) else {}
    cur[key] = m; meta = cur
    tmpp = meta_p + '.%d' % os.getpid(); json.dump(cur, open(tmpp, 'w'), indent=1, ensure_ascii=False); os.replace(tmpp, meta_p)
    print(key, m.get('license') or m.get('license_url'), os.path.getsize(m['path']) // 1024, 'KB', flush=True)
