"""Garden Edition — the results screen's winner figure (menu.js blitFigure): the gardener
cheering, arms up with a flower, then a little hop (2 frames, 16 + 32 frames like the
original's), in each colour. Drawn from the gardener's pieces + hand-placed arms."""
from common import *  # noqa: F401,F403
import bombers

W_, H_ = 24, 34


def _figure(colour, frame):
    P = bombers.read_pieces()
    idx = np.zeros((H_, W_), np.int32)
    dy = 2 if frame == 0 else 0
    head, body = P[40], P[42]
    for y in range(16):
        for x in range(16):
            if head[y, x]:
                idx[y + dy, x + 4] = head[y, x]
            if body[y, x]:
                idx[16 + y + dy, x + 4] = body[y, x]
    if frame == 0:
        # arms up: sleeves from the shoulders, gloves above the hat brim, a flower in one hand
        for side in (-1, 1):
            sx = 5 if side < 0 else 18
            for k in range(6):
                x, y = sx + side * (k // 3), 21 - k
                idx[y, x] = 10
                idx[y, x - side] = 1 if idx[y, x - side] == 0 else idx[y, x - side]
            gx, gy = sx + side * 2, 13
            for (ox, oy) in ((0, 0), (1, 0), (0, 1), (1, 1), (0, -1)):
                idx[gy + oy, gx + ox - (1 if side < 0 else 0)] = 11 if oy < 1 else 12
        # gloves at the sides are gone (the original body's hands): repaint them as sleeve
        for y in range(18, 24):
            for x in range(W_):
                if idx[y, x] in (11, 12) and (x < 7 or x > 16):
                    idx[y, x] = 0
    img = blank(W_, H_)
    pal = bombers.palette(colour)
    for y in range(H_):
        for x in range(W_):
            if idx[y, x]:
                img[y, x] = pal[idx[y, x]]
    if frame == 0:
        for (x, y, c) in ((1, 9, PINK), (2, 8, PINK), (3, 9, PINK), (2, 10, PINK), (2, 9, GOLD_3), (2, 11, LEAF_3), (2, 12, LEAF_3)):
            img[y, x] = c
    # outline the new arms
    return outline(img, pal[1])


def frames(colour):
    return [(_figure(colour, 0), 16), (_figure(colour, 1), 32)]
