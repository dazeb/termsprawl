# AGENTS.md — src/renderer

Electron renderer root (Vite entry).

## Contents

- `index.html` — Vite HTML entry.
- `src/` — the React app (see src/AGENTS.md).

## Rules

- Talks to main ONLY through `window.termsprawl` (typed in
  `src/renderer/src/env.d.ts`). Never import `electron` or `ipcRenderer`.
- No React StrictMode (double-mount would spawn two PTYs per node).
- Never use `window.confirm`/`alert`/`prompt` — Electron silently no-ops them;
  use in-app dialogs.

See ../../AGENTS.md for the process model and design decisions.
