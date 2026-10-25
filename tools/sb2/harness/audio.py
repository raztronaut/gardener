"""Audio capture: WAV writer and ffmpeg (.ogg/.flac/...) encoder fed from Snes.audio().

    rec = AudioRecorder('data/sb2/audio/title.ogg', S.sample_rate)   # or .wav
    for _ in range(600):
        S.step(0)
        rec.write(S.audio())
    rec.close()

or simply:  record(S, 'out.ogg', frames=600, pads=0)

Sample rate is the core's native DSP rate (32040 Hz); stereo int16.
"""
import os
import subprocess
import wave

import numpy as np


class AudioRecorder:
    def __init__(self, path, rate=32040, quality=None):
        self.path = path
        self.rate = int(round(rate))
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        self.samples = 0
        if path.lower().endswith('.wav'):
            self.w = wave.open(path, 'wb')
            self.w.setnchannels(2)
            self.w.setsampwidth(2)
            self.w.setframerate(self.rate)
            self.p = None
        else:
            cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', str(self.rate),
                   '-ac', '2', '-i', 'pipe:0']
            if path.lower().endswith('.ogg'):
                cmd += ['-c:a', 'libvorbis', '-q:a', str(quality if quality is not None else 6)]
            cmd.append(path)
            self.p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
            self.w = None

    def write(self, pcm):
        pcm = np.asarray(pcm, dtype='<i2')
        self.samples += len(pcm)
        data = pcm.tobytes()
        if self.w:
            self.w.writeframes(data)
        else:
            self.p.stdin.write(data)

    def close(self):
        if self.w:
            self.w.close()
        else:
            self.p.stdin.close()
            if self.p.wait() != 0:
                raise RuntimeError('ffmpeg failed for ' + self.path)
        return self.path


def record(S, path, frames, pads=0):
    """Run `frames` frames (pads as in Snes.run) and write the audio they produce."""
    S.audio()   # drop anything pending
    rec = AudioRecorder(path, S.sample_rate)
    S.run(frames, pads, on_frame=lambda S, i: rec.write(S.audio()))
    return rec.close()
