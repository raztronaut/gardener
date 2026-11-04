// The Gardener™ — native emulation for the consoles the browser can't run at full speed.
// PlayStation in EmulatorJS (WASM, interpreter only) ran at ~15–25 fps on this Jetson;
// natively, RetroArch + PCSX-ReARMed (ARM64 dynarec, NEON GPU) holds the full 60.
//
// The Arcade (public/widgets/emulator.js) asks POST /api/arcade/native {file}; this starts
// RetroArch fullscreen on the wall's X display, ABOVE the kiosk, reading the SN30 Pro
// itself (linuxraw /dev/input/js0 — the same device pad.mjs reads; both may read it).
// Leaving: Select + Start (RetroArch's quit combo) → the process ends → the Arcade sees
// running:false and returns to the library; L1+R1+L2+R2 / the heart / "Hey Garden, close
// the game" → POST /api/arcade/native/stop. One game at a time.
// Binaries (gitignored, data/tools/retroarch/): the libretro buildbot's linux/aarch64
// RetroArch + pcsx_rearmed core (see tools/arcade/README.md).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { paths } from './config.mjs';

const RA_DIR = join(paths.DATA, 'tools', 'retroarch');
const RA_BIN = join(RA_DIR, 'retroarch');
const CORES = { psx: join(RA_DIR, 'pcsx_rearmed_libretro.so') };
const HOME = join(paths.DATA, 'arcade-native');

export const nativeSystems = () => Object.keys(CORES).filter((s) => existsSync(RA_BIN) && existsSync(CORES[s]));

let proc = null, current = null;
export const nativeStatus = () => ({ running: !!proc, rom: current, systems: nativeSystems() });

function writeConfig() {
  for (const d of ['saves', 'states', 'system', 'screenshots']) mkdirSync(join(HOME, d), { recursive: true });
  const cfg = {
    // video: fullscreen on the wall, GL (GLX) on the Tegra, vsync'd to the 60 Hz panel
    video_driver: 'gl', video_fullscreen: 'true', video_windowed_fullscreen: 'true', video_vsync: 'true',
    video_hard_sync: 'false', video_threaded: 'false', video_smooth: 'false', video_scale_integer: 'false',
    aspect_ratio_index: '22', video_font_enable: 'false', video_shader_enable: 'false',
    // audio: PulseAudio (the system volume / the Arcade's 42 % apply)
    audio_driver: 'pulse', audio_latency: '64', audio_sync: 'true',
    // input: the SN30 Pro through /dev/input/js0, bound explicitly (pad.mjs's numbering)
    input_joypad_driver: 'linuxraw', input_autodetect_enable: 'false', input_player1_joypad_index: '0',
    input_player1_a_btn: '0', input_player1_b_btn: '1', input_player1_x_btn: '3', input_player1_y_btn: '4',
    input_player1_l_btn: '6', input_player1_r_btn: '7', input_player1_l2_btn: '8', input_player1_r2_btn: '9',
    input_player1_select_btn: '10', input_player1_start_btn: '11', input_player1_l3_btn: '13', input_player1_r3_btn: '14',
    input_player1_up_axis: '-7', input_player1_down_axis: '+7', input_player1_left_axis: '-6', input_player1_right_axis: '+6',
    input_player1_l_x_plus_axis: '+0', input_player1_l_x_minus_axis: '-0', input_player1_l_y_plus_axis: '+1', input_player1_l_y_minus_axis: '-1',
    input_player1_r_x_plus_axis: '+2', input_player1_r_x_minus_axis: '-2', input_player1_r_y_plus_axis: '+3', input_player1_r_y_minus_axis: '-3',
    input_player1_analog_dpad_mode: '1',          // the left stick drives the d-pad too
    // the d-pad is the hat (axes 6/7 on this pad), not buttons
    input_player1_up_btn: 'nul', input_player1_down_btn: 'nul', input_player1_left_btn: 'nul', input_player1_right_btn: 'nul',
    input_quit_gamepad_combo: '4',                 // Select + Start leaves (as in the Arcade)
    input_menu_toggle_gamepad_combo: '0', input_menu_toggle_btn: 'nul', input_menu_toggle: 'nul',
    input_exit_emulator: 'escape', input_enable_hotkey_btn: 'nul',
    // quiet: no menu, notifications, pauses or saving the config
    menu_driver: 'rgui', pause_nonactive: 'false', config_save_on_exit: 'false', quit_press_twice: 'false',
    notification_show_autoconfig: 'false', notification_show_remap_load: 'false', notification_show_config_override_load: 'false',
    notification_show_set_initial_disk: 'false', notification_show_fast_forward: 'false', menu_show_load_content_animation: 'false',
    savestate_auto_save: 'false', savestate_auto_load: 'false', video_msg_bgcolor_enable: 'false',
    savefile_directory: join(HOME, 'saves'), savestate_directory: join(HOME, 'states'), system_directory: join(HOME, 'system'),
    screenshot_directory: join(HOME, 'screenshots'), libretro_directory: RA_DIR, core_options_path: join(HOME, 'core-options.cfg'),
    global_core_options: 'true', log_verbosity: 'false', fps_show: 'false',
  };
  writeFileSync(join(HOME, 'retroarch.cfg'), Object.entries(cfg).map(([k, v]) => `${k} = "${v}"`).join('\n') + '\n');
  // PCSX-ReARMed: the ARM dynarec + the NEON GPU at native resolution (full speed, no stutter)
  if (!existsSync(join(HOME, 'core-options.cfg'))) {
    writeFileSync(join(HOME, 'core-options.cfg'), ['pcsx_rearmed_drc = "enabled"', 'pcsx_rearmed_neon_enhancement_enable = "disabled"',
      'pcsx_rearmed_frameskip_type = "disabled"', 'pcsx_rearmed_show_bios_bootlogo = "disabled"', 'pcsx_rearmed_spu_interpolation = "simple"'].join('\n') + '\n');
  }
}

export function startNative(romPath, system, log = () => {}) {
  if (proc) return { ok: false, error: 'a game is already running' };
  const core = CORES[system];
  if (!core || !nativeSystems().includes(system)) return { ok: false, error: `no native core for ${system}` };
  writeConfig();
  const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':0' };
  if (!env.XAUTHORITY) for (const x of [`/run/user/${process.getuid()}/gdm/Xauthority`, join(process.env.HOME || '', '.Xauthority')]) if (existsSync(x)) { env.XAUTHORITY = x; break; }
  current = basename(romPath);
  proc = spawn(RA_BIN, ['-c', join(HOME, 'retroarch.cfg'), '-L', core, romPath], { env, stdio: 'ignore', detached: false });
  const p = proc;
  p.on('exit', (code) => { if (proc === p) { proc = null; current = null; } log(`native: ${system} game ended (${code})`); });
  log(`native: ${system} → ${current}`);
  return { ok: true };
}

export function stopNative() {
  if (!proc) return { ok: true };
  const p = proc;
  try { p.kill('SIGTERM'); } catch { /* gone */ }
  setTimeout(() => { try { if (!p.killed || p.exitCode == null) p.kill('SIGKILL'); } catch { /* gone */ } }, 2500);
  return { ok: true };
}
