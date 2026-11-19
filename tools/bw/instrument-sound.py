"""Analysis-only SPU voice muting for clean captures from the household's game."""
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[2];repo=root/'data/bw/upstream/pcsx-rearmed';name='plugins/dfsound/registers.c';p=repo/name
s=subprocess.check_output(['git','-C',str(repo),'show','HEAD:'+name]).decode().replace('\r\n','\n')
if p.read_text()!=s and 'World audio analysis' not in p.read_text():raise RuntimeError('Unexpected audio source edits')
hook='''/* World audio analysis; zero mask leaves normal execution untouched. */
static unsigned int bw_muted_voices;
__attribute__((visibility("default"))) void retro_bw_mute(unsigned int mask) {
 bw_muted_voices = mask;
 for (int ch = 0; ch < 24; ch++) {
  SetVolumeL(ch, (mask & (1u << ch)) ? 0 : spu.regArea[ch * 8]);
  SetVolumeR(ch, (mask & (1u << ch)) ? 0 : spu.regArea[ch * 8 + 1]);
 }
 spu.iLeftXAVol = (mask & 0x1000000) ? 0 : (short)spu.regArea[(0xdb0 - 0xc00) / 2];
 spu.iRightXAVol = (mask & 0x1000000) ? 0 : (short)spu.regArea[(0xdb2 - 0xc00) / 2];
}
'''
s=s.replace('void CALLBACK SPUwriteRegister(',hook+'\nvoid CALLBACK SPUwriteRegister(',1)
s=s.replace(' int rofs = (r - 0xc00) >> 1;', ' if ((bw_muted_voices & 0x1000000) && (r == 0xdb0 || r == 0xdb2)) val = 0;\n if (r >= 0xc00 && r < 0xd80 && (r & 15) <= 2 && (bw_muted_voices & (1u << ((r - 0xc00) >> 4)))) val = 0;\n int rofs = (r - 0xc00) >> 1;',1)
p.write_text(s);print('Audio analysis hooks installed')
