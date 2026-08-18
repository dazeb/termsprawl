# AGENTS.md — src

Source root. Three-process Electron app: main / preload / renderer, plus an
Electron-free core and shared types. **No file outside `src/core/` may be
imported by `src/core/`.**

## Subdirectories

- `core/` — Electron-free service core (pty/tmux, workspace store, scrollback,
  git, agents status/session). The Server Edition boots from here. Importing
  `electron` is forbidden (enforced by a guard test).
- `main/` — Electron main process: window/IPC/dialog wiring + `CorePlatform`
  implementation. Never imported by core or renderer.
- `preload/` — the only bridge; exposes narrow `window.termsprawl` via
  contextBridge.
- `renderer/` — React UI; talks to main only through `window.termsprawl`.
- `shared/` — types + IPC channel names; `ipc.ts` is the single source of
  truth for channel strings.

Each subdirectory has its own AGENTS.md. See ../AGENTS.md for the process
model, key design decisions, and legal rules.
