# termsprawl

A spatial terminal manager for Linux. Real terminals, editors, and agent
sessions live as draggable nodes on one infinite pan/zoom canvas — everything
sprawls, nothing hides in tabs.

![License: MIT](https://img.shields.io/badge/license-MIT-green) ![Platform: Linux](https://img.shields.io/badge/platform-Linux-blue)

## What it does

- **One infinite canvas** — pan, zoom, drag, and resize nodes anywhere. Layout
  is spatial, not stacked tabs: terminals, notes, groups, diffs, editors, and
  browsers sit where *you* put them. Every node is resizable (subtle handles
  appear when selected).
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
- **Embedded browser nodes** — a real sandboxed Chromium browser on the canvas,
  one guest per tab, hardened (no Node/preload, navigation policy), with an
  opt-in, localhost-only CDP surface so an external agent (Playwright/Puppeteer)
  can drive the exact page you're watching. Opens as a small mini-window
  (it's the agent's browser; viewing is a bonus) and stays capped at a compact
  size.
- **Source control** — stage, commit, branch, push/pull, and manage worktrees
  from a panel bound to the active project.
- **Undo/redo, command palette, dark lime-on-black UI.**

## Status

Actively developed. Phases 0–10 of [PLAN.md](PLAN.md) are shipped:

- **Desktop app** — terminal canvas, tmux session continuity, projects &
  persistence, sticky/group/editor/diff nodes, agents with context links
  and managed accounts, source control (git status, staging, commits,
  branches, sync, worktrees, AI commit messages), SSH remote projects,
  embedded browser nodes (opt-in agent control via CDP), Telegram bot v2,
  and auto-update with announcements.
- **Server Edition** — the same app runs in a browser via plain `node:http`
  + WebSocket RPC. Serves the built renderer, tunnels all core services
  (terminals, projects, git, agent hooks, file tree), with auto-save and
  shutdown safety.

Current version: **0.9.1**.

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

### Server Edition

The app also runs as a plain Node web server (no Electron). Build and start:

```bash
pnpm run build && pnpm run build:server
TERMSPRAWL_SERVER_ENTRY=1 PORT=3110 node out/server/index.js
# → http://localhost:3110
```

The Server Edition serves the same UI, tunnels all core services (terminals,
projects, git, agent hooks, file tree) over a WebSocket RPC shim, and
persists state to `~/.config/termsprawl/` (or `$TERMSPRAWL_DATA`).

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
