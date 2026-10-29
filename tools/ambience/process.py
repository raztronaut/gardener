# /rainforest ambience pipeline (runs in a work dir, default data/ambience-work/, set AMB_WORK):
#   cands.tsv -> fetch.py (downloads + licence metadata -> meta.json; IA items need lists/iameta.json
#   from iameta.py) -> analyze.py / spec.sh (listen-check numbers + spectrograms) -> plan.json
#   (excerpts, filters, targets) -> process.py <place|item ...|--all> -> data/ambience/.
# Copy cands.tsv + plan.json from tools/ambience/ into the work dir and tools into <work>/tools/.
# Build data/ambience/ from plan.json: trim, filter, loudness-normalise, encode Opus, write
# manifest.json + credits.json. One ffmpeg at a time, nice'd, 2 threads (light load).
import json, os, re, subprocess, sys, hashlib, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import analyze, summarize, loud
W = os.environ.get('AMB_WORK') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get('AMB_OUT') or os.path.join(os.path.dirname(W), 'ambience')
meta = json.load(open(os.path.join(W, 'meta.json')))
plan = json.load(open(os.path.join(W, 'plan.json')))
only = set(sys.argv[1:])
ALL = '--all' in only
FF = ['nice', '-n', '10', 'ffmpeg', '-hide_banner', '-nostdin', '-loglevel', 'error', '-threads', '2', '-y']

def chain(it, dur):
    f = ['highpass=f=%d' % it.get('hp', 80), 'highpass=f=%d' % it.get('hp', 80)]  # 24 dB/oct
    if it.get('lp'): f += ['lowpass=f=%d' % it['lp'], 'lowpass=f=%d' % it['lp']]
    for n in it.get('notch', []): f.append('equalizer=f=%d:t=q:w=8:g=-24' % n)
    f += it.get('extra', [])
    if it.get('denoise'): f.append('afftdn=nr=%d:nf=%d' % tuple(it['denoise']))
    fade = it.get('fade', 0.4)
    f += ['afade=t=in:d=%g' % fade, 'afade=t=out:st=%g:d=%g' % (max(0, dur - fade), fade)]
    return f

res_p = os.path.join(W, 'built.json'); built = json.load(open(res_p)) if os.path.exists(res_p) else {}
for it in plan['items']:
    name = '%s/%s.ogg' % (it['place'], it['out'])
    if not ALL and it['place'] not in only and it['out'] not in only: continue
    src = meta[it['src']]
    ss, to = it.get('ss', 0), it.get('to')
    if to is None: to = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src['path']], capture_output=True, text=True).stdout)
    dur = to - ss
    af = ','.join(chain(it, dur))
    # pass 1: loudness of the filtered excerpt
    tmp = os.path.join(W, 'tmp.wav')
    subprocess.run(FF + ['-ss', str(ss), '-to', str(to), '-i', src['path'], '-af', af, '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', tmp], check=True)
    L = loud(tmp)
    target = it.get('lufs', plan['bed_lufs'] if it['role'] == 'bed' else plan['accent_lufs'])
    gain = target - L['I']
    post = 'volume=%.2fdB' % gain
    if L['TP'] + gain > -1.5: post += ',alimiter=limit=%.3f:level=false:attack=5:release=80' % (10 ** (-1.5 / 20))
    os.makedirs(os.path.join(OUT, it['place']), exist_ok=True)
    out = os.path.join(OUT, name)
    subprocess.run(FF + ['-i', tmp, '-af', post, '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-application', 'audio', '-ac', '2', out], check=True)
    os.remove(tmp)
    A = analyze(out, os.path.join(W, 'an', 'out_' + name.replace('/', '_') + '.npy'))
    s = summarize(A); s.update(loud(out)); s['gain_db'] = round(gain, 1); s['src_lufs'] = L['I']
    s['seconds'] = round(dur, 1)
    built[name] = s; json.dump(built, open(res_p, 'w'), indent=1)
    print(name, s, flush=True)

# manifest + credits for everything in the plan that has been built
places, credits, seen = {}, [], {}
for it in plan['items']:
    name = '%s/%s.ogg' % (it['place'], it['out'])
    if name not in built: continue
    p = places.setdefault(it['place'], {'label': plan['places'][it['place']]['label'], 'description': plan['places'][it['place']]['description'],
                                        'accentEvery': plan['places'][it['place']].get('accentEvery', [25, 70]), 'beds': [], 'accents': []})
    entry = {'file': it['out'] + '.ogg', 'gain': it.get('gain', 1)}
    if it['role'] == 'bed': entry['seconds'] = built[name]['seconds']; p['beds'].append(entry)
    else: p['accents'].append(entry)
    src = meta[it['src']]
    c = seen.get(it['src'])
    if not c:
        lic = src.get('license') or {'https://creativecommons.org/publicdomain/mark/1.0/': 'Public Domain Mark 1.0', 'http://creativecommons.org/publicdomain/mark/1.0/': 'Public Domain Mark 1.0',
            'http://creativecommons.org/publicdomain/zero/1.0/': 'CC0 1.0', 'http://creativecommons.org/licenses/by-sa/3.0/': 'CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/4.0/': 'CC BY-SA 4.0',
            'http://creativecommons.org/licenses/by/3.0/': 'CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/': 'CC BY 3.0'}.get(src.get('license_url'), src.get('license_url'))
        author = src.get('author') or ('The British Library Board (Wildlife Sounds collection, via Europeana Sounds)' if ('W1CDR' in src['title'] or '(W ' in src['title']) else None)
        c = {'title': src['title'], 'author': author, 'license': lic, 'license_url': src.get('license_url'), 'source': src.get('source'),
             'url': src.get('page') or src['url'], 'file_url': src['url'], 'duration_s': src.get('duration'), 'note': plan.get('notes', {}).get(it['src']), 'used_in': []}
        seen[it['src']] = c; credits.append(c)
    c['used_in'].append({'place': it['place'], 'file': name, 'role': it['role'], 'from_s': it.get('ss', 0), 'to_s': it.get('to'),
                         'processing': 'trimmed, high-pass %d Hz%s%s, loudness-normalised (%g dB), Opus' % (it.get('hp', 80), ', low-pass %d Hz' % it['lp'] if it.get('lp') else '',
                          ', notch ' + '/'.join(map(str, it['notch'])) + ' Hz' if it.get('notch') else '', built[name]['gain_db']) + (', ' + ', '.join(x.split('=')[0] for x in it['extra']) if it.get('extra') else '')})
version = hashlib.sha1(json.dumps(built, sort_keys=True).encode()).hexdigest()[:10]
json.dump({'version': version, 'built': datetime.datetime.now().isoformat(timespec='seconds'), 'places': places}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1, ensure_ascii=False)
json.dump({'about': 'Real field recordings used by the /rainforest ambience. All openly licensed; CC BY / CC BY-SA require attribution (given here and in the /credits view). Our processed excerpts of CC BY-SA recordings are themselves CC BY-SA.', 'version': version, 'sources': credits},
          open(os.path.join(OUT, 'credits.json'), 'w'), indent=1, ensure_ascii=False)
print('manifest', version, {k: (len(v['beds']), len(v['accents'])) for k, v in places.items()})
