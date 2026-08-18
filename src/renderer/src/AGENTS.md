# AGENTS.md — src/renderer/src

React application source.

## Contents

- `main.tsx` — React root (no StrictMode — see renderer AGENTS.md).
- `App.tsx` — top-level app shell.
- `env.d.ts` — types for `window.termsprawl` (the preload bridge).
- `monaco.ts` — Monaco editor setup (used by editor/diff nodes).
- `styles.css` — global styles: dark, lime `#c6f135` functional-only, Geist.
- `canvas/` — the React Flow canvas (single live source of truth for node state).
- `components/` — shared UI (TabBar).
- `nodes/` — node kinds: terminal, sticky, group, diff, editor.
- `state/` — renderer state: workspace helpers, history (undo/redo),
  projects store, agents store.

Each subdirectory has its own AGENTS.md. See ../../../AGENTS.md for design
decisions (React Flow single source of truth, stable node ids, undo/redo).
