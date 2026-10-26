# aisnap.py vector T1 T2 -> /tmp/sb2/aisnap_<vector>.bin   (oracle for aicheck.mjs)
# Logs every WRAM write while replaying the vector in the emulator and cuts out each COM
# AI call: 'before' = WRAM at the AI's first write (stuck timer, C106D8), 'after' = WRAM at
# the first write from outside the AI's routines (interrupt handlers excluded).
# For each tick T in [T1,T2] and each COM slot whose AI ran: WRAM just before the AI (first
# stuck-timer write) and just after (before C022E2's +0E store at C02346).
# record: u32 tick, u32 slot, 128K before, 128K after
import json, os, sys, struct, zlib
REG = [(0, 0xA00), (0x5C00, 0x5F10), (0x8000, 0x8400), (0x18000, 0x19000), (0x1C000, 0x1D000)]
def pk(m):
    return b''.join(m[a:b].tobytes() for a, b in REG)
import numpy as np
sys.path[:0] = ['/home/talbot/gardener/tools/sb2/harness', '/home/talbot/gardener/tools/sb2/re']
from snes import Snes, STATES_DIR
from hooks import Hooks
name, T1, T2 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
v = json.load(open('/home/talbot/gardener/data/sb2/vectors/%s.json' % name))
S = Snes(render=False, multitap=v['start']['multitap'])
st = v['start']['state']
for d in (STATES_DIR, '/home/talbot/gardener/data/sb2/re/states'):
    p = os.path.join(d, st + '.state')
    if os.path.exists(p): S.load_state_file(p); break
for _ in range(v['start']['settle_frames']): S.step(0)
w = S.wram(live=True)
for off, val, size in v['start']['pokes']:
    w[off] = val & 0xff
    if size == 2: w[off + 1] = (val >> 8) & 0xff
H = Hooks(S)
H.watch_write(0, 0x20000)
out = open('/tmp/sb2/aisnap_%s.bin' % name, 'wb')
ticks = [f['truth']['tick'] for f in v['frames']]
first = {}
for i, t in enumerate(ticks):
    if t not in first: first[t] = i
nrec = 0
i = 0
logging = False
base = None
evs = []
while i < len(v['frames']):
    t = ticks[i]
    want = T1 <= t <= T2
    if want and (i == 0 or ticks[i - 1] != t):
        if evs and base is not None:
            pass
        base = S.wram()
        H.writes()  # clear
        H.enable(write=True)
    S.step(tuple(v['frames'][i]['pads']))
    nxt = ticks[i + 1] if i + 1 < len(ticks) else None
    if want and nxt != t:
        H.off()
        ev = H.writes()
        mem = base.copy()
        cur = {}  # slot -> before snapshot
        intr = False
        for e in ev:
            pc, a, val = int(e['pc']), int(e['addr']), int(e['val'])
            if 0xC106D8 <= pc <= 0xC10734 and 0x8000 <= a < 0x8400 and (a & 0xFF) in (0x38, 0x39, 0xEC, 0xED):
                s = (a - 0x8000) >> 8
                if s not in cur: cur[s] = mem.copy()
            inai = (0xC0C54B <= pc <= 0xC0D600 or 0xC106D8 <= pc <= 0xC10734 or 0xC17CA9 <= pc <= 0xC17F95
                    or 0xC19BFB <= pc <= 0xC19C40 or 0xC0EE1C <= pc <= 0xC0EE48 or 0xC00CAA <= pc <= 0xC00D34 or 0xC0BEA6 <= pc <= 0xC0C054 or 0xC01DCB <= pc <= 0xC01DE2)
            if pc < 0x10000:
                intr = True
            elif inai or 0xC01E00 <= pc < 0xC02400:
                intr = False
            act = [k for k in cur if cur[k] is not None]
            if not inai and act and not intr and (pc >> 16) != 0xC3:
                s = act[0]
                if True:
                    z = zlib.compress(pk(cur[s]) + pk(mem), 1); out.write(struct.pack('<III', t, s, len(z))); out.write(z); nrec += 1
                    cur[s] = None
            if a < 0x20000: mem[a] = val
    i += 1
    pass
out.close()
print(nrec, 'records')
