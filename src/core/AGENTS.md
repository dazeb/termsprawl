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
- `file-service.ts` — editor-node read/write/classify and project folder
  listings (`listProjectDir` stays inside the root; skips dotfiles,
  node_modules, .git).
- `app-settings.ts` — app-wide settings.json (auto-download updates).
- `git-service.ts` — git operations for source-control features.
- `agent-status.ts`, `session-name.ts`, `command-resolver.ts`, `transcript.ts`
  — agent status aggregation, session-name sync, command resolution, transcripts.
- `context-links.ts`, `transcript-index.ts`, `context-cli.ts`,
  `context-discovery.ts` — context links between agent nodes: ordered-pair link
  files, per-node transcript path index, the standalone `termsprawl-context`
  CLI (bundled to `scripts/termsprawl-context.mjs`), and the project-local
  discovery markers (skill + AGENTS.md block).
- `agent-accounts.ts`, `agent-cli.ts` — managed agent accounts (config dirs
  under userData/accounts, auth-env strip) and CLI `--help` probes
  (permission-mode / login command).
- `platform.ts` — `CorePlatform` interface: `broadcast()` + `userDataPath`.
  Core talks to its shell ONLY through this.

## Rules (hard)

- **Never import `electron` here** — enforced by `no-electron.test.ts`.
- Tests are `*.test.ts` colocated; `CorePlatform` stubs must provide
  `userDataPath` (a temp dir) or the tmux config write fails.
- PTY integration tests spawn real shells — give them generous timeouts.

See ../../AGENTS.md for the process model, design decisions, and legal rules.
