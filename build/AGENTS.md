# AGENTS.md — build

electron-builder build resources.

## Contents

- `icon.png` — the app icon (used for AppImage/.deb packaging).
  Regenerate with `pnpm run make-icon` (runs `scripts/make-icon.mjs`).

## Rules

- Tracked in git despite `build/` being gitignored — the exception is
  declared in `.gitignore` (`!build/icon.png`). Do not "fix" the ignore line
  without keeping the icon in the repo: packaging needs it.

See ../AGENTS.md for repo-wide conventions and legal rules.
