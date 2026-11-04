# Native emulation (PS1)

The browser core (EmulatorJS psx, WASM) can't reach full speed on the Jetson; RetroArch with
the PCSX-ReARMed core (ARM64 dynarec + NEON GPU) holds 60 fps on one core. Both binaries are
from the libretro buildbot (linux/aarch64), in the gitignored `data/tools/retroarch/`:

```sh
mkdir -p data/tools/retroarch && cd data/tools/retroarch
curl -sLO https://buildbot.libretro.com/nightly/linux/aarch64/RetroArch.7z   # → ./retroarch
7z x RetroArch.7z && rm RetroArch.7z     # (no 7z? apt-get download p7zip-full && dpkg -x)
curl -sL -o c.zip https://buildbot.libretro.com/nightly/linux/aarch64/latest/pcsx_rearmed_libretro.so.zip && unzip c.zip && rm c.zip
```

`src/native.mjs` writes the config (`data/arcade-native/retroarch.cfg`, saves next to it) and
launches it over the kiosk. Without the binaries the Arcade falls back to the browser core.
