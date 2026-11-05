# GardenOS host guide

These are machine-specific operating notes for the hacker house computer, not a
generic installation guide. Last verified: 2026-11-05. Read `/AGENTS.md` first.

## Quick orientation

- Hardware: NVIDIA Jetson Orin Nano, Linux ARM64, login `talbot`.
- Main interface: GardenOS in a fullscreen Chromium kiosk, one 900×1600 portrait
  display on X11 `:0`. Some unit descriptions still say “surf”; inspect the
  launcher rather than relying on the description.
- Live project: `/home/talbot/gardener`; backend `http://127.0.0.1:8787`.
- Public repository: https://github.com/raztronaut/gardener, checkout
  `/home/talbot/gardener-github`. This is separate from the running application.
- Paseo root project: **The Botanist**. Human workspace: **GardenOS computer**
  (`wks_91072100070aa0fb`); voice workspace: **Commands from the OS**
  (`wks_47b29bf1f3bdf1b6`). Both use `/`.

Paseo Desktop is installed under `/home/talbot/apps/paseo`. The local
`~/Applications/Paseo.AppImage` alias points to `~/.local/bin/paseo-desktop`
so `paseo agent open` can discover this custom ARM64 installation. The setup
to-do uses that command to open Gui’s own conversation in the root workspace.

The app is a Node server plus vanilla HTML/CSS/browser modules under `public/`.
The autonomous daily gardener uses feedback to tend it. “Hey Garden” voice
control and the Botanist bridge route spoken coding requests into Paseo.

## Fast, read-only diagnostics

Run as `talbot`; these are user services, so use `systemctl --user`, not sudo.

```bash
curl --fail --silent http://127.0.0.1:8787/api/health
systemctl --user list-units 'gardener*' --no-pager
systemctl --user list-timers 'gardener*' --no-pager
git -C /home/talbot/gardener status --short
/home/talbot/.local/bin/paseo workspace ls --json
```

For a specific failure, use `systemctl --user status UNIT --no-pager` and
`journalctl --user -u UNIT -n 60 --no-pager`. Logs can contain household input;
inspect only what is needed and do not copy them into the public repo.

## Runtime map

| Unit | Role |
| --- | --- |
| `gardener-backend.service` | Main UI and API, localhost port 8787. |
| `gardener-kiosk.service` | Fullscreen wall browser with GPU acceleration. |
| `gardener-voice.service` | On-device wake word and speech recognition, voice actions and Botanist bridge. |
| `gardener-pad.service` | Controller and input bridge. |
| `gardener-plant.service` | Separate remote feedback/household surface, normally port 8788. |
| `gardener-tunnel.service` | Tunnel for the plant server, not the main backend. |
| `gardener-iterate.timer` | Daily autonomous tending, 06:00 Pacific. |
| `gardener-day.timer` | Wake display at 07:00 Pacific. |
| `gardener-evening.timer` | Evening fade, starting at 22:00 Pacific. |
| `gardener-night.timer` | Sleep display at midnight Pacific. |
| `gardener-nightkeep.timer` | Keep display asleep overnight after idle timeout. |
| `gardener-tunnel-reprobe.timer` | Monthly tunnel provider recheck. |

Installed units: `/home/talbot/.config/systemd/user/`. Source units:
`/home/talbot/gardener/systemd/`. Launcher:
`/home/talbot/gardener/scripts/gardener.sh`. Inspect installed units with
`systemctl --user cat UNIT` before changing service behavior. Launcher paths are
machine-specific. Editing a source unit does not install it: copy the intended
unit, run `systemctl --user daemon-reload`, and restart only affected services.

## Desktop, display, and checks

```bash
/home/talbot/.local/bin/desk shot /tmp/garden-wall.png
/home/talbot/.local/bin/desk windows
cd /home/talbot/gardener
npm run smoke
npm run design:check  # for theme/design changes
```

Inspect screenshots with the available image-viewing tool. `desk --help` or the
header of `tools/desk/desk` lists input commands. The kiosk's Chrome debugging
port is normally 9223; keep it local. Display behavior is in `src/display.mjs`
and the display timers. Use the launcher (`scripts/gardener.sh day`, `night`,
or `sync`) when intentionally testing display state; it changes the real screen.
Do not wake the wall or open applications just to inspect a config file.

The smoke suite uses a temporary database and its own port. Read the project
instructions for feature-specific checks. Do not run install scripts or daily
tending just to test a documentation change.

## Git and publishing

The live checkout retains the original local history and may have uncommitted
work from humans or other agents. The public checkout retains sanitized copies
of those commits plus the publication work. Removing a historical secret changes
affected commit IDs; the two histories may differ. Do not merge or force-push
the unsanitized live history into GitHub.

For later changes, inspect both checkouts and the remote first. Transfer only
reviewed source changes to the publishing checkout, excluding `.env`, `data/`,
dependencies, and machine credentials. Scan new files and archives for secrets,
then commit and push from `/home/talbot/gardener-github` when authorized by the
task. Do not copy `.git/`. Preserve existing published commits. The public
Supabase `anon` client key and clearly dummy smoke-test keys are intentionally
client-visible/test data; private service-role keys and API credentials are not.

## Maintaining these root instructions

Versioned sources live in `docs/host/` in the public checkout. The installer
copies only `AGENTS.md`, `CLAUDE.md`, and `GARDENOS.md` to `/`, backing up existing
files. It changes no services, authentication settings, or app code.

```bash
sudo bash /home/talbot/gardener-github/scripts/install-host-docs.sh
```

An administrator password may be required because `/` is owned by root. Enter
it in the local terminal, never in chat. Run the installer again after updating
these source docs. Fresh agents starting in `/` will then load `/AGENTS.md` or
`/CLAUDE.md`; existing chats may need to read the updated file explicitly.
