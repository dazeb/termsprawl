# AGENTS.md — src/renderer/src/canvas

The canvas — React Flow wiring.

## Contents

- `Canvas.tsx` — the React Flow canvas. **The single live source of truth for
  node state** (no separate store mirroring nodes). Handles pan/zoom, node
  drag/select/delete, hover-guard (drag = move, dwell = focus), and emits
  layout changes for persistence.

## Rules

- Node ids are stable and load-bearing (PTY session id == tmux key ==
  persisted id). Never change an id's meaning.
- New nodes land on top of existing ones; persist close/archive/delete.
- Keep canvas logic here — don't mirror node state into `state/` stores.

See ../../../AGENTS.md for design decisions.
