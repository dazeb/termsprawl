import { contextBridge, ipcRenderer } from 'electron'
import { IPC, ptyDataChannel, ptyExitChannel } from '../shared/ipc'
import type {
  AgentStatusEvent,
  DiffBase,
  DiffInfoResult,
  ProjectMeta,
  PtyCreateRequest,
  PtyCreateResult,
  PtyExitInfo,
  SerializedNode,
  WorkspaceSnapshot
} from '../shared/types'

// The narrow API surface exposed to the renderer as window.termsprawl.
// Grows per phase; the renderer must never touch ipcRenderer directly.
const api = {
  appVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),

  workspace: {
    snapshot: (): Promise<WorkspaceSnapshot> => ipcRenderer.invoke(IPC.workspaceSnapshot),
    saveNodes: (id: string, nodes: SerializedNode[]): Promise<number> =>
      ipcRenderer.invoke(IPC.workspaceSaveNodes, id, nodes),
    addProject: (name: string, cwd: string | null): Promise<ProjectMeta> =>
      ipcRenderer.invoke(IPC.projectAdd, name, cwd),
    closeProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectClose, id),
    archiveProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectArchive, id),
    reopenProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectReopen, id),
    deleteProject: (id: string): Promise<void> => ipcRenderer.invoke(IPC.projectDelete, id),
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogSelectFolder)
  },

  pty: {
    create: (req: PtyCreateRequest): Promise<PtyCreateResult> =>
      ipcRenderer.invoke(IPC.ptyCreate, req),
    write: (id: string, data: string): void => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    destroy: (id: string): void => ipcRenderer.send(IPC.ptyDestroy, id),
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
    openDialog: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogOpenFile)
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
    }
  }
}

contextBridge.exposeInMainWorld('termsprawl', api)

export type TermsprawlApi = typeof api
