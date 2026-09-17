# Implementation plan — termsprawl

> **For Hermes:** implement task-by-task; use subagent-driven-development for
> task batches. Every task: TDD where feasible, exact commands, verify, commit.

**Goal:** build an independent, clean-room spatial terminal manager for Linux —
canvas, real terminals with tmux continuity, agents, editors, source control,
and our own extras (Telegram, relay) — with zero code from any prior project.
**Linux only** (no macOS-specific features); better experience than
competitors, including the feature set we already added to the nodeterm fork.

**Architecture:** three-process Electron app (main / preload / renderer) with a
framework-free core behind a platform interface, so the same core also boots in
a plain Node server shell (Server Edition). The renderer talks to terminal
sessions only through a transport interface (local now, remote/SSH later).
tmux provides session continuity; React Flow drives the canvas; xterm.js renders
terminals; Monaco renders editors/diffs.

**Tech stack:** TypeScript, Electron, electron-vite, React, React Flow, xterm.js
(+ fit addon), node-pty, tmux (external), Monaco, zustand, vitest, electron-builder.

---

## Current stage — updated 2026-09-16

The roadmap has reached Phase 19 (A2A communication). Work is now focused on
settings usability, node-link reliability, and release verification. The phase
sections below retain their historical implementation and verification records;
they are not evidence of fresh test runs or the current deployment state.

Recent completed implementation:
- Agent workspace tools (2026-09-17): agents launched by termsprawl now receive
  a shared, Electron-free operation service with two clients — a stdio MCP
  bridge and the bundled `termsprawlctl` helper — so one implementation serves
  every preset. Connections bind to an app instance, project and agent node,
  and the service validates access itself (a caller-supplied node ID is not
  authorization). Canvas mutations route through React Flow's existing state
  owner with request/response acknowledgements rather than a second node store.
  Launch preparation picks an adapter from the executable's own advertised
  capabilities, never its display name, and unverified mechanisms report
  **Needs setup** instead of claiming success. Managed runtime files are
  installed under app user data at 0600/0700. Verified: typecheck clean; 1,094
  tests pass across 114 files; originality gate OK (265 files vs 546 prior, one
  known-benign CSS block); production build plus AppImage and `.deb`; the new
  Electron smoke test passes end to end with two agents (launch identity,
  bundled-runtime `doctor`, MCP initialize/tools-list/tool-call, browser
  navigate/type/click/screenshot with cross-agent ownership refusal and explicit
  transfer, terminal submit/read, external window leaving the canvas attached,
  session close, canvas persistence) and its restart phase confirms a relaunch
  keeps the pane PID and credential digest while issuing a new instance ID. A
  packaged boot reads the helper out of the asar into user data byte-identically.
  Gitea `verify` run #179 passed on the merge commit. Not yet released; remote
  SSH and Server Edition transport are deferred, and transcript reading is
  advertised only for Claude transcripts. Docs are prepared on a branch, not
  deployed.
- Shared browser sessions (2026-09-16): sandboxed sign-in popups use the
  canvas browser profile; authenticated agent cookie read/write/clear commands
  operate on that same profile. New browsers open at 1000×720 with no resize
  maximum. Real Electron sign-in, restart persistence, and Playwright
  cookies/addCookies/storageState checks pass. Shipped in 0.26.0.
- Canvas menu refresh (2026-09-16): enabled agents are direct actions with
  monochrome logos (OpenClaude uses an original monogram), grouped above
  creation tools and selection actions. Keyboard navigation, dismissal,
  viewport clamping, and small-window scrolling verified in a browser preview.
  Matching agent/canvas docs updated. Shipped in 0.26.0.
- Agent-launch repair (2026-09-16): new agent terminals start their CLI as
  the tmux pane process instead of sending startup keystrokes before attach.
  Warm reattachment preserves the running agent; SSH presets resolve on the
  remote host. Regression reproduced before the fix; typecheck and all 1,033
  tests pass after it. Shipped in 0.26.0.
- Settings capability discovery and usage views, including truthful unsupported
  states for Server Edition and general terminal settings (0.25.3-era work).
- Capability pages backed by CLI data (`d77630a`), followed by Plugins and
  Subagents pages backed by CLI caches/configuration (`82e247f`).
- Settings-panel performance and card-outline polish (`3f526c9`).
- Link inspector synchronization and automatic link execution repairs across
  desktop and Server Edition (`e00e7a8`).

Release state verified on 2026-09-16: **0.26.0 is shipped.** Gitea `main` and
tag `v0.26.0` both resolve to `18dd668dc421255cb683c43238ff3322e1801212` on all
three remotes (origin / github / gitea), matching the local version-bump
commit. The Gitea `verify` and `release` jobs for that tag succeeded, and the
AppImage, `.deb`, and `latest-linux.yml` were read back from **both** the Gitea
release and GitHub Releases with matching sizes; the GitHub download URLs
return 200 and `latest-linux.yml` reports `version: 0.26.0`. The marketing site
is live at `APP_VERSION` 0.26.0 (every route 200, live bundle contains the
version) and the docs deploy run for the matching content commit succeeded,
with the new agent names present on the live pages.

Release blocker found and fixed while verifying: the first `release` job for
`v0.26.0` failed its `publish gitea release` step (`curl: (22)` → HTTP 500)
because Gitea CT 100's root filesystem was **100% full** (7.4G/7.8G, 45M free).
Gitea's own SQLite writes failed with `database or disk is full (13)`, so it
never recorded the failure and the run stayed "running" in the UI. The CT
rootfs was grown 8G → 16G (`pct resize 100 rootfs +8G`, non-destructive, no
snapshots present) and the tag was re-pushed to Gitea to re-trigger the
idempotent publish; that run published to both destinations cleanly. The stale
run #175 record on Gitea was left as-is (harmless) — it cannot be corrected
retroactively. **Watch CT 100 disk headroom before every release**; the 6.3G of
Gitea release attachments is what fills it.

Next release work:
- Agent workspace tools is the current unreleased scope on `main`. Before it
  ships: deploy the matching docs (they are committed on `codex/astra` in
  `termsprawl-docs`, not on `main`, because that repo auto-deploys on a push to
  `main` and this feature is not in a released build yet), and decide whether
  the feature warrants a marketing blurb on termsprawl.com.
- Deferred within that scope: remote SSH and Server Edition transport, and
  transcript reading beyond Claude. The design note for the feature lives
  outside the repo (`~/.codex/plans/`, "Automatic agent integration for
  termsprawl"); its remaining acceptance items are the per-agent real-launch
  smoke tests and the two-agent concurrency exercise, which the Electron smoke
  test covers in fixture form rather than against each installed CLI.
- No further phase is defined beyond this; choose the next scope explicitly.

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
- Close = detach + keep; delete (active tab or stored list) = destroy sessions.
- Verify: closed project reopens with live sessions.
- Delete removes Termsprawl's project metadata and terminal sessions, never the
  selected project folder or its contents. Active-tab and stored-project delete
  flows are covered by real-input Electron verification.

### Task 5.4: Commit
- `git commit -m "feat: projects and persistence"`

**← MVP cut line. Phases 0–5 shipped = usable product. Everything after is
extension, one feature at a time.**

## Phase 6 — More node kinds

> **Delivery workflow (user-approved 2026-08-13):** each major commit ends
> with an AppImage checkpoint — build, upload to files.dazeb.dev
> (r2-file-upload skill), send the link to the default Telegram channel with
> "what to test" notes; the user tests on their machine and reports what
> worked. Detailed plan: `.hermes/plans/2026-08-13_phase6-node-kinds.md`.

### Task 6.1: Sticky node
- Colored note (muted palette fitting the dark theme), double-click to edit
  text, collapse toggle, drag by header, persists via project file.
- AppImage checkpoint 1.
- **Status: DONE (commit c1bd6fd, checkpoint 1 AppImage built + uploaded).**
  **User test 2026-08-13: "sticky notes work" — verified.**

### Task 6.2: Group node
- Real parent/child frames (React Flow parentId): select ≥2 nodes → group;
  drag frame moves children; ungroup restores absolute positions; label pill;
  deleting a group ungroups children (terminals keep their tmux sessions).
- AppImage checkpoint 2.
- **Status: BUILT + DELIVERED (commit 50effe9, v0.2.1, Telegram msg 7874).**
  Packaged E2E: group 2 stickies → frame sized to children → frame drag moved
  both children → label renamed → ungroup preserved both positions; zero
  renderer errors. Awaiting user test on target machine.

### Task 6.3: Editor node
- Monaco (local, no CDN; vite `?worker` workers): open file via dialog,
  fs read/write through a new electron-free `core/file-service.ts` + IPC,
  language detect by extension, Ctrl+S save, dirty dot, markdown preview
  (marked), image preview via `termsprawl-file://` custom protocol.
- AppImage checkpoint 3.
- **Status: DONE (feat/phase6-editor-node on main, v0.3.3).** TDD: workspace
  editor factory/round-trip, file-service classify/read/write, file-url
  protocol helpers, markdown render (raw HTML dropped). Monaco reused from
  the shared `monaco.ts` loader. Image preview is `termsprawl-file://local/…`
  (privileged scheme; only image extensions are served).

### Task 6.4: Diff node
- Monaco diff editor, read-only; `core/git-service.ts` (repoRoot +
  `git show`): staged (`:path`) vs HEAD; path picker; status line for
  not-a-repo / no-changes.
- AppImage checkpoint 4.
- **Status: DONE (commits 0f81c76→f584815 on main, v0.2.4).** TDD:
  git-service (11 tests), diff-node data round-trips (4 tests) — 40 total
  green. Checkpoint 4 AppImage built + uploaded; user test pending.

### Task 6.5: Commit + status
- Update PLAN.md status with checkpoint results.
- `git commit -m "feat: sticky, group, editor, diff nodes"`
- **Status: DONE.** Sticky + group + diff landed earlier (v0.2.4); editor
  node closes Phase 6 (v0.3.3). Grok preset already on main — the old
  `feature/editor-node` / `feature/grok-agent` worktrees are stale labels.

## Phase 7 — Agents

### Task 7.1: Agent registry + spawn
- Create: `src/shared/agents/config.ts` — agent config keyed by open id
  (claude/codex/gemini/grok/custom), capability lists, helpers. Agent node
  spawns CLI once via initialCommand.
- **Status: DONE (commit 50e6bb2→…, v0.2.5+).** Registry (claude/codex/
  gemini/custom with capability lists), `createAgentNode()` factory, context
  menu "Open agent ▸" submenu. Spawn reuses the command-preset mechanism from
  the druk node (resolveCommandLine → absolute path, so GUI-launched apps find
  agent CLIs in ~/.local/bin). Fixed a latent gap: `@shared/*` value imports
  never resolved at bundle/test time (only type imports were erased) — added
  aliases to electron.vite.config.ts + vitest.config.ts. 62 tests green.
- **Grok added** on `feature/grok-agent` (worktree, merged to main). Registry id
  `grok`, command `grok`, enabled. Capabilities match the Grok CLI
  (hooks/resume/subagents/recurring/branch/usage/chat/permissionMode). No
  `--session-id` pin — Grok requires a UUID, and node ids are not UUIDs.
  Hook installer / normalizer still Claude-only (Task 7.2).

### Task 7.2: Hook server + status
- Create: `src/main/agents/hook-server.ts` (loopback HTTP, per-session token,
  fail-open), installer registry, managed hook scripts per agent.
- Normalize each agent's hooks → shared state model (working/waiting/blocked/
  done) + subagent/recurring/session kinds.
- Verify: node shows RUNNING/NEEDS YOU badge.
- **Status: DONE (commit 540b8ab).** `core/agent-status.ts` normalizer (TDD,
  claude payloads → working/waiting/blocked/done + subagent kind),
  `main/agents/hook-server.ts` (loopback 127.0.0.1, fail-open 200s, routed
  /hook/<agent>), `main/agents/hook-installer.ts` (merge-only install/uninstall
  of Claude URL hooks into ~/.claude/settings.json, __termsprawlManaged
  marker), renderer agent-status store + RUNNING/NEEDS YOU/BLOCKED/DONE badges
  on command-spawned terminal nodes. claude nodes pin `--session-id <nodeId>`
  so hook events map to the exact node. Live-verified: app boot installs hooks
  pointing at the live loopback port; POSTs accepted (unit-tested). 82 tests.

### Task 7.3: Notifications + unread
- Unread dot on busy→idle while unfocused; OS notification; focus-node click.
- Verify: background agent completion → dot + notification.
- **Status: DONE (commit 02a1e71).** `shared/agent-status.ts` now owns the
  status model + `shouldNotify()` (pure, TDD — notify only on transition into
  done/waiting/blocked, only for known sessions, only while unfocused). Main
  fires an Electron `Notification` (click focuses the window) on those
  transitions; renderer sets a pulsing amber unread dot on the node (click
  clears). Consolidated the status types into shared/agent-status.ts (removed
  the duplicate from shared/types.ts). Fixed a flaky pty test (raised timeout
  under parallel tmux load). 87 tests.

### Task 7.4: Session name sync + branch
- Session name ⇄ node title (transcript reader, not OSC title); manual rename
  pushes `/rename`. Branch: `/branch` + new node resuming old session.
- **Status: DONE (v0.3.0).** `core/transcript.ts` reads the latest non-null
  `session_name` from a Claude JSONL transcript (fail-open); the normalizer now
  carries `transcript_path` through `AgentStatusEvent`; `core/session-name.ts`
  throttles reads (5s) and only reports changes. Main broadcasts
  `agent:session-name:<id>` → the terminal node title mirrors the agent's
  session name. Terminal titles are double-click editable; renaming a claude
  node pushes `/rename <name>` into the live PTY. Agent context menu: "Branch
  session" writes `/branch`, "Resume session in new node" spawns
  `claude --resume <nodeId>` (createResumeAgentNode factory). TDD: transcript
  (5), session-name tracker (5), normalizer passthrough (2), resume factory
  (2) — 107 tests green.

### Task 7.5: Context links
- Link file per node pair; CLI that parses transcript formats to print linked
  context; discovery markers per agent (skill / AGENTS.md marker block).
- **Status: DONE (TDD, v0.3.5-dev on main).** `core/context-links.ts` (ordered
  pair file, add/list/remove/peers, SELF guard), `core/transcript.ts`
  `readTranscriptTurns` + `formatLinkedContext`, `core/transcript-index.ts`
  (per-node transcript path persistence so the one-shot CLI finds peers),
  `core/context-cli.ts` + `scripts/termsprawl-context.mjs` (bundled via
  `pnpm build:cli`, a thin runContextCli wired to a real-io impl),
  `core/context-discovery.ts` (`.termsprawl/AGENTS.md` managed block +
  `.claude/skills/termsprawl-context/SKILL.md`, project-local only). IPC
  `context:list/add/remove` with known-cwd guard in main; preload + env.d.ts
  surface; `TERMSPRAWL_NODE_ID` injected on Claude `--session-id/--resume`
  spawn; canvas "link to another agent" submenu (Claude gate, folder projects
  only) persisting `data.linkedIds` as a cache rebuilt from disk on load.
  229 tests green.

### Task 7.6: Managed accounts + permission mode
- Account list in settings; per-account config dirs; env injection with
  AUTH_ENV strip; login node flow. Permission-mode flag with CLI version gate.
- **Status: DONE (TDD, on main).** `core/agent-accounts.ts` (managed dirs under
  userData/accounts, safe ids, `claudeConfigEnv`, `stripAuthEnv` — drops
  `ANTHROPIC_API_KEY`/`CLAUDE_API_KEY`/`ANTHROPIC_AUTH_TOKEN`, unit-tested),
  `activeAccount` resolver; `AppSettings` + normalization carry
  `accounts`/`activeAccountId`/per-account `permissionMode`. Settings panel:
  list, active radio, add (creates dir via `app:account-create`), delete with
  in-app destructive confirm (`app:account-delete`), per-account permission-mode
  select shown only when `claude --help` advertises `--permission-mode`
  (cached probe). Spawn: main injects active account `CLAUDE_CONFIG_DIR` on any
  Claude spawn, appends `--permission-mode` for session-pinned agent nodes when
  supported, and pty-manager always strips inherited auth env. Login nodes:
  `core/agent-cli.ts` CLI probes, `app:login-command` IPC, `createAgentLoginNode`
  + a renderer spawn-request store so settings can drop a login terminal onto the
  canvas. 252 tests green.

### Task 7.7: Commit
- `git commit -m "feat: agent support"`
- **Status: DONE.** Phase 7 complete (7.1–7.7); version bump / AppImage /
  release only on request.

### Task 7.8: Extensible settings panel
- A proper, sectioned settings panel (the app-gear modal) driven by a section
  registry, so new sections are added by appending to an array ("space to add
  more stuff"). Sections: user (display name; cloud/account sign-in is the
  extension point when the cloud feature lands), agents (primary: codex + grok),
  agent accounts (existing), a2a peers (config only), api providers (non-secret
  endpoints; keys deliberately not stored), updates (auto-download).
- Model: `AppSettings.displayName`, `a2aPeers`, `apiProviders` (optional, added
  to normalize + defaults). Focus: codex + grok are the primary agents
  (PRIMARY_AGENTS); claude stays registered but secondary.
- **Status: DONE (on main).** The `phase-10-server` branch was merged into main
  (via 3b2fc14) and deleted 2026-08-27 — Task 7.8 is complete, do not reopen.
  app-settings normalize round-trips the new fields (13 tests); typecheck, build,
  build:server, originality all green (325 tests).

## Phase 8 — Source control

### Task 8.1: Git service
- Create: `src/core/git-service.ts` — system git + gh; repoRoot, status, diff,
  stage/unstage, discard, branch ops, commit, push/sync/publish, recent commits.
- **Status: DONE (TDD, on main).** Extended `core/git-service.ts` with a
  promisified `runGit` (argv-array, remote-agnostic) and `gitStatus`
  (`parseGitStatus` porcelain), `currentBranch`/`listBranches`/
  `createBranch`/`checkoutBranch`/`deleteBranch`, `stageChanges`/
  `unstageChanges`/`discardChanges`, `commitChanges`/`recentCommits`,
  `syncState`/`parseSyncState` (ahead/behind), `push`/`pull`/`publish`/
  `remoteUrl`, `ghAuthed`. 263 tests green.

### Task 8.2: Panel
- Create: `src/renderer/components/SourceControlPanel.tsx` — file list,
  +/- stage, discard, commit box, branch UI, gh banner.
- Verify: full cycle in a test repo.
- **Status: DONE (on main).** `git:snapshot/stage/unstage/discard/commit/
  branch-create/branch-checkout/push/pull/publish` IPC (main validates the
  active project cwd), preload + env.d.ts surface, `GitPanelSnapshot` in
  shared/types. `SourceControlPanel.tsx`: status file list (+/− stage,
  inline-confirm discard, status letters), commit box, branch list +
  create/switch, push/pull/publish, sync (ahead/behind) and gh-auth banner.
  Docked via the "source control" toolbar button (folder projects only).

### Task 8.3: Worktrees bound to groups
- One worktree store/poller (epoch-guarded); creation dialog; scoped panel
  (scope = main checkout or bound worktree); reconciliation against
  `git worktree list`; destructive-safety rules.
- **Status: DONE (on main, shipped in v0.4.0).** `core/worktree-store.ts`
  (epoch-guarded `reconcile`: drops stale/out-of-order/same-version polls;
  `get`/`has`/`at`, 5 tests), `git:worktrees/worktreeAdd/worktreeRemove` IPC
  (main validates cwd, force guarded with in-app destructive confirm).
  `SourceControlPanel.tsx` renders a scoped worktree list: create (name + run)
  and force-remove with explicit change-discard confirmation. Landed in commits
  9f08a80 (primitives) + 9d33b0a (panel), both ahead of the v0.4.0 tag.

### Task 8.4: AI commit messages + naming
- BYO local agent CLI spawned read-only on staged diff / captured output.
- **Status: DONE (commit a2a5245).** `core/commit-message.ts` (electron-free,
  TDD) spawns claude>codex on the staged diff and returns a conventional
  message; `git:commit-message` IPC + an "ai" button in SourceControlPanel
  fills the commit input (never commits automatically).

### Task 8.5: Commit
- `git commit -m "feat: source control"`

## Phase 9 — SSH remote projects

### Task 9.1: Remote transport
- ControlMaster-based SSH; remote tmux config; remote pty over ssh exec.
- Renderer keeps using the terminal transport interface — remote is a second
  implementation, canvas untouched.
- Verify: open project on a test host; terminal/git/file ops run remotely.
- **Status: DONE — superseded by Task 9.1b (full remote git/file/pty surface,
  verified live 2026-08-27). Transport stack: commits 75dd7b3/…/0e3e78a.** `core/ssh.ts` (remote spec + runSsh), `core/remote-git.ts`
  (`git -C`), `core/remote-file.ts` (quoted remote read), `core/remote-pty.ts` +
  PtyManager remote routing (`ssh -tt` + remote tmux; create/destroy/fresh over
  ssh, local spawn cwd fixed, remote sessions skip local scrollback) — all
  verified against a real host (hermes-box): remote terminal spawns + streams.
  Surface added: `ProjectMeta.remote` + `addProject(name, cwd, remote?)`
  (persists, round-trip tested), `@shared/remote-project` helpers
  (isRemoteProject/remoteLabel/normalizeRemote), the add-project IPC wired main
  + preload + renderer store, `TerminalNode` passes the owning project's remote
  on pty.create (so a remote terminal spawns over ssh), and a TabBar "New
  remote (SSH) project" dialog (validate via normalizeRemote).
- **Live transport re-verification 2026-08-27 (real Proxmox LXC):** exercised
  the actual modules against `root@192.168.8.221` (actrunner CT 109 on PVE
  192.168.8.195; tmux 3.5a + git 2.47.3; user's ed25519 key deployed to its
  authorized_keys). Verified: runSsh command exec, remote tmux session lifecycle
  (create / has-session / kill, both async and sync variants), remote file read
  (/etc/hostname), and a remote git status→add→commit round-trip in a scratch
  repo. **Found + fixed a real bug:** `runSsh` joined argv elements unquoted and
  ssh hands the joined string to the REMOTE shell, so any argument containing
  spaces (commit messages, paths) was split — a multi-word `git commit -m` died
  with a pathspec error. Fix: `ssh.ts` now single-quotes every element via
  `remoteCommand()` (new `shq` moved here; `runSshRaw` added for pre-quoted
  compound commands — `remoteSh` uses it, sync tmux helpers quote too). 3 new
  unit tests (multi-word round-trip through /bin/sh); 379 tests green;
  typecheck + originality OK. Test host left configured for the app-level pass.

### Task 9.1b: Source control + file panel over ssh (DONE, verified 2026-08-27)

**Status: DONE.** Phase 9 remaining work shipped + verified end-to-end against
the live LXC (`root@192.168.8.221`). 391 tests green, typecheck + originality OK.

- **ControlMaster multiplexing (`core/ssh.ts`):** `connectionArgs(remote, opts)`
  now takes an optional `controlPath` → `ControlMaster=auto` +
  `ControlPath=<socket>` + `ControlPersist=600`, so every git/file op for a
  project rides ONE persistent ssh connection (a snapshot's ~7 parallel calls
  stop paying the TCP+auth handshake each time). `sshControlPath(userDataPath,
  remote)` derives a sanitized per-host socket under `userData/ssh`;
  `runSshWithInput` added for stdin-backed writes. Interactive terminals
  deliberately keep their own connections (no control path). Unit tests cover
  the argv shape + a localhost ControlMaster round-trip (skips when no sshd).
- **Full remote git surface (`core/remote-git.ts`):** mirrors git-service —
  remoteRepoRoot (`git rev-parse --show-toplevel`, so a project path inside a
  repo resolves like findRepoRoot), currentBranch, listBranches, syncState,
  remoteUrl, status (parsed), stage/unstage/discard, commit, recentCommits,
  createBranch/checkoutBranch, push/pull/publish, stagedDiff, showFromRef.
  All thread `SshOptions`. parse helpers extracted for unit tests.
- **Remote file ops (`core/remote-file.ts`):** `remoteListDir` (mirrors
  listProjectDir: one level, skips dotfiles/node_modules/.git, dirs first,
  MISSING/NOTDIR markers) and `remoteFileWrite` (`mkdir -p` + `cat >` with the
  content piped on stdin — no shell quoting of content, safe for any text).
- **Main routing (`src/main/index.ts`):** every git IPC now takes a `GitTarget`
  (`{cwd}` local | `{remote}` ssh; new shared type). `resolveGitTarget`
  validates the remote against the known project list (never an arbitrary
  host/path), resolves the repo root on the correct side, and threads the
  control path. `git:commit-message` fetches the remote staged diff over ssh
  and runs the LOCAL agent CLI (`generateCommitMessageFromDiff` extracted in
  `core/commit-message.ts`). files.read/write/list and diff.info accept an
  optional remote; `resolveRemoteFileTarget` keeps every path inside the
  project's remote root (OUTSIDE guard). Worktrees stay local-only (panel
  hides the section for remote projects).
- **Renderer:** `Canvas` takes the active project's `remote` (from App) and
  passes it to the FileTree + editor/diff factories. FileTree browses
  `remote.path` (title shows `user@host:path` via remoteLabel); the source
  control panel shows an `ssh …` banner, sends GitTargets, and hides the
  worktree section. Editor/diff nodes carry `data.remote` so open files read /
  save / diff over ssh (a dialog-picked local file clears remote).
- **End-to-end verify (running app, headless boot + CDP against the LXC):**
  built the app, booted with a fresh user-data dir + raw debug port, and drove
  the REAL preload→IPC→main→core→ssh→LXC chain from the renderer: addProject
  with a remote persisted the project; git.snapshot returned the LXC repo's
  branch + dirty file + commits; stage/unstage worked; git.commitMessage
  generated "chore(index): bump export constant to 2" via local codex on the
  REMOTE staged diff; files.list/read/write round-tripped over ssh; diff.info
  returned HEAD vs working-tree content. **Found + fixed a second real bug:**
  remoteDiffInfo passed the FILE path to `git -C` (needs a directory) — now
  uses `posix.dirname(path)`, matching local diffInfo's findRepoRoot walk.
  App + Xvfb killed by PID after; LXC test repo left clean.

### Task 9.2: Commit
- `git commit -m "feat: ssh remote projects"`

## Phase 10 — Server Edition

### Task 10.1: Node shell + bridge
- Create: `src/server/` — plain `node:http` + `ws`, serves built renderer,
  WS-RPC protocol; browser shim fills the same API as the desktop preload.
- Boot same core services via a platform implementation.
- Verify: browser session opens project, runs terminals, sees agent status.
- **Status: DONE (v0.9.1+).** The full Phase 10 stack is live and verified:
  web shell, terminals, projects, agent status broadcast, agent CLI hooks,
  git (full 16-channel surface), diff:info, file tree, auto-save, port
  fallback, shutdown safety, default welcome project, and platform-parity
  shim. The hook-installer was extracted to `src/core/hook-installer.ts`
  (electron-free) so both main and server share it. 444 tests, typecheck,
  and originality all green. Live-verified via WS smoke test: `git:snapshot`
  returns the repo's branch/changes/commits, `diff:info` returns original +
  modified content, and project persistence survives server restart.
  Deliberately out of scope: managed accounts, cloud sync, browser nodes
  (all reject gracefully in the shim).

### Task 10.2: Commit
- `git commit -m "feat: server edition"`
- **Status: DONE.** Phase 10 complete. Files changed in this phase:
  - `src/server/handlers.ts` — added git (16 channels) + diff:info handlers
  - `src/server/shim.js` — replaced git/diff stubs with real invocations;
    added missing `openExternal`
  - `src/server/index.ts` — auto-save (30s), port fallback, shutdown safety,
    default welcome project
  - `src/server/agent-bridge.ts` — installs agent CLI hooks on boot
  - `src/core/hook-installer.ts` — extracted electron-free hook installer
  - `src/main/agents/hook-installer.ts` — re-exports from core
  - `src/server/server.test.ts` — added git:snapshot + diff:info smoke tests

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
- **Status: DONE (2026-08-28, live-verified).** Standalone zero-dep service
  (`relay/`, plain ESM `.mjs`, only dep `ws`) on branch `feature/relay-service`:
  - `store.mjs` — atomic JSON store (tmp+rename; crash-safe), invite model
    (8-char codes, expiry/revocation/max-uses, per-host active-invite quota).
  - `github-auth.mjs` — device flow (injectable fetch + sleep): pending/slow_down
    back-off, login lookup; only the SHA-256 token hash is stored, never the token.
  - `crypto.mjs` — X25519 keypairs + ECDH→HKDF-SHA256 shared keys + AES-256-GCM
    envelopes with the sender id as AAD (tamper/wrong-peer → throw; 1000-seal
    nonce uniqueness tested).
  - `hub.mjs` — WS hub: host sessions (token-hash auth, replacement on
    re-login), client pairing via invites (typed errors EXPIRED/REVOKED/
    EXHAUSTED/UNKNOWN), peers frames carrying each side's pub key, opaque
    `{from,to,env}` routing, offline queue (cap 100, flush on resume),
    direct-path hint pass-through, metrics counters.
  - `admin.mjs` + `index.mjs` — /healthz (open), /admin/stats + invite
    revocation + user delete (Bearer token), env config (PORT, RELAY_DATA_DIR,
    GITHUB_CLIENT_ID/SECRET, ADMIN_TOKEN), RELAY_DEV_AUTH=1 dev bypass that
    hard-refuses in production and prefixes dev logins; binds 127.0.0.1.
  - `README.md` — protocol, security model (relay sees ciphertext only), ops.
  - **Verified live** (`/tmp/relay-e2e2.mjs` against a real booted relay):
    invite mint → host register → client redeem+pair (pub keys exchanged via
    peers frames) → E2E envelope round-trip decrypted with the derived key →
    stats counters advanced → **relay stdout contains no plaintext** (AAD binds
    the sender id; the log only ever sees routing metadata). 64 relay tests
    green alongside the app's 506.
  - Follow-ups: app-side client seam (`core/relay-client`), in-app pairing UI,
    terminal frames over the tunnel, direct-path connection actually dialing
    the offered endpoint.

### Task 11.3: Telegram bot v2
- Build local bot (no relay): commands: /terminals /attach /send /help.
- **Status: DONE (2026-08-28).** A local, zero-dependency Telegram bot runs
  INSIDE the app (long-polling over global fetch; no new npm deps). Command
  surface: `/start` `/help` `/projects` `/terminals` `/send <id> <text>`
  `/peek <id>` `/attach <id>` `/detach` `/status` — pairing is secure by
  default (empty allowlist = the first chat to `/start` becomes the owner and
  is persisted; non-empty = only listed chats may issue commands). `/attach`
  streams a terminal's tmux pane every 2 s (auto-stops after 5 min, `/detach`
  ends it). Session↔project awareness: terminals are listed under their owning
  project; terminal ids are the stable node ids (= tmux session keys). Written
  fresh from docs/OWN-WORK.md §A concepts — nothing ported.
  - `src/core/telegram/api.ts` — minimal Bot API client (getMe/getUpdates/
    sendMessage/sendChatAction/deleteWebhook; injectable fetch).
  - `src/core/telegram/pairing.ts` — allowlist/pairing decision (pure).
  - `src/core/telegram/commands.ts` — parse/format/dispatch via an AppAdapter
    interface (pure, fully unit-tested).
  - `src/main/telegram/bot.ts` — long-poll loop + adapter wiring
    (workspaceStore + ptyManager + tmux capture) + `/attach` streaming.
  - `AppSettings.telegram` (enabled/token/allowedChatIds) + Settings →
    Connections → "Telegram bot" section (enable toggle, masked token,
    allowlist). Token source: env `TERMSPRAWL_TELEGRAM_TOKEN` wins over
    settings.telegram.token — never in the repo.
  - PtyManager gained `liveSessionIds()` + `capturePane()` (local tmux capture;
    remote via ssh); remote-pty gained `remoteTmuxCapture(Sync)`.
  - Verified: 47 new tests (438 total green, typecheck + originality OK);
    **live end-to-end**: token validated (bot = @termsprawlbot, no webhook →
    long-poll OK), app booted headless with the env token enabled the bot, a
    real phone `/start` was received and chat `1033877751` auto-paired +
    persisted to settings.json, and a confirmation message was delivered to
    that chat (`sendMessage` ok). App + Xvfb killed by PID after.
  - Follow-ups (OWN-WORK.md §A ideas): desktop approval UI, inline keyboards
    for node pick, read-only viewer mode, per-node allowlist, session-scoped
    attach tokens.

### Task 11.4: Chat driver v2 (provider-agnostic)
- SDK chat node with streaming, permission cards, cost chip.
- **Status: DONE (2026-08-28, verified live).** Built fresh against termsprawl's
  own core (no ports). Zero new npm deps — SSE parsed by hand from fetch
  streams (injectable fetch, like the Telegram client).
  - `src/core/chat/` (all electron-free, guard-tested):
    `types.ts` (ChatMessage/ChatEvent/ChatError), `conversation.ts` (message
    model + slash detection + byte-capped serialization that drops oldest
    user+assistant pairs, keeps system), `sse.ts` (shared SSE reader — blank
    line blocks, data:/event:/comments, CRLF, trailing flush), `openai.ts`
    (any OpenAI-shaped endpoint: /v1 normalization, delta + reasoning_content +
    index-keyed tool_call assembly + usage-only chunks, abort → stopped),
    `anthropic.ts` (x-api-key + anthropic-version; content_block events;
    thinking_delta; input_json_delta tool assembly; system top-level),
    `cost.ts` (longest-prefix model prices, user overrides, estimated flag for
    unknown models), `tools.ts` (provider-neutral loop: permission gate with
    approve/deny, max-iterations guard, consumer exceptions never break the
    loop), `runtime.ts` (shared main/server runtime: per-node runs, abort =
    normal stop, approval plumbing, env-wins key resolution).
  - IPC: `chat:send` / `chat:stop` / `chat:approve` invokes + `chat:event:<nodeId>`
    push channel (`chatEventChannel`); preload `window.termsprawl.chat.*`;
    env.d.ts typed. Server Edition: same runtime via buildHandlers + shim chat
    namespace (REAL implementation, not a stub).
  - Settings: `AppSettings.chat` (defaultProvider/defaultModel/keys/
    priceOverrides; normalize round-trip tested, empty-shape-stable); Settings →
    Connections → "Chat models" section (provider select, model, masked
    per-provider keys; env TERMSPRAWL_PROVIDER_KEY_<ID> overrides; local-only).
  - `ChatNode.tsx`: streaming transcript with collapsed thinking blocks, token
    chip, slash commands, stop button; streaming accumulates in LOCAL state
    with functional updates (events outran React Flow re-renders — found live),
    committed to node data per completed turn so history persists via the
    project file. Context menu "New chat". Node resize via NodeResizer
    (min 280×220), DEFAULT_SIZE chat 420×480.
  - Verified live (headless boot + raw CDP): booted the BUILT app with a stub
    OpenAI-compatible provider on loopback, created a chat node via the real
    context menu, typed through the real textarea, pressed Enter, and the
    streamed reply ("Hello from the stub provider! Streaming works.") rendered
    in the transcript end-to-end through preload → IPC → runtime → adapter.
    **Found + fixed two real bugs:** settings.normalizeAppSettings stripped the
    new `chat` field (provider lookup failed at runtime), and the
    ChatNode stale-closures race above.
  - Gates: 506 tests green (52 chat + 6 runtime + 3 settings new), typecheck
    clean, originality OK.
  - Follow-ups: permission-card UI for tool calls (core loop + approval IPC
    already wired; ChatNode renders tool results as text), cost chip USD
    display (usage + price table already collected), tool schema surfacing in
    provider requests.

### Task 11.5: Commit
- `git commit -m "feat: rebuild own extras (relay, telegram, chat)"`
- **Status: DONE.** Phase 11 complete (2026-08-28): 11.3 Telegram bot v2
  (local, live-verified), 11.4 chat driver v2 (SDK chat node, live-verified),
  11.2 relay service v2 (standalone + app-side client seam, live-verified).
  All rebuilt fresh from the OWN-WORK.md concepts — zero code ported.

## Phase 12 — Packaging & release

### Task 12.1: electron-builder config
- AppImage + .deb for Linux; asar-unpack node-pty; icon.
- Verify: `pnpm run dist` produces working Linux artifacts; smoke-test the
  AppImage and installed `.deb`.

### Task 12.2: Auto-update + announcements
- GitHub Releases feed; update card; announce banner.
- **Status: DONE (commit e4289d2).** electron-updater checks GitHub Releases on
  packaged boot (toast + auto-download switch, default off). Added a
  dismissible announcements banner that shows the latest GitHub release notes
  (parseLatestRelease, TDD) — dismissal persisted per version in app settings.
  Releases must include `latest-linux.yml` (produced by `pnpm run dist`) or the
  client cannot see a new version.

### Task 12.3: CI and release delivery — Gitea only

- **Implemented:** `.gitea/workflows/ci.yml` is the sole CI/release workflow.
  [Gitea repository](http://192.168.8.175:3000/dazeb/termsprawl) and
  [Actions runs](http://192.168.8.175:3000/dazeb/termsprawl/actions).
  GitHub Actions is permanently disabled; do not add a mirror workflow.
- **Required trigger:** push `main` to `gitea` to run verification; push the
  release `v*` tag to `gitea` to run verification and packaging/publishing on
  the self-hosted runner (CT 109, `actrunner`). Pushing only to GitHub or
  hermes-box does not activate this runner. An ordinary feature-branch push
  does not match the workflow's branch filter; pull requests also run CI.
- Verification installs app and relay dependencies, then runs typecheck, app
  build, Server Edition build, and tests. Build precedes tests because the
  server boot gate needs the built renderer.
- The tag release job builds Linux artifacts and publishes to Gitea and,
  using the required `GH_TOKEN`, GitHub Releases. GitHub remains the desktop
  auto-update source and must contain `latest-linux.yml`.
- **Release hardening (2026-09-16):** the release job now requires a successful
  verify job, a configured `GH_TOKEN`, and all three nonempty release assets
  before publishing. The app release script reuses an existing tag only when
  it points to HEAD; a conflicting tag fails. Site deployment resumes when
  the version is already committed and fails on unsuccessful HTTP requests,
  a missing application bundle, or a missing expected version.
- These hardening changes require merging and pushing to Gitea before they
  affect runner behavior. Offline checks: `python3 scripts/release-safety.test.py`.

### Task 12.4: Required release checklist

1. Check the working tree and actual remote URLs (`git remote -v`), integrate
   the intended work into `main`, and run typecheck, tests, and the local
   originality gate. Run the spaces and GitHub-import E2E gates documented
   in `AGENTS.md` before pushing the release tag.
2. Run `scripts/release.sh X.Y.Z` from clean `main` (or use its explicit
   `--from <branch>` option). It bumps the version, runs local gates, pushes
   `main` to origin, Gitea, and GitHub, then pushes the version tag to all three.
   The E2E gates are manual prerequisites, not executed by this script.
3. **Do not skip `git push gitea main` or `git push gitea vX.Y.Z`.** These are
   the runner triggers already included in the release script. Read back the
   branch/tag refs and inspect the corresponding Gitea Actions jobs.
4. Verify successful verify and release jobs and read back all three assets
   (AppImage, `.deb`, `latest-linux.yml`) on both Gitea and GitHub. Do not
   label a local version bump or tag push as a completed release.
5. Run `scripts/release-site.sh X.Y.Z` to update and deploy the marketing
   site, and update/deploy sibling docs for changed user-facing behavior.
   Verify the live site version and relevant docs before closing the release.

**Pre-flight: Gitea runner and CT 100 disk headroom.** Each release adds ~280M
of attachments to Gitea, whose data lives on CT 100 (an 8G rootfs until it was
grown to 16G on 2026-09-16). When that filesystem fills, the publish step fails
with `curl: (22)` → HTTP 500 *and* Gitea cannot record the failure, so the run
stays "running" forever while publishing nothing. Before pushing a release tag,
check headroom:

```bash
ssh root@192.168.8.195 'pct exec 100 -- df -h /'   # want well under 90% used
```

If it is tight, prune old releases or grow it with `pct resize 100 rootfs +8G`
(non-destructive; the `pve` VG had ~14G free). If a release job fails this way,
grow the disk and re-push the tag to Gitea (`git push gitea :refs/tags/vX.Y.Z`
then `git push gitea refs/tags/vX.Y.Z`) — the publish steps are idempotent and
reuse the existing release.

---

## Phase 13 — Embedded browser node (deviation from the plan)

*User-directed deviation 2026-08-26. Goal: a real browser INSIDE termsprawl —
a sandboxed `<webview>` guest node on the canvas — that a user opens manually AND
that an external agent can drive, so the user literally watches what the agent
does in a browser. Branch: `feature/browser-node`.*

### Task 13.1: Browser node vertical slice (DONE, verified)

Artifacts:
- `src/core/browser-policy.ts` (+ test) — pure navigation policy (electron-free,
  TDD): only http/https + about:blank/srcdoc; denies file:, termsprawl-file:,
  javascript:, data:, devtools:, chrome:. `normalizeAddress` (bare host → https,
  localhost → http).
- `src/main/browser/runtime.ts` — provisions the ONE per-session CDP endpoint:
  random high port (49152–65535), 48-hex token, localhost-only.
  `ensureBrowserDebugPort()` puts `--remote-debugging-port` on the real argv
  (reliable path) via the Wayland respawn, or appendSwitch on X11; reconciles
  `cdp-info` to any manually-passed port.
- `src/main/browser/manager.ts` (`installBrowserSecurity`) — hardens every
  `<webview>` guest at attach: strips preload, forces nodeIntegration off +
  contextIsolation/sandbox on, blocks non-web `will-navigate`/`will-redirect`,
  denies all popups. Keeps a node-id → guest-id map; `navigateBrowserNode`
  centralises the URL policy. (A1)
- `src/main/index.ts` — wires the respawn port, `installBrowserSecurity()`,
  `webviewTag: true`, and the browser IPC handlers. (A3)
- `src/shared/ipc.ts` / `src/shared/types.ts` — `browser:cdp-info` /
  `browser:register` / `browser:unregister` / `browser:navigate` +
  `BrowserCdpInfo` / `BrowserNavigateResult`. (A2)
- `src/preload/index.ts` + `src/renderer/src/env.d.ts` — `window.termsprawl.browser.*`.
- `src/renderer/src/nodes/BrowserNode.tsx` + `state/workspace.ts` (new `browser`
  kind: factory, NODE_TYPES, DEFAULT_SIZE, deserialize, nodeTitle) + Canvas
  nodeTypes + "New browser" context menu + `styles.css`. (A4–A6)

Verified (headless boot, Electron 43 / Chromium 150, CDP driven):
- App boots; CDP endpoint live at `http://127.0.0.1:<port>` with a browser-level
  WS target (`/json/version.webSocketDebuggerUrl`) — the `connectOverCDP` shape.
- Right-click → "New browser" creates a `<webview>` guest (guestId=2,
  nodeId=nmta7v3lj-1); the guest appears in `/json` as a `webview` target.
- `window.termsprawl.browser.navigate(nodeId, 'https://example.com')` drives the
  guest (its target URL → https://example.com/).
- Policy enforced through the real IPC path: `file:///etc/passwd`,
  `javascript:alert(1)`, `data:text/html,hi` all return
  `{ok:false, reason:'DENIED'}`; `https://example.com` returns `{ok:true}`.
- Gates: `pnpm run typecheck` clean; `pnpm test` 338 passed (10 new policy tests);
  `./scripts/check-originality.sh` OK.

### Task 13.2: Agent-attach reliability (SPIKE — DONE, 2026-08-26)

Verified with a real client against a running headless app + a live browser node
(guestID 2, page https://example.com, /json showed title "Example Domain"):

- **Raw CDP attach + drive: WORKS.** Browser-level WS (`/json/version`) lets a
  client `Target.attachToTarget` the guest, then `Page.navigate` /
  `Runtime.evaluate`.
- **Puppeteer `connect({ browserWSEndpoint })`: WORKS FULLY.** Connected, saw the
  `webview` target, read H1 "Example Domain", ran `page.evaluate` (set
  document.title → "CONTROLLED-BY-PUPPETEER"), and `page.goto` navigated it
  (URL → ?from=puppeteer). Confirmed `puppeteer-core` 25.9.
- **Playwright `connectOverCDP`: CONNECTS but does NOT see the embedded `webview`
  guest** (`chromium.connectOverCDP('http://127.0.0.1:<port>')` enumerated only the
  main renderer page, no example.com). Electron reports webview guests as target
  type `webview`, which Playwright's connectOverCDP filters out. This is the
  Hermes-relevant gap: `browser_exec` (Browser Use CLI) is Playwright-based.

Conclusion: the control mechanism itself is reliable + secure (proven via raw CDP
and Puppeteer). The mitigation for a Playwright-only agent:
- (A) small in-main CDP adapter that re-exposes each guest as a standard
  browser-context `page` target Playwright will surface; or
- (B) route the agent's browser tooling through Puppeteer (`connect`), which
  needs no app change; or
- (C) for Hermes `computer_use` (cua-driver): it drives the termsprawl desktop
  window, so the embedded browser is pixels it can click, but not CDP-level
  control — prefer the CDP path for real automation.
Recommended: (A) so the common Playwright/Browser-Use path works unchanged.

### Task 13.2.1: Playwright-compat CDP facade (DONE, verified 2026-08-26)

Mitigation (A) implemented + verified end-to-end with real clients against a
headless boot.

- `src/main/browser/cdp-facade.ts` (+ test, `cdp-facade.test.ts`) — a minimal
  "virtual browser" on its own loopback port (random high port, 127.0.0.1 only):
  presents every live browser-node guest as a standard `page` target and proxies
  page-level CDP through the guest's `webContents.debugger`. Started in
  `whenReady`; `browser:cdp-info` and the agent-server discovery file now point
  at the facade, and `before-quit` closes it.
- **Playwright connect model implemented**: connectOverCDP drives pages through
  `Target.setAutoAttach` + `Target.attachedToTarget` events (it never calls
  `attachToTarget`), so the facade auto-attaches every live guest, emits the
  event with a sessionId, and polls (500ms) so guests opened later appear live.
  Puppeteer's `getTargets` + `attachToTarget` path works unchanged.
- **The frame-id trap (hard-won)**: Chromium reports a webview guest's CDP
  target id AS its main frame id, and Playwright resolves frame sessions by
  walking `frame._id` through its targetId-keyed session map. Reporting the
  numeric webContents id while getFrameTree reports the hex frame id made
  Playwright's `_sessionForFrame` throw "Frame has been detached", silently
  degrading the page to a dummy frame (empty URL, no utility world, title()
  hangs forever). Fix: the facade learns each guest's real target id from its
  own debugger's `Page.getFrameTree` at attach and uses it in every
  `targetInfo`. Pre-attach enumeration falls back to the numeric id; both
  resolve.
- **No hung agents**: every proxied page command races a 15s timeout
  (`webContents.debugger.sendCommand` has none and can wedge against a frame
  mid-navigation); Playwright page-init commands the guest debugger can't
  answer (`Runtime.runIfWaitingForDebugger`, page-level `Target.setAutoAttach`)
  are answered locally; connect-time browser commands (`setDownloadBehavior`,
  `grantPermissions`, `getBrowserContexts`, …) are tolerated; a no-arg
  `Target.getTargetInfo` answers with the first live guest; `createTarget` is
  rejected with a pointer to the agent-control `/open` endpoint.
- `TERMSPRAWL_FACADE_DEBUG=1` logs every CDP message/event (verification aid,
  off by default).

Verified (headless boot, real clients against the facade):
- Playwright `chromium.connectOverCDP(facadeUrl)`: sees the guest as the only
  page; `page.title()` → "Example Domain"; `page.evaluate` sets the title
  (read back); `page.goto('https://example.com/?from=playwright')` navigates
  the visible guest (URL + h1 verified); exactly one page enumerated (no
  Electron internals leaked).
- Puppeteer `connect({browserWSEndpoint})`: page target visible, title read,
  evaluate sticks.
- Gates: typecheck clean; 357 tests (12 new facade tests); originality OK.

### Task 13.3: Agent-driven auto-open (DONE, verified 2026-08-26)

When an agent wants to use the browser, it can open a node without the user
manually adding one, and drive exactly what appears on the canvas.

- `src/main/browser/agent-server.ts` (+ test) — a loopback (127.0.0.1), token-
  gated control server (random per-session token). `GET /info` returns the CDP
  endpoint; `POST /open` `{url?}` validates via core/browser-policy and
  broadcasts `browser:agent-open` to the renderer. Writes a discovery file
  `userData/browser-agent.json` (port, token, cdp, open URL) the agent reads to
  find the endpoint. Started in `whenReady`. The discovery file's `cdp.wsUrl`
  is the CDP facade (13.2.1) — the endpoint agents actually connect to.
- Preload `browser.onAgentOpen`, `canvas-requests` gained a `{kind:'browser'}` 
  spawn, and Canvas subscribes + spawns a browser node on the event.

Verified (headless, end-to-end): external agent read `browser-agent.json`, `POST
/open {url:'https://example.com'}` → 200; a browser node auto-appeared and the
guest loaded the page (`webview` target, title "Example Domain") on the CDP
endpoint, ready for a client to attach. `file:///etc/passwd` → 400, missing auth
→ 401 over the real server. Gates: typecheck clean; 345 tests (7 agent-server).

### Task 13.4: Follow-ups (DONE, verified 2026-08-26)

- **Settings gate (agentBrowserControl, OFF by default).** New app setting
  `agentBrowserControl` (Settings → General → "Allow agents to control browser
  nodes"). Off (default): browser nodes work manually, and there is NO browser
  debug surface at all — no CDP facade, no `/open` server, no
  `browser-agent.json`, AND no raw `--remote-debugging-port` (the port is now
  gated too, not merely unadvertised; `ensureBrowserDebugPort()` and the
  Wayland-respawn argv injection run only when enabled). On: everything starts.
  Toggling the setting mid-session starts/stops the facade + `/open` server
  live (`syncAgentBrowserControl`, with an epoch guard so a rapid off→on→off
  can't leave endpoints running while off); `cdpFacade.close()` terminates
  connected clients and releases guest debuggers so a later re-enable re-attaches
  cleanly, and `agent-server.close()` removes the discovery file so a stopped
  endpoint is never advertised. Verified headless: default boot has no
  `DevTools listening` line, no discovery file, no debug listener (only the
  Phase 7 hook server); gate-on boot opens the raw port + facade + `/open` and
  passes the full Playwright + Puppeteer regression. The live re-attach path is
  covered by a facade unit test (close→reopen re-attaches the same guest).
- **Tabs within a browser node.** Each tab is its own sandboxed `<webview>`
  guest (tab strip + `+`, close-last-tab closes the node, active tab drives the
  toolbar; open/close show+hide the right webviews so exactly the active guest
  is visible). Tabs share the persistent cookie partition; each tab is its own
  CDP `page` target, so an agent sees every tab. Main-side node→guest map is
  now keyed `nodeId::tabId` (`browser:register`/`unregister`/`navigate` carry a
  tabId). Legacy persisted nodes (no `tabs` field) deserialize to a single tab.
  Pure helpers in `state/workspace.ts` (`addBrowserTab`, `closeBrowserTab`,
  `activateBrowserTab`, `setBrowserTabUrl`) + tests.
- **Per-node history.** `BrowserNodeData.history` (most-recent-first, capped at
  10, `about:` pages skipped) is recorded on every navigation and persisted with
  the project file via the node data, so a reload restores where the node has
  been. (`pushBrowserHistory` + tests.)
- **Guest cleanup.** Guest lifetime is renderer-owned — removing the
  `<webview>` element destroys the guest (Electron has no main-side guest
  destroy); unregister reaps the `nodeId::tabId` map entry, and
  `browserGuestIds()` now filters dead guests so the CDP facade never
  advertises a corpse after a renderer crash.

Gates: typecheck clean; 369 tests (12 new: tabs/history, settings gate,
discovery-file removal, facade close→reopen re-attach); originality OK;
headless boots verified — gate-off has no debug surface at all (no
`DevTools listening`, no discovery file, no debug listener), gate-on opens the
raw port + facade + `/open` and passes the full Playwright/Puppeteer regression.

---

## Phase 14 — Configurable search provider (deviation — re-scoped 2026-08-27)

*User-directed deviation. NOTE (2026-08-27, re-scope): the initial "bundle a
SearXNG sidecar into the app" approach was REVERSED — we decided NOT to
include SearXNG in the app (runtime + license overhead). Instead the browser
node home is a user-configurable search-provider URL, defaulting to
DuckDuckGo, which the user can point at their own SearXNG (localhost or LAN).*

### Task 14.1: Configurable search provider / browser home (DONE)

- `AppSettings.browserHomeUrl` (types + normalize round-trips, unset = app
  default), Settings > General text-input row ("Search provider / browser
  home" — "point this at your own SearXNG (e.g. http://127.0.0.1:8080 or a
  LAN host) ... Empty = DuckDuckGo"), and threading into browser node
  creation + new tabs via a module-level `useBrowserHome` store (custom nodes
  can't take props). Explicit setting wins over everything else.
  (`DEFAULT_BROWSER_URL` stays DuckDuckGo.)
- Removed: the bundled SearXNG sidecar entirely — `src/main/searxng/`,
  `src/core/searxng-config.*`, `src/renderer/src/state/searxng.ts`,
  `searxng:*` IPC + preload + env.d.ts surface, the `browser-search-chip`,
  `scripts/vendor-searxng.sh`, `package.json` `extraResources`,
  `.gitignore` entry, and the release.sh / CI vendor steps. `resources/
  searxng-runtime/` is untracked on disk (user-owned, safe to delete). App
  stays slim; no Python runtime shipped; no AGPL distribution.
- `resolveHomeUrl(settingUrl)` (pure, tested): setting > DuckDuckGo.

---

## Phase 16 — Workspace bundle (user-directed 2026-08-30)

*The whole workspace as ONE json file: all projects, every canvas, terminal
scrollback. Format = the spaces-sync envelope (`SpaceSnapshotPayload`) plus a
`bundle` header, so file export, cloud sync, and the space boot path all
speak one format. Plan: `.hermes/plans/2026-08-30_123805-workspace-bundle.md`.*

- ✅ Core: `buildBundle` / `applyBundlePlan` / `isValidBundle`
  (`src/core/workspace-bundle.ts`, 17 tests) — fresh project ids,
  collision-safe names, terminal-id remap on collision, revs required —
  `dd115bc`.
- ✅ Cloud sync: `CloudClient.pushWorkspaceContent`/`pullWorkspaceContent`
  over the existing `/api/v1/spaces/push|pull` endpoints (no server change;
  boot-restore tolerates the bundle header — test) — `2d3ed1c`.
- ✅ Desktop: Export/Open workspace via IPC + save/open dialogs; Settings
  rows; ScrollbackStore round-trip test — `8b44de1`.
- ✅ AGENTS.md key-design-decisions entry — `edad4b7`.

---

## Node-resize fixes (2026-08-27, post-phase)

- **ResizeObserver loop warning on node resize.** TerminalNode's RO called
  `fit.fit()` synchronously inside the callback (xterm writes element
  dimensions back into its observed host) and Monaco's `automaticLayout`
  re-triggered its own observer on fractional sizes — both produced
  "ResizeObserver loop completed with undelivered notifications" on every
  resize drag. Fix: `src/renderer/src/hooks/useSafeResize.ts` — a shared hook
  that rAF-defers the layout work out of the RO callback and skips when the
  content size hasn't actually changed (≥1px guard kills subpixel feedback).
  TerminalNode fits through the hook; EditorNode/DiffNode switched
  `automaticLayout: false` and drive `editor.layout()` through it. Verified
  headless via raw CDP: 12 resize drags (terminal + Monaco editor node, both
  fractional rects) → 0 warnings.
- **Double border on selected nodes.** The selected node showed two lines
  around it: the NodeResizer's 4 edge lines AND a separate
  `.react-flow__node.selected > div` outline (offset 2px). Fix: the resizer's
  lines ARE the single selection border (faint lime, coincident with the
  node's 1px border) — removed the separate outline entirely and dropped the
  BrowserNode hardcoded `color="#c6f135"` so the theme's accent drives it.
  Verified headless via CDP: selected node has 4 resizer lines at the exact
  node edges, 0 outlines, single visible border.
- **Node resize didn't actually resize content (fixed root sizes).** The
  NodeResizer changes the WRAPPER (`.react-flow__node`) inline width/height,
  but the node roots had fixed px sizes (terminal 720×420, diff 560×360,
  editor 640×420, sticky min 200×130) so only the selection box grew while
  the content stayed put. Fix (the unified system for ALL node types): every
  node factory sets `style: { width, height }` (the wrapper — what the resizer
  writes), and every node root CSS is `width:100%; height:100%; box-sizing:
  border-box` so it fills the wrapper. Group + browser already did this.
  Also lowered the per-node resizer minimums (terminal 240×140, sticky
  120×80, diff 260×180, editor 240×160) so nodes can be shrunk smaller.
  Verified live (HMR) via CDP: sticky drags down to 120×80, wrapper style
  updates, content follows.
- **BLACK SCREEN / renderer crash (the disconnect/re-observe "fix" was wrong).**
  Disconnecting + re-observing inside the deferred work can re-trigger RO
  delivery and hit Chromium's "ResizeObserver loop limit exceeded", which is
  THROWN inside the observer callback — an uncaught exception there blanks
  the whole page (user: "black screen, requires reload/force reload"). Final
  correct fix in `useSafeResize`: plain rAF deferral + size guard (the
  mutation lands in a later frame, so no loop warning) and HARD try/catch
  around the callback body and the work so an RO callback can NEVER throw or
  crash the renderer. Do NOT reintroduce disconnect/re-observe or synchronous
  fit. Verified live: full reload → app boots, nodes create, multi-node
  grow/shrink resize ×3 → renderer alive, 0 RO warnings, 0 RO crashes.

---

## Phase 18 — Node links (typed, persisted edges) — DONE 2026-09-01

*User-directed: canvas edges become first-class "links" — extract a node's
content, inject it somewhere (file / chat conversation / agent terminal / A2A
peer). Plan: `.hermes/plans/2026-09-01_123613-node-links-a2a.md`. Branch
`feature/node-links`. Executed parent-side after both Phase-18 subagent
dispatches died to provider API errors (HTTP 405 / non-streaming timeouts).*

- **18.1 Types + channels (0254fbd):** `NodeLink` / `LinkKind` / `LinkConfig`
  discriminated union + `LinkRunResult` in `src/shared/types.ts`;
  `links:list/run/mark-dirty/update` in `src/shared/ipc.ts`.
- **18.2 Registry + extractors (a4a0760):** `src/core/links/registry.ts` —
  `LINK_SOURCES`/`LINK_TARGETS` matrices, `validateLink`, `linkDefaultConfig`,
  `connectableLinkKinds` (node-drag surface), `extractContent` (sticky/terminal
  via `capturePane`, editor via saved file, chat via message serialization;
  fail-open to empty). 17 tests.
- **18.3 Engine (fa2c873):** `src/core/links/engine.ts` — `runLink` never
  throws; injectors: file-output (project-root containment via injected
  `resolveOutputPath`, 1MB truncate note, header stamp, overwrite/append),
  context-inject → chat (one `chatInject` dep riding the chat event channel),
  context-inject → agent terminal (staged file under
  `.termsprawl/links/context/<id>.md` + ONE bracketed-paste pointer line),
  a2a-peer (dep-injected; Phase 19 wires the real client). 31 tests.
- **18.4 Persistence (c2cdde3):** `ProjectFile.links?` (optional — pre-link
  files load unchanged); parse rules in `src/shared/node-links.ts` (junk
  dropped, not fatal; renderer-safe — workspace-files re-exports; a first cut
  put them in workspace-files.ts and the renderer build externalized node:fs —
  build caught it); `saveProjectFile` PRESERVES existing links on node-only
  saves (nodes save constantly; link edits are explicit); store gains
  `linksFor`/`saveLinks`/`allLinks`/`findLink`/`recordLinkRun`.
- **18.5 Canvas (8281e89 + 2c8788b):** links load over IPC on project switch
  and render as `type: 'nodelink'` edges (`NodeLinkEdge.tsx` — kind chip at
  the midpoint, lime on selection); `onConnect` creates/updates a link
  (validated via `connectableLinkKinds` + `isValidConnection` guard); edge
  delete = link delete; node deletes cascade (`removeLinksForNode` on all
  three removal paths); **every node kind renders `LinkHandles`** (subtle
  source/target dots, visible on hover/selected/while connecting) — React
  Flow cannot render an edge between handle-less nodes (found live: 0 edges
  rendered until handles existed).
- **18.6 Inspector (aba735a):** `LinkInspector.tsx` — edge click opens it
  (Esc/pane-click closes): kind picker (valid kinds only), per-kind options,
  auto toggle, Run now (busy state), delete with in-app confirm, lastRun
  status line.
- **18.7 Main (d16aac1):** `src/main/links/service.ts` (`LinkService` —
  resolves link → source content → engine deps; project root = folder cwd or
  `userData/link-outputs/<projectId>`), `src/main/links/scheduler.ts`
  (`LinkScheduler` — per-link debounce timers, 3s quiescence gap, in-flight
  dedupe, dirty-before-load replay, dispose on quit); PTY activity tapped in
  `platform.broadcast` on `pty:data:*`; dirty signals from StickyNode (typing,
  800ms debounce), EditorNode (Ctrl+S), ChatNode (turn commit); `chatInject`
  rides `chat:event:<nodeId>` as a new `context-added` ChatEvent that ChatNode
  commits straight to node data (dedup by messageId, persists via project
  file).
- **18.8 E2E verified (headless, built app, raw CDP):** seeded project →
  boot: 2 nodes + 1 edge; `links.run` through real IPC wrote
  `.termsprawl/outputs/sticky.md` with header + payload; editing the sticky
  auto re-ran the link (file updated within the debounce+gap window); links
  persisted (lastRun recorded); chat inject: `[context from sticky]` appeared
  in the ChatNode transcript AND persisted into the project file. Gates:
  typecheck, 804 tests, build, originality green.

---

## Phase 19 — A2A agent-to-agent communication — DONE 2026-09-01

*User-directed: A2A (Google Agent2Agent, JSON-RPC 2.0 over HTTP) so every agent
CLI node can exchange messages with other agents — including Hermes mesh peers
— as a client (send to configured peers) and a server (expose live agent nodes
on an opt-in loopback endpoint).*

### Task 19.1: Protocol primitives (core, TDD)
- `src/core/a2a/protocol.ts` — `buildMessageSend`, `parseAgentCard`,
  `extractResponseText`, `parseRpcError`, `isRpcResponse`. Pure, never throws,
  browser-safe (no node imports — the renderer imports it for peer testing).
- **Status: DONE (TDD, 13 tests).**

### Task 19.2: A2A client (core, TDD)
- `src/core/a2a/client.ts` — `discoverAgentCard` + `sendText` (injectable
  fetch, mandatory timeouts, optional Bearer token). Telegram-client patterns.
- **Status: DONE (TDD, 9 tests).**

### Task 19.3: A2A server for agent nodes (main, TDD)
- `src/main/a2a/server.ts` — loopback-only, token-gated JSON-RPC endpoint;
  agent card at `/.well-known/agent-card.json` (open — titles only);
  `message/send` → bracketed-paste into the target node's PTY; opt-in setting
  `agentA2aServer` (default OFF); discovery file `userData/a2a-agent.json`
  (removed on close); targets matched by `@title:` prefix (fallback: first
  live agent — an unmatched address never silently drops a message).
- **Status: DONE (TDD, 9 tests) + live-verified.** Boot-gate fix: the gate now
  also syncs at `whenReady` (it previously only fired on settings-set, so a
  pre-set setting never started the server). E2E (headless, built app, real
  protocol): card 200 + lists the live node; no-token 401; message/send →
  agent Message result; **pasted text visible in the terminal node**; unknown
  method → -32601. 9/9 passed.

### Task 19.4: A2A client wiring + send-to-peer
- `LinkService.a2aSend` → the real `core/a2a/client.sendText` (env token
  `TERMSPRAWL_A2A_PEER_TOKEN_<ID>` wins); peer replies delivered back into the
  source node (chat context event, or a one-line terminal paste);
  `links:send-to-peer` IPC + `links.sendToPeer` bridge; canvas context menu
  "A2A send to peer ▸" on any agent terminal (peers from settings; inline
  status note).
- **Status: DONE.**

### Task 19.5: Settings — tokens, test, toggle
- `A2APeer.token?` (normalize round-trips it); peer rows gain **test**
  (discoverAgentCard → "✓ <peer name>" / "✗ <error>") + a token field; General
  gains the "Expose agent nodes to A2A peers" toggle.
- **Status: DONE.**

### Task 19.6: Loopback round-trip e2e
- **Status: DONE** (see 19.3 — same run).

### Task 19.7: Server Edition links parity
- `src/main/links/*` moved to `src/core/links/service.ts` +
  `src/core/links-scheduler.ts` (the no-electron guard caught the server →
  main import; now both hosts construct the same service). Server handlers
  gained all five `links:*` channels; the shim's `links` namespace is a REAL
  implementation, not a stub. The A2A **server** (exposing nodes) stays
  desktop-only by design; A2A **client** (send-to-peer) works in both editions.
- **Status: DONE.** typecheck + 835 tests + build + build:server green.

---

## Settings polish (2026-09-01, branch feature/settings-polish)

*User report: the settings panel had purple highlights (the OS/GTK accent
leaking through native form controls), cramped 10px mono buttons, and dead
controls on editions/installs that can't use them.*

- **One control system for the whole sheet** (`styles.css`, scoped to
  `.settings-content`): checkboxes/radios get `accent-color: var(--accent)`
  (lime, both themes — the OS purple can never reappear); inputs/selects/
  textareas share one 32px box at 13px Geist (sans, body font stack); selects
  are `appearance: none` with an inline SVG chevron; every control gets a
  lime `:focus-visible` ring; buttons are a two-variant system —
  `.settings-btn` (neutral) / `.settings-btn.accent` (primary, lime outline) /
  `.settings-btn.danger` (red is a hover/armed STATE, never a resting color).
  All sections (accounts, A2A peers, API providers, cloud/user, telegram,
  relay, agents, updates) use it; the old cramped `.account-login/-delete`
  10px mono styles are gone. The LinkInspector popover shares the system.
- **Edition/feature gating**: `runtimeInfo()` on the bridge (main answers
  `app:runtime-info` with `app.isPackaged`; the Server Edition shim returns
  `packaged: false`) — the Updates section shows its real toggle only in a
  packaged desktop build and an honest explanation otherwise. Tab/section
  edition filters were already in place and verified.
- **Verified** (headless, built app, raw CDP — assertions on computed styles
  across all five tabs): buttons 32px/13px Geist/`rgb(198,241,53)` accent;
  selects `appearance: none` + 32px; checkbox/radio accent lime; focused input
  gets a lime border + ring; **zero purple-painted pixels** in the sheet;
  destructive buttons rest neutral. 835 tests, typecheck, build, originality
  green. Screenshot: e2e artifact (not committed).

---

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
- **O-3** ~~Keep the hosted relay feature in v1, or ship desktop-only first and
  add relay later?~~ → **DECIDED: relay ships standalone with in-app pairing +
  terminal frames (v0.23.0); hosting rides the cloud canvas-spaces infra.**
- **O-4** ~~Minimum supported tmux version?~~ → **DECIDED: >= 3.2
  (AGENTS.md "Runtime prerequisites").**
- **O-5** Electron vs Tauri: Electron chosen (node-pty + Monaco maturity);
  revisit only if a concrete constraint appears.

---

## Phase 15 — Online canvas spaces (deviation — user-directed 2026-08-29)

*Hosted "canvas space" per Pro member at `canvas.termsprawl.com/<login>`: a
Server Edition instance per user in a Docker container on hermes-box, synced
with the desktop via backup-shaped snapshots. Full plan:
`.hermes/plans/2026-08-29_210125-online-canvas-spaces.md`. Sync model = the
pull-model, backup-shaped option (D1-B) the user chose: spaces push
snapshots (workspace + project files + terminal scrollback) to the cloud
store; desktop pulls them in as a NEW local project ("Open online snapshot")
and can push a project back up. One writer at a time; no merge logic.*

### Task 15.1: Cloud control plane (termsprawl-web)

- ✅ A1 spaces store — one space per Pro user, atomic JSON store
  (`47e9670`, proto-safety fix `b3e42d4`).
- ✅ A2 short-lived space access tokens (HS256, 5 min) — `7043c7e`.
- ✅ A3 docker space provisioning (`ts-space-<login>`, caps, port pool
  3101–3199, reconcile) — `eb68ff9`.
- ✅ A4 spaces API (pro-gated provision / access / status / delete) —
  `6b4ba34`.
- ✅ A5 space-router (`canvas.termsprawl.com/<login>` → container: JWT gate +
  HttpOnly router cookie, wake-on-connect with retry page, raw-TCP WS
  passthrough, deterministic shutdown) — `b1f5e36` (+ systemd unit).
- ✅ Space-content store + routes (the sync endpoint the app's engine
  already targets): `/api/v1/space/content` (bearer `space-sync` JWT from
  the space) and `/api/v1/spaces/push|pull` (session, Pro) — plus the
  space-manager minting signed long-lived sync tokens (stateless
  verification; boot-token secret still never persisted).

### Task 15.2: Space image & sync engine (app repo)

- ✅ B1 `Dockerfile.space` + build script (node-pty recompiled for plain
  node, non-root, /data volume) — `6735e47`.
- ✅ B2 space-sync engine (TDD, Electron-free: push/pull, coalescing
  scheduler with one chained follow-up) — `c63c698` + `b3aca6d`.
- ✅ B3+B4 boot-restore + snapshot push + scrollback in Server Edition —
  `68bd1f7`.

### Task 15.3: Client surfaces

- ✅ C1 desktop — cloud spaces methods + Settings "Open your online canvas"
  (Pro-gated) — `5e72975`.
- ✅ C2 dashboard — Spaces card (create/provisioning/open/resume/retry
  states, mock-mode aware) — `a25a4a3`.

### Task 15.4: Desktop sync loop

- ✅ D1 "Open online snapshot" (new local project, collision-safe naming,
  scrollback persisted for the cold-start replay) + D2 "Sync this project
  online" (pushes nodes + scrollbacks + revs) — `643ed91`.

### Task 15.5: Ops & launch

- ✅ DNS `canvas.termsprawl.com` → box (DNS-only) + runbook
  `docs/SPACES-OPS.md` (capacity, idle-stop, tokens, kill switch) —
  `a65f6e0`.
- ✅ `scripts/space-e2e.sh` verified END-TO-END (seed cloud → boot-restore →
  WS drive → push → restart persistence → post-restart push) — `09c51f9`;
  the run exposed two real bugs, fixed in `7de4a54`: restore used
  project:add for unknown projects (mismatched ids → restore silently
  no-opped; new `project:import` keeps snapshot ids) and WS saves never
  marked the sync pusher dirty (the entrypoint now shares createApp's
  dispatcher + an onRequest mutation hook).
- ✅ On-box deploy LIVE (2026-08-30): space image `ts-space:latest` built on
  the box; cloud API (content store) + `space-router.service` (:3030) +
  Caddy `canvas.termsprawl.com` vhost; SPACE_JWT_SECRET provisioned;
  production smoke PASS (provision → container on 3101 → access token →
  HTTPS token hop → 200 page → WS save → snapshot in
  `data/spaces/content/`). Note: the router listens on `SPACE_ROUTER_PORT`
  (the shared env file's PORT=8787 must not hijack it) — `7aca255`.
- ✅ Pre-release review findings fixed (app `16ef828`, web `b23cb43` +
  `921d2ea`): openSpace http(s) scheme guard, snapshot id remap on D1 pull
  (load-bearing ids), bounded body reads + drain-for-413 on the cloud,
  DELETE /me removes the space snapshot, unique tmp names, secret-fallback
  warning, SpaceCard URLSearchParams, shim space stubs.
- ✅ RELEASED **v0.14.0** (2026-08-30): branch merged to main,
  `scripts/release.sh 0.14.0` green, GitHub release verified by read-back
  (AppImage + .deb + latest-linux.yml), termsprawl.com live at 0.14.0,
  `ts-space:latest` rebuilt on the box from final main. Web-dev handoff:
  termsprawl-web `docs/CANVAS-SPACES-NEXT-STEPS.md`.
- ✅ Space image ships the full agent bench (2026-08-31): the starting
  container now carries every CLI the canvas expects — `claude`, `codex`,
  `grok`, and Antigravity (`agy`, the Gemini CLI) with a `gemini`→`agy` shim
  for older canvas files. CLI auth dirs (~/.claude, ~/.codex, ~/.grok,
  ~/.gemini) are symlinked onto the /data volume so logins survive container
  recreation; a seeded welcome project opens a fresh space on a ready
  terminal node. Registry display rename: 'Gemini CLI' → 'Antigravity'
  (id/command unchanged for persisted nodes).
- ✅ Phase 17 — GitHub repo import (2026-08-31, branch feature/github-import):
  connect GitHub once via the cloud device flow (scope now includes `repo`);
  the token is stored ONLY in the cloud's per-user encrypted vault. Desktop:
  "Import from GitHub…" at project creation + a GitHub connection row in
  Settings → User & cloud (with disconnect = vault wipe). Spaces: `github:import`
  RPC + boot-time `github:suggest` broadcast; the container clones via
  90-second broker URLs (`POST /api/v1/github/import-url`, session OR
  space-sync JWT, 30/min/user) and never sees the token. Imported projects
  install with pnpm 11.22.0 from a shared per-user store
  (/data/pnpm-store + `pnpmi` helper in the ts-space image). **Status: MERGED
  + SHIPPED** — github-import fully wired in the app (core/github-import.ts,
  cloud vault, spaces RPC + broker URLs); see the v0.24.0-era release notes.
