#!/usr/bin/env python3
"""Reproducible analysis-only hooks for an isolated pinned PCSX source checkout."""
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[2]
repo=root/'data/bw/upstream/pcsx-rearmed';name='libpcsxcore/psxinterpreter.c';p=repo/name
assert subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()=='7b0e8f8fadfbce3d170d195b9d9eecaabfa08c8e'
s=subprocess.check_output(['git','-C',str(repo),'show','HEAD:'+name],text=True)
if p.read_text()!=s and 'GardenOS World analysis hooks' not in p.read_text():raise RuntimeError('Unexpected local edits; refusing overwrite')
hook='''/* GardenOS World analysis hooks; disabled by default. */
static unsigned int bw_counts[0x80000];
static int bw_trace;
static unsigned int bw_lo, bw_hi, bw_n, bw_log[65536 * 4];
__attribute__((visibility("default"))) unsigned int *retro_bw_watch(unsigned int lo, unsigned int hi) {
    bw_lo = lo & 0x1fffff; bw_hi = hi & 0x1fffff; bw_n = 0; return bw_log;
}
__attribute__((visibility("default"))) unsigned int retro_bw_watch_count(void) { return bw_n; }
__attribute__((visibility("default"))) unsigned int *retro_bw_trace(int enabled) { bw_trace = enabled; return bw_counts; }
__attribute__((visibility("default"))) unsigned int retro_bw_pc(void) { return psxRegs.pc; }
static inline void bw_observe(psxRegisters *regs, unsigned int pc, unsigned int code) {
    if (bw_trace && (pc & 0x1fffffff) < 0x200000) bw_counts[(pc & 0x1fffff) >> 2]++;
    if (bw_hi > bw_lo && bw_n < 65536) {
        unsigned int op = code >> 26;
        if (op == 40 || op == 41 || op == 43) {
            unsigned int ea = regs->GPR.r[(code >> 21) & 31] + (short)code;
            if ((ea & 0x1fffffff) >= 0x200000) return;
            ea &= 0x1fffff;
            if (ea >= bw_lo && ea < bw_hi) {
                unsigned int *p = bw_log + 4 * bw_n++;
                p[0] = pc; p[1] = ea; p[2] = regs->GPR.r[(code >> 16) & 31]; p[3] = code;
            }
        }
    }
}
'''
s=s.replace('static void (INT_ATTR *psxBSC[64])',hook+'\nstatic void (INT_ATTR *psxBSC[64])',1)
# Both normal fetch paths and both delay-slot dispatch paths are observed.
s=s.replace('\tpsxBSC[regs->code >> 26](regs, regs->code);','\tbw_observe(regs, pc, regs->code);\n\tpsxBSC[regs->code >> 26](regs, regs->code);')
s=s.replace('\t\t\tpsxBSC[code >> 26](regs, code);','\t\t\tbw_observe(regs, tar1, code);\n\t\t\tpsxBSC[code >> 26](regs, code);')
s=s.replace('\n\tpsxBSC[code >> 26](regs, code);','\n\tbw_observe(regs, pc, code);\n\tpsxBSC[code >> 26](regs, code);')
s += r"""
/* Bounded isolated function call. Only use on analysis instances. */
__attribute__((visibility("default"))) int retro_bw_call(unsigned int pc, unsigned int a0, unsigned int a1, unsigned int a2, unsigned int a3, unsigned int *result) {
    psxRegisters backup = psxRegs;
    unsigned int count = 0;
    psxRegs.pc = pc;
    psxRegs.GPR.r[4] = a0; psxRegs.GPR.r[5] = a1;
    psxRegs.GPR.r[6] = a2; psxRegs.GPR.r[7] = a3;
    psxRegs.GPR.r[31] = 0x80000000;
    while (psxRegs.pc != 0x80000000 && count++ < 100000) execI(&psxRegs);
    *result = psxRegs.GPR.r[2];
    int ok = psxRegs.pc == 0x80000000;
    psxRegs = backup;
    return ok;
}
"""
p.write_text(s);print('Analysis hooks ready (including branch delay slots)')
