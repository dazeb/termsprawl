# HERMES.md — termsprawl origin story & direction

*Hermes: read this to understand why this repo exists, where the ideas came
from, and where we're going. For operational rules (commands, architecture,
clean-room guard), read AGENTS.md in this repo.*

## Why this project exists

This is a **clean-room rebuild**, born from a licensing dead end. The story:

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
   started fresh: **termsprawl**, MIT, 100% our own code, built from the same
   *ideas* — which are free — without a single line of his *expression* —
   which is not.

## Where the inspiration comes from

The concept we're building toward is the same one that made nodeterm good:
**terminals as places on an infinite canvas, not stacked tabs.** Spatial
layouts help people with scattered workflows (ADHD-friendly by design).
Beyond that core idea, the feature set is a wish-list we compiled ourselves —
the canvas of terminals, tmux continuity, agent nodes, editors, source
control — plus the features **we** invented in the fork (Telegram, relay,
provider-agnostic chat), which are ours and ours alone.

Nothing in this repo is copied from nodeterm or any other project. The
originality check (`scripts/check-originality.py`) diffs against the fork's
tree and FAILs on any identical block ≥ 5 lines. That is a hard stop, not a
suggestion. See AGENTS.md → Legal rules.

## Where we are (as of the MVP cut)

- **Phases 0–5 shipped** (PLAN.md is the contract): scaffold, terminal node
  with real PTY, canvas (drag/pan/zoom/undo), tmux session continuity with
  cold-start scrollback replay, projects & persistence with git-shareable
  project files.
- **Working end-to-end**, verified by tests + packaged boot: 13 vitest tests,
  typecheck clean, AppImage builds and runs.
- **Packaging done**: `pnpm run dist` → AppImage + .deb, icon generator, all
  committed.

## Where we're going

- **Phase 6** — sticky / group / editor / diff nodes (next up).
- **Phase 7** — agents: registry + capability lists, hook server + status
  badges, notifications, session-name sync, branch, context links, managed
  accounts. This is where our differentiators live.
- **Phase 8** — source control panel, worktrees bound to groups, AI commit
  messages.
- **Phase 9** — SSH remote projects.
- **Phase 10** — Server Edition (browser) via the platform seam.
- **Phase 11** — port our own extras: relay service, Telegram bot, chat
  driver (audit is pre-done in docs/OWN-WORK.md — our fork files are marked
  pure-ours vs entangled, with seams listed).
- **Phase 12** — release polish, auto-update, CI.

The goal: a **better experience than the competitors**, including the feature
set we already added to nodeterm-linux — but owned outright, MIT, and built
on our own decisions.

## Working here

- Plan is the contract: `PLAN.md` (phases, tasks, verification). Spec:
  `docs/FEATURES.md`. Operations: `AGENTS.md`.
- Keep the clean-room rule sacred. When in doubt about whether something is
  copied, assume it is and rewrite it.
- When you finish a phase or fix a real bug, update PLAN.md's status and
  commit — this file exists so the next session doesn't have to re-derive
  context we already paid for.
