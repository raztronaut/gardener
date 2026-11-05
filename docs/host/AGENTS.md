# GardenOS computer — start here

This is the hacker house's dedicated GardenOS computer, an NVIDIA Jetson Orin Nano
running Linux as user `talbot`. GardenOS is the primary interface on its single
900×1600 portrait wall display. Paseo's **The Botanist** project and its **GardenOS
computer** and **Commands from the OS** workspaces use `/` as their working directory.
Root workspace means the filesystem root, not the root user, and `/` is not a Git repo.

## Resolve context locally first

When the humans say “the garden”, “GardenOS”, “the OS”, “the gardener”, “this
computer”, or “our setup”, they mean this machine and its local software. Inspect
the paths below before searching the web or asking which project they mean.
Never assume a root workspace means the project files are unavailable.

| Path | Meaning |
| --- | --- |
| `/home/talbot/gardener` | **Live application and source of truth.** Services run this checkout. |
| `/home/talbot/gardener-github` | Public publishing checkout: `https://github.com/raztronaut/gardener`. Editing it alone does not change the wall. |
| `/home/talbot/GardenerV1` | Older React/Vite predecessor, remote `gdavidss/GardenerV1`; not the current GardenOS. |
| `/home/talbot/gardenos-theme` | Separate theme tooling; not the live app. |
| `/home/talbot/.config/systemd/user/gardener*` | Installed user services and timers. |
| `/home/talbot/.paseo` | Paseo configuration, workspace metadata, and agent state; may contain credentials. |
| `/GARDENOS.md` | Machine operations, quick diagnostics, and publishing notes. |

## Before changing anything

Read `/home/talbot/gardener/AGENTS.md`, `CLAUDE.md`, and `GARDEN_RULES.md` before
app edits. Also read `DESIGN_SYSTEM.md` for appearance, theme, size, or layout work.
Nested project instructions supply the detailed contracts. Check current Git
status: other agents and the daily gardener may have work in progress. Preserve
their changes; stage only your work. Never reset, clean, or overwrite the live
working tree to make a task easier. Do not initialize a Git repo at `/`.

The app is vanilla browser JavaScript with a Node backend, without a frontend
build step. The wall auto-reloads changes. Treat edits in the live checkout as
immediately visible to the household. Use isolated copies for experiments or
unapproved visual previews. Default design target is Garden Classic; follow the
project's explicit rules before changing additional themes.

## Work efficiently

- Use explicit paths or `git -C /home/talbot/gardener ...`. Search the relevant
  project with `rg` first; avoid recursive searches across `/`, home directories,
  dependencies, browser profiles, or agent transcripts.
- Start diagnostics with backend health and the relevant `systemctl --user`
  unit. Installed units and current code take precedence over stale descriptions.
- Use `/home/talbot/.local/bin/desk` for desktop screenshots and input. There is
  one real screen; applications opened over the kiosk appear on the wall.
- Keep the kiosk, voice bridge, controller, display schedule, and autonomous
  tending working. Restart only the service that needs it, then verify health.
  Do not restart Paseo while active agents are doing work merely to refresh docs.
- Validate changes with the relevant existing checks and, for visual work, inspect
  the resulting display. Do not claim the full app passed tests after syntax-only checks.
- Update durable docs when paths or architecture change. Record human standing
  preferences in the project's rules as directed there; do not put chat logs here.

## Credentials and GitHub

GitHub CLI is `/home/talbot/.local/bin/gh`, authenticated as `raztronaut`; verify
with `gh auth status` when needed. Never print `.env`, tokens, credential files,
or raw environment dumps. Runtime state lives under the live `data/` directory.
Never publish it, browser profiles, recordings, household uploads, or ROM assets.

The public repo retains sanitized local history. The live checkout's original
history contains an old transit API key, so **do not push its raw history** or
attach it to the public remote and push. Use the publishing checkout, review and
scan the intended changes, and preserve published history. See `/GARDENOS.md`.
