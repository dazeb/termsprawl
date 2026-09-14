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
  CloudGithubRepo,
  CloudUser,
  WorkspaceBundleExportResult,
  WorkspaceBundleImportResult,
  BrowserCdpInfo,
  BrowserNavigateResult,
  NodeLink,
  LinkRunResult,
  SettingsSkill, SettingsHook, SettingsCommand, SettingsCapabilities, UsageStats
  } from '@shared/types'
import type { AgentStatusEvent } from '@shared/agent-status'
import type { UpdateStatus } from '@shared/update-status'
import type { ChatEvent } from '../../core/chat/types'

// The shape of window.termsprawl as exposed by the preload bridge.
declare global {
  interface Window {
    termsprawl: {
      appVersion(): Promise<string>
      openExternal(url: string): Promise<void>
      /** Which edition serves this renderer — the settings panel shows only
       * surfaces that exist here (the Server Edition shim carries
       * runtime.kind = 'server'). */
      runtime: { kind: 'desktop' | 'server' }
      /** Runtime facts for UI gating (updates only work packaged). */
      runtimeInfo(): Promise<{ packaged: boolean }>
      settings: {
        get(): Promise<AppSettings>
        set(patch: Partial<AppSettings>): Promise<AppSettings>
        createAccount(label: string): Promise<AppSettings>
        deleteAccount(id: string): Promise<AppSettings>
        permissionSupported(): Promise<boolean>
        loginCommand(): Promise<string>
        capabilities(): Promise<SettingsCapabilities>
        usage(): Promise<UsageStats>
      }
      updates: {
        check(): Promise<UpdateStatus>
        download(): Promise<UpdateStatus>
        install(): Promise<void>
        dismiss(): Promise<UpdateStatus>
        onStatus(cb: (status: UpdateStatus) => void): () => void
      }
      announcements: {
        get(): Promise<Announcement | null>
      }
      workspace: {
        snapshot(): Promise<WorkspaceSnapshot>
        saveNodes(id: string, nodes: SerializedNode[]): Promise<number>
        /** Phase 16 — the whole workspace as ONE json file (save dialog). */
        exportBundle(): Promise<WorkspaceBundleExportResult>
        /** Pick a saved bundle and land it as NEW local projects (fresh ids,
         * collision-safe names, terminal ids remapped on collision). */
        importBundle(): Promise<WorkspaceBundleImportResult>
        addProject(name: string, cwd: string | null, remote?: ProjectRemote): Promise<ProjectMeta>
        closeProject(id: string): Promise<void>
        archiveProject(id: string): Promise<void>
        reopenProject(id: string): Promise<void>
        deleteProject(id: string): Promise<DurableCleanupResult>
        updateSettings(id: string, patch: ProjectSettings): Promise<void>
        renameProject(id: string, name: string): Promise<void>
        selectFolder(): Promise<string | null>
      }
      pty: {
        create(req: PtyCreateRequest): Promise<PtyCreateResult>
        write(id: string, data: string): void
        resize(id: string, cols: number, rows: number): void
        destroy(id: string): Promise<void>
        closeNode(projectId: string, id: string): Promise<DurableCleanupResult>
        readScrollback(id: string): Promise<string | null>
        onData(id: string, cb: (data: string) => void): () => void
        onExit(id: string, cb: (info: PtyExitInfo) => void): () => void
      }
      diff: {
        info(path: string, base: DiffBase, remote?: ProjectRemote): Promise<DiffInfoResult>
      }
      files: {
        openDialog(): Promise<string | null>
        read(path: string, remote?: ProjectRemote): Promise<FileReadResult>
        write(path: string, content: string, remote?: ProjectRemote): Promise<FileWriteResult>
        list(root: string, rel?: string, remote?: ProjectRemote): Promise<DirListResult>
      }
      agent: {
        onStatus(sessionId: string, cb: (event: AgentStatusEvent) => void): () => void
        onSessionName(
          sessionId: string,
          cb: (info: { sessionId: string; name: string }) => void
        ): () => void
      }
      contextLinks: {
        list(cwd: string): Promise<ContextLinkListResult>
        add(cwd: string, a: string, b: string): Promise<ContextLinkWriteResult>
        remove(cwd: string, a: string, b: string): Promise<ContextLinkWriteResult>
      }
      git: {
        snapshot(target: GitTarget): Promise<GitPanelSnapshot>
        stage(target: GitTarget, paths: string[]): Promise<GitResult>
        unstage(target: GitTarget, paths: string[]): Promise<GitResult>
        discard(target: GitTarget, paths: string[]): Promise<GitResult>
        commit(target: GitTarget, message: string): Promise<GitResult>
        commitMessage(target: GitTarget): Promise<CommitMessageResult>
        createBranch(target: GitTarget, name: string): Promise<GitResult>
        checkout(target: GitTarget, name: string): Promise<GitResult>
        push(target: GitTarget): Promise<GitResult>
        pull(target: GitTarget): Promise<GitResult>
        publish(target: GitTarget): Promise<GitResult>
        worktrees(target: GitTarget): Promise<GitWorktree[]>
        worktreeAdd(target: GitTarget, path: string, branch?: string): Promise<GitResult>
        worktreeRemove(target: GitTarget, path: string, force?: boolean): Promise<GitResult>
      }
      cloud: {
        status(): Promise<CloudUser | null>
        deviceStart(): Promise<CloudDeviceStart>
        devicePoll(deviceCode: string): Promise<CloudDevicePoll>
        signOut(): Promise<void>
        backupNow(): Promise<CloudBackup>
        listBackups(limit?: number): Promise<CloudBackup[]>
        /** The user's online canvas space (null when signed out / none provisioned). */
        spaceStatus(): Promise<CloudSpace | null>
        /** Mint a short-lived access token and open the canvas URL in the system browser (Pro). */
        openSpace(): Promise<void>
        /** Pull the space snapshot and import it as a NEW local project (main
         * handles collision-safe naming + scrollback persistence). */
        pullSpace(): Promise<CloudSpacePullResult | CloudSpacePullEmpty>
        /** Push the given project's nodes + scrollbacks to the space. */
        pushSpace(projectId: string): Promise<CloudSpacePushResult>
      }
      github: {
        /** The connected account's repos (names + private badge; main strips
         * cloneUrl — the renderer never receives a URL of any kind). */
        repos(): Promise<CloudGithubReposResult | CloudGithubFailure>
        /** Clone a picked repo into the default projects root and return its
         * local path. Main mints the credential-bearing import-url itself;
         * the renderer sends only { fullName, name }. */
        import(req: { fullName: string; name: string }): Promise<CloudGithubImportResult | CloudGithubFailure>
        /** Disconnect GitHub: wipe the stored token in the cloud vault. */
        disconnect(): Promise<{ ok: true } | CloudGithubFailure>
      }
      browser: {
        cdpInfo(): Promise<BrowserCdpInfo>
        register(nodeId: string, tabId: string, guestId: number): Promise<void>
        unregister(nodeId: string, tabId: string): Promise<void>
        navigate(nodeId: string, tabId: string, url: string): Promise<BrowserNavigateResult>
        onAgentOpen(cb: (info: { url: string }) => void): () => void
      }
      chat: {
        send(req: {
          nodeId: string
          messages: unknown[]
          model?: string
          provider?: string
        }): Promise<{ ok: boolean; error?: string; stopReason?: string }>
        stop(nodeId: string): Promise<void>
        approve(nodeId: string, callId: string, decision: 'approve' | 'deny'): Promise<void>
        onEvent(nodeId: string, cb: (event: ChatEvent) => void): () => void
      }
      links: {
        list(projectId: string): Promise<NodeLink[]>
        run(linkId: string): Promise<LinkRunResult>
        markDirty(sourceId: string): Promise<void>
        update(projectId: string, links: NodeLink[]): Promise<number>
        sendToPeer(nodeId: string, peerId: string): Promise<LinkRunResult>
      }
      relay: {
        status(): Promise<{ state: string; error: string | null }>
        connect(): Promise<{
          ok: boolean
          error?: string
          pairing?: { peerLogin: string | null; peerPub: string | null; selfId: string; fingerprint: string | null }
        }>
        mintInvite(): Promise<{ ok: boolean; code?: string; error?: string }>
        disconnect(): Promise<void>
        /** Send a serialized relay-term frame (client → host). */
        sendFrame(frame: string): Promise<{ ok: boolean; error?: string }>
        onStatus(cb: (status: { state: string; error: string | null }) => void): () => void
        onFrame(cb: (frame: { from: string; text: string }) => void): () => void
      }
    }
  }
}

export {}
