import { app, BrowserWindow, dialog, ipcMain, Notification } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { DiffBase, DiffInfoResult, ProjectSettings, PtyCreateRequest, PtyExitInfo, SerializedNode } from '../shared/types'
import type { CorePlatform } from '../core/platform'
import { diffInfo } from '../core/git-service'
import { PtyManager } from '../core/pty-manager'
import { shouldNotify, type AgentStatus } from '../shared/agent-status'
import { WorkspaceStore } from '../core/workspace-store'
import type { ProjectMeta } from '../core/workspace-files'
import { deleteProjectAndDestroyTerminals } from '../core/project-deletion'
import { HookServer } from './agents/hook-server'
import { claudeSettingsPath, installClaudeHooks } from './agents/hook-installer'
import { SessionNameTracker } from '../core/session-name'
import { agentSessionNameChannel } from '../shared/ipc'

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
    const failures = deleteProjectAndDestroyTerminals(
      workspaceStore,
      (terminalId) => ptyManager.destroy(terminalId),
      id,
      ptyManager.sessionIdsForProject(id)
    )
    for (const failure of failures) {
      console.error(`[project-delete] failed to clean up terminal ${failure.id}:`, failure.error)
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.error),
        `Project removed, but ${failures.length} terminal session(s) still need cleanup. Retry delete.`
      )
    }
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

function registerPtyIpc(): void {
  ipcMain.handle(IPC.ptyCreate, (_event, req: PtyCreateRequest) => ptyManager.create(req))
  ipcMain.on(IPC.ptyWrite, (_event, id: string, data: string) => ptyManager.write(id, data))
  ipcMain.on(IPC.ptyResize, (_event, id: string, cols: number, rows: number) =>
    ptyManager.resize(id, cols, rows)
  )
  ipcMain.handle(IPC.ptyDestroy, (_event, id: string) => ptyManager.destroy(id))
  ipcMain.handle(IPC.terminalClose, (_event, projectId: string, id: string) => {
    workspaceStore.stageTerminalNodeClose(projectId, id)
    workspaceStore.removeTerminalNode(projectId, id)
    ptyManager.destroy(id)
    workspaceStore.completeTerminalNodeClose(projectId, id)
  })
  ipcMain.handle(IPC.ptyReadScrollback, (_event, id: string) => ptyManager.readScrollback(id))
}

void app.whenReady().then(async () => {
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  registerPtyIpc()
  registerWorkspaceIpc()
  registerDiffIpc()

  for (const entry of workspaceStore.pendingTerminalNodeCleanup()) {
    try {
      workspaceStore.removeTerminalNode(entry.projectId, entry.terminalId)
      ptyManager.destroy(entry.terminalId)
      workspaceStore.completeTerminalNodeClose(entry.projectId, entry.terminalId)
    } catch (error) {
      console.error(`[terminal] startup node cleanup failed: ${entry.terminalId}`, error)
    }
  }

  // Project deletion records terminal ids before cleanup begins. Retry any
  // sessions left by a prior failed cleanup or process interruption.
  const pendingProjectIds = new Set(
    workspaceStore.pendingTerminalCleanup().map((entry) => entry.projectId)
  )
  for (const projectId of pendingProjectIds) {
    const failures = deleteProjectAndDestroyTerminals(
      workspaceStore,
      (terminalId) => ptyManager.destroy(terminalId),
      projectId
    )
    for (const failure of failures) {
      console.error(`[project] startup terminal cleanup failed: ${failure.id}`, failure.error)
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
