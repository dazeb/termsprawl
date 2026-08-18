# AGENTS.md — src/preload

The only bridge between renderer and main.

## Contents

- `index.ts` — exposes a narrow, typed `window.termsprawl` API via
  `contextBridge`, backed by IPC channels from `src/shared/ipc.ts`.

## Rules

- The renderer must never touch `ipcRenderer` directly.
- Builds as `index.mjs` (ESM). The main process references
  `../preload/index.mjs`, NOT `.js` — a stale path silently breaks the bridge
  in production builds.

See ../../AGENTS.md for the process model.
