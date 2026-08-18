# AGENTS.md — src/renderer/src/state

Renderer-side state helpers and stores.

## Contents

- `workspace.ts` — pure helpers: node factories + `serializeNodes`/
  `deserializeNodes`. NOT a node-state mirror (the canvas owns live state).
- `history.ts` — undo/redo: debounced snapshots of the nodes array, skipped
  while typing in inputs/terminals.
- `edge-reveal.ts` — pure helpers for the edge-hover file tree (hot zone +
  keep-open).
- `projects.ts` — project store: tabs, per-project settings, deletion flow.
- `agents.ts` — agent registry/status UI state.
- `*.test.ts` — unit tests (history, projects, workspace).

## Rules

- Keep `workspace.ts` pure (no Electron, no DOM) so it stays unit-testable.
- When adding a node kind: factory here + `NODE_TYPES` here + `data.kind`
  union in src/shared/types.ts.

See ../../../AGENTS.md for conventions.
