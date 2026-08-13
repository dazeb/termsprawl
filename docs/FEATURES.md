# Feature spec — termsprawl

The target feature set, written fresh from requirements (not from any existing
source). Items marked **[own]** were originally written by us for the prior
project and are ours to reuse; everything else is built new from scratch.

## 1. Canvas

- Infinite pan/zoom canvas (React Flow or equivalent graph library).
- Nodes are draggable, selectable, box-selectable, deletable.
- Node kinds: terminal, agent, chat, sticky, group, editor, diff, web/video.
- Right-click context menu (pane: add nodes; node: group/color/duplicate/delete).
- Command palette (Ctrl+K), undo/redo (Ctrl+Z / Ctrl+Shift+Z).
- Dark theme, dot-grid background, configurable accent color.

## 2. Terminals & sessions

- Each terminal node runs a real PTY (`node-pty` or equivalent) inside a
  persistent `tmux` session, so sessions survive node remounts and app restarts.
- xterm.js renderer; wheel scrolls tmux history; tmux copy-mode selection;
  OSC 52 clipboard support.
- Cold-restart scrollback replay ("session restored" marker).
- Resize via FitAddon; stable cols/rows across canvas zoom (CSS transform).
- Hover-guard overlay so drag = move node, dwell = focus terminal.
- Markdown render of captured output (Ctrl+M).
- Link detection: URLs → browser, file paths → editor.

## 3. Projects & persistence

- Tabs, one project per tab; each project is a canvas with its own folder (cwd).
- Layout persisted per project (git-shareable project file), index of projects.
- Closing a project detaches terminals; tmux sessions keep running.
- Reopen restores nodes and reattaches sessions.

## 4. Agents (Claude / Codex / Gemini / custom)

- Agent node = terminal preset that launches an agent CLI once.
- Registry of agents + capability lists (hooks, resume, subagents, recurring,
  branch, context-link, usage, chat, permission-mode).
- Hook-driven status: RUNNING / NEEDS YOU badges, unread dots, notifications.
- Subagent cards with live transcript; context-window meter.
- Session name sync (agent name ⇄ node title); Branch conversation (Claude).
- Context links between agent nodes (read each other's transcripts on demand).
- Managed accounts (per-account config dirs, Claude).
- Permission mode selection with CLI version gating.

## 5. Chat node **[own concept, reimplemented]**

- SDK-driven chat (not a PTY): streaming, permission cards, stop, thinking
  blocks, slash commands, image paste, diff cards, cost chip.
- Provider-agnostic LLM driver (our own design — original was Claude-only SDK;
  ours supports multiple providers).
- Resume-based continuity via persisted session id.

## 6. Source control

- Panel with stage/unstage, discard, diff nodes, branch switch/create, commit,
  push/sync/publish, gh sign-in, recent commits.
- Worktrees bound to group frames.
- AI commit messages + terminal naming via BYO local agent CLI.

## 7. Remote / SSH projects

- Open a project on a remote host over SSH; terminals, files, git run there,
  canvas stays local.
- Reuse the terminal transport abstraction so remote sessions drop in without
  touching canvas code.

## 8. Server Edition (browser) **[own direction, reimplemented]**

- Plain Node `http` + `ws` serve the built renderer; a browser-side shim fills
  the same API the desktop preload exposes.
- Same core services booted from a Node shell via a platform seam.

## 9. Extras **[own]**

> Inventory of exactly which prior-project files are ours (and which are
> entangled) lives in `docs/OWN-WORK.md` — consult it before porting.

- Telegram bot: control terminals from the phone (list, attach, send). Local,
  no relay needed.
- Hosted relay foundation: GitHub device-flow auth, host sessions, invite
  quotas, E2E-encrypted relay frames.
- Auto-update + announcements feed.

## 10. Platform

- Linux desktop builds (AppImage + .deb), Ctrl-based shortcuts.
- Node 20+ and tmux required.
