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
