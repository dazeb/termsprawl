# AGENTS.md — src/renderer/src/components

Shared UI components (non-node chrome).

## Contents

- `TabBar.tsx` — project tabs (one project per tab) and the in-app delete
  confirmation overlay. Confirmation dialogs live here — never
  `window.confirm` (Electron silently no-ops it).

## Rules

- Node-specific UI belongs in `nodes/`, not here.
- Any new confirmation UI must follow the `.confirm-overlay` in-app pattern.

See ../../../AGENTS.md for conventions.
