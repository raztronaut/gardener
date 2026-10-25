"""SPC700 .spc file writer (format v0.30, text ID666 tag).

Layout (66048 bytes):
  0x00000  "SNES-SPC700 Sound File Data v0.30" + 26,26
  0x00023  26 = ID666 present          0x00024  30 (minor version)
  0x00025  PC(lo,hi) A X Y PSW SP, 2 reserved
  0x0002E  ID666: title[32] game[32] dumper[16] comment[32] date[11]
           seconds[3] fade_ms[5] artist[32] chan_disable[1] emulator[1] pad[45]
  0x00100  64 KB SPC RAM
  0x10100  128 DSP registers
  0x10180  64 unused
  0x101C0  64 B "extra RAM" (RAM hidden under the IPL ROM at $FFC0-$FFFF)

The I/O bytes $F0-$FF in RAM are rebuilt from the SMP's internal state because
snes9x keeps the SPC->CPU port values at $F4-$F7 and the real control/timer
registers in C++ fields; an SPC player reads its input ports from $F4-$F7.
"""
import datetime
import numpy as np


def _txt(s, n):
    b = s.encode('ascii', 'replace')[:n]
    return b + b'\0' * (n - len(b))


def build_spc(ram, dsp, smp, song='', game='', dumper='', comment='', seconds=180,
              fade_ms=10000, artist=''):
    ram = np.array(ram, dtype=np.uint8).copy()
    assert ram.size == 0x10000 and len(dsp) == 128
    # rebuild $F0-$FF
    ram[0xF0] = 0x0A                       # TEST (power-on value)
    ram[0xF1] = smp['control'] & 0x87      # timer enables + IPL ROM enable
    ram[0xF2] = smp['dsp_addr'] & 0xFF
    ram[0xF3] = dsp[smp['dsp_addr'] & 0x7F]
    for i in range(4):
        ram[0xF4 + i] = smp['cpu_to_spc'][i]   # what the SPC reads from $F4-$F7
    ram[0xF8] = smp['f8']
    ram[0xF9] = smp['f9']
    for i in range(3):
        ram[0xFA + i] = smp['timer_target'][i]
        ram[0xFD + i] = smp['timer_counter'][i]
    hdr = bytearray(0x100)
    hdr[0:33] = b'SNES-SPC700 Sound File Data v0.30'
    hdr[0x21] = 26
    hdr[0x22] = 26
    hdr[0x23] = 26
    hdr[0x24] = 30
    hdr[0x25] = smp['pc'] & 0xFF
    hdr[0x26] = smp['pc'] >> 8
    hdr[0x27] = smp['a']
    hdr[0x28] = smp['x']
    hdr[0x29] = smp['y']
    hdr[0x2A] = smp['psw']
    hdr[0x2B] = smp['sp']
    tag = (_txt(song, 32) + _txt(game, 32) + _txt(dumper, 16) + _txt(comment, 32) +
           _txt(datetime.date.today().strftime('%m/%d/%Y'), 11) +
           _txt(str(int(seconds)), 3) + _txt(str(int(fade_ms)), 5) + _txt(artist, 32) +
           b'\0' + b'0' + b'\0' * 45)
    assert len(tag) == 0x100 - 0x2E, len(tag)
    hdr[0x2E:0x100] = tag
    out = bytes(hdr) + ram.tobytes() + bytes(np.array(dsp, np.uint8)) + b'\0' * 64 + \
        ram[0xFFC0:0x10000].tobytes()
    assert len(out) == 0x10200
    return out


def parse_spc(data):
    """Minimal reader (for verification): returns dict(pc, a, x, y, psw, sp, ram, dsp, title, game)."""
    assert data[:27] == b'SNES-SPC700 Sound File Data'
    return dict(pc=data[0x25] | (data[0x26] << 8), a=data[0x27], x=data[0x28], y=data[0x29],
                psw=data[0x2A], sp=data[0x2B], ram=data[0x100:0x10100],
                dsp=data[0x10100:0x10180], title=data[0x2E:0x4E].rstrip(b'\0').decode(),
                game=data[0x4E:0x6E].rstrip(b'\0').decode())
