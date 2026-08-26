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
  ProjectRemote,
  ProjectSettings,
  PtyCreateRequest,
  PtyCreateResult,
  PtyExitInfo,
  SerializedNode,
  WorkspaceSnapshot,
  AppSettings,
  ContextLinkListResult,
  ContextLinkWriteResult,
  GitPanelSnapshot,
  GitResult,
  GitWorktree,
  CommitMessageResult,
  Announcement,
  CloudBackup,
  CloudDevicePoll,
  CloudDeviceStart,
  CloudUser,
  BrowserCdpInfo,
  BrowserNavigateResult
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
    permissionSupported: (): Promise<boolean> => ipcRenderer.invoke(IPC.permissionProbe),
    loginCommand: (): Promise<string> => ipcRenderer.invoke(IPC.loginCommand)
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

  announcements: {
    get: (): Promise<Announcement | null> => ipcRenderer.invoke(IPC.announcementGet)
  },

  workspace: {
    snapshot: (): Promise<WorkspaceSnapshot> => ipcRenderer.invoke(IPC.workspaceSnapshot),
    saveNodes: (id: string, nodes: SerializedNode[]): Promise<number> =>
      ipcRenderer.invoke(IPC.workspaceSaveNodes, id, nodes),
    addProject: (name: string, cwd: string | null, remote?: ProjectRemote): Promise<ProjectMeta> =>
      ipcRenderer.invoke(IPC.projectAdd, name, cwd, remote),
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
  },

  git: {
    snapshot: (cwd: string): Promise<GitPanelSnapshot> =>
      ipcRenderer.invoke(IPC.gitSnapshot, cwd),
    stage: (cwd: string, paths: string[]): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitStage, cwd, paths),
    unstage: (cwd: string, paths: string[]): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitUnstage, cwd, paths),
    discard: (cwd: string, paths: string[]): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitDiscard, cwd, paths),
    commit: (cwd: string, message: string): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitCommit, cwd, message),
    commitMessage: (cwd: string): Promise<CommitMessageResult> =>
      ipcRenderer.invoke(IPC.gitCommitMessage, cwd),
    createBranch: (cwd: string, name: string): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitCreateBranch, cwd, name),
    checkout: (cwd: string, name: string): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitCheckout, cwd, name),
    push: (cwd: string): Promise<GitResult> => ipcRenderer.invoke(IPC.gitPush, cwd),
    pull: (cwd: string): Promise<GitResult> => ipcRenderer.invoke(IPC.gitPull, cwd),
    publish: (cwd: string): Promise<GitResult> => ipcRenderer.invoke(IPC.gitPublish, cwd),
    worktrees: (cwd: string): Promise<GitWorktree[]> =>
      ipcRenderer.invoke(IPC.gitWorktrees, cwd),
    worktreeAdd: (cwd: string, path: string, branch?: string): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitWorktreeAdd, cwd, path, branch),
    worktreeRemove: (cwd: string, path: string, force?: boolean): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitWorktreeRemove, cwd, path, force)
  },

  cloud: {
    /** Signed-in user, or null when not signed in. */
    status: (): Promise<CloudUser | null> => ipcRenderer.invoke(IPC.cloudStatus),
    /** Start GitHub device flow + open the verification page; returns the code to display. */
    deviceStart: (): Promise<CloudDeviceStart> => ipcRenderer.invoke(IPC.cloudDeviceStart),
    devicePoll: (deviceCode: string): Promise<CloudDevicePoll> =>
      ipcRenderer.invoke(IPC.cloudDevicePoll, deviceCode),
    signOut: (): Promise<void> => ipcRenderer.invoke(IPC.cloudSignOut),
    backupNow: (): Promise<CloudBackup> => ipcRenderer.invoke(IPC.cloudBackupNow),
    listBackups: (limit?: number): Promise<CloudBackup[]> =>
      ipcRenderer.invoke(IPC.cloudListBackups, limit)
  },

  browser: {
    /** Localhost-only CDP endpoint an external agent can attach to. */
    cdpInfo: (): Promise<BrowserCdpInfo> => ipcRenderer.invoke(IPC.browserCdpInfo),
    /** Tell main which live guest this browser node owns (node id is stable). */
    register: (nodeId: string, guestId: number): Promise<void> =>
      ipcRenderer.invoke(IPC.browserRegister, nodeId, guestId),
    unregister: (nodeId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.browserUnregister, nodeId),
    /** Navigate a browser node; main enforces the URL policy. */
    navigate: (nodeId: string, url: string): Promise<BrowserNavigateResult> =>
      ipcRenderer.invoke(IPC.browserNavigate, nodeId, url),
    /** Subscribe to an external agent's "open a browser node" request. */
    onAgentOpen: (cb: (info: { url: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: { url: string }): void =>
        cb(info)
      ipcRenderer.on(IPC.browserAgentOpen, listener)
      return () => {
        ipcRenderer.removeListener(IPC.browserAgentOpen, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('termsprawl', api)

export type TermsprawlApi = typeof api
