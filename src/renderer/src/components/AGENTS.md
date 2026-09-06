# AGENTS.md — src/renderer/src/components

Shared UI components (non-node chrome).

## Contents

- `TabBar.tsx` — project tabs (one project per tab) and the in-app delete
  confirmation overlay. Confirmation dialogs live here — never
  `window.confirm` (Electron silently no-ops it).
- `FileTree.tsx` — hover a canvas edge to slide out one project file tree.
  Header icons: move left/right (single panel) and pin open.
- `UpdateToast.tsx` — packaged-app update notice (download / restart).
- `AppSettingsPanel.tsx` — app-wide settings as a full-width sheet: a head row
  (title + close), a left sidebar nav (`General` / `User` / `Agents` /
  `Connections` / `Updates`), and a scrollable content column, grouped by
  termsprawl domain. The panel renders with the shared UI kit in
  `ui/` (Button, Toggle, Select, TextInput, PrefRow, …) styled by
  Tailwind v4 utilities (tokens in `src/renderer/src/settings.css`) — neutral
  palette, no lime. General holds the preference rows (agent preset, default
  permission, appearance, enter behavior); User & cloud holds display name +
  Termsprawl Cloud sign in / back up; Agents holds the primary agent list +
  managed accounts; Connections holds A2A peers + API providers + Telegram +
  Relay + chat models; Updates holds auto-download. Theme choices are
  persisted and applied via `state/theme.ts`. Closes on Escape / backdrop
  click.
- `CogMenu.tsx` — toolbar cog button that opens the app settings sheet
  directly. (The old source-control/settings dropdown was removed — source
  control lives in the sidebar open via the canvas-edge hover; see `FileTree`.)
- `HelpBadge.tsx` — `?` next to titles; hover/focus/click opens a portaled
  explanation so node overflow cannot clip it.

## Rules

- Node-specific UI belongs in `nodes/`, not here.
- Any new confirmation UI must follow the `.confirm-overlay` in-app pattern.

See ../../../AGENTS.md for conventions.
