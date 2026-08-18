# AGENTS.md — src/renderer/src/components

Shared UI components (non-node chrome).

## Contents

- `TabBar.tsx` — project tabs (one project per tab) and the in-app delete
  confirmation overlay. Confirmation dialogs live here — never
  `window.confirm` (Electron silently no-ops it).
- `FileTree.tsx` — hover a canvas edge to slide out one project file tree.
  Header icons: move left/right (single panel) and pin open.
- `UpdateToast.tsx` — packaged-app update notice (download / restart).
- `AppSettingsPanel.tsx` — app-wide settings (auto-download updates).
- `HelpBadge.tsx` — `?` next to titles; hover/focus/click opens a portaled
  explanation so node overflow cannot clip it.

## Rules

- Node-specific UI belongs in `nodes/`, not here.
- Any new confirmation UI must follow the `.confirm-overlay` in-app pattern.

See ../../../AGENTS.md for conventions.
