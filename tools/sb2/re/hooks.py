"""ctypes wrapper for the phase-2b execution/memory hooks in sb2_shim.cpp.

    import sys; sys.path[:0] = ['tools/sb2/harness', 'tools/sb2/re']
    from snes import Snes; from hooks import Hooks
    S = Snes(); H = Hooks(S)
    H.watch_write(0x0C00, 0x0C40)          # WRAM offsets [lo, hi)
    H.enable(write=True)
    H.step(S, pads)                        # S.step + frame tag
    for ev in H.writes(): ...              # dicts pc/addr/val/old/tag
    H.enable(exec_counts=True); ...; H.exec_rom()   # np.uint32[0x100000] by ROM offset
    H.trace_config(lo_pc, hi_pc); H.enable(trace=True); H.trace()
    # v2 (cycle costs): trace events carry `cyc` = running master-cycle count;
    H.trace_pcs([pc, ...])                 # also trace these exact PCs (any bank)
    H.enable(cycles=True); ...; H.cycles_rom()   # master cycles per ROM offset

Hooks never modify emulated state; with all flags off the core is unchanged.
"""
import ctypes as C
import numpy as np

MEM_EV = np.dtype([('pc', '<u4'), ('addr', '<u4'), ('val', 'u1'), ('old', 'u1'),
                   ('pad', '<u2'), ('tag', '<u4')])
TRACE_EV = np.dtype([('pc', '<u4'), ('a', '<u2'), ('x', '<u2'), ('y', '<u2'), ('s', '<u2'),
                     ('d', '<u2'), ('db', 'u1'), ('p', 'u1'), ('tag', '<u4'), ('cyc', '<u4')])


class Hooks:
    def __init__(self, S):
        self.S = S
        L = self.L = S.lib
        self.version = L.retro_sb2_hook_version()
        if self.version not in (1, 2):
            raise RuntimeError('hook version mismatch')
        L.retro_sb2_hook_set_flags.argtypes = [C.c_uint32]
        L.retro_sb2_hook_get_flags.restype = C.c_uint32
        L.retro_sb2_hook_set_tag.argtypes = [C.c_uint32]
        L.retro_sb2_hook_watch.argtypes = [C.c_int, C.c_uint32, C.c_uint32, C.c_int]
        L.retro_sb2_hook_log.argtypes = [C.c_int, C.POINTER(C.c_void_p), C.POINTER(C.c_uint32)]
        L.retro_sb2_hook_log.restype = C.c_uint32
        L.retro_sb2_hook_log_clear.argtypes = [C.c_int]
        L.retro_sb2_hook_exec_counts.argtypes = [C.c_int]
        L.retro_sb2_hook_exec_counts.restype = C.c_void_p
        L.retro_sb2_hook_trace_config.argtypes = [C.c_uint32, C.c_uint32, C.c_uint32]
        L.retro_sb2_hook_trace.argtypes = [C.POINTER(C.c_void_p), C.POINTER(C.c_uint32)]
        L.retro_sb2_hook_trace.restype = C.c_uint32
        self.tag = 0

    def enable(self, exec_counts=False, write=False, read=False, trace=False, cycles=False):
        f = (1 if exec_counts else 0) | (2 if write else 0) | (4 if read else 0) | (8 if trace else 0) \
            | (16 if cycles else 0)
        self.L.retro_sb2_hook_set_flags(f)

    def off(self):
        self.L.retro_sb2_hook_set_flags(0)

    def set_tag(self, t):
        self.tag = t
        self.L.retro_sb2_hook_set_tag(t)

    def step(self, pads=0):
        self.L.retro_sb2_hook_set_tag(self.tag)
        self.S.step(pads)
        self.tag += 1

    def watch_write(self, lo, hi=None, on=True):
        self.L.retro_sb2_hook_watch(0, lo, hi if hi is not None else lo + 1, 1 if on else 0)

    def watch_read(self, lo, hi=None, on=True):
        self.L.retro_sb2_hook_watch(1, lo, hi if hi is not None else lo + 1, 1 if on else 0)

    def unwatch_all(self):
        self.L.retro_sb2_hook_watch(0, 0, 0x20000, 0)
        self.L.retro_sb2_hook_watch(1, 0, 0x20000, 0)

    def _log(self, k, clear):
        p = C.c_void_p()
        d = C.c_uint32()
        n = self.L.retro_sb2_hook_log(k, C.byref(p), C.byref(d))
        if n == 0 or not p.value:
            arr = np.zeros(0, MEM_EV)
        else:
            arr = np.frombuffer((C.c_uint8 * (n * 16)).from_address(p.value), MEM_EV).copy()
        if d.value:
            print('warning: %d hook events dropped' % d.value)
        if clear:
            self.L.retro_sb2_hook_log_clear(k)
        return arr

    def writes(self, clear=True):
        return self._log(0, clear)

    def reads(self, clear=True):
        return self._log(1, clear)

    def exec_rom(self):
        p = self.L.retro_sb2_hook_exec_counts(0)
        return np.ctypeslib.as_array((C.c_uint32 * 0x100000).from_address(p)).copy()

    def exec_wram(self):
        p = self.L.retro_sb2_hook_exec_counts(1)
        return np.ctypeslib.as_array((C.c_uint32 * 0x20000).from_address(p)).copy()

    def exec_clear(self):
        self.L.retro_sb2_hook_exec_clear()

    def trace_config(self, lo=0, hi=0xFFFFFF, capacity=0):
        self.L.retro_sb2_hook_trace_config(lo, hi, capacity)

    def trace(self, clear=True):
        p = C.c_void_p()
        d = C.c_uint32()
        n = self.L.retro_sb2_hook_trace(C.byref(p), C.byref(d))
        arr = (np.frombuffer((C.c_uint8 * (n * 24)).from_address(p.value), TRACE_EV).copy()
               if n and p.value else np.zeros(0, TRACE_EV))
        if d.value:
            print('warning: %d trace events dropped' % d.value)
        if clear:
            self.L.retro_sb2_hook_trace_clear()
        return arr


def _v2(self):
    if self.version < 2:
        raise RuntimeError('cycle hooks need the v2 shim (tools/sb2/harness/build.sh)')
    L = self.L
    L.retro_sb2_hook_trace_pcs.argtypes = [C.c_void_p, C.c_uint32, C.c_int]
    L.retro_sb2_hook_cycles_rom.restype = C.c_void_p
    L.retro_sb2_hook_cycles_total.restype = C.c_uint64
    return L


def _trace_pcs(self, pcs, on=True):
    offs = np.array([rom_off(p) for p in pcs], np.uint32)
    _v2(self).retro_sb2_hook_trace_pcs(offs.ctypes.data if len(offs) else None, len(offs), 1 if on else 0)


def _cycles_rom(self):
    p = _v2(self).retro_sb2_hook_cycles_rom()
    if not p:
        return np.zeros(0x100000, np.uint32)
    return np.ctypeslib.as_array((C.c_uint32 * 0x100000).from_address(p)).copy()


def _cycles_clear(self):
    _v2(self).retro_sb2_hook_cycles_clear()


def _cycles_total(self):
    return int(_v2(self).retro_sb2_hook_cycles_total())


Hooks.trace_pcs = _trace_pcs
Hooks.cycles_rom = _cycles_rom
Hooks.cycles_clear = _cycles_clear
Hooks.cycles_total = _cycles_total


def rom_off(pc):
    """HiROM: CPU address -> ROM file offset (None if not ROM)."""
    bank, off = (pc >> 16) & 0xff, pc & 0xffff
    if (bank & 0x40) or off >= 0x8000:
        if (bank & 0xfe) == 0x7e:
            return None
        return (((bank & 0x3f) << 16) | off) & 0xfffff
    return None


def _exec_mx(self):
    p = self.L.retro_sb2_hook_exec_counts(2)
    return np.ctypeslib.as_array((C.c_uint8 * 0x100000).from_address(p)).copy()


Hooks.exec_mx = _exec_mx
