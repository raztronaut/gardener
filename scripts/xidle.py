#!/usr/bin/env python3
# Print X input idle time in ms (XScreenSaver extension) — used by display.mjs nightkeep.
import ctypes, os
class Info(ctypes.Structure):
    _fields_ = [('window', ctypes.c_ulong), ('state', ctypes.c_int), ('kind', ctypes.c_int),
                ('til_or_since', ctypes.c_ulong), ('idle', ctypes.c_ulong), ('eventMask', ctypes.c_ulong)]
X = ctypes.CDLL('libX11.so.6'); S = ctypes.CDLL('libXss.so.1')
X.XOpenDisplay.restype = ctypes.c_void_p; X.XDefaultRootWindow.restype = ctypes.c_ulong
S.XScreenSaverAllocInfo.restype = ctypes.POINTER(Info)
d = X.XOpenDisplay(os.environ.get('DISPLAY', ':0').encode())
if not d: raise SystemExit(1)
i = S.XScreenSaverAllocInfo()
S.XScreenSaverQueryInfo(ctypes.c_void_p(d), ctypes.c_ulong(X.XDefaultRootWindow(ctypes.c_void_p(d))), i)
print(i.contents.idle)
