"""Headless ctypes libretro frontend for the instrumented snes9x core (sb2 harness).

    from snes import Snes, B
    S = Snes()                                   # default ROM + core paths
    S.run(60)                                    # 60 frames, no buttons
    S.run(1, pads=B.START)                       # P1 Start for 1 frame
    S.run(10, pads=(B.RIGHT, B.A))               # P1 Right, P2 A, held 10 frames
    S.run(3, pads=[B.UP, 0, B.UP])               # per-frame list (P1 only)
    S.run(3, pads=[(B.UP, 0), (0, B.B), 0])      # per-frame, per-port
    S.run(n, pads=lambda i: B.A if i % 2 else 0) # callable(frame_index)
    img = S.frame()        # numpy uint8 (H, W, 3) native res (256x224 usually)
    pcm = S.audio()        # numpy int16 (N, 2) since last call, 32040 Hz
    st = S.save_state(); S.load_state(st)
    S.wram(), S.vram(), S.cgram(), S.oam(), S.apu_ram(), S.dsp()  # numpy uint8 copies
    S.ppu()                # dict of decoded PPU registers (end of last frame)
    S.save_spc('x.spc')

Only ONE Snes instance per process: a libretro core is a set of globals.
Button bitmask = libretro RETRO_DEVICE_ID_JOYPAD_* bit order (see class B).
"""
import ctypes as C
import hashlib
import os
import struct

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
DEFAULT_CORE = os.path.join(ROOT, 'data', 'sb2', 'build', 'snes9x_sb2_libretro.so')
DEFAULT_ROM = os.path.join(ROOT, 'data', 'roms', 'Super Bomberman 2 (USA).sfc')
STATES_DIR = os.path.join(ROOT, 'data', 'sb2', 'states')
DEBUG_DIR = os.path.join(ROOT, 'data', 'sb2', 'debug')


class B:
    """libretro joypad bits (RETRO_DEVICE_ID_JOYPAD_*): mask = 1 << id."""
    B = 1 << 0
    Y = 1 << 1
    SELECT = 1 << 2
    START = 1 << 3
    UP = 1 << 4
    DOWN = 1 << 5
    LEFT = 1 << 6
    RIGHT = 1 << 7
    A = 1 << 8
    X = 1 << 9
    L = 1 << 10
    R = 1 << 11
    NAMES = ['B', 'Y', 'SELECT', 'START', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'A', 'X', 'L', 'R']

    @classmethod
    def parse(cls, s):
        """'RIGHT+A' / 'r+a' / '-' / '0x108' -> mask."""
        s = s.strip()
        if s in ('', '-', '.', '0', 'NONE', 'none'):
            return 0
        if s.lower().startswith('0x'):
            return int(s, 16)
        m = 0
        for part in s.replace(',', '+').split('+'):
            part = part.strip().upper()
            if not part:
                continue
            alias = {'SEL': 'SELECT', 'ST': 'START', 'U': 'UP', 'D': 'DOWN', 'LT': 'LEFT', 'RT': 'RIGHT'}
            part = alias.get(part, part)
            if part not in cls.NAMES:
                raise ValueError('unknown button %r' % part)
            m |= getattr(cls, part)
        return m

    @classmethod
    def fmt(cls, m):
        return '+'.join(n for i, n in enumerate(cls.NAMES) if m & (1 << i)) or '-'


# ---- libretro ABI -------------------------------------------------------------
ENV_GET_CAN_DUPE = 3
ENV_GET_SYSTEM_DIRECTORY = 9
ENV_SET_PIXEL_FORMAT = 10
ENV_GET_VARIABLE = 15
ENV_GET_VARIABLE_UPDATE = 17
ENV_GET_SAVE_DIRECTORY = 31
ENV_GET_AUDIO_VIDEO_ENABLE = 47 | 0x10000
ENV_GET_INPUT_BITMASKS = 51 | 0x10000
DEVICE_JOYPAD = 1
DEVICE_JOYPAD_MULTITAP = (1 << 8) | 1
DEVICE_NONE = 0
JOYPAD_MASK_ID = 256
PIXEL_RGB565 = 2


class GameInfo(C.Structure):
    _fields_ = [('path', C.c_char_p), ('data', C.c_void_p), ('size', C.c_size_t), ('meta', C.c_char_p)]


class Geometry(C.Structure):
    _fields_ = [('base_width', C.c_uint), ('base_height', C.c_uint), ('max_width', C.c_uint),
                ('max_height', C.c_uint), ('aspect_ratio', C.c_float)]


class Timing(C.Structure):
    _fields_ = [('fps', C.c_double), ('sample_rate', C.c_double)]


class AVInfo(C.Structure):
    _fields_ = [('geometry', Geometry), ('timing', Timing)]


class Variable(C.Structure):
    _fields_ = [('key', C.c_char_p), ('value', C.c_char_p)]


ENV_CB = C.CFUNCTYPE(C.c_bool, C.c_uint, C.c_void_p)
VIDEO_CB = C.CFUNCTYPE(None, C.c_void_p, C.c_uint, C.c_uint, C.c_size_t)
AUDIO_CB = C.CFUNCTYPE(None, C.c_int16, C.c_int16)
AUDIO_BATCH_CB = C.CFUNCTYPE(C.c_size_t, C.POINTER(C.c_int16), C.c_size_t)
POLL_CB = C.CFUNCTYPE(None)
STATE_CB = C.CFUNCTYPE(C.c_int16, C.c_uint, C.c_uint, C.c_uint, C.c_uint)

# shim memory ids (sb2_shim.cpp)
MEM_CGRAM, MEM_OAM, MEM_VRAM, MEM_APURAM, MEM_FILLRAM, MEM_WRAM = range(6)

# order == retro_sb2_ppu_regs() slots (shim version 1)
PPU_FIELDS = ['bgmode', 'bg3_priority', 'bgmode_raw']
for _n in range(1, 5):
    PPU_FIELDS += ['bg%d_sc_base' % _n, 'bg%d_sc_size' % _n, 'bg%d_char_base' % _n,
                   'bg%d_hofs' % _n, 'bg%d_vofs' % _n]
PPU_FIELDS += ['obsel', 'obj_name_base', 'obj_name_base2', 'obj_size_select',
               'tm', 'ts', 'cgwsel', 'cgadsub', 'brightness', 'forced_blank',
               'm7a', 'm7b', 'm7c', 'm7d', 'm7x', 'm7y', 'm7hofs', 'm7vofs', 'm7sel',
               'mosaic', 'mosaic_raw', 'coldata_r', 'coldata_g', 'coldata_b',
               'screen_height', 'setini', 'hdmaen']

_INSTANCE = None


class Snes:
    def __init__(self, rom=DEFAULT_ROM, core=DEFAULT_CORE, multitap=False, render=True):
        """multitap=True plugs a Multitap (MP5) into SNES port 2: pads[0] = P1 on
        port 1, pads[1..4] = P2..P5 on the multitap. Otherwise 2 plain pads."""
        global _INSTANCE
        if _INSTANCE is not None:
            raise RuntimeError('only one Snes per process (libretro cores are global state)')
        _INSTANCE = self
        self.rom_path = rom
        self.lib = lib = C.CDLL(core)
        self._sysdir = C.create_string_buffer(os.path.join(ROOT, 'data', 'sb2', 'build').encode())
        self.render = render        # False = skip PPU rendering (faster; frame() goes stale)
        self.multitap = multitap
        self.npads = 5 if multitap else 2
        self._pads = [0] * 8
        self._vid = None            # (bytes, w, h, pitch)
        self._audio = []
        self.frame_count = 0
        self.polls = 0              # input polls (one per retro_run)

        # keep callback objects referenced
        self._cbs = [ENV_CB(self._env), VIDEO_CB(self._video), AUDIO_CB(self._audio1),
                     AUDIO_BATCH_CB(self._audio_batch), POLL_CB(self._poll), STATE_CB(self._state)]
        lib.retro_set_environment(self._cbs[0])
        lib.retro_set_video_refresh(self._cbs[1])
        lib.retro_set_audio_sample(self._cbs[2])
        lib.retro_set_audio_sample_batch(self._cbs[3])
        lib.retro_set_input_poll(self._cbs[4])
        lib.retro_set_input_state(self._cbs[5])

        lib.retro_serialize_size.restype = C.c_size_t
        lib.retro_serialize.argtypes = [C.c_void_p, C.c_size_t]
        lib.retro_serialize.restype = C.c_bool
        lib.retro_unserialize.argtypes = [C.c_void_p, C.c_size_t]
        lib.retro_unserialize.restype = C.c_bool
        lib.retro_load_game.restype = C.c_bool
        lib.retro_load_game.argtypes = [C.POINTER(GameInfo)]
        lib.retro_get_memory_data.restype = C.c_void_p
        lib.retro_get_memory_size.restype = C.c_size_t
        lib.retro_sb2_mem_ptr.restype = C.c_void_p
        lib.retro_sb2_mem_size.restype = C.c_size_t
        lib.retro_sb2_ppu_regs.argtypes = [C.c_void_p, C.c_int]
        lib.retro_sb2_dsp_regs.argtypes = [C.c_void_p]
        lib.retro_sb2_smp_regs.argtypes = [C.c_void_p]
        if lib.retro_sb2_version() != 1:
            raise RuntimeError('shim version mismatch; rebuild with tools/sb2/harness/build.sh')

        lib.retro_init()
        with open(rom, 'rb') as f:
            self._romdata = f.read()
        self._rombuf = C.create_string_buffer(self._romdata, len(self._romdata))
        gi = GameInfo(rom.encode(), C.cast(self._rombuf, C.c_void_p), len(self._romdata), None)
        if not lib.retro_load_game(C.byref(gi)):
            raise RuntimeError('retro_load_game failed')
        av = AVInfo()
        lib.retro_get_system_av_info(C.byref(av))
        self.fps = av.timing.fps
        self.sample_rate = av.timing.sample_rate
        lib.retro_set_controller_port_device(0, DEVICE_JOYPAD)
        lib.retro_set_controller_port_device(1, DEVICE_JOYPAD_MULTITAP if multitap else DEVICE_JOYPAD)
        self._mem = {i: (lib.retro_sb2_mem_ptr(i), lib.retro_sb2_mem_size(i)) for i in range(6)}

    # ---- callbacks -----------------------------------------------------------
    def _env(self, cmd, data):
        try:
            if cmd == ENV_GET_CAN_DUPE:
                C.cast(data, C.POINTER(C.c_bool))[0] = True
                return True
            if cmd == ENV_SET_PIXEL_FORMAT:
                return C.cast(data, C.POINTER(C.c_int))[0] == PIXEL_RGB565
            if cmd in (ENV_GET_SYSTEM_DIRECTORY, ENV_GET_SAVE_DIRECTORY):
                C.cast(data, C.POINTER(C.c_void_p))[0] = C.cast(self._sysdir, C.c_void_p)
                return True
            if cmd == ENV_GET_INPUT_BITMASKS:
                return True
            if cmd == ENV_GET_AUDIO_VIDEO_ENABLE:
                if data:
                    C.cast(data, C.POINTER(C.c_int))[0] = (1 if self.render else 0) | 2
                return True
            if cmd == ENV_GET_VARIABLE_UPDATE:
                if data:
                    C.cast(data, C.POINTER(C.c_bool))[0] = False
                return True
            # GET_VARIABLE and everything else: unsupported -> core defaults
            return False
        except Exception:
            return False

    def _video(self, data, w, h, pitch):
        if data:
            self._vid = (C.string_at(data, pitch * h), w, h, pitch)

    def _audio1(self, l, r):
        self._audio.append(struct.pack('<hh', l, r))

    def _audio_batch(self, data, frames):
        self._audio.append(C.string_at(data, frames * 4))
        return frames

    def _poll(self):
        self.polls += 1

    def _state(self, port, device, index, id_):
        if port >= 8:
            return 0
        m = self._pads[port]
        if id_ == JOYPAD_MASK_ID:
            return m
        return (m >> id_) & 1 if id_ < 16 else 0

    # ---- running -------------------------------------------------------------
    def _set_pads(self, entry):
        if isinstance(entry, (int, np.integer)):
            p = [int(entry)]
        else:
            p = [int(x) for x in entry]
        p = (p + [0] * 8)[:8]
        self._pads = p

    def step(self, pads=0):
        """Emulate exactly one frame with the given pad entry (int = P1, or tuple per port)."""
        self._set_pads(pads)
        self.lib.retro_run()
        self.frame_count += 1

    def run(self, frames, pads=0, on_frame=None):
        """Run `frames` frames. pads: int (P1 mask held) | tuple (per-port masks held) |
        list of per-frame entries (len == frames; each int or tuple) | callable(i)->entry.
        on_frame(S, i) is called after each frame."""
        if isinstance(pads, list):
            if len(pads) != frames:
                raise ValueError('per-frame pads list must have len == frames')
            get = pads.__getitem__
        elif callable(pads):
            get = pads
        else:
            get = lambda i: pads
        for i in range(frames):
            self.step(get(i))
            if on_frame is not None:
                on_frame(self, i)

    def reset(self):
        self.lib.retro_reset()

    # ---- video / audio -------------------------------------------------------
    def frame(self):
        """Last rendered frame as numpy uint8 (H, W, 3). Native resolution."""
        if self._vid is None:
            return np.zeros((224, 256, 3), np.uint8)
        buf, w, h, pitch = self._vid
        a = np.frombuffer(buf, dtype='<u2').reshape(h, pitch // 2)[:, :w]
        r = (a >> 11) & 0x1f
        g = (a >> 5) & 0x3f
        b = a & 0x1f
        out = np.empty((h, w, 3), np.uint8)
        out[..., 0] = (r << 3) | (r >> 2)
        out[..., 1] = (g << 2) | (g >> 4)
        out[..., 2] = (b << 3) | (b >> 2)
        return out

    def png(self, path, scale=1):
        from PIL import Image
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        im = Image.fromarray(self.frame())
        if scale != 1:
            im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        im.save(path)
        return path

    def audio(self):
        """int16 stereo samples (N, 2) produced since the last call."""
        raw = b''.join(self._audio)
        self._audio = []
        return np.frombuffer(raw, dtype='<i2').reshape(-1, 2).copy()

    # ---- memory --------------------------------------------------------------
    def _view(self, mid):
        ptr, size = self._mem[mid]
        return np.ctypeslib.as_array((C.c_uint8 * size).from_address(ptr))

    def wram(self, live=False):
        """128 KB WRAM ($7E0000-$7FFFFF). live=True returns a zero-copy view."""
        v = self._view(MEM_WRAM)
        return v if live else v.copy()

    def vram(self, live=False):
        v = self._view(MEM_VRAM)
        return v if live else v.copy()

    def cgram(self, live=False):
        """512 B: 256 little-endian BGR555 words."""
        v = self._view(MEM_CGRAM)
        return v if live else v.copy()

    def palette_rgb(self):
        """CGRAM decoded to (256, 3) uint8 RGB (5->8 bit)."""
        w = self.cgram().view('<u2')
        c = np.stack([(w & 31), (w >> 5) & 31, (w >> 10) & 31], -1).astype(np.uint8)
        return (c << 3) | (c >> 2)

    def oam(self, live=False):
        """544 B: 128 x 4-byte entries (x, y, tile, attr) + 32 B high table."""
        v = self._view(MEM_OAM)
        return v if live else v.copy()

    def sprites(self):
        """OAM decoded: list of dicts (x, y, tile(0-511), pal, prio, hflip, vflip, large)."""
        o = self.oam()
        out = []
        for i in range(128):
            x, y, t, a = o[i * 4:i * 4 + 4]
            hi = (o[512 + i // 4] >> ((i % 4) * 2)) & 3
            xx = int(x) | ((hi & 1) << 8)
            if xx >= 256:
                xx -= 512
            out.append(dict(i=i, x=xx, y=int(y), tile=int(t) | ((int(a) & 1) << 8),
                            pal=(int(a) >> 1) & 7, prio=(int(a) >> 4) & 3,
                            hflip=bool(a & 0x40), vflip=bool(a & 0x80), large=bool(hi & 2)))
        return out

    def io(self, live=False):
        """32 KB FillRAM shadow: index = bank-0 address; [0x2100:0x2200] = last value
        written to each PPU register, [0x4200:0x4220] CPU regs (caveats in NOTES)."""
        v = self._view(MEM_FILLRAM)
        return v if live else v.copy()

    def apu_ram(self, live=False):
        v = self._view(MEM_APURAM)
        return v if live else v.copy()

    def dsp(self):
        out = (C.c_uint8 * 128)()
        self.lib.retro_sb2_dsp_regs(out)
        return np.frombuffer(bytes(out), np.uint8).copy()

    def smp(self):
        o = (C.c_uint8 * 32)()
        self.lib.retro_sb2_smp_regs(o)
        o = bytes(o)
        return dict(pc=o[0] | (o[1] << 8), a=o[2], x=o[3], y=o[4], psw=o[5], sp=o[6],
                    opcode_cycle=o[7], control=o[8], dsp_addr=o[9], f8=o[10], f9=o[11],
                    timer_target=list(o[12:15]), timer_counter=list(o[15:18]),
                    cpu_to_spc=list(o[18:22]), spc_to_cpu=list(o[22:26]))

    def ppu(self):
        n = self.lib.retro_sb2_ppu_regs(None, 0)
        arr = (C.c_int32 * n)()
        self.lib.retro_sb2_ppu_regs(arr, n)
        d = dict(zip(PPU_FIELDS, list(arr)))
        for k in list(d):   # convenience: byte offsets into vram()
            if k.endswith('_sc_base') or k.endswith('_char_base') or k.startswith('obj_name_base'):
                d[k + '_byte'] = d[k] * 2
        return d

    def rom(self):
        return self._romdata

    def read(self, addr, n=1):
        """Read CPU-visible WRAM by 24-bit address ($7E0000-$7FFFFF or $00-$3F:0000-1FFF mirror)."""
        bank, off = addr >> 16, addr & 0xffff
        if bank in (0x7e, 0x7f):
            base = ((bank - 0x7e) << 16) | off
        elif off < 0x2000:
            base = off
        else:
            raise ValueError('not a WRAM address: %06X' % addr)
        return bytes(self._view(MEM_WRAM)[base:base + n])

    # ---- states --------------------------------------------------------------
    def save_state(self):
        n = self.lib.retro_serialize_size()
        buf = C.create_string_buffer(n)
        if not self.lib.retro_serialize(buf, n):
            raise RuntimeError('serialize failed')
        return buf.raw

    def load_state(self, data):
        buf = C.create_string_buffer(data, len(data))
        if not self.lib.retro_unserialize(buf, len(data)):
            raise RuntimeError('unserialize failed')
        self._vid = None   # frame() is stale until the next run

    def save_state_file(self, path):
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(self.save_state())
        return path

    def load_state_file(self, path):
        with open(path, 'rb') as f:
            self.load_state(f.read())

    # ---- hashing / spc -------------------------------------------------------
    def wram_hash(self):
        return hashlib.sha1(self._view(MEM_WRAM).tobytes()).hexdigest()

    def save_spc(self, path, song='', game='Super Bomberman 2', dumper='sb2 harness',
                 comment='', seconds=180, fade_ms=10000, artist=''):
        from spc import build_spc
        st, vid = self.save_state(), self._vid
        try:
            self.lib.retro_sb2_smp_finish_opcode()   # clean instruction boundary
            data = build_spc(self.apu_ram(), self.dsp(), self.smp(), song=song, game=game,
                             dumper=dumper, comment=comment, seconds=seconds,
                             fade_ms=fade_ms, artist=artist)
        finally:
            self.load_state(st)
            self._vid = vid
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)
        return path
