#!/usr/bin/env python3
"""Read-only X11 check: focused kiosk must also be under the pointer."""
import ctypes as c
import json
import subprocess

x = c.CDLL('libX11.so.6')
x.XOpenDisplay.restype = c.c_void_p
d = x.XOpenDisplay(None)
if not d:
    raise SystemExit('X display unavailable')
x.XDefaultRootWindow.argtypes = [c.c_void_p]
x.XDefaultRootWindow.restype = c.c_ulong
root = x.XDefaultRootWindow(d)
r, child = c.c_ulong(), c.c_ulong()
rx, ry, wx, wy, mask = c.c_int(), c.c_int(), c.c_int(), c.c_int(), c.c_uint()
x.XQueryPointer.argtypes = [c.c_void_p, c.c_ulong] + [c.c_void_p] * 7
x.XQueryPointer(d, root, c.byref(r), c.byref(child), c.byref(rx), c.byref(ry), c.byref(wx), c.byref(wy), c.byref(mask))
def prop(*args):
    return subprocess.check_output(['xprop', *args], timeout=2, text=True)
active = prop('-root', '_NET_ACTIVE_WINDOW').strip().split()[-1]
same = int(active, 16) == child.value
klass = prop('-id', active, 'WM_CLASS') if same else ''
print(json.dumps({'kiosk': same and 'gardener-kiosk-gpu' in klass,
                  'buttonsDown': bool(mask.value & 0x1f00)}))
