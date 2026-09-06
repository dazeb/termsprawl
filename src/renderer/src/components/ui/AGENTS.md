# AGENTS.md — src/renderer/src/components/ui

The app's shared component library (internal — deliberately no third-party UI
framework; see rules). One file: `kit.tsx` + Tailwind v4 utilities (tokens in
`src/renderer/src/settings.css`).

## Contents

- `kit.tsx` — the control kit: `Section`, `PrefRow`, `Row`, `FieldRow`,
  `Button` (neutral / primary / danger + armed, `size` md|sm), `Toggle`
  (role=switch), `Select`, `TextInput` / `TextArea` (grow prop), `Card`,
  `Hint`, `Status`.

## Rules

- Styled **only** with Tailwind v4 utilities. Never reintroduce `.settings-*`
  classes from `styles.css` here — unlayered CSS beats the utilities layer,
  so mixed styling silently wins over Tailwind.
- Neutral palette: emphasis is ink-on-page, `#e06c75` red is reserved for
  destructive states. No lime — the canvas owns lime (node chrome, context
  menus, chat input buttons keep their `.styles.css` lime styling).
- The `.settings-btn` / `.settings-modal-close` classes in `styles.css`
  belong to OTHER components (LinkInspector, AnnouncementBanner). Don't reuse
  them here; use the kit.
- Use the kit for any NEW control in the renderer (menus, forms, buttons).
  Existing descendant-CSS surfaces (context menus, node headers, source
  control) are working and stay as-is; migrate a surface only when it is
  broken or being rebuilt.
- `kit.tsx` needs `import React from 'react'` (value import) — vitest uses
  the legacy JSX transform and throws "ReferenceError: React is not defined"
  without it (same as Onboarding.tsx).
- Panel layout JSX (sheet shell, nav, theme cards) lives in
  `AppSettingsPanel.tsx` one level up and uses Tailwind classes directly.

See ../../../AGENTS.md for renderer conventions.
