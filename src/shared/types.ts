// Shared types across main / preload / renderer.

export interface PtyCreateRequest {
  /** Stable per-node id; also the tmux session key (Phase 4). */
  id: string
  /** Owning project, used to clean up live sessions before persistence settles. */
  projectId?: string
  /** Shell to run; default: user's shell. */
  shell?: string
  /** Working directory; default: project cwd. */
  cwd?: string
  /** Optional command to run instead of an interactive shell (e.g. `druk`).
   * Runs as `shell -lc <command>` so the user's login PATH applies. */
  command?: string
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

/** A destructive metadata operation committed; listed sessions still need retry cleanup. */
export interface DurableCleanupResult {
  committed: true
  cleanupPendingIds: string[]
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
  /** Archived = hidden from the tab bar, preserved; reopen restores it. */
  archived?: boolean
  /** Per-project settings (accent color, etc.), persisted in the index. */
  settings?: ProjectSettings
}

/** Per-project settings. Accent is a hex color used for the node accent dot. */
export interface ProjectSettings {
  accent?: string
}

export interface WorkspaceSnapshot {
  index: {
    version: 1
    projects: ProjectMeta[]
    pendingTerminalCleanup?: Array<{ projectId: string; terminalId: string }>
    pendingTerminalNodeCleanup?: Array<{ projectId: string; terminalId: string }>
    terminalTombstones?: Array<{ projectId: string; terminalId: string }>
  }
  projects: Record<string, SerializedNode[]>
}

// Diff node (Phase 6): original = git ref content, modified = working tree.
export type DiffBase = 'staged' | 'HEAD'

export interface DiffInfoResult {
  original: string | null
  modified: string | null
  error?: { code: 'NO_REPO' | 'MISSING' | 'IO'; message: string }
}

// Editor node (Phase 6): read/write a local file through core/file-service.
export type FileErrorCode = 'MISSING' | 'IO' | 'UNSUPPORTED'

export type FileReadResult =
  | { kind: 'text'; content: string }
  | { kind: 'markdown'; content: string }
  | { kind: 'image' }
  | { error: { code: FileErrorCode; message: string } }

export type FileWriteResult = { ok: true } | { error: { code: FileErrorCode; message: string } }

export interface AppSettings {
  autoDownloadUpdates: boolean
  /** Managed agent accounts (7.6). v1: Claude only. Null active = default ~/.claude. */
  accounts: AgentAccount[]
  activeAccountId: string | null
}

export interface AgentAccount {
  id: string
  label: string
  agentId: 'claude'
  /** Absolute path, under userData/accounts/<id>. Never store tokens here. */
  configDir: string
  /** Per-account permission mode; undefined = the CLI default. */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions'
}

export type DirEntryKind = 'dir' | 'file'

export interface DirEntry {
  name: string
  path: string
  kind: DirEntryKind
}

export type DirListResult =
  | { entries: DirEntry[] }
  | { error: { code: 'MISSING' | 'IO' | 'OUTSIDE'; message: string } }

// Agent status lives in shared/agent-status.ts (types + shouldNotify).

// Context links (Phase 7, 7.5): a link file per node pair under the project
// folder. IPC calls carry the project cwd; main validates it is a known
// project cwd (never an arbitrary root) before touching core.
export interface ContextLinkPair {
  a: string
  b: string
}

export type ContextLinkError = 'NO_FOLDER' | 'SELF' | 'BAD_ID' | 'IO'

export type ContextLinkListResult =
  | { ok: true; links: ContextLinkPair[] }
  | { ok: false; error: 'NO_FOLDER' }

export type ContextLinkWriteResult =
  | { ok: true }
  | { ok: false; error: ContextLinkError }
