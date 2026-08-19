import { app, BrowserWindow, dialog, ipcMain, Notification, protocol, net } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '../shared/ipc'
import type { ContextLinkListResult, ContextLinkWriteResult, DiffBase, DiffInfoResult, ProjectSettings, PtyCreateRequest, PtyExitInfo, SerializedNode } from '../shared/types'
import type { CorePlatform } from '../core/platform'
import { diffInfo } from '../core/git-service'
import { classifyFile, listProjectDir, readProjectFile, writeProjectFile } from '../core/file-service'
import { addLink, listLinks, removeLink } from '../core/context-links'
import { FILE_PROTOCOL, fromFilePreviewUrl } from '../shared/file-url'
import { PtyManager } from '../core/pty-manager'
import { shouldNotify, type AgentStatus } from '../shared/agent-status'
import { WorkspaceStore } from '../core/workspace-store'
import type { ProjectMeta } from '../core/workspace-files'
import { deleteProjectAndDestroyTerminals } from '../core/project-deletion'
import { closeTerminalNode } from '../core/terminal-close'
import { loadAppSettings, saveAppSettings } from '../core/app-settings'
import { createUpdateBridge } from './updates'
import { HookServer } from './agents/hook-server'
import { claudeSettingsPath, installClaudeHooks } from './agents/hook-installer'
import { SessionNameTracker } from '../core/session-name'
import { agentSessionNameChannel } from '../shared/ipc'

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
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  }
}

const ptyManager = new PtyManager(platform)
const workspaceStore = new WorkspaceStore(platform)
const appSettings = { current: loadAppSettings(platform.userDataPath) }
const updateBridge = createUpdateBridge({
  isPackaged: app.isPackaged,
  autoDownload: appSettings.current.autoDownloadUpdates,
  broadcast: (channel, payload) => platform.broadcast(channel, payload)
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

function registerWorkspaceIpc(): void {
  ipcMain.handle(IPC.workspaceSnapshot, () => workspaceStore.snapshot())
  ipcMain.handle(IPC.workspaceSaveNodes, (_event, id: string, nodes: SerializedNode[]) =>
    workspaceStore.saveNodes(id, nodes)
  )
  ipcMain.handle(IPC.projectAdd, (_event, name: string, cwd: string | null): ProjectMeta => {
    if (cwd) {
      const existing = workspaceStore.snapshot().index.projects.find((p) => p.cwd === cwd)
      if (existing) return existing // folder already has a project — dedupe
    }
    return workspaceStore.addProject(name, cwd)
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
    (_event, path: string, base: DiffBase): Promise<DiffInfoResult> => diffInfo(path, base)
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

function registerFileIpc(): void {
  ipcMain.handle(IPC.fileRead, (_event, path: string) => readProjectFile(path))
  ipcMain.handle(IPC.fileWrite, (_event, path: string, content: string) =>
    writeProjectFile(path, content)
  )
  ipcMain.handle(IPC.fileList, (_event, root: string, rel?: string) =>
    listProjectDir(root, rel ?? '.')
  )
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
    return { ok: true }
  })
  ipcMain.handle(IPC.contextLinkRemove, (_event, cwd: string, a: string, b: string): ContextLinkWriteResult => {
    if (!isKnownProjectCwd(cwd)) return { ok: false, error: 'NO_FOLDER' }
    removeLink(cwd, a, b)
    return { ok: true }
  })
}

function registerFileProtocol(): void {
  protocol.handle(FILE_PROTOCOL, (request) => {
    const filePath = fromFilePreviewUrl(request.url)
    if (!filePath || classifyFile(filePath) !== 'image') {
      return new Response('forbidden', { status: 403, statusText: 'Forbidden' })
    }
    return net.fetch(pathToFileURL(filePath).href)
  })
}

function registerUpdateIpc(): void {
  ipcMain.handle(IPC.appSettingsGet, () => appSettings.current)
  ipcMain.handle(IPC.appSettingsSet, (_event, patch: { autoDownloadUpdates?: boolean }) => {
    appSettings.current = saveAppSettings(platform.userDataPath, patch)
    updateBridge.setAutoDownload(appSettings.current.autoDownloadUpdates)
    return appSettings.current
  })
  ipcMain.handle(IPC.updateCheck, () => updateBridge.check())
  ipcMain.handle(IPC.updateDownload, () => updateBridge.download())
  ipcMain.handle(IPC.updateInstall, () => {
    updateBridge.install()
  })
  ipcMain.handle(IPC.updateDismiss, () => updateBridge.dismiss())
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'termsprawl',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // electron-vite dev serves the renderer over HTTP; prod loads the file.
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
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

function registerPtyIpc(): void {
  ipcMain.handle(IPC.ptyCreate, (_event, req: PtyCreateRequest) =>
    ptyManager.create(withAgentNodeIdEnv(req))
  )
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
  registerFileProtocol()
  registerUpdateIpc()

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
    installClaudeHooks(claudeSettingsPath(homedir()), hookServer.url)
  } catch (err) {
    console.error('[hooks] install failed:', err)
  }

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
})
