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
} from '@shared/types'
import type { AgentStatusEvent } from '@shared/agent-status'
import type { UpdateStatus } from '@shared/update-status'

// The shape of window.termsprawl as exposed by the preload bridge.
declare global {
  interface Window {
    termsprawl: {
      appVersion(): Promise<string>
      settings: {
        get(): Promise<AppSettings>
        set(patch: Partial<AppSettings>): Promise<AppSettings>
        createAccount(label: string): Promise<AppSettings>
        deleteAccount(id: string): Promise<AppSettings>
        permissionSupported(): Promise<boolean>
      }
      updates: {
        check(): Promise<UpdateStatus>
        download(): Promise<UpdateStatus>
        install(): Promise<void>
        dismiss(): Promise<UpdateStatus>
        onStatus(cb: (status: UpdateStatus) => void): () => void
      }
      workspace: {
        snapshot(): Promise<WorkspaceSnapshot>
        saveNodes(id: string, nodes: SerializedNode[]): Promise<number>
        addProject(name: string, cwd: string | null): Promise<ProjectMeta>
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
        info(path: string, base: DiffBase): Promise<DiffInfoResult>
      }
      files: {
        openDialog(): Promise<string | null>
        read(path: string): Promise<FileReadResult>
        write(path: string, content: string): Promise<FileWriteResult>
        list(root: string, rel?: string): Promise<DirListResult>
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
    }
  }
}

export {}
