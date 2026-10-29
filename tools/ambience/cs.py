import sys, json, urllib.request, urllib.error, urllib.parse, re, html
UA = {'User-Agent': 'GardenerKiosk/1.0 (private home dashboard; ambience sourcing)'}
def api(params):
    params = dict(params, action='query', format='json', formatversion='2')
    u = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(params)
    import time
    for i in range(6):
        try:
            time.sleep(1.5)
            return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(10 * (i + 1))
    raise SystemExit('rate limited')
def strip(s): return html.unescape(re.sub('<[^>]+>', '', s or '')).strip()
def show(pages, mindur=0):
    out = []
    for p in pages:
        ii = (p.get('imageinfo') or [{}])[0]
        md = ii.get('extmetadata', {})
        dur = ii.get('duration') or 0
        if dur < mindur: continue
        out.append((dur, p['title'], md.get('LicenseShortName', {}).get('value'), strip(md.get('Artist', {}).get('value'))[:40], strip(md.get('ImageDescription', {}).get('value'))[:160].replace('\n', ' ')))
    for o in sorted(out, reverse=True):
        print(f"{o[0]:7.0f}s | {o[1]} | {o[2]} | {o[3]}\n         {o[4]}")
mode = sys.argv[1]
mindur = float(sys.argv[3]) if len(sys.argv) > 3 else 0
props = dict(prop='imageinfo', iiprop='url|size|mime|extmetadata', iiextmetadatafilter='LicenseShortName|Artist|ImageDescription|LicenseUrl')
if mode == 'search':
    pages=[]; off=0
    for _ in range(4):
        r = api(dict(props, generator='search', gsrsearch=sys.argv[2] + ' filetype:audio', gsrnamespace=6, gsrlimit=50, gsroffset=off))
        pages += r.get('query', {}).get('pages', [])
        if 'continue' not in r: break
        off = r['continue']['gsroffset']
    show(pages, mindur)
elif mode == 'cat':
    r = api(dict(props, generator='categorymembers', gcmtitle='Category:' + sys.argv[2], gcmtype='file', gcmlimit=200))
    show(r.get('query', {}).get('pages', []), mindur)
elif mode == 'subcats':
    r = api(dict(list='categorymembers', cmtitle='Category:' + sys.argv[2], cmtype='subcat', cmlimit=200))
    for p in r['query']['categorymembers']: print(p['title'])
elif mode == 'info':
    r = api(dict(props, titles=sys.argv[2]))
    print(json.dumps(r['query']['pages'], indent=1)[:4000])
