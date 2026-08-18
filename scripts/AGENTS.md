# AGENTS.md — scripts

Development/verification tooling. Not shipped in the app.

## Contents

- `check-originality.py` / `check-originality.sh` — clean-room guard. Diffs the
  tree against the prior project and FAILs on identical blocks >= 5 lines.
  Run after significant changes; a FAIL is a hard stop.
- `make-icon.mjs` — regenerates `build/icon.png` (`pnpm run make-icon`).
- `test-live-hooks.sh` — live hook-server gate: boots the app, POSTs lifecycle
  events, verifies fail-open behavior. Manual integration check.

## Rules

- Never weaken check-originality — it is the license escape-hatch guard.
- `__pycache__/` is gitignored; don't commit it.

See ../AGENTS.md for repo-wide conventions and legal rules.
