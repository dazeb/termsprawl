# AGENTS.md — src/main

Electron main process.

## Contents

- `index.ts` — window creation, IPC wiring, dialogs, app lifecycle, and the
  `CorePlatform` implementation (the concrete side of the seam in src/core).
- `updates.ts` — electron-updater wrapper (GitHub Releases; no-op in dev).
- `agents/` — agent hook infrastructure (see its AGENTS.md).

## Rules

- Must never be imported by `src/core/` or `src/renderer/`.
- Preload builds as ESM (`../preload/index.mjs`); keep the reference correct —
  a stale `.js` path silently breaks the bridge in production.

See ../../AGENTS.md for the process model and key design decisions.
