# Implementation plan — termsprawl

> **For Hermes:** implement task-by-task; use subagent-driven-development for
> task batches. Every task: TDD where feasible, exact commands, verify, commit.

**Goal:** build an independent, clean-room spatial terminal manager for Linux —
canvas, real terminals with tmux continuity, agents, editors, source control,
and our own extras (Telegram, relay) — with zero code from any prior project.
Linux first; better experience than competitors, including the feature set we
already added to the nodeterm fork.

**Architecture:** three-process Electron app (main / preload / renderer) with a
framework-free core behind a platform interface, so the same core also boots in
a plain Node server shell (Server Edition). The renderer talks to terminal
sessions only through a transport interface (local now, remote/SSH later).
tmux provides session continuity; React Flow drives the canvas; xterm.js renders
terminals; Monaco renders editors/diffs.

**Tech stack:** TypeScript, Electron, electron-vite, React, React Flow, xterm.js
(+ fit addon), node-pty, tmux (external), Monaco, zustand, vitest, electron-builder.

---

## Legal ground rules (Phase 0 enforced, applies forever)

1. **Do not copy** any code, comments, file structure, assets, or docs text
   from any existing terminal-manager project. Ideas, features, and design
   patterns are free to use; expression is not.
2. **Allowed to reuse:** third-party OSS libraries (xterm.js, React Flow,
   Monaco, node-pty, tmux as an external program) under their own licenses.
3. **Allowed as concepts only:** our own prior work **[own]** — the relay
   service, Telegram bot logic, and the provider-agnostic chat driver. Their
   *ideas* inform Phase 11 v2 designs, but **no file from the prior project is
   ever copied into termsprawl** — everything is written fresh (see
   `docs/OWN-WORK.md`).
4. Every phase ends with a **no-copy scan**: diff new files against the prior
   project's tree; any identical block > 5 lines is a red flag — rewrite it.
   (Script: `scripts/check-originality.sh`, task 0.4.)
5. No use of the "nodeterm" name, logo, or branding. Our own name + assets.
6. License choice is ours alone (see O-2) — no BUSL obligations apply to code
   we wrote.

---

## Phase 0 — Legal hygiene & repo setup

### Task 0.1: Choose project name
**DECIDED: `termsprawl`.** Verified free on npm, PyPI, crates.io, and GitHub
(no user/org/repo collision). Evokes the infinite-canvas product. Do not
rename again.

### Task 0.2: Choose license
**DECIDED: MIT.** Copyright (c) 2026 termsprawl contributors. Simple,
permissive, no obligations on our own code.

### Task 0.3: Repo hygiene files
- Create: `.gitignore` (node_modules, out, dist, *.log, .env)
- Create: `THIRD-PARTY-NOTICES.md` (policy: list every bundled dep + license;
  add to it as deps land)
- Create: `docs/ORIGINALITY.md` (this page's ground rules, short version)
- Verify: `git status` clean, `git commit -m "chore: repo hygiene"`

### Task 0.4: Originality check script
- Create: `scripts/check-originality.sh` — runs a block-diff of `src/`
  against the prior project path (configurable) and fails on identical blocks.
- Verify: run it on an empty tree → passes; touch a copy of a file → fails.

## Phase 1 — Scaffold

### Task 1.1: electron-vite + React + TS skeleton
- `npm create electron-vite` style scaffold in repo root (manual, no template
  from any other project), or hand-rolled config.
- Files: `package.json`, `electron.vite.config.ts`, `tsconfig.json` +
  `tsconfig.web.json`, `src/main/index.ts`, `src/preload/index.ts`,
  `src/renderer/index.html`, `src/renderer/src/main.tsx`.
- Verify: `pnpm run typecheck` clean; `pnpm run dev` opens a window.

### Task 1.2: Preload bridge skeleton
- Files: `src/preload/index.ts` exposing a narrow typed `window.termsprawl`
  API (starts empty, grows per phase); `src/shared/ipc.ts` for channel names
  (single source of truth); `src/shared/types.ts` shared types.
- Verify: renderer reads `window.termsprawl` version string; unit test on the
  channel-name module.

### Task 1.3: Commit
- `git commit -m "feat: scaffold electron-vite react app"`

## Phase 2 — Terminal MVP (minimal end-to-end)

Goal: one terminal node, real PTY, real input. **This is the vertical slice**
everything else hangs off.

### Task 2.1: PTY service in main
- Create: `src/core/pty-manager.ts` (spawn node-pty, write, resize, kill,
  per-node id). Plain class, no electron imports.
- Test: vitest spawns a pty, writes `echo hi`, asserts output. (`core` must
  stay electron-free — enforce with a `no-electron.test.ts` guard.)

### Task 2.2: Wire PTY data over IPC
- Create: `src/main/index.ts` handlers; channels `pty:create` / `pty:write` /
  `pty:resize` / `pty:data:<id>` / `pty:destroy`.
- Test: integration test asserts data flows main → renderer channel.

### Task 2.3: xterm node in renderer
- Create: `src/renderer/nodes/TerminalNode.tsx` — xterm + FitAddon in a
  draggable card; mounts once per node id (no StrictMode double-mount).
- Verify: dev app spawns a shell, typing works, resize works.

### Task 2.4: Hover guard
- Create: `src/renderer/nodes/hover-guard.tsx` — overlay until dwell timer.
- Verify: quick drag moves node; dwell gives terminal focus.

### Task 2.5: Commit
- `git commit -m "feat: terminal node with real pty"`

## Phase 3 — Canvas

### Task 3.1: React Flow canvas
- Create: `src/renderer/canvas/Canvas.tsx` — pan/zoom, node dragging, box
  select, delete with confirm dialog.
- Verify: manual — pan, zoom, drag, select, delete.

### Task 3.2: Context menu + add menu
- Create: `src/renderer/components/ContextMenu.tsx`, dock for add actions.
- Verify: pane right-click adds a terminal at cursor.

### Task 3.3: Undo/redo
- Create: `src/renderer/state/history.ts` — debounced snapshots, stacks.
- Verify: Ctrl+Z / Ctrl+Shift+Z across move/create/delete; skipped while typing
  in inputs/terminals.

### Task 3.4: Commit
- `git commit -m "feat: canvas interactions"`

## Phase 4 — tmux continuity

### Task 4.1: tmux-backed sessions
- Modify: `src/core/pty-manager.ts` — spawn inside `tmux new-session -A -D -s
  tc-<nodeId>` on a dedicated socket with a generated config (status off,
  mouse on, history, clipboard).
- Test: session survives pty kill; reattach redraws.

### Task 4.2: Cold-start scrollback
- Create: `src/main/scrollback-store.ts` — byte-capped snapshots per session,
  refreshed on timer + quit; replay on cold start with separator.
- Test: kill tmux server (simulated reboot), relaunch, output restored.

### Task 4.3: Destroy semantics
- Verify: node × runs `tmux kill-session`; app quit does NOT kill sessions.

### Task 4.4: Commit
- `git commit -m "feat: tmux session continuity"`

## Phase 5 — Projects & persistence

### Task 5.1: Project store
- Create: `src/core/workspace-store.ts` + `src/core/workspace-files.ts` —
  project index + per-project file (git-shareable, pretty-printed, portable
  relative cwds). Serialize node positions only (canvas is single source of
  truth for live state; store is serialization).
- Test: save → reload round-trips; corrupt file set aside, not dropped.

### Task 5.2: Tabs + project switch
- Create: `src/renderer/state/projects.ts`, `src/renderer/components/TabBar.tsx`.
- Verify: switch projects; terminals detach/reattach via tmux.

### Task 5.3: Close vs delete
- Close = detach + keep; delete (only from closed list) = destroy sessions.
- Verify: closed project reopens with live sessions.

### Task 5.4: Commit
- `git commit -m "feat: projects and persistence"`

**← MVP cut line. Phases 0–5 shipped = usable product. Everything after is
extension, one feature at a time.**

## Phase 6 — More node kinds

### Task 6.1: Sticky + group
- Sticky: colored note, collapsible. Group: real parent/child frame,
  group/ungroup transforms, label pill.
- Verify: group moves children; ungroup restores positions.

### Task 6.2: Editor node
- Monaco for a file path; fs read/write; language detect; Ctrl+S save; dirty
  dot; markdown preview; image preview for raster formats.

### Task 6.3: Diff node
- Monaco diff editor; staged vs unstaged via git show + fs read. Read-only.

### Task 6.4: Commit
- `git commit -m "feat: sticky, group, editor, diff nodes"`

## Phase 7 — Agents

### Task 7.1: Agent registry + spawn
- Create: `src/shared/agents/config.ts` — agent config keyed by open id
  (claude/codex/gemini/custom), capability lists, helpers. Agent node spawns
  CLI once via initialCommand.

### Task 7.2: Hook server + status
- Create: `src/main/agents/hook-server.ts` (loopback HTTP, per-session token,
  fail-open), installer registry, managed hook scripts per agent.
- Normalize each agent's hooks → shared state model (working/waiting/blocked/
  done) + subagent/recurring/session kinds.
- Verify: node shows RUNNING/NEEDS YOU badge.

### Task 7.3: Notifications + unread
- Unread dot on busy→idle while unfocused; OS notification; focus-node click.
- Verify: background agent completion → dot + notification.

### Task 7.4: Session name sync + branch
- Session name ⇄ node title (transcript reader, not OSC title); manual rename
  pushes `/rename`. Branch: `/branch` + new node resuming old session.

### Task 7.5: Context links
- Link file per node pair; CLI that parses transcript formats to print linked
  context; discovery markers per agent (skill / AGENTS.md marker block).

### Task 7.6: Managed accounts + permission mode
- Account list in settings; per-account config dirs; env injection with
  AUTH_ENV strip; login node flow. Permission-mode flag with CLI version gate.

### Task 7.7: Commit
- `git commit -m "feat: agent support"`

## Phase 8 — Source control

### Task 8.1: Git service
- Create: `src/core/git-service.ts` — system git + gh; repoRoot, status, diff,
  stage/unstage, discard, branch ops, commit, push/sync/publish, recent commits.

### Task 8.2: Panel
- Create: `src/renderer/components/SourceControlPanel.tsx` — file list,
  +/- stage, discard, commit box, branch UI, gh banner.
- Verify: full cycle in a test repo.

### Task 8.3: Worktrees bound to groups
- One worktree store/poller (epoch-guarded); creation dialog; scoped panel
  (scope = main checkout or bound worktree); reconciliation against
  `git worktree list`; destructive-safety rules.

### Task 8.4: AI commit messages + naming
- BYO local agent CLI spawned read-only on staged diff / captured output.

### Task 8.5: Commit
- `git commit -m "feat: source control"`

## Phase 9 — SSH remote projects

### Task 9.1: Remote transport
- ControlMaster-based SSH; remote tmux config; remote pty over ssh exec.
- Renderer keeps using the terminal transport interface — remote is a second
  implementation, canvas untouched.
- Verify: open project on a test host; terminal/git/file ops run remotely.

### Task 9.2: Commit
- `git commit -m "feat: ssh remote projects"`

## Phase 10 — Server Edition

### Task 10.1: Node shell + bridge
- Create: `src/server/` — plain `node:http` + `ws`, serves built renderer,
  WS-RPC protocol; browser shim fills the same API as the desktop preload.
- Boot same core services via a platform implementation.
- Verify: browser session opens project, runs terminals, sees agent status.

### Task 10.2: Commit
- `git commit -m "feat: server edition"`

## Phase 11 — Our own extras (rebuilt from scratch, better than the originals)

*Direction: we do NOT port code from the fork — not even files we wrote
there. The fork's extras (relay, Telegram bot, chat driver) are concepts we
originated; each is rebuilt from scratch against termsprawl's own core/shared,
with better features. `docs/OWN-WORK.md` is a design reference for those
concepts, not a porting source.*

### Task 11.1: Concept spec v2 (no code)
- Read `docs/OWN-WORK.md` for the feature concepts we originated in the fork
  (relay: GitHub device flow, host sessions, invite quotas, E2E relay frames;
  Telegram bot; provider-agnostic chat driver).
- Write v2 specs for each with better features than the fork had. Zero code
  is copied from the fork; every file is written fresh.

### Task 11.2: Relay service v2
- Build standalone: `relay/` — GitHub device flow, host sessions, invite
  quotas, E2E relay frames. Its own README.

### Task 11.3: Telegram bot v2
- Build local bot (no relay): commands: /terminals /attach /send /help.

### Task 11.4: Chat driver v2 (provider-agnostic)
- SDK chat node with streaming, permission cards, cost chip.

### Task 11.5: Commit
- `git commit -m "feat: rebuild own extras (relay, telegram, chat)"`

## Phase 12 — Packaging & release

### Task 12.1: electron-builder config
- AppImage + .deb for Linux; asar-unpack node-pty; icon.
- Verify: `npm run dist:linux` produces working artifacts (launch the .deb).

### Task 12.2: Auto-update + announcements
- GitHub Releases feed; update card; announce banner.

### Task 12.3: CI
- GitHub Actions: typecheck + test + build on PR; release on tag.

---

## Testing strategy

- Unit: vitest for core services (pty, workspace files, git ops, normalizers).
- Integration: IPC flow tests; tmux lifecycle tests (session survives kill,
  scrollback restores).
- Guard tests: `core` and `server` never import electron (no-electron tests).
- Manual: dev-app walkthrough per phase (listed in each phase's Verify line).
- Originality: `scripts/check-originality.sh` per phase.

## Verification commands (whole repo)

```bash
pnpm run typecheck   # fastest gate
pnpm test            # vitest suite
pnpm run build       # production build
pnpm run dist        # AppImage + .deb
```

## Risks & tradeoffs

- **Scope is large.** Mitigation: MVP cut at Phase 5; one phase at a time;
  subagent-driven batches per phase.
- **node-pty vs Electron ABI** — rebuild after install (postinstall hook),
  keep external in bundle. Known pitfall: bundling node-pty breaks its native
  loader; keep it external.
- **tmux version differences** (3.2 vs 3.4): clipboard/terminal-features
  behavior differs; pin minimum version, test on both.
- **WebGL context budget** for many terminals: viewport-scoped, budgeted
  contexts (cap ~12), DOM-renderer fallback. Defer until terminals > 8 work.
- **Server Edition auth** (Phase 10): single-user scrypt + httpOnly cookie +
  origin check; keep it simple, never expose the box.

## Open questions

- **O-1** ~~Final project name?~~ → **DECIDED: termsprawl**
- **O-2** ~~License~~ → **DECIDED: MIT**
- **O-3** Keep the hosted relay feature in v1, or ship desktop-only first and
  add relay later? (Scope knob — post-MVP decision.)
- **O-4** Minimum supported tmux version?
- **O-5** Electron vs Tauri: Electron chosen (node-pty + Monaco maturity);
  revisit only if a concrete constraint appears.
