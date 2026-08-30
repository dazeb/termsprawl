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
  /** Remote project (Phase 9): when set, the terminal runs on the remote host
   * via ssh -tt + remote tmux instead of a local node-pty. */
  remote?: ProjectRemote
}

/** A remote project's ssh destination + the path on the remote host (Phase 9). */
export interface ProjectRemote {
  user?: string
  host: string
  port?: number
  path: string
}

/** Where a git/file op runs (Phase 9). A local folder project sends `cwd`; a
 * remote project sends `remote` (cwd null). Exactly one side is set by the
 * renderer; main validates both against the known project list. */
export interface GitTarget {
  /** Local project folder path (null for remote projects). */
  cwd?: string | null
  /** Remote project destination — ops run over ssh at `remote.path`. */
  remote?: ProjectRemote
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
  /** Live node size (top-level React Flow width/height), persisted so a
   * resized node remembers its size after a project switch / reopen. */
  width?: number
  height?: number
  /** Node `style` (the NodeResizer writes width/height here); restored so the
   * node renders at its saved size instead of reverting to content-measured. */
  style?: Record<string, unknown>
  data: Record<string, unknown>
}

export interface ProjectMeta {
  id: string
  name: string
  cwd: string | null
  /** Remote project (Phase 9): when set, cwd is null and the project's
   * terminal/git/file ops run over ssh on this host at `path`. */
  remote?: ProjectRemote
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

// Embedded browser node (Phase — browser node). A browser node is a sandboxed
// <webview> guest rendered inline in the canvas. The CDP endpoint (localhost
// only, random high port) is how an external agent attaches to drive it.
export interface BrowserCdpInfo {
  port: number
  /** Bearer token for a future gated CDP proxy; surfaced so the agent can carry it. */
  token: string
  /** http://127.0.0.1:<port> — hand this to connectOverCDP / puppeteer. */
  wsUrl: string
  /** 127.0.0.1 only — exposed for the agent's own trust decision. */
  host: string
}

export type BrowserNavigateResult =
  | { ok: true }
  | { ok: false; reason: 'UNKNOWN_NODE' | 'DENIED' }

// Diff node (Phase 6): original = git ref content, modified = working tree.
export type DiffBase = 'staged' | 'HEAD'

export interface DiffInfoResult {
  original: string | null
  modified: string | null
  error?: { code: 'NO_REPO' | 'MISSING' | 'IO'; message: string }
}

// Editor node (Phase 6): read/write a local file through core/file-service.
// 'OUTSIDE' added by the audit (B1): the Server Edition refuses paths that
// leave every known project folder.
export type FileErrorCode = 'MISSING' | 'IO' | 'UNSUPPORTED' | 'OUTSIDE'

export type FileReadResult =
  | { kind: 'text'; content: string }
  | { kind: 'markdown'; content: string }
  | { kind: 'image' }
  | { error: { code: FileErrorCode; message: string } }

export type FileWriteResult = { ok: true } | { error: { code: FileErrorCode; message: string } }

// Phase 12.2 — announcements. Parsing of a GitHub release payload. Pure,
// electron-free (the fetch lives in main).
export interface Announcement {
  /** Version without the leading 'v'. */
  version: string
  title: string
  body: string
}

// Phase — Termsprawl Cloud. Shapes mirror the web API contract
// (termsprawl-web/docs/cloud-app-integration.md).
export type CloudPlan = 'free' | 'pro'
export type CloudBackupStatus = 'ok' | 'restoring' | 'failed'
export type CloudSyncState = 'synced' | 'syncing' | 'idle' | 'error'

export interface CloudUser {
  id: string
  github_login: string
  name: string
  email: string
  avatar_url: string
  plan: CloudPlan
  created_at: string
}
export interface CloudBackup {
  id: string
  project: string
  size_bytes: number
  created_at: string
  status: CloudBackupStatus
}
export interface CloudBackupDetail extends CloudBackup {
  content: { project: string; name?: string; workspace: unknown; files: Record<string, unknown> }
}
export interface CloudSyncStatus {
  state: CloudSyncState
  last_backup_at: string | null
  storage_used_bytes: number
  storage_quota_bytes: number
  encryption: boolean
  /** Non-null while the web dashboard has asked this account to back up now. */
  backup_requested_at: string | null
}
/** GitHub device-flow start response (the app shows user_code + verification_uri). */
export interface CloudDeviceStart {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
  expires_in: number
  /** True only for the DEV_LOGIN seam (no real GitHub). */
  dev?: boolean
}
/** One device-flow poll; pending until the user approves. */
export interface CloudDevicePoll {
  status: 'pending' | 'ok'
  user?: CloudUser
  slow_down?: boolean
}

/** One online canvas space (Phase — online canvas spaces). Shapes mirror the
 * spaces API: GET /api/v1/spaces/mine → { space: CloudSpace | null },
 * POST /api/v1/spaces → { login, url, status }. The URL always comes from the
 * API response — it is never assembled client-side. */
export interface CloudSpace {
  login: string
  status: 'provisioning' | 'running' | 'stopped' | 'error'
  url: string
  lastActiveAt: string
}

/** POST /api/v1/spaces/access — a 5-minute JWT + the space URL for the
 * browser hand-off (the space-router validates `?t=<token>`). */
export interface CloudSpaceAccess {
  token: string
  url: string
}

/** cloud:space-pull result (D1 "Open online snapshot"): main pulls the space
 * content, imports the current project as a NEW local project (never
 * overwriting an existing one), and persists the snapshot's scrollbacks so
 * restored terminals replay history on their first cold start. The imported
 * project's raw persisted nodes ride along so the renderer can hydrate them
 * through its own deserializeNodes path. */
export interface CloudSpacePullResult {
  /** The freshly created local project the snapshot landed in. */
  project: ProjectMeta
  /** The imported project's persisted nodes (serialized shape). */
  nodes: SerializedNode[]
  /** How many scrollback entries were persisted into the store. */
  scrollbacksImported: number
  /** True when the space simply has no snapshot yet (404 no_content). */
  empty: false
}

/** cloud:space-pull when there is nothing online yet. */
export interface CloudSpacePullEmpty {
  empty: true
}

/** cloud:space-push result (D2 "Sync this project online"). */
export interface CloudSpacePushResult {
  ok: true
  /** Byte size the server reported for the stored snapshot. */
  bytes: number
  /** True when there was no space yet and main provisioned one first. */
  provisioned: boolean
}

export interface AppSettings {
  autoDownloadUpdates: boolean
  /** Managed agent accounts (7.6). v1: Claude only. Null active = default ~/.claude. */
  accounts: AgentAccount[]
  activeAccountId: string | null
  /** Announcements banner (12.2): the release version the user already dismissed. */
  dismissedAnnouncementVersion: string | null
  /** Termsprawl Cloud origin for the in-app sign-in + backup. Unset = https://termsprawl.com */
  cloudApiBase?: string
  /** Basic user profile: a display name shown in the user section. */
  displayName?: string
  /** Agent-to-agent peers (settings: A2A details). Config only — orchestration
   * is a later feature; the panel just manages the peer list. */
  a2aPeers?: A2APeer[]
  /** OSS/provider API endpoints (settings: API details). Non-secret config only —
   * keys are NOT stored here (would land plaintext in the settings JSON). */
  apiProviders?: ApiProviderConfig[]
  /** UI theme. 'system' follows the OS preference. Defaults to 'system'. */
  theme?: 'light' | 'dark' | 'system'
  /** UI language code (BCP-47). Cosmetic for now — English is the only shipped locale. */
  language?: string
  /** Default agent preset mode for new agents (e.g. 'standard'). */
  agentPreset?: string
  /** Default permission mode for new sessions. */
  defaultPermission?: string
  /** Enter behavior while an agent is busy: 'queue' | 'send' | 'prompt'. */
  enterBehavior?: string
  /** Allow external agents to control embedded browser nodes (13.4): when on,
   * the CDP facade + agent-control server are started (localhost-only); when
   * off (default) browser nodes still work manually but no agent endpoint
   * exists. */
  agentBrowserControl?: boolean
  /** Invert the mousewheel canvas zoom direction. Default (false): scroll up
   * zooms in. True: scroll up zooms out. */
  invertWheelZoom?: boolean
  /** Browser home page for new browser nodes + new tabs (14.1). Unset =
   * the app default (DuckDuckGo). */
  browserHomeUrl?: string
  /** Local Telegram bot (11.3). Token is the user's own bot secret — stored in
   * settings.json on this machine only (env TERMSPRAWL_TELEGRAM_TOKEN overrides
   * it in dev). Allowed chats = the paired phone(s); empty list = the first
   * chat to /start becomes the owner. */
  telegram?: TelegramSettings
  /** Chat driver v2 (11.4): default provider/model + stored API keys (local
   * machine only; env TERMSPRAWL_PROVIDER_KEY_<ID> overrides per key). */
  chat?: ChatSettings
  /** Relay service (11.2): the URL to dial + role. Nothing connects unless
   * the user asks (relay:connect IPC). */
  relay?: { url?: string; role?: 'host' | 'client'; invite?: string }
}

/** Telegram bot settings (Phase 11 Task 11.3). */
export interface TelegramSettings {
  enabled?: boolean
  token?: string
  allowedChatIds?: string[]
}

/** API key for one configured provider (Phase 11 Task 11.4). Stored in
 * settings.json on this machine only (same decision as the Telegram token);
 * env TERMSPRAWL_PROVIDER_KEY_<ID uppercased> overrides it. Never committed. */
export interface ProviderKey {
  providerId: string
  key: string
}

/** Chat driver v2 settings: which provider/model new chats default to, plus
 * the stored keys. Keys live here (local machine only), never in project
 * files. */
export interface ChatSettings {
  defaultProvider?: string
  defaultModel?: string
  keys?: ProviderKey[]
  /** Optional per-model price overrides ($/Mtok) for the cost chip. */
  priceOverrides?: Record<string, { in: number; out: number }>
}

/** A chat node's persisted state (Phase 11 Task 11.4). History rides in node
 * data, so it survives restarts via the project file (serialized with the
 * conversation's byte cap). Kept in sync with core/chat/types ChatMessage —
 * structural, because shared/ must not import core/. */
export interface ChatNodeData {
  kind: 'chat'
  provider?: string
  model?: string
  /** Slash/system preamble for this chat. */
  system?: string
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'system' | 'tool' | 'note'
    content: string
    thinking?: string
    toolCalls?: Array<{
      id: string
      name: string
      argsJson: string
      result?: string
      isError?: boolean
      status: 'running' | 'done' | 'error'
    }>
    stopped?: boolean
    usage?: { inputTokens: number; outputTokens: number }
    model?: string
    ts: number
  }>
  /** Running total for the cost chip (usd + estimated flag). */
  cost?: { usd: number; estimated: boolean }
  /** While a reply is streaming (cache only — never persisted mid-flight). */
  streaming?: boolean
}

/** An A2A (agent-to-agent) peer the user may route tasks to. */
export interface A2APeer {
  id: string
  label: string
  /** Base URL of the peer's A2A endpoint. */
  endpoint: string
}

/** A non-secret provider endpoint (name + base URL) for the chat/agent drivers. */
export interface ApiProviderConfig {
  id: string
  name: string
  baseUrl: string
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

// Source control (Phase 8): surface types shared by core git-service, main IPC,
// and the renderer panel.
export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface GitFileChange {
  path: string
  status: GitFileStatus
  staged: boolean
}

export interface GitBranchInfo {
  name: string
  current: boolean
}

export interface GitCommitInfo {
  hash: string
  author: string
  date: string
  subject: string
}

export interface GitSyncState {
  upstream: string | null
  ahead: number
  behind: number
}

export interface GitResult {
  code: number
  stdout: string
  stderr: string
}

// Phase 8.4 — AI commit message generation.
export type CommitAgentCli = 'claude' | 'codex'

export interface CommitMessageResult {
  ok: boolean
  /** Suggested conventional-commit subject; present only when ok === true. */
  message?: string
  /** Failure reason; present only when ok === false. */
  error?: string
  /** Which agent CLI produced the message (or none when unavailable). */
  tool?: CommitAgentCli | 'none'
}

export interface GitWorktree {
  path: string
  /** Branch name (e.g. "feature/x"), or null when detached. */
  branch: string | null
  /** Commit hash at the worktree's HEAD, or null when unknown. */
  head: string | null
}

export interface GitPanelSnapshot {
  cwd: string | null
  branch: string
  remote: string | null
  sync: GitSyncState
  changes: GitFileChange[]
  branches: GitBranchInfo[]
  commits: GitCommitInfo[]
  ghAuthed: boolean
}

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
