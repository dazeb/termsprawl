# AGENTS.md — src/core

Electron-free service core. The heart of termsprawl — and the seam a future
Server Edition boots from.

## Contents

- `pty-manager.ts` — real PTY lifecycle via node-pty + tmux. `create()`
  returns `fresh` (cold start) vs warm reattach; `killAll()` detaches,
  `destroy()` kills the session.
- `tmux.ts` — tmux config generation and session plumbing. Copy-mode binds
  MUST use `send-keys -X` wrappers (see root AGENTS.md).
- `scrollback-store.ts` — byte-capped scrollback snapshot + replay with
  "session restored" separator.
- `workspace-store.ts` / `workspace-files.ts` — persistence: workspace.json
  project index, git-shareable `<cwd>/.termsprawl/project.json`, rev-monotonic
  `saveNodes`.
- `project-deletion.ts` / `terminal-close.ts` — lifecycle cleanup for projects
  and terminal nodes.
- `git-service.ts` — git operations for source-control features.
- `agent-status.ts`, `session-name.ts`, `command-resolver.ts`, `transcript.ts`
  — agent status aggregation, session-name sync, command resolution, transcripts.
- `platform.ts` — `CorePlatform` interface: `broadcast()` + `userDataPath`.
  Core talks to its shell ONLY through this.

## Rules (hard)

- **Never import `electron` here** — enforced by `no-electron.test.ts`.
- Tests are `*.test.ts` colocated; `CorePlatform` stubs must provide
  `userDataPath` (a temp dir) or the tmux config write fails.
- PTY integration tests spawn real shells — give them generous timeouts.

See ../../AGENTS.md for the process model, design decisions, and legal rules.
