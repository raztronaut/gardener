"""Contact sheets for eyeballing the extracted assets (data/sb2/assets/preview/*.png).

    python3 preview.py

Transparent pixels are drawn over a grey checkerboard so holes are visible.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ASSETS, mkdir, NSTAGES, COLOURS  # noqa: E402

PRE = os.path.join(ASSETS, 'preview')
YEL = (255, 255, 0)


def checker(w, h, s=4):
    im = Image.new('RGBA', (w, h), (90, 90, 90, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, h, s):
        for x in range((y // s % 2) * s, w, 2 * s):
            d.rectangle([x, y, x + s - 1, y + s - 1], fill=(130, 130, 130, 255))
    return im


def on_checker(im):
    bg = checker(im.width, im.height)
    bg.alpha_composite(im.convert('RGBA'))
    return bg


def crop(atlas, rect):
    x, y, w, h = rect
    return atlas.crop((x, y, x + w, y + h))


class Canvas:
    def __init__(self, w, bg=(32, 0, 40)):
        self.w = w
        self.items = []          # (img, x, y)
        self.texts = []
        self.y = 0
        self.x = 0
        self.rowh = 0
        self.bg = bg

    def newline(self, gap=4):
        self.y += self.rowh + gap
        self.x = 0
        self.rowh = 0

    def label(self, text):
        self.newline()
        self.texts.append((2, self.y, text))
        self.y += 12

    def put(self, img, caption=None, scale=1, pad=4):
        if scale != 1:
            img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
        h = img.height + (11 if caption else 0)
        if self.x + img.width > self.w and self.x > 0:
            self.newline()
        self.items.append((img, self.x, self.y + (11 if caption else 0)))
        if caption:
            self.texts.append((self.x, self.y, caption))
        self.x += max(img.width, 6 * len(caption or '')) + pad
        self.rowh = max(self.rowh, h)

    def save(self, path):
        self.newline()
        out = Image.new('RGBA', (self.w, self.y + 4), self.bg + (255,))
        for img, x, y in self.items:
            out.alpha_composite(img.convert('RGBA'), (x, y))
        d = ImageDraw.Draw(out)
        for x, y, t in self.texts:
            d.text((x, y), t, fill=YEL)
        out.convert('RGB').save(path)
        return path


def anim_strip(atlas, rects, frames, scale=2):
    imgs = [on_checker(crop(atlas, rects[f['metatile']])) for f in frames if f.get('metatile') is not None]
    if not imgs:
        return None
    w = sum(i.width + 1 for i in imgs)
    out = Image.new('RGBA', (w, imgs[0].height), (0, 0, 0, 255))
    x = 0
    for i in imgs:
        out.paste(i, (x, 0))
        x += i.width + 1
    return out.resize((out.width * scale, out.height * scale), Image.NEAREST)


def stage_sheet(st):
    d = os.path.join(ASSETS, 'stages', 'stage%02d' % st)
    m = json.load(open(os.path.join(d, 'stage.json')))
    at = Image.open(os.path.join(d, 'metatiles.png')).convert('RGBA')
    rects = {x['id']: x['rect'] for x in m['metatiles']}
    C = Canvas(1100)
    C.label('stage %d  (%d metatiles)  screen at match start | arena rebuilt from grid_start ids'
            % (st, len(m['metatiles'])))
    C.put(Image.open(os.path.join(d, 'screen.png')), scale=2)
    # rebuild the arena from the manifest (verifies grid ids + atlas rects)
    arena = Image.new('RGBA', (15 * 16, 13 * 16))
    for r, row in enumerate(m['grid_start']):
        for c, mid in enumerate(row):
            if mid >= 0:
                arena.alpha_composite(crop(at, rects[mid]), (c * 16, r * 16))
    C.put(on_checker(arena), scale=2)
    C.label('stage-specific metatiles (floor / walls / blocks / gimmicks); name and grid codes')
    for x in m['metatiles']:
        if x['kind'] in ('flame', 'bomb', 'item_burn', 'soft_destroy', 'item'):
            continue
        C.put(on_checker(crop(at, x['rect'])), '%d' % x['id'], scale=2)
    C.label('animations (white = palette 1): bomb pulse per type, soft block destruction, item burn, '
            'flame centre/arms/ends')
    for name, a in m['animations'].items():
        if name.endswith('_p1') or name == 'soft_regrow':
            s = anim_strip(at, rects, a['frames'])
            if s:
                C.put(s, '%s %s' % (name, '/'.join(str(f['duration']) for f in a['frames'])))
    if m.get('tile_animations'):
        C.label('character-animated metatiles (rows = metatiles, columns = phases)')
        C.put(on_checker(Image.open(os.path.join(d, 'anim_tiles.png'))), scale=2)
    C.label('full metatile atlas (metatiles.png)')
    C.put(on_checker(at), scale=2)
    return C.save(os.path.join(PRE, 'stage%02d.png' % st))


def items_sheet():
    d = os.path.join(ASSETS, 'stages', 'stage01')
    m = json.load(open(os.path.join(d, 'stage.json')))
    at = Image.open(os.path.join(d, 'metatiles.png')).convert('RGBA')
    C = Canvas(900)
    C.label('item icons (BG2 metatiles, palette 5, stage 1 colours); first 14 are the battle deck')
    for x in m['metatiles']:
        if x['kind'] == 'item':
            C.put(on_checker(crop(at, x['rect'])), x['name'].replace('item_', '')[:14], scale=3, pad=10)
    C.label('bombs (4 owner palettes x 5 types)')
    for x in m['metatiles']:
        if x['kind'] == 'bomb':
            C.put(on_checker(crop(at, x['rect'])), scale=2, pad=2)
    return C.save(os.path.join(PRE, 'items_bombs.png'))


def sprite_sheet():
    d = os.path.join(ASSETS, 'sprites')
    m = json.load(open(os.path.join(d, 'sprites.json')))
    rects = {s['id']: s['rect'] for s in m['bomber_shapes']}
    scr = {s['id'] for s in m['bomber_shapes'] if s['category'] == 'screen_bomber'}
    sat = Image.open(os.path.join(d, 'screen_bombers.png')).convert('RGBA')
    C = Canvas(1300)
    for c in COLOURS:
        at = Image.open(os.path.join(d, 'bombers_%s.png' % c)).convert('RGBA')
        C.label('%s bomber animations (shape id:duration)' % c)
        for name, fr in m['animations'][c].items():
            imgs = [on_checker(crop(sat if f['shape'] in scr else at, rects[f['shape']]))
                    for f in fr if f['shape'] in rects]
            if not imgs:
                continue
            w = sum(i.width + 2 for i in imgs[:24])
            h = max(i.height for i in imgs)
            strip = Image.new('RGBA', (w, h), (0, 0, 0, 255))
            x = 0
            for i in imgs[:24]:
                strip.paste(i, (x, h - i.height))
                x += i.width + 2
            C.put(strip, '%s %s' % (name, ' '.join('%d:%d' % (f['shape'], f['duration']) for f in fr[:8])), scale=2)
    C.label('all arena bomber shapes (white palette)')
    C.put(on_checker(Image.open(os.path.join(d, 'bombers_white.png'))), scale=2)
    C.label('between-round screen figures (screen_bombers.png, real palettes)')
    C.put(on_checker(sat), scale=2)
    C.label('fx pieces (fx.png, palette as first seen)')
    fx = Image.open(os.path.join(d, 'fx.png')).convert('RGBA')
    for p in m['fx_pieces']:
        C.put(on_checker(crop(fx, p['rect'])), str(p['id']), scale=2, pad=3)
    return C.save(os.path.join(PRE, 'sprites.png'))


def hud_sheet():
    d = os.path.join(ASSETS, 'hud')
    C = Canvas(800)
    C.label('HUD bar at start, glyphs, faces (alive/dead), chars; later HUD states')
    for f in ('hud_start.png', 'glyphs.png', 'faces.png', 'hud_f5000.png', 'hud_f7599.png', 'hud_chars.png'):
        p = os.path.join(d, f)
        if os.path.exists(p):
            C.put(on_checker(Image.open(p)), f, scale=3)
            C.newline()
    sj = json.load(open(os.path.join(d, 'screens.json')))
    C.label('between-round screens (key frames)')
    for name, ks in sj['sequences'].items():
        picks = [k for k in ks if k['changed_bg']][:6] or ks[:6]
        for k in picks:
            C.put(Image.open(os.path.join(d, 'screens', k['file'])), '%s f%d' % (name, k['frame']))
    return C.save(os.path.join(PRE, 'hud_screens.png'))


def highlights():
    C = Canvas(1560)
    C.label('Super Bomberman 2 battle assets - extracted from the running game (stage screens, '
            'bombers, bombs/flames/items, HUD)')
    for st in range(1, NSTAGES + 1):
        p = os.path.join(ASSETS, 'stages', 'stage%02d' % st, 'screen.png')
        if os.path.exists(p):
            C.put(Image.open(p), 'stage %d' % st)
    d = os.path.join(ASSETS, 'sprites')
    if os.path.exists(os.path.join(d, 'sprites.json')):
        m = json.load(open(os.path.join(d, 'sprites.json')))
        rects = {s['id']: s['rect'] for s in m['bomber_shapes']}
        C.label('bomber walk cycles + death (from sprites.json animations)')
        for c in COLOURS:
            at = Image.open(os.path.join(d, 'bombers_%s.png' % c)).convert('RGBA')
            for name in ('walk_down', 'walk_up', 'walk_left', 'walk_right', 'death'):
                fr = m['animations'][c].get(name, [])
                seen = []
                for f in fr:
                    if f['shape'] not in seen:
                        seen.append(f['shape'])
                for sid in seen[:10]:
                    C.put(on_checker(crop(at, rects[sid])), scale=2, pad=1)
                C.x += 8
            C.newline()
    st1 = os.path.join(ASSETS, 'stages', 'stage01')
    m = json.load(open(os.path.join(st1, 'stage.json')))
    at = Image.open(os.path.join(st1, 'metatiles.png')).convert('RGBA')
    C.label('bombs, flames (all frames), soft-block destruction, item burn, items - stage 1 metatiles')
    C.put(on_checker(at), scale=2)
    hud = os.path.join(ASSETS, 'hud', 'hud_start.png')
    if os.path.exists(hud):
        C.label('HUD')
        C.put(on_checker(Image.open(hud)), scale=3)
        C.put(on_checker(Image.open(os.path.join(ASSETS, 'hud', 'glyphs.png'))), scale=3)
    return C.save(os.path.join(PRE, 'highlights.png'))


def main():
    mkdir(PRE)
    for st in range(1, NSTAGES + 1):
        if os.path.exists(os.path.join(ASSETS, 'stages', 'stage%02d' % st, 'stage.json')):
            print(stage_sheet(st))
    print(items_sheet())
    if os.path.exists(os.path.join(ASSETS, 'sprites', 'sprites.json')):
        print(sprite_sheet())
    if os.path.exists(os.path.join(ASSETS, 'hud', 'hud.json')):
        print(hud_sheet())
    print(highlights())


if __name__ == '__main__':
    main()
