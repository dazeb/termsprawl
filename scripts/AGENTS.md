# AGENTS.md — scripts

Development/verification tooling. Not shipped in the app.

## Contents

- `check-originality.py` / `check-originality.sh` — clean-room guard. Diffs the
  tree against the prior project and FAILs on identical blocks >= 5 lines.
  Run after significant changes; a FAIL is a hard stop. It is a heuristic, not
  a legal guarantee — see docs/VERIFICATION.md for methodology and limits.
- `trust-surface.test.ts` — repository policy test (runs in the normal vitest
  suite). Asserts the public trust documents exist, that maturity wording is
  pre-1.0, that the audits are labelled self-audits, that no `.github/workflows`
  or absolute originality/revenue claims exist, that links resolve, that
  machine-specific infrastructure details stay out of tracked docs, and that
  package metadata is present. Run it alone with
  `pnpm test scripts/trust-surface.test.ts` after editing any trust document.
- `make-icon.mjs` — regenerates `build/icon.png` (`pnpm run make-icon`).
- `test-live-hooks.sh` — live hook-server gate: boots the app, POSTs lifecycle
  events, verifies fail-open behavior. Manual integration check.
- `run-dev-nosandbox.sh` — container/CI dev launcher. Termsprawl can't boot
  when the root fs is read-only (`$HOME/.config` EROFS) or chrome-sandbox isn't
  setuid (no-new-privileges), so this redirects `HOME`/`XDG_*` to a writable
  project-local `.runtime` and sets `ELECTRON_DISABLE_SANDBOX=1`. Dev only —
  never ship it as the production launcher (production keeps the SUID sandbox).

## Rules

- Never weaken check-originality — it is the license escape-hatch guard.
- `__pycache__/` is gitignored; don't commit it.

See ../AGENTS.md for repo-wide conventions and legal rules.
