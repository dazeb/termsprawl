# AGENTS.md — src/renderer/src/nodes

Canvas node kinds. Extend `NODE_TYPES` (state/workspace.ts) + the `data.kind`
union (src/shared/types.ts) when adding a new kind.

## Contents

- `TerminalNode.tsx` — xterm.js terminal node: PTY attach, tmux continuity,
  hover-guard overlay, resize via FitAddon, right-click passthrough to tmux.
- `StickyNode.tsx` — note/scratchpad node.
- `GroupNode.tsx` — group frame node (Phase 6).
- `DiffNode.tsx` — Monaco-based diff viewer node (Phase 6).
- `EditorNode.tsx` — Monaco editor: open/save via file-service IPC, dirty
  dot, markdown preview (`marked`), image preview via `termsprawl-file://`.

## Rules

- Terminal node id == PTY session id == tmux session key — never change it.
- Node React components are thin: real work happens in src/core via
  `window.termsprawl`; renderer never touches IPC directly.

See ../../../AGENTS.md for design decisions.
