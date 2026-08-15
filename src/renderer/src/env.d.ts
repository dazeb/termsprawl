import type {
  DiffBase,
  DiffInfoResult,
  ProjectMeta,
  PtyCreateRequest,
  PtyCreateResult,
  PtyExitInfo,
  SerializedNode,
  WorkspaceSnapshot
} from '@shared/types'

// The shape of window.termsprawl as exposed by the preload bridge.
declare global {
  interface Window {
    termsprawl: {
      appVersion(): Promise<string>
      workspace: {
        snapshot(): Promise<WorkspaceSnapshot>
        saveNodes(id: string, nodes: SerializedNode[]): Promise<number>
        addProject(name: string, cwd: string | null): Promise<ProjectMeta>
        closeProject(id: string): Promise<void>
        reopenProject(id: string): Promise<void>
        deleteProject(id: string): Promise<void>
        selectFolder(): Promise<string | null>
      }
      pty: {
        create(req: PtyCreateRequest): Promise<PtyCreateResult>
        write(id: string, data: string): void
        resize(id: string, cols: number, rows: number): void
        destroy(id: string): void
        readScrollback(id: string): Promise<string | null>
        onData(id: string, cb: (data: string) => void): () => void
        onExit(id: string, cb: (info: PtyExitInfo) => void): () => void
      }
      diff: {
        info(path: string, base: DiffBase): Promise<DiffInfoResult>
      }
      files: {
        openDialog(): Promise<string | null>
      }
    }
  }
}

export {}
