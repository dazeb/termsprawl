# AGENTS.md — src/renderer/src/components

Shared UI components (non-node chrome).

## Contents

- `TabBar.tsx` — project tabs (one project per tab) and the in-app delete
  confirmation overlay. Confirmation dialogs live here — never
  `window.confirm` (Electron silently no-ops it).
- `FileTree.tsx` — hover a canvas edge to slide out one project file tree.
  Header icons: move left/right (single panel) and pin open.
- `UpdateToast.tsx` — packaged-app update notice (download / restart).
- `AppSettingsPanel.tsx` — app-wide settings as a full-width sheet
  (`settings-sheet`): a head row (title + open-config + close), a left sidebar
  nav (`General` / `User` / `Agents` / `Connections` / `Updates`), and a
  scrollable content column, grouped by termsprawl domain. General holds the
  preference rows (agent preset, default permission, language, appearance,
  enter behavior); User & cloud holds display name + Termsprawl Cloud sign
  in / back up; Agents holds the primary agent list + managed accounts;
  Connections holds A2A peers + API providers; Updates holds auto-download.
  Theme choices are persisted and applied via `state/theme.ts`. Closes on
  Escape / backdrop click.
- `CogMenu.tsx` — toolbar cog button + dropdown (source control / settings).
  Closes on Escape or outside click; source control is disabled without a
  folder project.
- `HelpBadge.tsx` — `?` next to titles; hover/focus/click opens a portaled
  explanation so node overflow cannot clip it.

## Rules

- Node-specific UI belongs in `nodes/`, not here.
- Any new confirmation UI must follow the `.confirm-overlay` in-app pattern.

See ../../../AGENTS.md for conventions.
