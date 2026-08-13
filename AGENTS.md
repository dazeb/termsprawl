# AGENTS.md — termsprawl

**termsprawl** is a spatial terminal manager for Linux: real terminals, editors,
and agent sessions live as draggable nodes on one infinite pan/zoom canvas.
MIT-licensed, clean-room — **no code in this repo is copied from any other
project** (see Legal rules below).

## Commands

```bash
npm install        # deps + rebuilds node-pty against Electron's ABI (postinstall)
npm run dev        # dev mode with renderer HMR
npm run build      # production build into out/
npm start          # preview the production build
npm run typecheck  # tsc for both node (main/preload) and web (renderer) projects
npm test           # vitest suite (unit + integration)
npm run dist       # AppImage + .deb into dist/ (electron-builder)
npm run make-icon  # regenerate build/icon.png
./scripts/check-originality.sh   # clean-room guard — run after any large change
```

`npm run typecheck` is the fastest correctness gate.

## Process model (Electron, three contexts)

- **`src/main/`** — Electron main process: window/IPC/dialog wiring and the
  `CorePlatform` implementation (`platform.ts` seam). Must never be imported
  by core or renderer.
- **`src/core/`** — Electron-free service core (pty/tmux, workspace store,
  scrollback). Talks to its shell ONLY via `CorePlatform`
  (`src/core/platform.ts`: `broadcast()` + `userDataPath`). Importing
  `electron` here is forbidden — enforced by `src/core/no-electron.test.ts`.
  This is the seam a future Server Edition boots from.
- **`src/preload/`** — the only bridge. Exposes a narrow `window.termsprawl`
  API via `contextBridge` (typed in `src/renderer/src/env.d.ts`). The renderer
  must never touch `ipcRenderer` directly.
- **`src/renderer/`** — React UI. Talks to main *only* through
  `window.termsprawl`.
- **`src/shared/`** — types + IPC channel names. `ipc.ts` is the single source
  of truth for channel strings; never hardcode a channel elsewhere.

**Preload builds as `index.mjs`** (ESM) — the main process references
`../preload/index.mjs`, NOT `.js`. A stale `.js` path silently breaks the
bridge in production builds (renderer crashes on `window.termsprawl`). If you
touch build config, re-verify with a packaged boot test.

## Key design decisions (do not casually reverse)

- **React Flow is the single live source of truth** for node state
  (`Canvas.tsx`). No separate store mirroring nodes. `state/workspace.ts`
  holds only pure helpers: node factories + `serializeNodes`/`deserializeNodes`.
- **Node ids are stable and load-bearing**: the PTY session id, the tmux
  session key (`ts-<nodeId>`), and the persisted node id are all the same
  string. Change an id ⇒ the terminal respawns and loses its session.
- **tmux owns session continuity.** Every terminal runs inside
  `tmux new-session -A -D -s ts-<nodeId>` on a dedicated socket (`-S
  <userData>/tmux-sockets/termsprawl`) with a generated config
  (`<userData>/tmux.conf`, status off, mouse on, 50k history, clipboard).
  `killAll()` (app quit) detaches but never kills sessions; `destroy()`
  (node ×) kills the session permanently. `create()` returns `fresh` (cold
  start) vs warm reattach; cold starts replay the byte-capped scrollback
  snapshot (`scrollback-store.ts`) with a "session restored" separator.
- **tmux copy-mode binds MUST use the `send-keys -X` wrapper**
  (`bind -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel`).
  A bare `copy-pipe-and-cancel` puts the pane into copy mode at startup
  (tmux 3.4), swallowing all keyboard input. Do not "simplify" this.
- **node-pty is external in the bundle** (electron-vite `externalizeDepsPlugin`)
  and `asarUnpack`ed in electron-builder — bundling it breaks its native
  loader at runtime.
- **No React StrictMode** (`main.tsx` comment) — double-mount would spawn two
  PTYs per node.
- **Undo/redo** (`state/history.ts`): debounced snapshots of the nodes array,
  skipped while typing in inputs/terminals.
- **Workspace persistence** (`core/workspace-files.ts` + `workspace-store.ts`):
  `<userData>/workspace.json` is the project index; folder projects persist to
  `<cwd>/.termsprawl/project.json` (git-shareable); cwd-less projects go to
  `<userData>/projects/<id>.json`. `saveNodes` returns a monotonic rev.

## Node kinds

Only `terminal` is implemented today (Phase 5 = MVP cut). The plan
(`PLAN.md`) adds sticky/group/editor/diff/chat, agents, source control, SSH
remote, Server Edition, then ports our own extras (Telegram, relay, chat
driver). Extend `NODE_TYPES` and the `data.kind` union in `state/workspace.ts`
when adding kinds.

## Tests

- `src/core/pty-manager.test.ts` — real node-pty integration: spawn/echo,
  exit events, tmux warm reattach, scrollback replay. These spawn real shells;
  give them generous timeouts.
- `src/core/workspace-store.test.ts` — persistence round-trips via temp dirs.
- `src/core/no-electron.test.ts` — guards the core boundary.
- Test stubs of `CorePlatform` must provide `userDataPath` (a temp dir) or the
  tmux config write fails.

## Legal rules (clean-room — non-negotiable)

This project exists because the prior fork (nodeterm-linux, BUSL-1.1) could
not shed its license. Therefore:

1. **Never copy** code, comments, structure, assets, or docs text from
   nodeterm-linux (or any other terminal-manager project). Ideas and features
   are free; expression is not.
2. Our own prior work (Telegram bot, relay service, provider-agnostic chat
   driver) is ours to port — but audit each file for imports that drag in
   upstream code (PLAN.md task 11.1).
3. `scripts/check-originality.py` diffs the tree against the prior project and
   fails on identical blocks ≥ 5 lines. Known-benign matches are documented in
   the script (library export names, channel names, generic CSS). Run it after
   significant changes; a FAIL is a hard stop, not a suggestion.
4. No use of the "nodeterm" name, logo, or branding.

## Conventions

- English everywhere: code comments, UI strings, identifiers.
- Path aliases: `@shared/*` (both tsconfigs), `@renderer/*` (web tsconfig).
- Dark UI: black surfaces, lime (`#c6f135`) only as functional signal,
  Geist/Geist Mono stack, dot-grid canvas.
- When in doubt about a phase's scope, read `PLAN.md` — it is the contract.
