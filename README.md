# termsprawl

A spatial terminal manager for Linux. Real terminals, editors, and agent
sessions live as draggable nodes on one infinite pan/zoom canvas — everything
sprawls, nothing hides in tabs.

![License: MIT](https://img.shields.io/badge/license-MIT-green) ![Platform: Linux](https://img.shields.io/badge/platform-Linux-blue)

## What it does

- **One infinite canvas** — pan, zoom, drag nodes anywhere. Layout is spatial,
  not stacked tabs: terminals, notes, groups, and diffs sit where *you* put
  them.
- **Real terminals** — every terminal node runs a genuine PTY (`node-pty`)
  rendered with xterm.js.
- **Sessions that survive restarts** — each terminal lives inside a persistent
  `tmux` session. Close the app, reopen it, and your terminals reattach with
  scrollback intact (cold starts replay a byte-capped scrollback snapshot).
- **Projects & persistence** — tabs, one project per tab; layouts persist to a
  git-shareable project file, so you can commit and share a workspace.
- **Agent nodes** — spawn Claude / Codex / Gemini / Grok right on the canvas,
  with hook-driven status badges (RUNNING / NEEDS YOU), unread dots, and OS
  notifications when an agent finishes.
- **Sticky, group, editor, and diff nodes** — notes, frames, and Monaco-based
  editors/diffs as first-class canvas citizens.
- **Source control** — stage, commit, branch, push/pull, and manage worktrees
  from a panel bound to the active project.
- **Undo/redo, command palette, dark lime-on-black UI.**

## Status

Actively developed. Phases 0–7 of [PLAN.md](PLAN.md) are shipped (scaffold,
terminal nodes, canvas, tmux continuity, projects/persistence, sticky/group/
editor/diff nodes, agents with context links and managed accounts); Phase 8
(source control) is in progress. Current version: **0.4.0**.

Linux only — AppImage and `.deb` artifacts. No macOS support, by design.

## Install

Download the latest **AppImage** or **.deb** from the
[Releases](https://github.com/dazeb/termsprawl/releases) page.

Runtime requirements:

- **tmux >= 3.2** — required for session continuity. Without it, terminals
  still work but lose scrollback across restarts.
  `sudo apt install tmux` (Debian/Ubuntu) · `dnf install tmux` · `pacman -S tmux`
- **FUSE** — to run the AppImage: `libfuse2t64` (Ubuntu 24.04),
  `libfuse2` (20.04–22.04), `fuse-libs` (Fedora), `fuse2` (Arch). Fallback:
  `./termsprawl-*.AppImage --appimage-extract-and-run`
- A shell (`$SHELL` or `/bin/bash`) and glibc >= 2.31 (Ubuntu 20.04+).

## Build from source

Requires Node 20+, pnpm, and Linux build tools for `node-pty`.

```bash
pnpm install        # deps + rebuilds node-pty against Electron's ABI
pnpm run dev        # dev mode with renderer HMR
pnpm run typecheck  # fastest correctness gate (tsc, both projects)
pnpm test           # vitest suite (unit + integration)
pnpm run build      # production build into out/
pnpm run dist       # AppImage + .deb into dist/
```

## Docs

- `docs/FEATURES.md` — the feature spec (what we're building toward)
- `docs/OWN-WORK.md` — concept reference for features we originated
- `PLAN.md` — the implementation plan (phases, tasks, verification)
- `AGENTS.md` — operational guide for AI agents working in this repo
- `THIRD-PARTY-NOTICES.md` — bundled dependencies and licenses

## License

MIT — see [LICENSE](LICENSE).

This is an independent, clean-room implementation. It shares no code with any
other terminal-manager project; it is inspired by the general concept of
canvas-based terminals and implements that concept from scratch.
