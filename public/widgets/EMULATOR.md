# Arcade — the retro-console emulator widget

The **Arcade** widget (`public/widgets/emulator.js`) plays console games in the
kiosk via [EmulatorJS](https://emulatorjs.org), loaded at runtime from
`cdn.emulatorjs.org` (cores are large, so they're never vendored — the kiosk has
internet). Click the card (or highlight + A on the SN30 Pro) to open the
fullscreen ROM picker, choose a game, and play.

## Where to drop ROMs

Put ROM files in the **`data/roms/`** directory on the wall machine
(`<GARDENER_DATA>/roms/`, resolved by `src/config.mjs` → `paths.ROMS`). The dir
is created automatically on startup and is **gitignored** — ROMs are never
committed or shipped. The wall server lists them at `GET /api/roms` and streams
each at `GET /roms/<file>` (localhost-only, read-only, path-traversal guarded).

The console is inferred from the file extension:

| Extension      | System  | EmulatorJS core |
| -------------- | ------- | --------------- |
| `.nes` `.fds`  | NES     | `nes`           |
| `.smc` `.sfc`  | SNES    | `snes`          |
| `.gb`          | Game Boy| `gb`            |
| `.gbc`         | GBC     | `gb`            |
| `.gba`         | GBA     | `gba`           |
| `.n64` `.z64`  | N64     | `n64`           |
| `.md` `.gen`   | Genesis | `segaMD`        |
| `.sms`         | SMS     | `segaMS`        |
| `.pce`         | PC Engine | `pce`         |

Dotfiles and unknown extensions are ignored. Files are sorted by name in the
picker.

## Controller

The SN30 Pro is a browser Gamepad, so **EmulatorJS reads it natively for
gameplay**. In the ROM picker, the d-pad/stick moves the selection and A boots
the highlighted game. **L2 / Esc** closes the panel, which hard-stops the
emulator and its audio. The in-game "← Games" button re-opens the picker.
