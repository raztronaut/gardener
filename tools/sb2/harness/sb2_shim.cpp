/* sb2_shim.cpp - instrumentation exports for the snes9x libretro core.
 *
 * Part of tools/sb2/harness (Super Bomberman 2 reverse-engineering harness).
 * build.sh copies this file into snes9x/libretro/ and the one-line patch
 * (snes9x-sb2.patch) adds it to SOURCES_CXX in libretro/Makefile.common.
 *
 * Every export is named retro_sb2_* so the stock link.T version script
 * ("global: retro_*") exports it without further changes.
 *
 * Nothing here alters emulation unless explicitly documented
 * (retro_sb2_smp_finish_opcode advances the SMP; the Python side wraps it in
 * save_state/load_state so it never leaks into a run).
 */
#include "snes9x.h"
#include "memmap.h"
#include "ppu.h"
#include "apu/apu.h"
#include "apu/bapu/snes/snes.hpp"
#include <string.h>
#include <stdint.h>

#define SB2_SHIM_VERSION 1

enum {
    SB2_MEM_CGRAM   = 0, /* PPU.CGDATA: 256 x uint16 BGR555 little-endian = 512 B */
    SB2_MEM_OAM     = 1, /* PPU.OAMData: 512 B low table + 32 B high table = 544 B */
    SB2_MEM_VRAM    = 2, /* Memory.VRAM: 64 KB, byte address = word address * 2 */
    SB2_MEM_APURAM  = 3, /* SNES::smp.apuram: 64 KB SPC700 RAM */
    SB2_MEM_FILLRAM = 4, /* Memory.FillRAM: 0x8000 B shadow of $0000-$7FFF bank 0 I/O
                            (index = register address, e.g. [0x2105] = last BGMODE write) */
    SB2_MEM_WRAM    = 5, /* Memory.RAM: 128 KB ($7E0000-$7FFFFF) */
};

extern "C" {

int retro_sb2_version(void) { return SB2_SHIM_VERSION; }

void *retro_sb2_mem_ptr(int id)
{
    switch (id) {
    case SB2_MEM_CGRAM:   return (void *) PPU.CGDATA;
    case SB2_MEM_OAM:     return (void *) PPU.OAMData;
    case SB2_MEM_VRAM:    return (void *) Memory.VRAM;
    case SB2_MEM_APURAM:  return (void *) SNES::smp.apuram;
    case SB2_MEM_FILLRAM: return (void *) Memory.FillRAM;
    case SB2_MEM_WRAM:    return (void *) Memory.RAM;
    }
    return NULL;
}

size_t retro_sb2_mem_size(int id)
{
    switch (id) {
    case SB2_MEM_CGRAM:   return sizeof(PPU.CGDATA);   /* 512 */
    case SB2_MEM_OAM:     return sizeof(PPU.OAMData);  /* 544 */
    case SB2_MEM_VRAM:    return 0x10000;
    case SB2_MEM_APURAM:  return 0x10000;
    case SB2_MEM_FILLRAM: return 0x8000;
    case SB2_MEM_WRAM:    return 0x20000;
    }
    return 0;
}

/* Decoded PPU state as int32 slots. The order is the ABI: snes.py keeps the
 * matching name list (PPU_FIELDS); bump SB2_SHIM_VERSION if it changes.
 * Addresses are VRAM WORD addresses (multiply by 2 for a byte offset into
 * retro_sb2_mem_ptr(SB2_MEM_VRAM)). Values are those latched at the moment
 * of the call (i.e. end of the last emulated frame) - mid-frame HDMA/IRQ
 * raster changes are NOT captured. */
int retro_sb2_ppu_regs(int32_t *out, int n)
{
    int32_t v[64];
    int k = 0;
    v[k++] = PPU.BGMode;                         /* 0  $2105 bits 0-2 */
    v[k++] = PPU.BG3Priority;                    /* 1  $2105 bit 3 */
    v[k++] = Memory.FillRAM[0x2105];             /* 2  raw BGMODE (bits 4-7 = 16x16 tile size BG1-4) */
    for (int i = 0; i < 4; i++) {                /* 3..22 BG1-4, 5 slots each */
        v[k++] = PPU.BG[i].SCBase;               /*   tilemap base (word addr) */
        v[k++] = PPU.BG[i].SCSize;               /*   0=32x32 1=64x32 2=32x64 3=64x64 */
        v[k++] = PPU.BG[i].NameBase;             /*   char/tile base (word addr) */
        v[k++] = PPU.BG[i].HOffset & 0x3ff;      /*   BGnHOFS */
        v[k++] = PPU.BG[i].VOffset & 0x3ff;      /*   BGnVOFS */
    }
    v[k++] = Memory.FillRAM[0x2101];             /* 23 OBSEL raw */
    v[k++] = PPU.OBJNameBase;                    /* 24 OBJ name base (word addr) */
    v[k++] = PPU.OBJNameSelect;                  /* 25 OBJ 2nd-table gap (words) */
    v[k++] = PPU.OBJSizeSelect;                  /* 26 OBSEL size bits 5-7 */
    v[k++] = Memory.FillRAM[0x212C];             /* 27 TM main screen enable */
    v[k++] = Memory.FillRAM[0x212D];             /* 28 TS sub screen enable */
    v[k++] = Memory.FillRAM[0x2130];             /* 29 CGWSEL */
    v[k++] = Memory.FillRAM[0x2131];             /* 30 CGADSUB */
    v[k++] = PPU.Brightness;                     /* 31 INIDISP brightness 0-15 */
    v[k++] = PPU.ForcedBlanking;                 /* 32 INIDISP forced blank */
    v[k++] = PPU.MatrixA;                        /* 33 M7A */
    v[k++] = PPU.MatrixB;                        /* 34 M7B */
    v[k++] = PPU.MatrixC;                        /* 35 M7C */
    v[k++] = PPU.MatrixD;                        /* 36 M7D */
    v[k++] = PPU.CentreX;                        /* 37 M7X */
    v[k++] = PPU.CentreY;                        /* 38 M7Y */
    v[k++] = PPU.M7HOFS;                         /* 39 */
    v[k++] = PPU.M7VOFS;                         /* 40 */
    v[k++] = Memory.FillRAM[0x211A];             /* 41 M7SEL raw */
    v[k++] = PPU.Mosaic;                         /* 42 mosaic size */
    v[k++] = Memory.FillRAM[0x2106];             /* 43 MOSAIC raw */
    v[k++] = PPU.FixedColourRed;                 /* 44 COLDATA r (0-31) */
    v[k++] = PPU.FixedColourGreen;               /* 45 */
    v[k++] = PPU.FixedColourBlue;                /* 46 */
    v[k++] = PPU.ScreenHeight;                   /* 47 224 or 239 */
    v[k++] = Memory.FillRAM[0x2133];             /* 48 SETINI raw */
    v[k++] = Memory.FillRAM[0x420C];             /* 49 HDMAEN (last write) */
    int cnt = k < n ? k : n;
    if (out) memcpy(out, v, cnt * sizeof(int32_t));
    return k;
}

/* 128 DSP registers, read through SNES::dsp.read (synchronises the lazily
 * clocked DSP first, which does not change emulated behaviour). */
void retro_sb2_dsp_regs(uint8_t *out128)
{
    for (int i = 0; i < 128; i++)
        out128[i] = SNES::dsp.read((uint8) i);
}

/* SPC700 CPU + I/O state, fixed layout (32 bytes):
 *  0 PCL  1 PCH  2 A  3 X  4 Y  5 PSW  6 SP  7 opcode_cycle (0 = on an
 *  instruction boundary)  8 $F1-ish CONTROL reconstructed (timer enables |
 *  iplrom<<7)  9 $F2 dsp_addr  10 $F8  11 $F9  12-14 timer targets ($FA-$FC)
 *  15-17 timer stage3 counters ($FD-$FF)  18-21 CPU->SPC ports ($2140-3 as
 *  seen by the SPC at $F4-$F7)  22-25 SPC->CPU ports (apuram $F4-$F7). */
void retro_sb2_smp_regs(uint8_t *out32)
{
    SNES::SMP &s = SNES::smp;
    memset(out32, 0, 32);
    out32[0] = s.regs.pc & 0xff;
    out32[1] = s.regs.pc >> 8;
    out32[2] = s.regs.B.a;
    out32[3] = s.regs.x;
    out32[4] = s.regs.B.y;
    out32[5] = (uint8) (unsigned) s.regs.p;
    out32[6] = s.regs.sp;
    out32[7] = (uint8) s.opcode_cycle;
    out32[8] = (s.timer0.enable ? 1 : 0) | (s.timer1.enable ? 2 : 0) |
               (s.timer2.enable ? 4 : 0) | (s.status.iplrom_enable ? 0x80 : 0);
    out32[9] = (uint8) s.status.dsp_addr;
    out32[10] = (uint8) s.status.ram00f8;
    out32[11] = (uint8) s.status.ram00f9;
    out32[12] = s.timer0.target;
    out32[13] = s.timer1.target;
    out32[14] = s.timer2.target;
    out32[15] = s.timer0.stage3_ticks & 15;
    out32[16] = s.timer1.stage3_ticks & 15;
    out32[17] = s.timer2.stage3_ticks & 15;
    for (int i = 0; i < 4; i++) {
        out32[18 + i] = SNES::cpu.registers[i];
        out32[22 + i] = s.apuram[0xf4 + i];
    }
}

/* Run the SMP until it sits on an instruction boundary (opcode_cycle == 0),
 * so a .spc snapshot has a clean PC. MUTATES emulation state: only call it
 * between save_state/load_state. Returns the number of op_step calls. */
int retro_sb2_smp_finish_opcode(void)
{
    int steps = 0;
    /* op_step() is always_inline inside smp.cpp, so drive it through
       enter(): with clock = -1 enter() executes exactly one op_step. */
    while (SNES::smp.opcode_cycle != 0 && steps < 64) {
        SNES::smp.clock = -1;
        SNES::smp.enter();
        steps++;
    }
    SNES::dsp.synchronize();
    return steps;
}

} /* extern "C" */
