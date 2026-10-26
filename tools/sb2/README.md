# Super Bomberman 2 · Tall — a faithful 9:16 port for the Gardener wall

Goal: Super Bomberman 2's BATTLE MODE, rebuilt for the wall's portrait screen (900×1600,
9:16) with TALLER arenas, using the original game's own assets and rules — extracted from
the user's ROM by running it in an instrumented emulator — not redrawn, not guessed.

The SNES PPU can only output ~256×224, so no ROM patch can show a 256×455 picture. Hence:
(1) instrumented emulator harness → (2) asset extraction + logic reverse-engineering →
(3) a new engine with the real assets/rules on a taller grid → (4) conformance tests that
replay the same input traces through the original and the port.

## Ground rules (every agent)
- ROM: `data/roms/Super Bomberman 2 (USA).sfc` (the user's own file). NEVER commit the ROM
  or anything extracted from it. Extracted assets/dumps go under `data/sb2/` (gitignored).
  Only CODE and NOTES (tools/sb2/, public/arcade/sb2/ engine code) are committed.
  Tables decoded from the ROM that the core loads at runtime (core/animdata.js,
  core/movers_tables.js) are gitignored too — `tools/sb2/build-rom-data.sh` rebuilds them.
- Don't touch the live kiosk (CDP port 9223), don't restart services, don't edit files
  outside your area. Build/run heavy things with `nice -n 10`.
- The 06:00 tending runs `git reset --hard` on a dirty tree: commit your own CODE paths
  as you go (`git add tools/sb2/<yours> && git commit -m "sb2: …"`, ending the message with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`). If
  `.git/index.lock` exists, wait and retry — other agents commit too.
- Record findings as you go in `tools/sb2/NOTES-<area>.md` (addresses, formats, numbers,
  how each was verified). Numbers must be MEASURED in the harness, not assumed.

## Layout
- `tools/sb2/harness/`  — emulator core build + Python frontend (phase 1)
- `tools/sb2/extract/`  — asset extraction scripts → `data/sb2/assets/` (phase 2a)
- `tools/sb2/re/`       — RAM maps, disassembly notes, measured rule spec (phase 2b) → `tools/sb2/SPEC.md`
- `public/arcade/sb2/`  — the port (phase 3); `tools/sb2/conformance/` (phase 4)
