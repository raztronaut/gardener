import sys, json, time, re, html, urllib.request
out = {}
try: out = json.load(open(sys.argv[1]))
except Exception: pass
for ident in sys.argv[2:]:
    if ident in out: continue
    time.sleep(0.7)
    d = json.load(urllib.request.urlopen(urllib.request.Request('https://archive.org/metadata/' + ident, headers={'User-Agent': 'GardenerKiosk/1.0'}), timeout=60))
    m = d.get('metadata', {})
    fs = [f for f in d.get('files', []) if re.search(r'\.(wav|flac|mp3|ogg|aif+|m4a)$', f['name'], re.I)]
    out[ident] = dict(title=m.get('title'), creator=m.get('creator'), lic=m.get('licenseurl'), date=m.get('date'),
        desc=' '.join(html.unescape(re.sub('<[^>]+>', ' ', str(m.get('description') or ''))).split())[:700],
        files=[dict(name=f['name'], source=f.get('source'), fmt=f.get('format'), size=f.get('size'), length=f.get('length')) for f in fs])
    json.dump(out, open(sys.argv[1], 'w'), indent=1)
for ident in sys.argv[2:]:
    o = out[ident]; orig = [f for f in o['files'] if f['source'] == 'original'] or o['files']
    print(f"## {ident} | {o['title']} | {o['lic']} | {o['creator']} | {o['date']}\n   files: " + '; '.join(f"{f['name'][-40:]} {f['fmt']} {f['length']}" for f in orig[:3]) + f"\n   {o['desc'][:500]}")
