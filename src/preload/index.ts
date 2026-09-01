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
  GitTarget,
  GitWorktree,
  CommitMessageResult,
  Announcement,
  CloudBackup,
  CloudDevicePoll,
  CloudDeviceStart,
  CloudSpace,
  CloudSpacePullEmpty,
  CloudSpacePullResult,
  CloudSpacePushResult,
  CloudGithubFailure,
  CloudGithubImportResult,
  CloudGithubReposResult,
  CloudUser,
  WorkspaceBundleExportResult,
  WorkspaceBundleImportResult,
  NodeLink,
  LinkRunResult,
  BrowserCdpInfo,
  BrowserNavigateResult,
  ChatSettings
} from '../shared/types'
import type { ChatEvent } from '../core/chat/types'
import { chatEventChannel } from '../shared/ipc'
import type { UpdateStatus } from '../shared/update-status'

// The narrow API surface exposed to the renderer as window.termsprawl.
// Grows per phase; the renderer must never touch ipcRenderer directly.
const api = {
  appVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  // Which edition is running. The desktop preload always says 'desktop'; the
  // Server Edition shim carries its own `runtime: { kind: 'server' }` — the
  // settings panel reads this to show only surfaces that exist here.
  runtime: { kind: 'desktop' as const },

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
    // Phase 16 — the whole workspace as ONE json file (save/open dialogs).
    exportBundle: (): Promise<WorkspaceBundleExportResult> =>
      ipcRenderer.invoke(IPC.workspaceExportBundle),
    importBundle: (): Promise<WorkspaceBundleImportResult> =>
      ipcRenderer.invoke(IPC.workspaceImportBundle),
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
    info: (path: string, base: DiffBase, remote?: ProjectRemote): Promise<DiffInfoResult> =>
      ipcRenderer.invoke(IPC.diffInfo, path, base, remote)
  },

  files: {
    openDialog: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogOpenFile),
    read: (path: string, remote?: ProjectRemote): Promise<FileReadResult> =>
      ipcRenderer.invoke(IPC.fileRead, path, remote),
    write: (path: string, content: string, remote?: ProjectRemote): Promise<FileWriteResult> =>
      ipcRenderer.invoke(IPC.fileWrite, path, content, remote),
    list: (root: string, rel?: string, remote?: ProjectRemote): Promise<DirListResult> =>
      ipcRenderer.invoke(IPC.fileList, root, rel, remote)
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
    // Phase 9: every op takes a GitTarget — { cwd } for local folder projects,
    // { remote } for ssh remote projects.
    snapshot: (target: GitTarget): Promise<GitPanelSnapshot> =>
      ipcRenderer.invoke(IPC.gitSnapshot, target),
    stage: (target: GitTarget, paths: string[]): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitStage, target, paths),
    unstage: (target: GitTarget, paths: string[]): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitUnstage, target, paths),
    discard: (target: GitTarget, paths: string[]): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitDiscard, target, paths),
    commit: (target: GitTarget, message: string): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitCommit, target, message),
    commitMessage: (target: GitTarget): Promise<CommitMessageResult> =>
      ipcRenderer.invoke(IPC.gitCommitMessage, target),
    createBranch: (target: GitTarget, name: string): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitCreateBranch, target, name),
    checkout: (target: GitTarget, name: string): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitCheckout, target, name),
    push: (target: GitTarget): Promise<GitResult> => ipcRenderer.invoke(IPC.gitPush, target),
    pull: (target: GitTarget): Promise<GitResult> => ipcRenderer.invoke(IPC.gitPull, target),
    publish: (target: GitTarget): Promise<GitResult> => ipcRenderer.invoke(IPC.gitPublish, target),
    worktrees: (target: GitTarget): Promise<GitWorktree[]> =>
      ipcRenderer.invoke(IPC.gitWorktrees, target),
    worktreeAdd: (target: GitTarget, path: string, branch?: string): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitWorktreeAdd, target, path, branch),
    worktreeRemove: (target: GitTarget, path: string, force?: boolean): Promise<GitResult> =>
      ipcRenderer.invoke(IPC.gitWorktreeRemove, target, path, force)
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
      ipcRenderer.invoke(IPC.cloudListBackups, limit),
    /** The user's online canvas space (null when signed out / none provisioned). */
    spaceStatus: (): Promise<CloudSpace | null> => ipcRenderer.invoke(IPC.cloudSpaceStatus),
    /** Mint a short-lived space access token and open the canvas URL with it in the system browser. */
    openSpace: (): Promise<void> => ipcRenderer.invoke(IPC.cloudSpaceOpen),
    /** Pull the space snapshot and import it as a NEW local project (main
     * handles collision-safe naming + scrollback persistence). */
    pullSpace: (): Promise<CloudSpacePullResult | CloudSpacePullEmpty> =>
      ipcRenderer.invoke(IPC.cloudSpacePull),
    /** Push the given project's nodes + scrollbacks to the space. */
    pushSpace: (projectId: string): Promise<CloudSpacePushResult> =>
      ipcRenderer.invoke(IPC.cloudSpacePush, projectId)
  },

  // GitHub on the desktop (Task 4): the repo listing and the import run in
  // MAIN with the cloud session cookie. The credential-bearing clone URL is
  // minted and consumed inside main — the renderer only ever sends
  // { fullName, name } and receives the clone's local path.
  github: {
    /** The connected account's repos (no cloneUrl — names + badges only). */
    repos: (): Promise<CloudGithubReposResult | CloudGithubFailure> =>
      ipcRenderer.invoke(IPC.githubRepos),
    /** Clone a picked repo into the default projects root; main mints the
     * import-url itself. Returns the new project's local path. */
    import: (req: { fullName: string; name: string }): Promise<CloudGithubImportResult | CloudGithubFailure> =>
      ipcRenderer.invoke(IPC.githubClone, req),
    /** Disconnect GitHub: wipe the stored token in the cloud vault. */
    disconnect: (): Promise<{ ok: true } | CloudGithubFailure> =>
      ipcRenderer.invoke(IPC.githubDisconnect)
  },

  browser: {
    /** Localhost-only CDP endpoint an external agent can attach to. */
    cdpInfo: (): Promise<BrowserCdpInfo> => ipcRenderer.invoke(IPC.browserCdpInfo),
    /** Tell main which live guest this browser-node tab owns (node + tab ids
     * are both stable canvas ids). */
    register: (nodeId: string, tabId: string, guestId: number): Promise<void> =>
      ipcRenderer.invoke(IPC.browserRegister, nodeId, tabId, guestId),
    unregister: (nodeId: string, tabId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.browserUnregister, nodeId, tabId),
    /** Navigate a browser-node tab; main enforces the URL policy. */
    navigate: (nodeId: string, tabId: string, url: string): Promise<BrowserNavigateResult> =>
      ipcRenderer.invoke(IPC.browserNavigate, nodeId, tabId, url),
    /** Subscribe to an external agent's "open a browser node" request. */
    onAgentOpen: (cb: (info: { url: string }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: { url: string }): void =>
        cb(info)
      ipcRenderer.on(IPC.browserAgentOpen, listener)
      return () => {
        ipcRenderer.removeListener(IPC.browserAgentOpen, listener)
      }
    }
  },

  chat: {
    /** Send the conversation for a chat node; events arrive via onEvent. */
    send: (req: { nodeId: string; messages: unknown[]; model?: string; provider?: string }): Promise<{ ok: boolean; error?: string; stopReason?: string }> =>
      ipcRenderer.invoke(IPC.chatSend, req),
    stop: (nodeId: string): Promise<void> => ipcRenderer.invoke(IPC.chatStop, nodeId),
    approve: (nodeId: string, callId: string, decision: 'approve' | 'deny'): Promise<void> =>
      ipcRenderer.invoke(IPC.chatApprove, nodeId, callId, decision),
    /** Subscribe to streamed chat events for one chat node. */
    onEvent: (nodeId: string, cb: (event: ChatEvent) => void): (() => void) => {
      const channel = chatEventChannel(nodeId)
      const listener = (_event: Electron.IpcRendererEvent, ev: ChatEvent): void => cb(ev)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  },

  // Node links (Phase 18): persisted typed edges — list, run, edit, dirty-signal.
  links: {
    list: (projectId: string): Promise<NodeLink[]> => ipcRenderer.invoke(IPC.linksList, projectId),
    run: (linkId: string): Promise<LinkRunResult> => ipcRenderer.invoke(IPC.linksRun, linkId),
    markDirty: (sourceId: string): Promise<void> => ipcRenderer.invoke(IPC.linksMarkDirty, sourceId),
    update: (projectId: string, links: NodeLink[]): Promise<number> =>
      ipcRenderer.invoke(IPC.linksUpdate, projectId, links),
    sendToPeer: (nodeId: string, peerId: string): Promise<LinkRunResult> =>
      ipcRenderer.invoke(IPC.linksSendToPeer, nodeId, peerId)
  },

  // Relay seam (Phase 11 Task 11.2, surfaced by audit B7): dial/disconnect the
  // E2E-encrypted relay and follow its connection state. Frames from the peer
  // arrive via onFrame (only while paired).
  relay: {
    status: (): Promise<{ state: string; error: string | null }> =>
      ipcRenderer.invoke(IPC.relayStatus),
    connect: (): Promise<{ ok: boolean; error?: string; pairing?: { peerLogin: string | null; selfId: string } }> =>
      ipcRenderer.invoke(IPC.relayConnect),
    disconnect: (): Promise<void> => ipcRenderer.invoke(IPC.relayDisconnect),
    onStatus: (cb: (status: { state: string; error: string | null }) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: { state: string; error: string | null }): void => cb(status)
      ipcRenderer.on(IPC.relayStatus, listener)
      return () => {
        ipcRenderer.removeListener(IPC.relayStatus, listener)
      }
    },
    onFrame: (cb: (frame: { from: string; text: string }) => void): (() => void) => {
      // Frames are push-gated: subscribing tells main to attach its frame
      // listener (audit B7 — no listener, no decrypted frames flowing).
      ipcRenderer.send(IPC.relayFrameSubscribe)
      const listener = (_event: Electron.IpcRendererEvent, frame: { from: string; text: string }): void => cb(frame)
      ipcRenderer.on('relay:frame', listener)
      return () => {
        ipcRenderer.removeListener('relay:frame', listener)
        ipcRenderer.send(IPC.relayFrameUnsubscribe)
      }
    }
  }
}

contextBridge.exposeInMainWorld('termsprawl', api)

export type TermsprawlApi = typeof api
