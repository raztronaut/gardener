"""Contact sheets: many emulator frames in one PNG (for looking at with an image viewer).

    from sheet import Sheet
    sh = Sheet()
    S.run(600, on_frame=lambda S, i: i % 30 == 0 and sh.add(S, 'f%d' % S.frame_count))
    sh.save('data/sb2/debug/intro.png', cols=5)
"""
import os
import numpy as np
from PIL import Image, ImageDraw


class Sheet:
    def __init__(self):
        self.items = []

    def add(self, S_or_img, label=''):
        img = S_or_img.frame() if hasattr(S_or_img, 'frame') else S_or_img
        self.items.append((np.asarray(img), str(label)))
        return True

    def save(self, path, cols=4, scale=1):
        if not self.items:
            return None
        h = max(i.shape[0] for i, _ in self.items)
        w = max(i.shape[1] for i, _ in self.items)
        rows = (len(self.items) + cols - 1) // cols
        lab = 12
        out = Image.new('RGB', (cols * (w + 2), rows * (h + lab + 2)), (40, 0, 40))
        d = ImageDraw.Draw(out)
        for k, (img, label) in enumerate(self.items):
            x = (k % cols) * (w + 2)
            y = (k // cols) * (h + lab + 2)
            out.paste(Image.fromarray(img), (x, y + lab))
            d.text((x + 2, y), label, fill=(255, 255, 0))
        if scale != 1:
            out = out.resize((out.width * scale, out.height * scale), Image.NEAREST)
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        out.save(path)
        return path
