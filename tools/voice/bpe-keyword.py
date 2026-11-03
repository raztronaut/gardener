#!/usr/bin/env python3
"""Tokenize a wake phrase into the KWS model's SentencePiece pieces with no sentencepiece
dependency: parse bpe.model's protobuf for (piece, score) and take the best-scoring
segmentation of each word (Viterbi — the model is unigram despite its name; it matches
the model's own keywords.txt). Usage: bpe-keyword.py <bpe.model> "HEY GARDEN"."""
import struct, sys

def varint(b, i):
    r = s = 0
    while True:
        c = b[i]; i += 1; r |= (c & 0x7F) << s; s += 7
        if c < 0x80: return r, i

def pieces(path):
    b = open(path, 'rb').read(); i = 0; out = {}
    while i < len(b):
        key, i = varint(b, i); f, wt = key >> 3, key & 7
        if wt == 2:
            n, i = varint(b, i); body = b[i:i + n]; i += n
            if f == 1:  # SentencePiece message
                j = 0; piece = None; score = 0.0
                while j < len(body):
                    k, j = varint(body, j); ff, ww = k >> 3, k & 7
                    if ww == 2:
                        m, j = varint(body, j); v = body[j:j + m]; j += m
                        if ff == 1: piece = v.decode('utf8')
                    elif ww == 5:
                        v = struct.unpack('<f', body[j:j + 4])[0]; j += 4
                        if ff == 2: score = v
                    elif ww == 0: _, j = varint(body, j)
                    else: raise ValueError('wire type')
                if piece is not None: out[piece] = score
        elif wt == 0: _, i = varint(b, i)
        elif wt == 5: i += 4
        elif wt == 1: i += 8
        else: raise ValueError('wire type')
    return out

def encode(word, P):
    w = '▁' + word; n = len(w)
    best = [(-1e18, None)] * (n + 1); best[0] = (0.0, None)
    for j in range(1, n + 1):
        for i in range(max(0, j - 16), j):
            piece = w[i:j]
            if piece in P and best[i][0] > -1e17:
                sc = best[i][0] + P[piece]
                if sc > best[j][0]: best[j] = (sc, i)
    out = []; j = n
    while j > 0:
        i = best[j][1]
        if i is None: raise ValueError(f'cannot segment {word}')
        out.append(w[i:j]); j = i
    return out[::-1]

P = pieces(sys.argv[1])
print(' '.join(t for w in sys.argv[2].upper().split() for t in encode(w, P)))
