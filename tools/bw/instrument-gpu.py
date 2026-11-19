#!/usr/bin/env python3
"""Observe consumed GP0 words and VRAM in the isolated analysis core only."""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[2]
repo=ROOT/'data/bw/upstream/pcsx-rearmed';name='plugins/gpulib/gpu.c';p=repo/name
assert subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()=='7b0e8f8fadfbce3d170d195b9d9eecaabfa08c8e'
s=subprocess.check_output(['git','-C',str(repo),'show','HEAD:'+name],text=True)
if p.read_text()!=s and 'GardenOS World GPU observation' not in p.read_text():raise RuntimeError('Unexpected edits; refusing overwrite')
s=s.replace('struct psx_gpu gpu;','''struct psx_gpu gpu;
/* GardenOS World GPU observation: off by default, never alters command data. */
static unsigned int bw_gpu_words[262144], bw_gpu_n;
static int bw_gpu_enabled, bw_gpu_overflow;
__attribute__((visibility("default"))) unsigned int *retro_bw_gpu_capture(int enabled) {
  bw_gpu_enabled = enabled;
  if (enabled) { bw_gpu_n = 0; bw_gpu_overflow = 0; }
  return bw_gpu_words;
}
__attribute__((visibility("default"))) unsigned int retro_bw_gpu_count(void) { return bw_gpu_n; }
__attribute__((visibility("default"))) int retro_bw_gpu_overflow(void) { return bw_gpu_overflow; }
static void bw_gpu_observe(uint32_t *words, unsigned int count) {
  if (!bw_gpu_enabled) return;
  if (bw_gpu_n + count > 262144) { bw_gpu_overflow = 1; return; }
  memcpy(bw_gpu_words + bw_gpu_n, words, count * 4); bw_gpu_n += count;
}
''',1)
needle='  return count - pos;'
assert s.count(needle)==1
s=s.replace(needle,'  bw_gpu_observe(data, pos);\n'+needle)
s += '''
__attribute__((visibility("default"))) uint16_t *retro_bw_vram(void) {
  flush_cmd_buffer(&gpu); sync_renderer(&gpu); return gpu.vram;
}
__attribute__((visibility("default"))) uint32_t *retro_bw_gpu_ex_regs(void) { return gpu.ex_regs; }
'''
p.write_text(s);print('Isolated GPU observation hooks ready')
