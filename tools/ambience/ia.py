import sys, json, urllib.request, urllib.parse
q = sys.argv[1]
u = 'https://archive.org/advancedsearch.php?' + urllib.parse.urlencode({'q': f'({q}) AND mediatype:audio', 'fl[]': ['identifier','title','licenseurl','creator'], 'rows': int(sys.argv[3]) if len(sys.argv) > 3 else 100, 'output': 'json'}, doseq=True)
r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'GardenerKiosk/1.0'}), timeout=60))
for d in r['response']['docs']:
    lic = d.get('licenseurl', '-')
    if len(sys.argv) > 2 and sys.argv[2] == 'lic' and lic == '-': continue
    print(d['identifier'], '|', str(d.get('title'))[:70], '|', lic, '|', str(d.get('creator'))[:30])
