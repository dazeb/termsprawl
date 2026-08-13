// Shared types across main / preload / renderer.

export interface PtyCreateRequest {
  /** Stable per-node id; also the tmux session key (Phase 4). */
  id: string
  /** Shell to run; default: user's shell. */
  shell?: string
  /** Working directory; default: project cwd. */
  cwd?: string
  cols: number
  rows: number
  env?: Record<string, string>
}

export interface PtyCreateResult {
  id: string
  pid: number
  /** false = warm reattach (tmux redraws), true = cold start (Phase 4). */
  fresh: boolean
}

export interface PtyExitInfo {
  id: string
  exitCode: number
  signal?: number
}

// Serialized node shape for workspace persistence (mirrors core's
// SerializedNode so the renderer never imports core).
export interface SerializedNode {
  id: string
  type: string
  position: { x: number; y: number }
  /** Parent frame id (group nodes) — kept out of live state only because
   * React Flow owns it; persisted so groups survive a reopen. */
  parentId?: string
  data: Record<string, unknown>
}

export interface ProjectMeta {
  id: string
  name: string
  cwd: string | null
  closed: boolean
}

export interface WorkspaceSnapshot {
  index: { version: 1; projects: ProjectMeta[] }
  projects: Record<string, SerializedNode[]>
}
