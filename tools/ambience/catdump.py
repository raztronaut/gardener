import sys, json, time, urllib.request, urllib.parse, urllib.error
UA = {'User-Agent': 'GardenerKiosk/1.0 (private home dashboard; ambience sourcing)'}
def api(params):
    u = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(dict(params, action='query', format='json', formatversion='2'))
    for i in range(6):
        try:
            time.sleep(1.5)
            return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60))
        except urllib.error.HTTPError as e:
            if e.code != 429: raise
            time.sleep(10 * (i + 1))
out = []
p = dict(generator='categorymembers', gcmtitle='Category:' + sys.argv[1], gcmtype='file', gcmlimit=100, prop='imageinfo', iiprop='url|size|mime|extmetadata', iiextmetadatafilter='LicenseShortName|Artist|ImageDescription|ObjectName')
while True:
    r = api(p)
    for pg in r.get('query', {}).get('pages', []):
        ii = (pg.get('imageinfo') or [{}])[0]; md = ii.get('extmetadata', {})
        out.append(dict(title=pg['title'], dur=ii.get('duration') or 0, url=ii.get('url'), page=ii.get('descriptionurl'), mime=ii.get('mime'),
            lic=md.get('LicenseShortName', {}).get('value'), artist=md.get('Artist', {}).get('value'), desc=md.get('ImageDescription', {}).get('value')))
    if 'continue' not in r: break
    p.update(r['continue'])
json.dump(out, open(sys.argv[2], 'w'), indent=0)
print(len(out))
