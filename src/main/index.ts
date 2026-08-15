import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { DiffBase, DiffInfoResult, PtyCreateRequest, PtyExitInfo, SerializedNode } from '../shared/types'
import type { CorePlatform } from '../core/platform'
import { diffInfo } from '../core/git-service'
import { PtyManager } from '../core/pty-manager'
import { WorkspaceStore } from '../core/workspace-store'
import type { ProjectMeta } from '../core/workspace-files'
import { HookServer } from './agents/hook-server'
import { claudeSettingsPath, installClaudeHooks } from './agents/hook-installer'

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

// Agent hook server (Phase 7): receives lifecycle POSTs from agent CLIs and
// broadcasts normalized status events to the renderer. Fail-open — an agent
// keeps working even if this never fires.
const hookServer = new HookServer((event) => {
  platform.broadcast(`${IPC.agentStatus}:${event.sessionId}`, event)
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
  ipcMain.handle(IPC.projectDelete, (_event, id: string) => {
    // Destroy every terminal session that belonged to the project — delete is
    // permanent, unlike close/archive which keep tmux sessions alive.
    const project = workspaceStore.snapshot().index.projects.find((p) => p.id === id)
    if (project) {
      const nodes = workspaceStore.snapshot().projects[id] ?? []
      for (const node of nodes) {
        if (node.type === 'terminal') ptyManager.destroy(node.id)
      }
    }
    workspaceStore.deleteProject(id)
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
  ipcMain.on(IPC.ptyDestroy, (_event, id: string) => ptyManager.destroy(id))
  ipcMain.handle(IPC.ptyReadScrollback, (_event, id: string) => ptyManager.readScrollback(id))
}

void app.whenReady().then(async () => {
  ipcMain.handle(IPC.appVersion, () => app.getVersion())
  registerPtyIpc()
  registerWorkspaceIpc()
  registerDiffIpc()

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
