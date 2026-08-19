import { contextBridge, ipcRenderer } from 'electron'
import { IPC, agentSessionNameChannel, ptyDataChannel, ptyExitChannel } from '../shared/ipc'
import type { AgentStatusEvent } from '../shared/agent-status'
import type {
  DiffBase,
  DiffInfoResult,
  DurableCleanupResult,
  FileReadResult,
  FileWriteResult,
  DirListResult,
  ProjectMeta,
  ProjectSettings,
  PtyCreateRequest,
  PtyCreateResult,
  PtyExitInfo,
  SerializedNode,
  WorkspaceSnapshot,
  AppSettings,
  ContextLinkListResult,
  ContextLinkWriteResult
} from '../shared/types'
import type { UpdateStatus } from '../shared/update-status'

// The narrow API surface exposed to the renderer as window.termsprawl.
// Grows per phase; the renderer must never touch ipcRenderer directly.
const api = {
  appVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.appSettingsGet),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.appSettingsSet, patch),
    createAccount: (label: string): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.accountCreate, label),
    deleteAccount: (id: string): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.accountDelete, id),
    permissionSupported: (): Promise<boolean> => ipcRenderer.invoke(IPC.permissionProbe)
  },

  updates: {
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateCheck),
    download: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateDownload),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),
    dismiss: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateDismiss),
    onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => cb(status)
      ipcRenderer.on(IPC.updateStatus, listener)
      return () => {
        ipcRenderer.removeListener(IPC.updateStatus, listener)
      }
    }
  },

  workspace: {
    snapshot: (): Promise<WorkspaceSnapshot> => ipcRenderer.invoke(IPC.workspaceSnapshot),
    saveNodes: (id: string, nodes: SerializedNode[]): Promise<number> =>
      ipcRenderer.invoke(IPC.workspaceSaveNodes, id, nodes),
    addProject: (name: string, cwd: string | null): Promise<ProjectMeta> =>
      ipcRenderer.invoke(IPC.projectAdd, name, cwd),
    closeProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectClose, id),
    archiveProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectArchive, id),
    reopenProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectReopen, id),
    deleteProject: (id: string): Promise<DurableCleanupResult> => ipcRenderer.invoke(IPC.projectDelete, id),
    updateSettings: (id: string, patch: ProjectSettings): Promise<void> =>
      ipcRenderer.invoke(IPC.projectUpdateSettings, id, patch),
    renameProject: (id: string, name: string): Promise<void> =>
      ipcRenderer.invoke(IPC.projectRename, id, name),
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogSelectFolder)
  },

  pty: {
    create: (req: PtyCreateRequest): Promise<PtyCreateResult> =>
      ipcRenderer.invoke(IPC.ptyCreate, req),
    write: (id: string, data: string): void => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    destroy: (id: string): Promise<void> => ipcRenderer.invoke(IPC.ptyDestroy, id),
    closeNode: (projectId: string, id: string): Promise<DurableCleanupResult> =>
      ipcRenderer.invoke(IPC.terminalClose, projectId, id),
    readScrollback: (id: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.ptyReadScrollback, id),

    onData: (id: string, cb: (data: string) => void): (() => void) => {
      const channel = ptyDataChannel(id)
      const listener = (_event: Electron.IpcRendererEvent, data: string): void => cb(data)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },

    onExit: (id: string, cb: (info: PtyExitInfo) => void): (() => void) => {
      const channel = ptyExitChannel(id)
      const listener = (_event: Electron.IpcRendererEvent, info: PtyExitInfo): void => cb(info)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  },

  diff: {
    info: (path: string, base: DiffBase): Promise<DiffInfoResult> =>
      ipcRenderer.invoke(IPC.diffInfo, path, base)
  },

  files: {
    openDialog: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogOpenFile),
    read: (path: string): Promise<FileReadResult> => ipcRenderer.invoke(IPC.fileRead, path),
    write: (path: string, content: string): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.fileWrite, path, content),
    list: (root: string, rel?: string): Promise<DirListResult> =>
      ipcRenderer.invoke(IPC.fileList, root, rel)
  },

  agent: {
    /** Subscribe to normalized hook status for one session/node id. */
    onStatus: (sessionId: string, cb: (event: AgentStatusEvent) => void): (() => void) => {
      const channel = `${IPC.agentStatus}:${sessionId}`
      const listener = (_event: Electron.IpcRendererEvent, e: AgentStatusEvent): void => cb(e)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    },
    /** Subscribe to session-name updates (agent transcript rename). */
    onSessionName: (
      sessionId: string,
      cb: (info: { sessionId: string; name: string }) => void
    ): (() => void) => {
      const channel = agentSessionNameChannel(sessionId)
      const listener = (
        _event: Electron.IpcRendererEvent,
        info: { sessionId: string; name: string }
      ): void => cb(info)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  },

  contextLinks: {
    list: (cwd: string): Promise<ContextLinkListResult> =>
      ipcRenderer.invoke(IPC.contextLinkList, cwd),
    add: (cwd: string, a: string, b: string): Promise<ContextLinkWriteResult> =>
      ipcRenderer.invoke(IPC.contextLinkAdd, cwd, a, b),
    remove: (cwd: string, a: string, b: string): Promise<ContextLinkWriteResult> =>
      ipcRenderer.invoke(IPC.contextLinkRemove, cwd, a, b)
  }
}

contextBridge.exposeInMainWorld('termsprawl', api)

export type TermsprawlApi = typeof api
