# HERMES.md — termsprawl origin story & direction

*Hermes: read this to understand why this repo exists, where the ideas came
from, and where we're going. For operational rules (commands, architecture,
clean-room guard), read AGENTS.md in this repo; for the public roadmap and
current priorities, read ROADMAP.md.*

**Current state:** v0.28.0 (2026-09-18), pre-1.0, actively maintained by a
single maintainer. See [docs/PROJECT-HEALTH.md](docs/PROJECT-HEALTH.md) for the
current evidence snapshot and [CHANGELOG.md](CHANGELOG.md) for recent releases.

## Why this project exists

This is an **independent implementation**, born from a licensing dead end. The
story:

1. **The fork.** We forked [nodeterm](https://github.com/eneskirca/nodeterm)
   (by Enes Kirca, **BUSL-1.1** license) as `nodeterm-linux` and added real
   value on top: a Linux port (AppImage/.deb), Telegram bot integration, a
   hosted relay service with GitHub device auth, a provider-agnostic chat
   driver, free Pro features, Ctrl-based shortcuts.
2. **The wall.** BUSL-1.1 cannot be removed from the original author's code.
   The creator confirmed it: the license must stay on any fork. We could
   modify, but the modified work stays BUSL-1.1, and the Additional Use Grant
   bars offering it hosted or as a standalone product that competes with his.
   Stripping the LICENSE doesn't free the code — it just makes us infringers.
3. **The decision.** Rather than live under someone else's license forever, we
   started fresh: **termsprawl**, MIT, written from scratch — built from the
   same *ideas* — which are free — without reusing his *expression* — which is
   not.

## Where the inspiration comes from

The concept we're building toward is the same one that made nodeterm good:
**terminals as places on an infinite canvas, not stacked tabs.** Spatial
layouts help people with scattered workflows (ADHD-friendly by design).
Beyond that core idea, the feature set is a wish-list we compiled ourselves —
the canvas of terminals, tmux continuity, agent nodes, editors, source
control — plus the features **we** invented in the fork (Telegram, relay,
provider-agnostic chat), which are ours and ours alone.

## Originality policy (no absolute claim)

termsprawl's code is written from scratch, and every contribution must be too
(this is enforced in review and stated in CONTRIBUTING.md and AGENTS.md).

An automated similarity screen — `scripts/check-originality.py`, run via
`./scripts/check-originality.sh` — compares this repository's source files
against the prior project's tree and FAILs on any identical block of 5 or more
consecutive non-trivial lines that appears in the same prior file. Trivial
lines (blank, punctuation-only, shorter than 8 characters) are ignored, and
known-benign generic matches are recorded as reviewed, not fatal. The screen
was last run on 2026-09-18: 273 source files scanned against 546 prior files,
no copied blocks found, one known-benign generic CSS block reviewed (see
[docs/VERIFICATION.md](docs/VERIFICATION.md)).

**Limits:** it is a textual heuristic, not a legal opinion and not proof of
originality. It cannot detect paraphrased copying, copied ideas, or copied
structure written with different identifiers; it compares only against the one
prior tree; and it is skipped (with a warning) when that tree is absent, so a
pass with the prior checkout missing means nothing. CI does not run it. The
project therefore describes itself as an *independent implementation screened
for textual similarity against the prior project* — not as "100% original".

If you are ever unsure whether something is too close to another project,
rewrite it from the idea. When in doubt, assume it is and start over.

## Where we are

- **The plan is complete through Phase 19** (see PLAN.md, which is the
  historical implementation record): scaffold; terminal node with real PTY;
  canvas; tmux continuity with cold-start scrollback replay; projects and
  git-shareable project files; sticky/group/editor/diff nodes; agents with
  hooks, managed accounts, and context links; source control; SSH remote
  projects; Server Edition; the rebuilt extras (relay, Telegram bot,
  provider-agnostic chat); packaging, auto-update and CI; browser nodes;
  workspace bundles; node links; A2A.
- **Verification is public.** The current gate results, the test categories,
  what was skipped, and the self-audit provenance are recorded in
  [docs/VERIFICATION.md](docs/VERIFICATION.md). The two audits in `docs/` are
  maintainer self-audits, not independent reviews.
- **The public trust layer is in place**: SECURITY.md, CONTRIBUTING.md,
  GOVERNANCE.md, CODE_OF_CONDUCT.md, ROADMAP.md, FUNDING.md, CHANGELOG.md, and
  this file's companions. A repository test (`scripts/trust-surface.test.ts`)
  keeps those files and their key claims intact.

## Where we're going

The public roadmap — current maintenance priorities, near-term work, the
funding-dependent work packages, 1.0 readiness criteria, and non-goals — is
[ROADMAP.md](ROADMAP.md). This file deliberately does not duplicate it: the
phase list in PLAN.md is history, and roadmap items change.

Two things stay fixed: **Linux only** — no macOS or Windows support, ever (the
fork's macOS phone relay is a dead end; the Telegram bot covers that use case)
— and **MIT with no proprietary core**.

## Working here

- Plan is the contract: `PLAN.md` (phases, tasks, verification) is the
  historical record; `ROADMAP.md` is what is next. Spec: `docs/FEATURES.md`.
  Operations: `AGENTS.md`.
- Keep the clean-room rule sacred: independent implementation, screened — see
  the originality policy above.
- When you finish a phase or fix a real bug, update PLAN.md's status and
  commit — this file exists so the next session doesn't have to re-derive
  context we already paid for.
- User-visible changes update the docs in the same task (AGENTS.md cross-repo
  rules).
