import { app, BrowserWindow, dialog, ipcMain, Notification, protocol, net, shell, screen } from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '../shared/ipc'
import type { ContextLinkListResult, ContextLinkWriteResult, DiffBase, DiffInfoResult, ProjectRemote, ProjectSettings, PtyCreateRequest, PtyExitInfo, SerializedNode, AppSettings, GitPanelSnapshot, GitResult, GitTarget, CommitMessageResult, Announcement, FileReadResult, FileWriteResult, DirListResult } from '../shared/types'
import type { CorePlatform } from '../core/platform'
import { diffInfo, findRepoRoot, currentBranch, remoteUrl, syncState, gitStatus, listBranches, recentCommits, ghAuthed, stageChanges, unstageChanges, discardChanges, commitChanges, createBranch, checkoutBranch, push as gitPush, pull as gitPull, publish as gitPublish, listWorktrees, addWorktree, removeWorktree } from '../core/git-service'
import {
  remoteRepoRoot, remoteCurrentBranch, remoteRemoteUrl, remoteSyncState, remoteGitStatusChanges,
  remoteListBranches, remoteRecentCommits, remoteStageChanges, remoteUnstageChanges, remoteDiscardChanges,
  remoteCreateBranch, remoteCheckoutBranch, remoteGitCommit, remotePush, remotePull, remotePublish,
  remoteStagedDiff, remoteShowFromRef
} from '../core/remote-git'
import { remoteFileRead, remoteFileWrite, remoteListDir } from '../core/remote-file'
import { sshControlPath, type RemoteHost } from '../core/ssh'
import { generateCommitMessage, generateCommitMessageFromDiff } from '../core/commit-message'
import { parseLatestRelease } from '../core/announcements'
import { classifyFile, listProjectDir, readProjectFile, writeProjectFile } from '../core/file-service'
import { addLink, listLinks, removeLink } from '../core/context-links'
import { ensureContextDiscovery } from '../core/context-discovery'
import { createManagedAccount, deleteManagedAccount, activeAccount, claudeConfigEnv } from '../core/agent-accounts'
import { claudeLoginCommand, claudeSupportsPermissionMode } from '../core/agent-cli'
import { FILE_PROTOCOL, fromFilePreviewUrl } from '../shared/file-url'
import { PtyManager } from '../core/pty-manager'
import { shouldNotify, type AgentStatus } from '../shared/agent-status'
import { createTelegramBot, type TelegramBot } from './telegram/bot'
import { createChatRuntime, type ChatRuntime } from '../core/chat/runtime'
import { projectChatTools } from '../core/chat/project-tools'
import { resolveFileScope } from '../core/project-scope'
import { createRelayRuntime, type RelayRuntime } from './relay'
import { WorkspaceStore } from '../core/workspace-store'
import { LinkService } from './links/service'
import type { NodeLink } from '../shared/types'
import type { ProjectMeta } from '../core/workspace-files'
import { loadProjectFile } from '../core/workspace-files'
import { buildProjectPushPayload, snapshotCurrentProject, uniqueOnlineSnapshotName, type SnapshotWorkspace } from '../core/space-snapshots'
import { applyBundlePlan, buildBundle, isValidBundle, terminalIdsIn, type WorkspaceBundle } from '../core/workspace-bundle'
import { deleteProjectAndDestroyTerminals } from '../core/project-deletion'
import { closeTerminalNode } from '../core/terminal-close'
import { loadAppSettings, saveAppSettings } from '../core/app-settings'
import { createUpdateBridge } from './updates'
import { createCloudRuntime } from './cloud'
import { CloudError } from '../core/cloud'
import { clampWindowBounds, desiredUiZoom, FALLBACK_WORK_AREA } from './window-metrics'
import type { CloudBackup, CloudDevicePoll, CloudDeviceStart, CloudGithubFailure, CloudGithubImportResult, CloudGithubReposResult, CloudSpace, CloudSpacePullEmpty, CloudSpacePullResult, CloudSpacePushResult, CloudUser, WorkspaceBundleExportResult, WorkspaceBundleImportResult } from '../shared/types'
import { HookServer } from '../core/hook-server'
import { claudeSettingsPath, installClaudeHooks } from './agents/hook-installer'
import { SessionNameTracker } from '../core/session-name'
import { agentSessionNameChannel } from '../shared/ipc'
import { browserRuntime, ensureBrowserDebugPort } from './browser/runtime'
import {
  installBrowserSecurity,
  registerBrowserGuest,
  unregisterBrowserGuest,
  navigateBrowserNode
} from './browser/manager'
import { startAgentServer, type AgentServerHandle } from './browser/agent-server'
import { startCdpFacade, type CdpFacadeHandle } from './browser/cdp-facade'
import { startA2aServer, type A2aServerHandle, type A2aNodeInfo } from './a2a/server'
import { sendText } from '../core/a2a/client'
import type { BrowserCdpInfo, BrowserNavigateResult } from '../shared/types'

// App settings must be readable BEFORE the ozone-respawn / debug-port decision
// below: the agent-browser-control gate decides whether we open ANY browser
// debug surface, the raw `--remote-debugging-port` included (13.4). Off means
// no debug endpoint exists — not just "unadvertised".
// `app.getPath('userData')` is valid at module load.
const appSettings = { current: loadAppSettings(app.getPath('userData')) }
const agentBrowserControlEnabled = (): boolean =>
  appSettings.current.agentBrowserControl === true

// ── Wayland → X11 ozone fix ─────────────────────────────────────────────────
// Electron chooses the browser (main) process's ozone platform during native
// startup, BEFORE this JS module runs. So `app.commandLine.appendSwitch(
// 'ozone-platform', 'x11')` only moves the *child* processes (GPU/renderer) to
// X11 while the browser stays on Wayland — a broken mix where the window is
// created but never appears (verified on Ubuntu 26 / Wayland with Electron 43).
// The only way to move the browser process is to put the flag on its real argv,
// so on a Wayland session without one we re-spawn ourselves with the flag and
// let this (wrong-ozone) instance exit. The re-spawned child already has the
// flag and therefore does not re-spawn.
const needsX11Respawn =
  process.platform === 'linux' &&
  process.env.XDG_SESSION_TYPE === 'wayland' &&
  !process.argv.some((a) => a.startsWith('--ozone-platform'))

if (needsX11Respawn) {
  // Forward the ozone fix plus the browser-node CDP port. Only add a debug
  // port when one isn't already on the real argv (a user/agent may pass
  // --remote-debugging-port manually); putting it on the real argv is the
  // reliable path, and ensureBrowserDebugPort() reconciles cdp-info to whatever
  // is actually in effect.
  const extra = ['--ozone-platform=x11']
  if (agentBrowserControlEnabled() && !process.argv.some((a) => a.startsWith('--remote-debugging-port'))) {
    extra.push(`--remote-debugging-port=${browserRuntime.port}`)
  }
  spawn(process.execPath, [...process.argv.slice(1), ...extra], {
    detached: true,
    stdio: 'inherit'
  }).unref()
  // Exit immediately so no window/IPC is set up in this wrong-ozone instance.
  process.exit(0)
}

// Expose the browser-node CDP endpoint — only when agent control is enabled
// (13.4). On the Wayland respawn path the flag is already on the child's real
// argv (kept identical); on a native X11 session this appends it via the
// command line, which IS honoured for the debug port (unlike the ozone flag).
if (agentBrowserControlEnabled()) ensureBrowserDebugPort()
// Harden every <webview> guest that the browser nodes create, before any exists.
installBrowserSecurity()

// On some hosts the GPU (Chromium GPU process) segfaults at startup even over
// X11/XWayland — `GPU process exited unexpectedly: exit_code=139` (SIGSEGV),
// `Failed to send GpuControl.CreateCommandBuffer`. This is a host-driver /
// GPU-diagnostic failure, not an app bug; a terminal-canvas UI needs no real
// GPU, so fall back to software rendering so the app reliably opens. (Verified
// 2026-08-23: `--disable-gpu` on the affected Ubuntu 26 host boots fine and
// spawns tmux sessions; without it the app dies with SIGSEGV.) The user can
// still opt back in with `--enable-gpu` from a launcher the app did not set.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-gpu')
}

// Must run before app.ready so <img src="termsprawl-file://..."> is treated as
// a secure custom scheme (otherwise Chromium blocks it under the CSP).
protocol.registerSchemesAsPrivileged([
  {
    scheme: FILE_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

// The Electron implementation of the core's platform seam.
const platform: CorePlatform = {
  userDataPath: app.getPath('userData'),
  broadcast(channel: string, payload: unknown): void {
    // Node links (Phase 18): every PTY byte flows through here — tap terminal
    // activity so the link scheduler can debounce auto runs. linkService is
    // constructed below; broadcast only fires once sessions exist.
    if (channel.startsWith('pty:data:')) {
      linkService.notePtyActivity(channel.slice('pty:data:'.length))
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  }
}

const ptyManager = new PtyManager(platform)
const workspaceStore = new WorkspaceStore(platform)

// Node links (Phase 18): persisted typed edges + the auto-run scheduler.
const linkService = new LinkService({
  allLinks: () => workspaceStore.allLinks(),
  findLink: (id) => workspaceStore.findLink(id),
  projectOfNode: (nodeId) => {
    for (const project of workspaceStore.snapshot().index.projects) {
      const nodes = workspaceStore.snapshot().projects[project.id] ?? []
      if (nodes.some((n) => n.id === nodeId)) return { id: project.id, cwd: project.cwd }
    }
    return null
  },
  capturePane: (id) => ptyManager.capturePane(id),
  ptyWrite: (id, data) => ptyManager.write(id, data),
  chatBroadcast: (nodeId, event) => platform.broadcast(`chat:event:${nodeId}`, event),
  nodesOfProject: (projectId) => (workspaceStore.snapshot().projects[projectId] ?? []) as unknown as Array<Record<string, unknown>>,
  recordLinkRun: (projectId, linkId, at, ok, summary) =>
    workspaceStore.recordLinkRun(projectId, linkId, at, ok, summary),
  sendToPeer: async (peerId, text, opts) => {
    // Resolve the configured peer (settings a2aPeers; env token wins).
    const peer = appSettings.current.a2aPeers?.find((p) => p.id === peerId)
    if (!peer) throw new Error(`unknown peer: ${peerId}`)
    const envToken = process.env[`TERMSPRAWL_A2A_PEER_TOKEN_${peerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`]
    const res = await sendText(peer.endpoint, text, {
      token: envToken || peer.token,
      timeoutMs: 20000
    })
    if (!res.ok) throw new Error(res.error)
    // A peer's text reply, when asked for, is delivered back into the SOURCE
    // node (chat: appended message; terminal: one-line paste).
    const replyText = res.ok && 'text' in res ? res.text : undefined
    if (opts.deliverReply && replyText && opts.sourceNodeId) {
      let srcKind: string | undefined
      for (const project of workspaceStore.snapshot().index.projects) {
        const nodes = workspaceStore.snapshot().projects[project.id] ?? []
        const found = nodes.find((n) => n.id === opts.sourceNodeId) as
          | { data?: { kind?: string } }
          | undefined
        if (found) {
          srcKind = found.data?.kind
          break
        }
      }
      if (srcKind === 'chat') {
        platform.broadcast(`chat:event:${opts.sourceNodeId}`, {
          kind: 'context-added',
          messageId: `a2a-${Date.now().toString(36)}`,
          role: 'user',
          content: `[reply from peer ${peerId}]\n${replyText}`,
          sourceTitle: `peer ${peerId}`
        })
      } else {
        ptyManager.write(opts.sourceNodeId, `\x1b[200~[termsprawl] peer ${peerId} replied: ${replyText}\x1b[201~`)
      }
    }
    return { reply: replyText }
  },
  userDataPath: platform.userDataPath
})
const updateBridge = createUpdateBridge({
  isPackaged: app.isPackaged,
  autoDownload: appSettings.current.autoDownloadUpdates,
  broadcast: (channel, payload) => platform.broadcast(channel, payload)
})

// Termsprawl Cloud: in-app GitHub sign-in (device flow) + workspace backup.
const cloud = createCloudRuntime({
  apiBase: appSettings.current.cloudApiBase || 'https://termsprawl.com',
  snapshot: () => workspaceStore.snapshot()
})

// Agent hook server (Phase 7): receives lifecycle POSTs from agent CLIs,
// broadcasts normalized status events to the renderer, and fires OS
// notifications when a node's agent goes busy→idle while the window is
// unfocused. Fail-open — an agent keeps working even if this never fires.
const prevStatus = new Map<string, AgentStatus>()
const sessionNames = new SessionNameTracker()
const hookServer = new HookServer((event) => {
  platform.broadcast(`${IPC.agentStatus}:${event.sessionId}`, event)

  // Session-name sync (Task 7.4): when the agent's transcript reveals a
  // (possibly renamed) session name, broadcast it so the node title follows.
  const sessionName = sessionNames.note(event.sessionId, event.transcriptPath)
  if (sessionName) {
    platform.broadcast(agentSessionNameChannel(event.sessionId), {
      sessionId: event.sessionId,
      name: sessionName
    })
  }

  const prev = prevStatus.get(event.sessionId)
  prevStatus.set(event.sessionId, event.status)

  const focused = BrowserWindow.getFocusedWindow()?.isFocused() ?? false
  const knownSession = ptyManager.has(event.sessionId)
  if (!shouldNotify(prev, event.status, { knownSession, windowFocused: focused })) return

  if (Notification.isSupported()) {
    const label = event.status === 'done' ? 'finished' : event.status === 'waiting' ? 'needs you' : 'blocked'
    const notification = new Notification({
      title: 'termsprawl',
      body: `agent ${label}${event.tool ? ` (${event.tool})` : ''}`
    })
    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })
    notification.show()
  }
})

// Agent-control surface (13.3/13.4): the CDP facade re-exposes browser-node
// guests as `page` targets so Playwright can drive them, and the token-gated
// loopback server lets an agent open a node. Both are localhost-only and
// OPT-IN via settings → General → "allow agents to control browser nodes"
// (off by default — browser nodes work fine manually without any agent
// endpoint). See browser/cdp-facade.ts + browser/agent-server.ts.
let agentServer: AgentServerHandle | null = null
let cdpFacade: CdpFacadeHandle | null = null
// Generation counter: a stop() invalidates any in-flight start() so a rapid
// off→on→off toggle can't leave endpoints running while the setting is off.
let browserControlEpoch = 0

/** Start the agent-control surface. Idempotent; no-ops when already running. */
async function startBrowserControlEndpoints(): Promise<void> {
  if (cdpFacade) return
  const epoch = ++browserControlEpoch
  try {
    const facade = await startCdpFacade({
      cdpInfo: { wsUrl: browserRuntime.wsUrl, host: '127.0.0.1', port: browserRuntime.port }
    })
    if (epoch !== browserControlEpoch) {
      void facade.close()
      return
    }
    const server = await startAgentServer({
      userDataPath: platform.userDataPath,
      broadcast: (channel, payload) => platform.broadcast(channel, payload),
      cdp: { wsUrl: facade.url, host: '127.0.0.1', port: facade.port }
    })
    if (epoch !== browserControlEpoch) {
      void server.close()
      void facade.close()
      return
    }
    cdpFacade = facade
    agentServer = server
  } catch (err) {
    console.error('[browser] agent-control facade failed to start:', err)
    void cdpFacade?.close()
    cdpFacade = null
    agentServer = null
  }
}

function stopBrowserControlEndpoints(): void {
  browserControlEpoch += 1 // invalidate any in-flight start
  if (agentServer) {
    void agentServer.close()
    agentServer = null
  }
  if (cdpFacade) {
    void cdpFacade.close()
    cdpFacade = null
  }
}

/** Keep the agent-control surface in sync with the settings toggle. */
function syncAgentBrowserControl(): void {
  if (appSettings.current.agentBrowserControl === true) {
    void startBrowserControlEndpoints()
  } else {
    stopBrowserControlEndpoints()
  }
}

// ---------------------------------------------------------------------------
// A2A server (Phase 19): expose live agent terminal nodes as A2A agents.
// Opt-in (agentA2aServer, default OFF), loopback-only, token-gated.
// ---------------------------------------------------------------------------
let a2aServer: A2aServerHandle | null = null
let a2aEpoch = 0

/** Live agent terminal nodes: a terminal node spawned with an agent command
 * preset (command set + agentCommand known to the registry). */
function liveA2aNodes(): A2aNodeInfo[] {
  const out: A2aNodeInfo[] = []
  for (const project of workspaceStore.snapshot().index.projects) {
    for (const node of workspaceStore.snapshot().projects[project.id] ?? []) {
      const data = node.data as { kind?: string; command?: string; title?: string }
      if (data?.kind !== 'terminal' || typeof data.command !== 'string' || data.command.length === 0) {
        continue
      }
      out.push({
        id: node.id,
        title: data.title ?? data.command,
        command: data.command
      })
    }
  }
  return out
}

async function startA2aEndpoint(): Promise<void> {
  if (a2aServer) return
  const epoch = ++a2aEpoch
  try {
    const handle = await startA2aServer({
      userDataPath: platform.userDataPath,
      agentNodes: liveA2aNodes,
      deliverToNode: async (nodeId, text) => {
        // Bracketed paste: the ONE inbound channel every agent CLI reads.
        ptyManager.write(nodeId, `\x1b[200~${text}\x1b[201~`)
      }
    })
    if (epoch !== a2aEpoch) {
      // Toggled off while starting — shut it straight back down.
      await handle.close()
      return
    }
    a2aServer = handle
  } catch (err) {
    console.error('[a2a] server failed to start:', err)
    a2aServer = null
  }
}

function stopA2aEndpoint(): void {
  a2aEpoch += 1
  if (a2aServer) {
    void a2aServer.close()
    a2aServer = null
  }
}

/** Keep the A2A endpoint in sync with the settings toggle. */
function syncA2aServer(): void {
  if (appSettings.current.agentA2aServer === true) {
    void startA2aEndpoint()
  } else {
    stopA2aEndpoint()
  }
}

// ---------------------------------------------------------------------------
// Chat driver v2 (Phase 11 Task 11.4). Provider/key resolution: settings.chat
// holds keys locally (never committed); env TERMSPRAWL_PROVIDER_KEY_<ID>
// wins per provider — same rule as the Telegram token.
// ---------------------------------------------------------------------------
const chatRuntime: ChatRuntime = createChatRuntime({
  resolveProvider: (req) => {
    const chat = appSettings.current.chat
    const providers = appSettings.current.apiProviders ?? []
    const wanted = req.provider ?? chat?.defaultProvider ?? providers[0]?.id
    const provider = providers.find((p) => p.id === wanted || p.name === wanted)
    if (!provider) return null
    const envKey = process.env[`TERMSPRAWL_PROVIDER_KEY_${provider.id.toUpperCase()}`]
    const storedKey = chat?.keys?.find((k) => k.providerId === provider.id)?.key
    const apiKey = envKey || storedKey || ''
    if (!apiKey) return null
    const isAnthropic = /anthropic/i.test(provider.baseUrl) || /anthropic/i.test(provider.name)
    return {
      id: provider.id,
      baseUrl: provider.baseUrl,
      apiKey,
      api: isAnthropic ? 'anthropic' : 'openai',
      model: req.model ?? chat?.defaultModel
    }
  },
  broadcast: (nodeId, event) => platform.broadcast(`chat:event:${nodeId}`, event),
  // Audit B3: project-scoped read-only tools. The chat is anchored to the
  // active project's cwd (resolved from the workspace index); tools refuse
  // anything outside it via resolveFileScope.
  toolsFor: (req) => {
    const cwd = workspaceStore
      .snapshot()
      .index.projects.find((p) => !p.closed && p.cwd)?.cwd
    return cwd ? projectChatTools(workspaceStore, { cwd }) : []
  },
  log: (msg) => console.log(`[chat] ${msg}`)
})

function registerChatIpc(): void {
  ipcMain.handle(IPC.chatSend, (_event, req: { nodeId: string; messages: unknown[]; model?: string; provider?: string }) => {
    if (typeof req?.nodeId !== 'string' || !Array.isArray(req.messages)) {
      return Promise.resolve({ ok: false, error: 'bad chat request' })
    }
    return chatRuntime.send(req as Parameters<ChatRuntime['send']>[0])
  })
  ipcMain.handle(IPC.chatStop, (_event, nodeId: string) => {
    if (typeof nodeId === 'string') chatRuntime.stop(nodeId)
  })
  ipcMain.handle(IPC.chatApprove, (_event, nodeId: string, callId: string, decision: 'approve' | 'deny') => {
    if (typeof nodeId === 'string' && typeof callId === 'string' && (decision === 'approve' || decision === 'deny')) {
      chatRuntime.approve(nodeId, callId, decision)
    }
  })
}

// Relay seam (Phase 11 Task 11.2) — nothing dials the relay unless asked.
const relayRuntime: RelayRuntime = createRelayRuntime({
  resolveTarget: () => {
    const relay = appSettings.current.relay
    if (!relay?.url) return null
    return {
      url: relay.url,
      role: relay.role === 'client' ? 'client' : 'host',
      invite: relay.invite,
      token: process.env.TERMSPRAWL_RELAY_GITHUB_TOKEN
    }
  },
  broadcast: (channel, payload) => platform.broadcast(channel, payload),
  log: (msg) => console.log(`[relay] ${msg}`)
})

function registerRelayIpc(): void {
  ipcMain.handle(IPC.relayStatus, () => ({ state: relayRuntime.state(), error: relayRuntime.lastError() }))
  ipcMain.handle(IPC.relayConnect, () => relayRuntime.connect())
  ipcMain.handle(IPC.relayDisconnect, () => {
    relayRuntime.disconnect()
  })
  // Decrypted frames only leave the runtime while the renderer listens.
  ipcMain.on(IPC.relayFrameSubscribe, () => {
    relayRuntime.setFrameListener((frame) => platform.broadcast('relay:frame', frame))
  })
  ipcMain.on(IPC.relayFrameUnsubscribe, () => {
    relayRuntime.setFrameListener(null)
  })
}

// ---------------------------------------------------------------------------
// Telegram bot (Phase 11 Task 11.3). Started/stopped from the settings toggle.
// Token: env TERMSPRAWL_TELEGRAM_TOKEN wins over settings.telegram.token — never
// hardcoded, never committed. Pairing persists via saveAppSettings.
// ---------------------------------------------------------------------------
let telegramBot: TelegramBot | null = null
let telegramBotActiveToken: string | null = null

function telegramToken(): string | null {
  return process.env.TERMSPRAWL_TELEGRAM_TOKEN || appSettings.current.telegram?.token || null
}

/** Keep the bot in sync with settings (enabled + token). Recreates on token change. */
function syncTelegramBot(): void {
  const enabled = appSettings.current.telegram?.enabled === true
  const token = telegramToken()
  if (!enabled || !token) {
    if (telegramBot) {
      telegramBot.stop()
      telegramBot = null
      telegramBotActiveToken = null
    }
    return
  }
  if (telegramBot && telegramBotActiveToken !== token) {
    telegramBot.stop()
    telegramBot = null
  }
  if (!telegramBot) {
    const botLogPath = join(platform.userDataPath, 'telegram.log')
    telegramBot = createTelegramBot({
      token,
      allowedChatIds: () => appSettings.current.telegram?.allowedChatIds ?? [],
      saveAllowedChatIds: (ids) => {
        appSettings.current = saveAppSettings(platform.userDataPath, {
          telegram: { ...appSettings.current.telegram, allowedChatIds: ids }
        })
      },
      workspaceStore,
      ptyManager,
      version: () => app.getVersion(),
      // console.log is buffered when stdout is a pipe/file (an unflushed few
      // lines vanish on a long-running app), so ALSO append synchronously to a
      // log file that always flushes — human-readable bot history + diagnostics.
      log: (msg) => {
        console.log(`[telegram] ${msg}`)
        try {
          appendFileSync(botLogPath, `${new Date().toISOString()} ${msg}\n`, 'utf8')
        } catch {
          // best-effort
        }
      }
    })
    telegramBotActiveToken = token
  }
  void telegramBot.start()
}

function registerWorkspaceIpc(): void {
  ipcMain.handle(IPC.workspaceSnapshot, () => workspaceStore.snapshot())
  ipcMain.handle(IPC.workspaceSaveNodes, (_event, id: string, nodes: SerializedNode[]) =>
    workspaceStore.saveNodes(id, nodes)
  )

  // Node links (Phase 18)
  ipcMain.handle(IPC.linksList, (_event, projectId: string): NodeLink[] => {
    if (typeof projectId !== 'string') return []
    const project = workspaceStore.snapshot().index.projects.find((p) => p.id === projectId)
    if (!project) return []
    return loadProjectFile(platform.userDataPath, project)?.links ?? []
  })
  ipcMain.handle(IPC.linksRun, (_event, linkId: string) => {
    if (typeof linkId !== 'string') return { ok: false, summary: 'bad request' }
    return linkService.runById(linkId)
  })
  ipcMain.handle(IPC.linksMarkDirty, (_event, sourceId: string) => {
    if (typeof sourceId === 'string') linkService.markDirty(sourceId)
  })
  ipcMain.handle(IPC.linksUpdate, (_event, projectId: string, links: NodeLink[]): number => {
    if (typeof projectId !== 'string' || !Array.isArray(links)) return 0
    const rev = workspaceStore.saveLinks(projectId, links)
    linkService.linksChanged()
    return rev
  })
  ipcMain.handle(IPC.linksSendToPeer, (_event, nodeId: string, peerId: string) => {
    if (typeof nodeId !== 'string' || typeof peerId !== 'string') {
      return { ok: false, summary: 'bad request' }
    }
    return linkService.sendNodeToPeer(nodeId, peerId)
  })
  ipcMain.handle(IPC.projectAdd, (_event, name: string, cwd: string | null, remote?: ProjectRemote): ProjectMeta => {
    // Dedupe only local folder projects (a remote project has cwd null, so any
    // remote + any path is its own identity). Two remote projects differ by
    // host/path, not by the null cwd.
    if (cwd) {
      const existing = workspaceStore.snapshot().index.projects.find((p) => p.cwd === cwd)
      if (existing) return existing // folder already has a project — dedupe
    }
    return workspaceStore.addProject(name, cwd, remote)
  })
  ipcMain.handle(IPC.projectClose, (_event, id: string) => workspaceStore.closeProject(id))
  ipcMain.handle(IPC.projectArchive, (_event, id: string) => workspaceStore.archiveProject(id))
  ipcMain.handle(IPC.projectReopen, (_event, id: string) => workspaceStore.reopenProject(id))
  ipcMain.handle(IPC.projectUpdateSettings, (_event, id: string, patch: ProjectSettings) =>
    workspaceStore.updateSettings(id, patch)
  )
  ipcMain.handle(IPC.projectRename, (_event, id: string, name: string) =>
    workspaceStore.renameProject(id, name)
  )
  ipcMain.handle(IPC.projectDelete, (_event, id: string) => {
    const result = deleteProjectAndDestroyTerminals(
      workspaceStore,
      (terminalId) => ptyManager.destroy(terminalId),
      id,
      ptyManager.sessionIdsForProject(id)
    )
    for (const terminalId of result.cleanupPendingIds) {
      console.error(`[project-delete] terminal cleanup pending: ${terminalId}`)
    }
    return result
  })
  ipcMain.handle(IPC.dialogSelectFolder, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

function registerDiffIpc(): void {
  ipcMain.handle(
    IPC.diffInfo,
    (_event, path: string, base: DiffBase, remote?: ProjectRemote): Promise<DiffInfoResult> =>
      remote ? remoteDiffInfo(remote, path, base) : diffInfo(path, base)
  )
  ipcMain.handle(IPC.dialogOpenFile, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'All files', extensions: ['*'] }]
    })
    return result.canceled ? null : result.filePaths[0]
  })
}

// ---------------------------------------------------------------------------
// Phase 9 — remote op routing. The renderer sends a `GitTarget` ({cwd} for
// local folder projects, {remote} for ssh projects); main resolves it to the
// real repo root on the correct side and runs the op there. Remote ops share
// one ControlMaster connection per host (sshControlPath under userData/ssh).
// ---------------------------------------------------------------------------

/** Mirror a ProjectRemote into the transport's RemoteHost shape. */
function toRemoteHost(remote: ProjectRemote): RemoteHost {
  return {
    host: remote.host,
    ...(remote.user ? { user: remote.user } : {}),
    ...(remote.port ? { port: remote.port } : {})
  }
}

/** The remote must belong to a known project (never an arbitrary host/path). */
function isKnownProjectRemote(remote: ProjectRemote): boolean {
  return workspaceStore.snapshot().index.projects.some(
    (p) =>
      p.remote !== undefined &&
      p.remote.host === remote.host &&
      (p.remote.user ?? 'root') === (remote.user ?? 'root') &&
      (p.remote.port ?? 22) === (remote.port ?? 22) &&
      p.remote.path === remote.path
  )
}

type ResolvedGitTarget =
  | { kind: 'local'; cwd: string; root: string }
  | { kind: 'remote'; remote: RemoteHost; root: string; controlPath: string }
  | { kind: 'none'; reason: string }

/** Resolve a GitTarget to a concrete repo root (local or remote). For remote
 * targets, `git rev-parse --show-toplevel` runs over ssh so a project path
 * inside a repo resolves like findRepoRoot does locally. */
async function resolveGitTarget(target: GitTarget): Promise<ResolvedGitTarget> {
  if (target.remote) {
    if (!isKnownProjectRemote(target.remote)) {
      return { kind: 'none', reason: 'no project folder' }
    }
    const remote = toRemoteHost(target.remote)
    const controlPath = sshControlPath(platform.userDataPath, remote)
    const root = await remoteRepoRoot(remote, target.remote.path, { controlPath })
    if (!root) return { kind: 'none', reason: 'not a git repository' }
    return { kind: 'remote', remote, root, controlPath }
  }
  const cwd = target.cwd ?? ''
  if (!cwd || !isKnownProjectCwd(cwd)) return { kind: 'none', reason: 'no project folder' }
  const root = findRepoRoot(cwd)
  if (!root) return { kind: 'none', reason: 'not a git repository' }
  return { kind: 'local', cwd, root }
}

/** Run a git op against whatever side the target resolves to. */
function runGitOp(
  target: GitTarget,
  localOp: (root: string) => Promise<GitResult>,
  remoteOp: (res: { remote: RemoteHost; root: string; controlPath: string }) => Promise<GitResult>
): Promise<GitResult> {
  return resolveGitTarget(target).then((resolved) => {
    if (resolved.kind === 'none') {
      return Promise.resolve({ code: 1, stdout: '', stderr: resolved.reason })
    }
    return resolved.kind === 'remote'
      ? remoteOp(resolved)
      : localOp(resolved.root)
  })
}

/** Validate a remote file path stays inside the project's remote root. */
function resolveRemoteFileTarget(
  remote: ProjectRemote,
  path: string
):
  | { ok: true; remote: RemoteHost; path: string; controlPath: string }
  | { ok: false; code: 'NO_FOLDER' | 'OUTSIDE' | 'IO'; message: string } {
  if (!isKnownProjectRemote(remote)) {
    return { ok: false, code: 'NO_FOLDER', message: 'no project folder' }
  }
  const root = posix.resolve(remote.path)
  const target = posix.resolve(path)
  if (target !== root && !target.startsWith(root + '/')) {
    return { ok: false, code: 'OUTSIDE', message: 'path is outside the project folder' }
  }
  const host = toRemoteHost(remote)
  return { ok: true, remote: host, path: target, controlPath: sshControlPath(platform.userDataPath, host) }
}

/** Diff info for a remote file: original from the git ref, modified from the
 * working tree, both over ssh. Mirrors core's diffInfo semantics. */
async function remoteDiffInfo(
  remote: ProjectRemote,
  path: string,
  base: DiffBase
): Promise<DiffInfoResult> {
  const ctx = resolveRemoteFileTarget(remote, path)
  if (!ctx.ok) {
    // DiffInfoResult only carries IO/NO_REPO/MISSING — fold target errors into IO.
    return { original: null, modified: null, error: { code: 'IO', message: ctx.message } }
  }
  // git -C needs a DIRECTORY (the local diffInfo walks up from dirname(path)).
  const repoRoot = await remoteRepoRoot(ctx.remote, posix.dirname(ctx.path), { controlPath: ctx.controlPath })
  if (!repoRoot) {
    return { original: null, modified: null, error: { code: 'NO_REPO', message: 'not a git repository' } }
  }
  const rel = posix.relative(repoRoot, ctx.path)
  const ref = base === 'staged' ? ':' : 'HEAD'
  const [original, modified] = await Promise.all([
    remoteShowFromRef(ctx.remote, repoRoot, ref, rel, { controlPath: ctx.controlPath }),
    remoteFileRead(ctx.remote, ctx.path, { controlPath: ctx.controlPath }).then((r) =>
      r.ok ? (r.content ?? null) : null
    )
  ])
  if (original === null && modified === null) {
    return {
      original: null,
      modified: null,
      error: { code: 'IO', message: 'path is missing from the ref and the working tree' }
    }
  }
  return { original, modified }
}

function registerFileIpc(): void {
  ipcMain.handle(
    IPC.fileRead,
    (_event, path: string, remote?: ProjectRemote) => remote ? remoteReadFile(path, remote) : readProjectFile(path)
  )
  ipcMain.handle(
    IPC.fileWrite,
    (_event, path: string, content: string, remote?: ProjectRemote) =>
      remote ? remoteWriteFile(path, content, remote) : writeProjectFile(path, content)
  )
  ipcMain.handle(
    IPC.fileList,
    (_event, root: string, rel: string, remote?: ProjectRemote) =>
      remote ? remoteListFolder(root, rel ?? '.', remote) : listProjectDir(root, rel ?? '.')
  )
}

/** Remote file read mirroring readProjectFile: classify by extension, reject
 * binary/image (the local preview protocol can't serve remote images). */
async function remoteReadFile(path: string, remote: ProjectRemote): Promise<FileReadResult> {
  const ctx = resolveRemoteFileTarget(remote, path)
  if (!ctx.ok) {
    return { error: { code: ctx.code === 'OUTSIDE' ? 'IO' : 'MISSING', message: ctx.message } }
  }
  const kind = classifyFile(ctx.path)
  if (kind === 'binary' || kind === 'image') {
    return { error: { code: 'UNSUPPORTED', message: 'binary file — open it elsewhere' } }
  }
  const r = await remoteFileRead(ctx.remote, ctx.path, { controlPath: ctx.controlPath })
  if (!r.ok) return { error: { code: 'MISSING', message: r.error ?? 'file not found' } }
  return kind === 'markdown'
    ? { kind: 'markdown', content: r.content ?? '' }
    : { kind: 'text', content: r.content ?? '' }
}

async function remoteWriteFile(path: string, content: string, remote: ProjectRemote): Promise<FileWriteResult> {
  const ctx = resolveRemoteFileTarget(remote, path)
  if (!ctx.ok) return { error: { code: 'IO', message: ctx.message } }
  const r = await remoteFileWrite(ctx.remote, ctx.path, content, { controlPath: ctx.controlPath })
  return r.ok ? { ok: true } : { error: { code: 'IO', message: r.error ?? 'write failed' } }
}

async function remoteListFolder(root: string, rel: string, remote: ProjectRemote): Promise<DirListResult> {
  const target = posix.resolve(root, rel)
  const ctx = resolveRemoteFileTarget(remote, target)
  if (!ctx.ok) return { error: { code: ctx.code === 'NO_FOLDER' ? 'IO' : ctx.code, message: ctx.message } }
  return remoteListDir(ctx.remote, ctx.path, { controlPath: ctx.controlPath })
}

/** Context-link IPC (Phase 7, 7.5): link files are the source of truth. cwd is
 * validated to be a known project cwd — never an arbitrary root (same "stay
 * inside root" idea as listProjectDir). Folder-less projects return NO_FOLDER. */
function isKnownProjectCwd(cwd: string): boolean {
  return workspaceStore.snapshot().index.projects.some((p) => p.cwd === cwd)
}

function registerContextLinkIpc(): void {
  ipcMain.handle(IPC.contextLinkList, (_event, cwd: string): ContextLinkListResult => {
    if (!isKnownProjectCwd(cwd)) return { ok: false, error: 'NO_FOLDER' }
    return { ok: true, links: listLinks(cwd).map(({ a, b }) => ({ a, b })) }
  })
  ipcMain.handle(IPC.contextLinkAdd, (_event, cwd: string, a: string, b: string): ContextLinkWriteResult => {
    if (!isKnownProjectCwd(cwd)) return { ok: false, error: 'NO_FOLDER' }
    const res = addLink(cwd, a, b)
    if ('error' in res) return { ok: false, error: res.error.code }
    ensureContextDiscovery(cwd)
    return { ok: true }
  })
  ipcMain.handle(IPC.contextLinkRemove, (_event, cwd: string, a: string, b: string): ContextLinkWriteResult => {
    if (!isKnownProjectCwd(cwd)) return { ok: false, error: 'NO_FOLDER' }
    removeLink(cwd, a, b)
    return { ok: true }
  })
}

function gitEmptySnapshot(cwd: string | null): GitPanelSnapshot {
  return {
    cwd,
    branch: '',
    remote: null,
    sync: { upstream: null, ahead: 0, behind: 0 },
    changes: [],
    branches: [],
    commits: [],
    ghAuthed: false
  }
}

function registerGitIpc(): void {
  ipcMain.handle(IPC.gitSnapshot, async (_event, target: GitTarget): Promise<GitPanelSnapshot> => {
    const resolved = await resolveGitTarget(target)
    if (resolved.kind === 'none') return gitEmptySnapshot(target.cwd ?? null)
    const opts = resolved.kind === 'remote' ? { controlPath: resolved.controlPath } : undefined
    const [branch, remote, sync, changes, branches, commits, authed] = await Promise.all([
      resolved.kind === 'remote'
        ? remoteCurrentBranch(resolved.remote, resolved.root, opts)
        : currentBranch(resolved.root),
      resolved.kind === 'remote'
        ? remoteRemoteUrl(resolved.remote, resolved.root, 'origin', opts)
        : remoteUrl(resolved.root),
      resolved.kind === 'remote'
        ? remoteSyncState(resolved.remote, resolved.root, opts)
        : syncState(resolved.root),
      resolved.kind === 'remote'
        ? remoteGitStatusChanges(resolved.remote, resolved.root, opts)
        : gitStatus(resolved.root),
      resolved.kind === 'remote'
        ? remoteListBranches(resolved.remote, resolved.root, opts)
        : listBranches(resolved.root),
      resolved.kind === 'remote'
        ? remoteRecentCommits(resolved.remote, resolved.root, 20, opts)
        : recentCommits(resolved.root, 20),
      ghAuthed()
    ])
    return {
      cwd: resolved.kind === 'remote' ? null : resolved.cwd,
      branch,
      remote,
      sync,
      changes,
      branches,
      commits,
      ghAuthed: authed
    }
  })

  ipcMain.handle(IPC.gitStage, (_event, target: GitTarget, paths: string[]) =>
    runGitOp(target, (r) => stageChanges(r, paths), (r) => remoteStageChanges(r.remote, r.root, paths, { controlPath: r.controlPath }))
  )
  ipcMain.handle(IPC.gitUnstage, (_event, target: GitTarget, paths: string[]) =>
    runGitOp(target, (r) => unstageChanges(r, paths), (r) => remoteUnstageChanges(r.remote, r.root, paths, { controlPath: r.controlPath }))
  )
  ipcMain.handle(IPC.gitDiscard, (_event, target: GitTarget, paths: string[]) =>
    runGitOp(target, (r) => discardChanges(r, paths), (r) => remoteDiscardChanges(r.remote, r.root, paths, { controlPath: r.controlPath }))
  )
  ipcMain.handle(IPC.gitCommit, (_event, target: GitTarget, message: string) =>
    runGitOp(target, (r) => commitChanges(r, message), (r) => remoteGitCommit(r.remote, r.root, message, { controlPath: r.controlPath }))
  )
  ipcMain.handle(
    IPC.gitCommitMessage,
    async (_event, target: GitTarget): Promise<CommitMessageResult> => {
      const resolved = await resolveGitTarget(target)
      if (resolved.kind === 'none') return { ok: false, error: resolved.reason }
      if (resolved.kind === 'remote') {
        const diff = await remoteStagedDiff(resolved.remote, resolved.root, {
          controlPath: resolved.controlPath
        })
        return generateCommitMessageFromDiff(diff)
      }
      return generateCommitMessage(resolved.root)
    }
  )
  ipcMain.handle(IPC.gitCreateBranch, (_event, target: GitTarget, name: string) =>
    runGitOp(target, (r) => createBranch(r, name), (r) => remoteCreateBranch(r.remote, r.root, name, { controlPath: r.controlPath }))
  )
  ipcMain.handle(IPC.gitCheckout, (_event, target: GitTarget, name: string) =>
    runGitOp(target, (r) => checkoutBranch(r, name), (r) => remoteCheckoutBranch(r.remote, r.root, name, { controlPath: r.controlPath }))
  )
  ipcMain.handle(IPC.gitPush, (_event, target: GitTarget) =>
    runGitOp(target, (r) => gitPush(r), (r) => remotePush(r.remote, r.root, { controlPath: r.controlPath }))
  )
  ipcMain.handle(IPC.gitPull, (_event, target: GitTarget) =>
    runGitOp(target, (r) => gitPull(r), (r) => remotePull(r.remote, r.root, { controlPath: r.controlPath }))
  )
  ipcMain.handle(IPC.gitPublish, (_event, target: GitTarget) =>
    runGitOp(target, (r) => gitPublish(r), (r) => remotePublish(r.remote, r.root, { controlPath: r.controlPath }))
  )
  // Worktrees are a local-dev workflow — remote projects get an empty list and
  // the panel hides the section (see SourceControlPanel).
  ipcMain.handle(IPC.gitWorktrees, async (_event, target: GitTarget) => {
    const resolved = await resolveGitTarget(target)
    if (resolved.kind !== 'local') return []
    return listWorktrees(resolved.root)
  })
  ipcMain.handle(IPC.gitWorktreeAdd, (_event, target: GitTarget, name: string, branch?: string) =>
    runGitOp(
      target,
      (r) => addWorktree(r, isAbsolute(name) ? name : join(dirname(r), name), branch),
      (r) => Promise.resolve({ code: 1, stdout: '', stderr: 'worktrees are not supported on remote projects' })
    )
  )
  ipcMain.handle(IPC.gitWorktreeRemove, (_event, target: GitTarget, path: string, force = false) =>
    runGitOp(
      target,
      (r) => removeWorktree(r, path, force),
      (r) => Promise.resolve({ code: 1, stdout: '', stderr: 'worktrees are not supported on remote projects' })
    )
  )
}

function registerFileProtocol(): void {
  protocol.handle(FILE_PROTOCOL, (request) => {
    const filePath = fromFilePreviewUrl(request.url)
    // Audit B11: this protocol previously served ANY image on disk — a
    // renderer-compromise read primitive. Confining to known project folders
    // matches the desktop threat model (file-service/project-scope behave the
    // same way); the Server Edition never registers this protocol at all.
    if (
      !filePath ||
      classifyFile(filePath) !== 'image' ||
      !resolveFileScope(workspaceStore, filePath).ok
    ) {
      return new Response('forbidden', { status: 403, statusText: 'Forbidden' })
    }
    return net.fetch(pathToFileURL(filePath).href)
  })
}

function registerUpdateIpc(): void {
  ipcMain.handle(IPC.appSettingsGet, () => appSettings.current)
  ipcMain.handle(IPC.appSettingsSet, (_event, patch: Partial<AppSettings>) => {
    appSettings.current = saveAppSettings(platform.userDataPath, patch)
    updateBridge.setAutoDownload(appSettings.current.autoDownloadUpdates)
    syncAgentBrowserControl()
    syncA2aServer()
    syncTelegramBot()
    return appSettings.current
  })
  ipcMain.handle(IPC.accountCreate, (_event, label: unknown): AppSettings => {
    const trimmed = typeof label === 'string' && label.trim() ? label.trim() : 'account'
    const created = { ...createManagedAccount(platform.userDataPath, trimmed), agentId: 'claude' as const }
    appSettings.current = saveAppSettings(platform.userDataPath, {
      accounts: [...appSettings.current.accounts, created]
    })
    return appSettings.current
  })
  ipcMain.handle(IPC.accountDelete, (_event, id: unknown): AppSettings => {
    if (typeof id === 'string') deleteManagedAccount(platform.userDataPath, id)
    const accounts = appSettings.current.accounts.filter((a) => a.id !== id)
    const activeAccountId =
      appSettings.current.activeAccountId === id ? null : appSettings.current.activeAccountId
    appSettings.current = saveAppSettings(platform.userDataPath, { accounts, activeAccountId })
    return appSettings.current
  })
  ipcMain.handle(IPC.permissionProbe, () => claudePermissionModeSupported())
  ipcMain.handle(IPC.loginCommand, () => {
    const help = claudeHelpText()
    return help ? claudeLoginCommand(help) : 'claude'
  })
  ipcMain.handle(IPC.updateCheck, () => updateBridge.check())
  ipcMain.handle(IPC.updateDownload, () => updateBridge.download())
  ipcMain.handle(IPC.updateInstall, () => {
    updateBridge.install()
  })
  ipcMain.handle(IPC.updateDismiss, () => updateBridge.dismiss())
}

// Phase 12.2 — announcements: fetch the latest GitHub release notes (packaged
// builds only) and let the renderer show a dismissible "what's new" banner.
let latestAnnouncement: Announcement | null = null

async function fetchLatestAnnouncement(): Promise<void> {
  try {
    const res = await net.fetch('https://api.github.com/repos/dazeb/termsprawl/releases/latest')
    if (!res.ok) return
    latestAnnouncement = parseLatestRelease(await res.json())
  } catch {
    // announcements are best-effort; never block or surface an error
  }
}

function registerAnnouncementIpc(): void {
  ipcMain.handle(IPC.announcementGet, () => {
    const a = latestAnnouncement
    if (!a) return null
    if (appSettings.current.dismissedAnnouncementVersion === a.version) return null
    return a
  })
  // Open a link in the user's system browser (changelog links etc.) — http(s)
  // only, never navigate the app window itself.
  ipcMain.handle(IPC.openExternal, (_event, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}

function registerCloudIpc(): void {
  ipcMain.handle(IPC.cloudStatus, (): Promise<CloudUser | null> => cloud.getUser())
  ipcMain.handle(IPC.cloudDeviceStart, (): Promise<CloudDeviceStart> => cloud.deviceStart())
  ipcMain.handle(IPC.cloudDevicePoll, (_event, deviceCode: string): Promise<CloudDevicePoll> => cloud.devicePoll(deviceCode))
  ipcMain.handle(IPC.cloudSignOut, (): Promise<void> => cloud.signOut())
  ipcMain.handle(IPC.cloudBackupNow, (): Promise<CloudBackup> => cloud.backupNow())
  ipcMain.handle(IPC.cloudListBackups, (_event, limit?: number): Promise<CloudBackup[]> => cloud.listBackups(limit))
  // Online canvas spaces: the open handler mints the short-lived access token
  // and opens the returned URL (which carries auth) in the system browser.
  ipcMain.handle(IPC.cloudSpaceStatus, (): Promise<CloudSpace | null> => cloud.getSpace())
  ipcMain.handle(IPC.cloudSpaceOpen, (): Promise<void> => cloud.openSpace())
  // D1 — "Open online snapshot": pull the space content and import the
  // current project as a NEW local project (collision-safe name), persisting
  // the snapshot's scrollbacks so restored terminals replay their history.
  ipcMain.handle(IPC.cloudSpacePull, (): Promise<CloudSpacePullResult | CloudSpacePullEmpty> =>
    pullAndImportSpaceSnapshot()
  )
  // D2 — "Sync this project online": build the active-project payload (nodes
  // + rev + folder project file + terminal scrollbacks) and push it. Without
  // a space yet, one is provisioned first (403 upgrade_required still throws).
  ipcMain.handle(IPC.cloudSpacePush, (_event, projectId: string): Promise<CloudSpacePushResult> =>
    pushProjectToSpace(typeof projectId === 'string' ? projectId : '')
  )
  // GitHub repo picker + import (Task 4): both run HERE, with the same cloud
  // session cookie the sign-in holds. The credential-bearing clone URL is
  // minted by github:clone's handler (POST /github/import-url) and consumed
  // by the local clone in the same call — it never crosses IPC, is never
  // logged, and is never persisted. Errors map to { ok:false, code, message }
  // so the renderer can branch on codes (github_not_connected → "Connect
  // GitHub in Settings first") instead of parsing thrown strings.
  ipcMain.handle(IPC.githubRepos, (): Promise<CloudGithubReposResult | CloudGithubFailure> =>
    cloud
      .githubRepos()
      .then((r) => r)
      .catch((e: unknown) => githubFailure(e))
  )
  ipcMain.handle(
    IPC.githubClone,
    (_event, req: { fullName?: unknown; name?: unknown }): Promise<CloudGithubImportResult | CloudGithubFailure> =>
      cloud
        .githubClone({
          fullName: typeof req?.fullName === 'string' ? req.fullName : '',
          name: typeof req?.name === 'string' ? req.name : '',
          projectsRoot: defaultProjectsRoot()
        })
        .catch((e: unknown) => githubFailure(e))
  )
  // Disconnect GitHub (settings row): wipes the cloud vault token server-side.
  ipcMain.handle(IPC.githubDisconnect, (): Promise<{ ok: true } | CloudGithubFailure> =>
    cloud.githubDisconnect().catch((e: unknown) => githubFailure(e))
  )
  // Phase 16 — "Export workspace…": the ENTIRE workspace (index + every
  // project's nodes + every terminal's scrollback) as ONE json file. Gathers
  // live state through the SAME singletons (workspaceStore + ptyManager) the
  // other handlers use — never a second store instance (that desyncs the
  // store's revs map, the v0.14.0 bug class).
  ipcMain.handle(IPC.workspaceExportBundle, (): Promise<WorkspaceBundleExportResult> =>
    exportWorkspaceBundle()
  )
  // "Open workspace…": one saved bundle lands as NEW local projects — fresh
  // ids, collision-safe names, terminal ids remapped on collision — with the
  // scrollbacks persisted so restored terminals replay their history.
  ipcMain.handle(IPC.workspaceImportBundle, (): Promise<WorkspaceBundleImportResult> =>
    importWorkspaceBundle()
  )
}

// ---------------------------------------------------------------------------
// GitHub on the desktop (Task 4) — helpers for the github:* IPC handlers.
// ---------------------------------------------------------------------------

/** Map any cloud/clone error to the { ok:false, code, message } shape the
 * renderer branches on. CloudError carries the server's code verbatim
 * (github_not_connected, missing_repo_scope, github_token_invalid,
 * github_unreachable, rate_limited); anything else becomes 'import_failed'.
 * Error text is renderer-safe: the clone url was already redacted by
 * core/github-clone.ts and no code path logs it. */
function githubFailure(e: unknown): CloudGithubFailure {
  if (e instanceof CloudError) return { ok: false, code: e.code, message: e.message }
  const message = e instanceof Error ? e.message : String(e)
  return { ok: false, code: 'import_failed', message }
}

/** Default parent directory for cloned GitHub projects. There is no existing
 * desktop convention for a projects home (folder projects are picked with
 * the OS dialog), so clones land in ~/termsprawl/<name>. */
function defaultProjectsRoot(): string {
  return join(app.getPath('home'), 'termsprawl')
}

// ---------------------------------------------------------------------------
// Phase 15 (D1+D2) — desktop pull/push of space snapshots. Runs in main where
// the core engines (workspace store, scrollback store, cloud client) live.
// ---------------------------------------------------------------------------

/** D1: pull the latest snapshot and import its current project as a NEW local
 * project. Existing projects are NEVER touched; a name collision gets
 * ' 2', ' 3', … appended. The snapshot's folder-project `files` entries are
 * intentionally ignored for v1 (the workspace blob already carries the
 * canvas) — the snapshot keeps them so future versions can adopt the folder
 * in place. */
async function pullAndImportSpaceSnapshot(): Promise<CloudSpacePullResult | CloudSpacePullEmpty> {
  const content = await cloud.pullSpace()
  if (!content) return { empty: true }
  const current = snapshotCurrentProject(content.workspace as SnapshotWorkspace)
  if (!current) throw new CloudError(0, 'malformed', 'The online snapshot has no project to open')
  if (!Array.isArray(current.nodes)) throw new CloudError(0, 'malformed', 'The online snapshot has no readable canvas')

  const snap = workspaceStore.snapshot()
  const name = uniqueOnlineSnapshotName(
    current.name,
    snap.index.projects.map((p) => p.name)
  )
  // A pulled snapshot is an inline (cwd-less) project: its cwd belongs to the
  // machine that pushed it. Remote metadata is likewise not adopted for v1.
  const project = workspaceStore.addProject(name, null)
  // Node ids are LOAD-BEARING (pty session id == tmux key == scrollback file
  // == persisted id). Snapshot ids belong to the machine that pushed them:
  // re-pulling the same snapshot — or pulling on a second machine — would
  // otherwise create two projects with identical terminal ids fighting over
  // one tmux session, and importSnapshot would clobber a live local
  // terminal's stored scrollback on id collision. Remap every id (nodes and
  // scrollback keys together) onto fresh ids scoped to the new project.
  const idRemap = new Map<string, string>()
  for (const node of current.nodes) {
    const raw = (node as { id?: unknown } | null)?.id
    if (typeof raw === 'string') idRemap.set(raw, `n-${project.id}-${idRemap.size + 1}`)
  }
  const remappedNodes = current.nodes.map((node) => {
    const fresh = idRemap.get((node as { id?: string }).id ?? '')
    if (!fresh) return node
    return { ...(node as unknown as Record<string, unknown>), id: fresh } as typeof node
  })
  workspaceStore.saveNodes(project.id, remappedNodes)
  const scopedScrollbacks: Record<string, string> = {}
  for (const [id, text] of Object.entries(content.scrollbacks ?? {})) {
    const fresh = idRemap.get(id)
    if (fresh && typeof text === 'string') scopedScrollbacks[fresh] = text
  }
  const scrollbacksImported = ptyManager.importScrollback(scopedScrollbacks)
  return { project, nodes: remappedNodes, scrollbacksImported, empty: false }
}

/** D2: build the ACTIVE project's snapshot payload — the same serialization
 * the app persists, the project's rev (boot restore applies only strictly
 * newer snapshots), the folder-project file when present, and the terminal
 * nodes' stored scrollbacks — then push it to the user's space. */
async function pushProjectToSpace(projectId: string): Promise<CloudSpacePushResult> {
  const snap = workspaceStore.snapshot()
  const meta = snap.index.projects.find((p) => p.id === projectId)
  if (!meta) throw new CloudError(0, 'no_project', 'No active project to sync')
  const nodes = loadProjectFile(platform.userDataPath, meta)?.nodes ?? []
  const rev = loadProjectFile(platform.userDataPath, meta)?.rev ?? 0

  // Folder projects keep their file under <cwd>/.termsprawl/project.json —
  // carry the raw contents so the space's boot restore can adopt them.
  let projectFile: unknown
  if (meta.cwd) {
    const p = join(meta.cwd, '.termsprawl', 'project.json')
    try {
      projectFile = JSON.parse(readFileSync(p, 'utf8'))
    } catch {
      // unreadable/absent project file — the nodes blob still carries state
    }
  }

  const terminalIds = nodes.filter((n) => n.type === 'terminal').map((n) => n.id)
  const payload = buildProjectPushPayload(
    { id: meta.id, name: meta.name, cwd: meta.cwd, nodes, rev, projectFile },
    ptyManager.readScrollbacks(terminalIds)
  )

  // The push needs a provisioned space; get one when the user has none yet.
  const existing = await cloud.getSpace()
  let provisioned = false
  if (!existing) {
    await cloud.provisionSpace()
    provisioned = true
  }
  const result = await cloud.pushSpace(payload)
  return { ...result, provisioned }
}

// ---------------------------------------------------------------------------
// Phase 16 — workspace bundle over a single json file. Same shape as the
// spaces-sync envelope; export gathers through the ONE workspaceStore /
// ptyManager pair, import lands everything as NEW projects the way D1 does.
// ---------------------------------------------------------------------------

/** Export: build the bundle from LIVE state and write it to the file the user
 * picks. Revs come from the persisted project files (the same read
 * pushProjectToSpace uses); scrollbacks from the ONE ptyManager's store. */
async function exportWorkspaceBundle(): Promise<WorkspaceBundleExportResult> {
  const snap = workspaceStore.snapshot()
  if (snap.index.projects.length === 0) {
    throw new Error('Nothing to export — create a project first')
  }
  const win = BrowserWindow.getFocusedWindow()
  const result = await dialog.showSaveDialog(win!, {
    defaultPath: `termsprawl-workspace-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'termsprawl workspace', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { saved: false }
  const bundle = buildBundle({
    index: snap.index as unknown as SnapshotWorkspace['index'],
    nodesFor: (id) => snap.projects[id] ?? [],
    revFor: (id) => {
      const meta = snap.index.projects.find((p) => p.id === id)
      return meta ? (loadProjectFile(platform.userDataPath, meta)?.rev ?? 0) : 0
    },
    scrollbacksFor: (ids) => ptyManager.readScrollbacks(ids),
    currentProjectId: useActiveProjectId(snap)
  })
  try {
    writeFileSync(result.filePath, JSON.stringify(bundle, null, 2), 'utf8')
  } catch (err) {
    throw new Error(`Could not write the workspace file: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { saved: true, path: result.filePath }
}

/** The bundle's currentProjectId: the renderer's active project. The store
 * doesn't track "active" (that's renderer state), so carry the FIRST OPEN
 * project — the same resolution snapshotCurrentProject falls back to. */
function useActiveProjectId(snap: ReturnType<WorkspaceStore['snapshot']>): string | undefined {
  const open = snap.index.projects.find((p) => !p.closed && !p.archived) ?? snap.index.projects[0]
  return open?.id
}

/** Import: pick a bundle file, validate it, land every planned project as a
 * NEW local project (workspaceStore methods directly — the same store path
 * pullAndImportSpaceSnapshot uses; node ids were already remapped by
 * applyBundlePlan), persist the scrollbacks, and return the first project id
 * so the renderer can switch to it. */
async function importWorkspaceBundle(): Promise<WorkspaceBundleImportResult> {
  const win = BrowserWindow.getFocusedWindow()
  const picked = await dialog.showOpenDialog(win!, {
    properties: ['openFile'],
    filters: [{ name: 'termsprawl workspace', extensions: ['json'] }]
  })
  if (picked.canceled || picked.filePaths.length === 0) return { imported: 0 }

  let bundle: WorkspaceBundle
  try {
    bundle = JSON.parse(readFileSync(picked.filePaths[0], 'utf8')) as WorkspaceBundle
  } catch {
    throw new Error('Invalid workspace bundle — the file is not readable json')
  }
  if (!isValidBundle(bundle)) {
    throw new Error('Invalid workspace bundle (bad format, unsupported version, or truncated)')
  }

  const snap = workspaceStore.snapshot()
  // ALL terminal ids in use locally — a collision in ANY project remaps that
  // project's terminals so live pty/tmux/scrollback identities stay intact.
  const existingTerminalIds = new Set<string>(
    snap.index.projects.flatMap((p) => terminalIdsIn(snap.projects[p.id] ?? []))
  )
  const plan = applyBundlePlan(bundle, {
    existingNames: snap.index.projects.map((p) => p.name),
    existingTerminalIds,
    newProjectId: (() => {
      let counter = 0
      return () => `p-${Date.now().toString(36)}-${counter++}`
    })(),
    newTerminalId: (i) => `nb-${Date.now().toString(36)}-${i}`
  })

  // Land each planned project directly through the store — project:import is
  // wrong here (ids are fresh); addProject + saveNodes is the D1 path.
  let firstProjectId: string | undefined
  for (const entry of plan.projects) {
    const project = workspaceStore.addProject(entry.name, null, undefined, { id: entry.id })
    workspaceStore.saveNodes(project.id, entry.nodes)
    firstProjectId ??= project.id
  }
  const scrollbacksImported = ptyManager.importScrollback(
    Object.fromEntries(plan.pendingScrollbacks)
  )
  if (scrollbacksImported < plan.pendingScrollbacks.size) {
    console.error(`[workspace-bundle] some scrollbacks were skipped on import (${scrollbacksImported}/${plan.pendingScrollbacks.size})`)
  }
  return { imported: plan.projects.length, firstProjectId }
}

function registerBrowserIpc(): void {
  ipcMain.handle(IPC.browserCdpInfo, (): BrowserCdpInfo => ({
    port: cdpFacade?.port ?? browserRuntime.port,
    token: agentServer?.token ?? browserRuntime.token,
    wsUrl: cdpFacade?.url ?? browserRuntime.wsUrl,
    host: '127.0.0.1'
  }))
  ipcMain.handle(IPC.browserRegister, (_event, nodeId: string, tabId: string, guestId: number): void => {
    if (typeof nodeId === 'string' && typeof tabId === 'string' && typeof guestId === 'number') {
      registerBrowserGuest(nodeId, tabId, guestId)
    }
  })
  ipcMain.handle(IPC.browserUnregister, (_event, nodeId: string, tabId: string): void => {
    if (typeof nodeId === 'string' && typeof tabId === 'string') {
      unregisterBrowserGuest(nodeId, tabId)
    }
  })
  ipcMain.handle(
    IPC.browserNavigate,
    (_event, nodeId: string, tabId: string, url: string): Promise<BrowserNavigateResult> =>
      navigateBrowserNode(nodeId, tabId, url)
  )
}

function createWindow(): void {
  // Size the window to the actual display (fixes controls/undo bar being cut
  // off on 1280x720 screens where the old 1440x900 default overflowed).
  const primary = screen.getPrimaryDisplay?.()
  const workArea = primary?.workArea ?? FALLBACK_WORK_AREA
  const { width, height } = clampWindowBounds({ width: 1440, height: 900 }, workArea)
  const win = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    title: 'termsprawl',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Browser nodes embed a real <webview> guest on the canvas. Guests are
      // hardened by installBrowserSecurity() (no node/preload, sandbox on).
      webviewTag: true
    }
  })

  // Renderer compromise must not mint new Electron windows carrying the full
  // preload (audit B9). Legitimate external links go through the openExternal
  // IPC (http/https-validated) — never through window.open.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => {
    // Same policy as webview guests: never navigate the app window itself.
    // (Vite HMR full-reloads go through reload(), not will-navigate.)
    event.preventDefault()
  })

  // electron-vite dev serves the renderer over HTTP; prod loads the file.
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Slight UI zoom-out on short displays so bottom-anchored chrome (React Flow
  // zoom controls, undo/redo bar) stays fully visible. No-op at 1.0.
  const uiZoom = desiredUiZoom(workArea)
  if (uiZoom !== 1) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.setZoomFactor(uiZoom)
    })
  }
}

/** Claude agent command detection: the command references the claude CLI and
 * pins a session (`--session-id` or `--resume`) — i.e. a termsprawl agent node. */
function isClaudeAgentCommand(command: string): boolean {
  return /\bclaude\b/.test(command) && /(--session-id|--resume)/.test(command)
}

/** On a Claude agent spawn, inject TERMSPRAWL_NODE_ID so the agent's context
 * CLI can resolve its own id without the user guessing. */
function withAgentNodeIdEnv(req: PtyCreateRequest): PtyCreateRequest {
  if (!req.command || !isClaudeAgentCommand(req.command)) return req
  return { ...req, env: { ...req.env, TERMSPRAWL_NODE_ID: req.id } }
}

/** Cached `claude --help` output (once per process), or null when the binary is
 * missing/old. Missing/old reads as unsupported everywhere — the controls hide
 * and spawns still work, just without the flag. */
let claudeHelpCache: string | null | undefined // undefined = not probed yet
function claudeHelpText(): string | null {
  if (claudeHelpCache === undefined) {
    try {
      claudeHelpCache = execFileSync('claude', ['--help'], { encoding: 'utf8', timeout: 5000 })
    } catch {
      claudeHelpCache = null
    }
  }
  return claudeHelpCache
}

function claudePermissionModeSupported(): boolean {
  const help = claudeHelpText()
  return help ? claudeSupportsPermissionMode(help) : false
}

/** Graft the active managed account's config env onto any Claude spawn (agent
 * or login), and append `--permission-mode` for session-pinned agent nodes when
 * the CLI supports it and the account requests a non-default mode. No active
 * account = default ~/.claude behaviour. */
function withAgentEnvironment(req: PtyCreateRequest): PtyCreateRequest {
  if (!req.command || !/\bclaude\b/.test(req.command)) return req
  const account = activeAccount(appSettings.current)
  if (!account) return req
  let out: PtyCreateRequest = { ...req, env: { ...req.env, ...claudeConfigEnv(account.configDir) } }
  const pm = account.permissionMode
  if (pm && pm !== 'default' && isClaudeAgentCommand(req.command) && claudePermissionModeSupported()) {
    out = { ...out, command: `${req.command} --permission-mode ${pm}` }
  }
  return out
}

function registerPtyIpc(): void {
  ipcMain.handle(IPC.ptyCreate, (_event, req: PtyCreateRequest) => {
    let augmented = withAgentNodeIdEnv(req)
    augmented = withAgentEnvironment(augmented)
    // When a Claude agent node is spawned into a folder project, make sure the
    // context CLI discovery markers exist so the agent can find its peers.
    if (isClaudeAgentCommand(augmented.command ?? '') && augmented.cwd) {
      ensureContextDiscovery(augmented.cwd)
    }
    return ptyManager.create(augmented)
  })
  ipcMain.on(IPC.ptyWrite, (_event, id: string, data: string) => ptyManager.write(id, data))
  ipcMain.on(IPC.ptyResize, (_event, id: string, cols: number, rows: number) =>
    ptyManager.resize(id, cols, rows)
  )
  ipcMain.handle(IPC.ptyDestroy, (_event, id: string) => ptyManager.destroy(id))
  ipcMain.handle(IPC.terminalClose, (_event, projectId: string, id: string) => {
    return closeTerminalNode(
      workspaceStore,
      (terminalId) => ptyManager.destroy(terminalId),
      projectId,
      id
    )
  })
  ipcMain.handle(IPC.ptyReadScrollback, (_event, id: string) => ptyManager.readScrollback(id))
}

void app.whenReady().then(async () => {
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  registerPtyIpc()
  registerWorkspaceIpc()
  registerDiffIpc()
  registerFileIpc()
  registerContextLinkIpc()
  registerGitIpc()
  registerFileProtocol()
  registerUpdateIpc()
  registerAnnouncementIpc()
  registerCloudIpc()
  registerBrowserIpc()
  registerChatIpc()
  registerRelayIpc()
  if (app.isPackaged) void fetchLatestAnnouncement()

  for (const entry of workspaceStore.pendingTerminalNodeCleanup()) {
    try {
      workspaceStore.removeTerminalNode(entry.projectId, entry.terminalId)
      ptyManager.destroy(entry.terminalId)
      workspaceStore.completeTerminalNodeClose(entry.projectId, entry.terminalId)
    } catch (error) {
      console.error(`[terminal] startup node cleanup failed: ${entry.terminalId}`, error)
    }
  }
  workspaceStore.retireCompletedTerminalTombstones()

  // Project deletion records terminal ids before cleanup begins. Retry any
  // sessions left by a prior failed cleanup or process interruption.
  const pendingProjectIds = new Set(
    workspaceStore.pendingTerminalCleanup().map((entry) => entry.projectId)
  )
  for (const projectId of pendingProjectIds) {
    const result = deleteProjectAndDestroyTerminals(
      workspaceStore,
      (terminalId) => ptyManager.destroy(terminalId),
      projectId
    )
    for (const terminalId of result.cleanupPendingIds) {
      console.error(`[project] startup terminal cleanup still pending: ${terminalId}`)
    }
  }

  // Start the hook server and point Claude Code's URL hooks at it, so agent
  // nodes can show RUNNING / NEEDS YOU badges.
  await hookServer.start()
  try {
  // Install our hooks with the per-boot shared secret (audit B8). The server
  // rejects POSTs whose ?key= mismatches — defense-in-depth on loopback.
  installClaudeHooks(claudeSettingsPath(homedir()), hookServer.url, hookServer.secret)
  } catch (err) {
    console.error('[hooks] install failed:', err)
  }

  // 13.3/13.4 — the agent-control surface is OPT-IN (settings → General →
  // "allow agents to control browser nodes"), off by default. When on, start
  // the playable CDP facade + the token-gated /open endpoint (both
  // localhost-only). The facade is what agents connect to: it re-exposes the
  // embedded guests as `page` targets so Playwright sees them.
  if (appSettings.current.agentBrowserControl === true) {
    await startBrowserControlEndpoints()
  }

  syncTelegramBot()

  createWindow()

  setTimeout(() => {
    void updateBridge.check()
  }, 2500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  ptyManager.killAll()
  linkService.dispose()
  stopA2aEndpoint()
  telegramBot?.stop()
  void agentServer?.close()
  void cdpFacade?.close()
  // Audit B7: a paired relay socket must not outlive the app.
  relayRuntime.disconnect()
})
