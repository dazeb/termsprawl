# AGENTS.md — src/shared

Types + IPC channel names shared across processes.

## Contents

- `ipc.ts` — the single source of truth for IPC channel strings (workspace,
  pty, files, agent hooks, context links, managed accounts). Never hardcode a
  channel elsewhere.
- `types.ts` — shared type definitions (node kinds, workspace shapes, context
  link pairs, agent accounts + app settings).
- `file-url.ts` — `termsprawl-file://local/...` preview URL helpers.
- `agent-status.ts` — agent status/notification types (shared with hook server).
- `agents/config.ts` — agent registry/preset config (Claude/Codex/Gemini/Grok).

## Rules

- Must stay Electron-free — imported by core and renderer alike.
- When adding a node kind, extend the union here AND in
  `src/renderer/src/state/workspace.ts`.

See ../../AGENTS.md for repo-wide conventions.
